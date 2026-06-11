import io
import os
import re
import json
import contextlib
import xml.etree.ElementTree as ET
from functools import lru_cache

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw
import cv2
import torch
from transformers import (
    VisionEncoderDecoderModel,
    PreTrainedTokenizerFast,
    TrOCRProcessor,
)
from flask import Flask, request, jsonify, render_template_string
import tempfile
import joblib
import base64

# ----------------------------------------------------------------------
# Configuration

MAX_LEN: int = 128
TOPK: int = 3
MAX_LINES: int = 120
RESIZE_MAX_SIDE: int = 800
REL_PROB_TH: float = 0.70
CLEANUP: re.Pattern = re.compile(r"[\u00AD\u200B\u200C\u200D]")

app = Flask(__name__)

# ----------------------------------------------------------------------
# Model + calibrator loading

@lru_cache(maxsize=1)
def load_beta_calibrator():
    return joblib.load("beta_calibrator.joblib")


@lru_cache(maxsize=1)
def load_model():
    model_path = "AnjaliSarawgi/model-fullset-57k"
    hf_token = os.environ.get("HF_TOKEN")
    model = VisionEncoderDecoderModel.from_pretrained(model_path, token=hf_token)
    tokenizer = PreTrainedTokenizerFast.from_pretrained(model_path, token=hf_token)
    processor = TrOCRProcessor.from_pretrained("microsoft/trocr-large-handwritten", token=None)
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model.to(device).eval()
    return model, tokenizer, processor, device


# ----------------------------------------------------------------------
# Utility functions

def clean_text(text: str) -> str:
    return CLEANUP.sub("", text)


def prepare_image(image: Image.Image, max_side: int = RESIZE_MAX_SIDE) -> Image.Image:
    img = image.convert("RGB")
    w, h = img.size
    if max(w, h) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img


def get_amp_ctx():
    return torch.cuda.amp.autocast if torch.cuda.is_available() else contextlib.nullcontext


def pil_to_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ----------------------------------------------------------------------
# Preprocessing

def apply_sauvola(pil_img, window_size=35, k=0.2):
    from skimage.filters import threshold_sauvola
    img_gray = np.array(pil_img.convert("L"))
    thresh = threshold_sauvola(img_gray, window_size=window_size, k=k)
    binary = (img_gray > thresh).astype(np.uint8) * 255
    return Image.fromarray(binary).convert("RGB")


def apply_clahe(pil_img, clip_limit=30.0, tile_grid_size=4):
    img_gray = cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_grid_size, tile_grid_size))
    enhanced = clahe.apply(img_gray)
    return Image.fromarray(cv2.cvtColor(enhanced, cv2.COLOR_GRAY2RGB))


def apply_gaussian_normalization(pil_img, kernel_size=201, sigma=201):
    image = np.array(pil_img.convert("RGB")).astype(np.float32)
    ks = kernel_size if kernel_size % 2 == 1 else kernel_size + 1
    background = cv2.GaussianBlur(image, (ks, ks), sigmaX=sigma)
    normalized = np.clip(image / (background + 1e-6) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(normalized)


def apply_morph_opening(pil_img, kernel_size=7):
    image = np.array(pil_img.convert("RGB"))
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    inverted = cv2.bitwise_not(gray)
    opened = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, kernel)
    result = cv2.bitwise_not(opened)
    return Image.fromarray(cv2.cvtColor(result, cv2.COLOR_GRAY2RGB))


# ----------------------------------------------------------------------
# XML parsing and segmentation

def parse_boxes_from_xml(xml_bytes, level="line", image_size=None):
    def _strip_ns(elem):
        for e in elem.iter():
            if isinstance(e.tag, str) and e.tag.startswith("{"):
                e.tag = e.tag.split("}", 1)[1]

    root = ET.parse(io.BytesIO(xml_bytes)).getroot()
    _strip_ns(root)
    boxes = []

    if root.tag.lower() == "alto":
        tag_map = {"block": "TextBlock", "line": "TextLine", "word": "String"}
        tag = tag_map.get(level, "TextLine")
        page_el = root.find(".//Page")
        page_w = page_h = None
        if page_el is not None:
            try:
                page_w = float(page_el.get("WIDTH") or 0)
                page_h = float(page_el.get("HEIGHT") or 0)
            except Exception:
                page_w = page_h = None
        sx = sy = 1.0
        if image_size and page_w and page_h:
            img_w, img_h = image_size
            sx = (img_w / page_w) if page_w else 1.0
            sy = (img_h / page_h) if page_h else 1.0
        for el in root.findall(f".//{tag}"):
            poly = el.find(".//Shape/Polygon")
            got_box = False
            pts = None
            if poly is not None and poly.get("POINTS"):
                raw = poly.get("POINTS").strip()
                tokens = re.split(r"[ ,]+", raw)
                nums = []
                for t in tokens:
                    try:
                        nums.append(float(t))
                    except Exception:
                        pass
                pts = []
                if len(nums) >= 6 and len(nums) % 2 == 0:
                    for i in range(0, len(nums), 2):
                        pts.append((nums[i] * sx, nums[i + 1] * sy))
                if pts:
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    x1, x2 = int(min(xs)), int(max(xs))
                    y1, y2 = int(min(ys)), int(max(ys))
                    got_box = (x2 > x1 and y2 > y1)
            if not got_box:
                try:
                    hpos = float(el.get("HPOS", 0)) * sx
                    vpos = float(el.get("VPOS", 0)) * sy
                    width = float(el.get("WIDTH", 0)) * sx
                    height = float(el.get("HEIGHT", 0)) * sy
                    x1, y1 = int(hpos), int(vpos)
                    x2, y2 = int(hpos + width), int(vpos + height)
                except Exception:
                    continue
                if x2 <= x1 or y2 <= y1:
                    continue
            label = tag if tag != "String" else (el.get("CONTENT") or "String")
            boxes.append({
                "label": label,
                "bbox": [x1, y1, x2, y2],
                "source": "alto",
                "id": el.get("ID", ""),
                **({"points": pts} if pts else {}),
            })
        return boxes

    for region in root.findall(".//TextRegion"):
        coords = region.find(".//Coords")
        pts_attr = coords.get("points") if coords is not None else None
        if not pts_attr:
            continue
        pts = []
        for token in pts_attr.strip().split():
            if "," in token:
                xx, yy = token.split(",", 1)
                try:
                    pts.append((float(xx), float(yy)))
                except Exception:
                    pass
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x1, x2 = int(min(xs)), int(max(xs))
        y1, y2 = int(min(ys)), int(max(ys))
        if x2 > x1 and y2 > y1:
            boxes.append({
                "label": "TextRegion",
                "bbox": [x1, y1, x2, y2],
                "source": "page",
                "id": region.get("id", ""),
            })
    if boxes:
        return boxes

    for obj in root.findall(".//object"):
        bb = obj.find("bndbox")
        if bb is None:
            continue
        try:
            xmin = int(float(bb.findtext("xmin")))
            ymin = int(float(bb.findtext("ymin")))
            xmax = int(float(bb.findtext("xmax")))
            ymax = int(float(bb.findtext("ymax")))
            if xmax > xmin and ymax > ymin:
                boxes.append({
                    "label": (obj.findtext("name") or "region").strip(),
                    "bbox": [xmin, ymin, xmax, ymax],
                    "source": "voc",
                    "id": obj.findtext("name") or "",
                })
        except Exception:
            pass
    return boxes


def sort_boxes_reading_order(boxes, y_tol=10):
    def key(b):
        x1, y1, x2, y2 = b["bbox"]
        return (round(y1 / max(1, y_tol)), y1, x1)
    return sorted(boxes, key=key)


def draw_boxes(img, boxes):
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    thickness = max(3, min(base.size) // 200)
    for i, b in enumerate(boxes, 1):
        if "points" in b and b["points"]:
            pts = [(int(x), int(y)) for x, y in b["points"]]
            draw.polygon(pts, outline=(255, 0, 0, 255), fill=(255, 0, 0, 64))
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x1, y1 = min(xs), min(ys)
        else:
            x1, y1, x2, y2 = map(int, b["bbox"])
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0, 255), width=thickness, fill=(255, 0, 0, 64))
        tag_w, tag_h = 40, 24
        draw.rectangle([x1, y1, x1 + tag_w, y1 + tag_h], fill=(255, 0, 0, 190))
        draw.text((x1 + 6, y1 + 4), str(i), fill=(255, 255, 255, 255))
    return Image.alpha_composite(base, overlay).convert("RGB")


# ----------------------------------------------------------------------
# OCR inference

def predict_and_score_once(image, line_id=1, topk=TOPK):
    model, tokenizer, processor, device = load_model()
    img = prepare_image(image)
    pixel_values = processor(images=img, return_tensors="pt").pixel_values.to(device)
    amp_ctx = get_amp_ctx()
    with torch.inference_mode(), amp_ctx():
        try:
            out = model.generate(
                pixel_values,
                max_length=100,
                num_beams=1,
                do_sample=False,
                return_dict_in_generate=True,
                output_scores=True,
                use_cache=True,
                eos_token_id=tokenizer.eos_token_id,
            )
        except RuntimeError as e:
            if "out of memory" in str(e).lower():
                out = model.generate(
                    pixel_values,
                    max_length=MAX_LEN,
                    num_beams=1,
                    do_sample=False,
                    return_dict_in_generate=True,
                    output_scores=False,
                    use_cache=True,
                    eos_token_id=tokenizer.eos_token_id,
                )
            else:
                raise

    seq = out.sequences[0]
    decoded_text = clean_text(tokenizer.decode(seq, skip_special_tokens=True))
    tokens_rows = []
    for step, (logits, tgt) in enumerate(zip(out.scores, seq[1:]), start=1):
        probs = torch.softmax(logits[0].float().cpu(), dim=-1)
        tgt_id = int(tgt.item())
        conf = float(probs[tgt_id].item())

        beta = load_beta_calibrator()
        p = np.clip(conf, 1e-6, 1 - 1e-6)
        cal_conf = beta.predict_proba([[np.log(p), np.log(1 - p)]])[0, 1]

        tk_vals, tk_idx = torch.topk(probs, k=min(topk, probs.shape[0]))
        tk_idx = tk_idx.tolist()
        tk_vals = tk_vals.tolist()
        if tgt_id in tk_idx:
            j = tk_idx.index(tgt_id)
            tk_idx.pop(j)
            tk_vals.pop(j)
        alt_ids = [tgt_id] + tk_idx[: topk - 1]
        alt_ps = [conf] + tk_vals[: topk - 1]
        alt_tokens = [tokenizer.decode([i], skip_special_tokens=True) for i in alt_ids]
        entropy = float((-probs * (probs.clamp_min(1e-12).log())).sum().item())
        gap12 = float(alt_ps[0] - (alt_ps[1] if len(alt_ps) > 1 else 0.0))
        rel_prob = float((alt_ps[1] / alt_ps[0]) if (len(alt_ps) > 1 and alt_ps[0] > 0) else 0.0)
        tokens_rows.append({
            "line_id": line_id,
            "seq_pos": step,
            "token_id": tgt_id,
            "token": alt_tokens[0],
            "confidence": conf,
            "rel_prob": rel_prob,
            "entropy": entropy,
            "gap12": gap12,
            "alt_tokens": "|".join(alt_tokens),
            "alt_probs": "|".join([f"{p:.6f}" for p in alt_ps]),
            "cal_confidence": float(cal_conf),
        })
        del probs
    df = pd.DataFrame(tokens_rows, columns=[
        "line_id", "seq_pos", "token_id", "token", "confidence",
        "cal_confidence", "rel_prob", "entropy", "gap12", "alt_tokens", "alt_probs",
    ])
    return decoded_text, df


# ----------------------------------------------------------------------
# Akshara splitting + highlighting

DEV_CONS = "\u0915-\u0939\u0958-\u095F\u0978-\u097F"
INDEP_VOW = "\u0904-\u0914"
NUKTA = "\u093C"
VIRAMA = "\u094D"
MATRAS = "\u093A-\u094C"
BINDUS = "\u0901\u0902\u0903"
AKSHARA_RE = re.compile(
    rf"(?:"
    rf"(?:[{DEV_CONS}]{NUKTA}?)(?:{VIRAMA}(?:[{DEV_CONS}]{NUKTA}?))*"
    rf"(?:[{MATRAS}])?"
    rf"(?:[{BINDUS}])?"
    rf"|"
    rf"(?:[{INDEP_VOW}](?:[{BINDUS}])?)"
    rf")",
    flags=re.UNICODE,
)


def split_aksharas(s):
    spans = []
    i = 0
    while i < len(s):
        m = AKSHARA_RE.match(s, i)
        if m and m.end() > i:
            spans.append((m.start(), m.end()))
            i = m.end()
        else:
            spans.append((i, i + 1))
            i += 1
    return [s[a:b] for (a, b) in spans], spans


def _html_escape(s):
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def highlight_tokens_with_tooltips(line_text, df_tok, red_threshold, metric_column):
    aks, spans = split_aksharas(line_text)
    joined = "".join(aks)
    used_ranges = []
    insertions = []
    for _, row in df_tok.iterrows():
        token = row.get("token", "").strip()
        try:
            val = float(row.get(metric_column, 0))
        except Exception:
            continue
        if not token:
            continue
        start_char_idx = joined.find(token)
        if start_char_idx == -1:
            continue
        ak_start = ak_end = None
        cum_len = 0
        for i, ak in enumerate(aks):
            next_len = cum_len + len(ak)
            if cum_len <= start_char_idx < next_len:
                ak_start = i
            if cum_len < start_char_idx + len(token) <= next_len:
                ak_end = i + 1
                break
            cum_len = next_len
        if ak_start is None or ak_end is None:
            continue
        if any(r[0] < ak_end and ak_start < r[1] for r in used_ranges):
            continue
        used_ranges.append((ak_start, ak_end))
        char_start = spans[ak_start][0]
        char_end = spans[ak_end - 1][1]
        alt_toks = row.get("alt_tokens", "").split("|")
        alt_probs = row.get("alt_probs", "").split("|")
        token_str = _html_escape(line_text[char_start:char_end])
        tooltip_lines = [f"Character: {token_str}"]
        cal = row.get("cal_confidence", None)
        conf_pct = cal * 100 if cal is not None else None
        if conf_pct is None:
            conf_cls = "conf-unknown"
        elif conf_pct <= 20:
            conf_cls = "conf-red"
        elif conf_pct <= 40:
            conf_cls = "conf-orange"
        elif conf_pct <= 60:
            conf_cls = "conf-yellow"
        else:
            conf_cls = "conf-green"
        if cal is not None:
            tooltip_lines.append(f"probability of correctness: {cal:.2f}")
        for t, p in zip(alt_toks, alt_probs):
            try:
                prob = float(p)
            except Exception:
                prob = 0.0
            tooltip_lines.append(f"{_html_escape(t)}: {prob:.3f}")
        tooltip = "\n".join(tooltip_lines)
        cls = f"ocr-token {conf_cls}"
        html_token = (
            f"<span class='{cls}' data-tooltip='{_html_escape(tooltip)}'>"
            f"{token_str}</span>"
        )
        insertions.append((char_start, char_end, html_token))
    if not insertions:
        return _html_escape(line_text)
    insertions.sort()
    out_parts = []
    last_idx = 0
    for s, e, html_tok in insertions:
        out_parts.append(_html_escape(line_text[last_idx:s]))
        out_parts.append(html_tok)
        last_idx = e
    out_parts.append(_html_escape(line_text[last_idx:]))
    return "".join(out_parts)


# ----------------------------------------------------------------------
# Core OCR runner

def _run_ocr_on_image(pil_img, xml_bytes=None, progress_queue=None):
    boxes = []
    if xml_bytes:
        try:
            boxes = parse_boxes_from_xml(xml_bytes, level="line", image_size=pil_img.size)
            boxes = sort_boxes_reading_order(boxes)[:MAX_LINES]
        except Exception:
            boxes = []

    all_dfs = []
    all_texts = []
    all_html_lines = []

    if boxes:
        total = len(boxes)
        for idx, b in enumerate(boxes, 1):
            if progress_queue:
                progress_queue.put(('progress', idx, total, f"Line {idx} of {total}"))
            x1, y1, x2, y2 = b["bbox"]
            pad = 4
            crop = pil_img.crop((
                max(0, x1 - pad), max(0, y1 - pad),
                min(pil_img.width, x2 + pad), min(pil_img.height, y2 + pad)
            ))
            try:
                text, df = predict_and_score_once(crop, line_id=idx)
            except Exception as e:
                text, df = f"[error: {e}]", pd.DataFrame()
            all_texts.append(text)
            all_dfs.append(df)
            if not df.empty:
                html_line = highlight_tokens_with_tooltips(text, df, REL_PROB_TH, "cal_confidence")
            else:
                html_line = _html_escape(text)
            all_html_lines.append(f'<div class="ocr-line">{html_line}</div>')
    else:
        # No XML — run OCR on the full image as a single region
        if progress_queue:
            progress_queue.put(('progress', 1, 1, "Processing full image"))
        try:
            text, df = predict_and_score_once(pil_img, line_id=1)
        except Exception as e:
            text, df = f"[error: {e}]", pd.DataFrame()
        all_texts.append(text)
        all_dfs.append(df)
        if not df.empty:
            html_line = highlight_tokens_with_tooltips(text, df, REL_PROB_TH, "cal_confidence")
        else:
            html_line = _html_escape(text)
        all_html_lines.append(f'<div class="ocr-line">{html_line}</div>')

    overlay_img = draw_boxes(pil_img, boxes) if boxes else pil_img.copy()
    predicted_html = "\n".join(all_html_lines)
    plain_text = "\n".join(all_texts)

    return overlay_img, predicted_html, plain_text


# ----------------------------------------------------------------------
# HTML template — clean academic design

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HTR — Old Nepali Manuscripts</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #f7f6f2;
    --surface:   #ffffff;
    --surface-2: #f2f1ed;
    --border:    rgba(0,0,0,0.10);
    --border-md: rgba(0,0,0,0.18);
    --text-1:    #111111;
    --text-2:    #555555;
    --text-3:    #999999;
    --accent:    #111111;
    --radius-md: 8px;
    --radius-lg: 12px;
  }

  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    background: var(--bg);
    color: var(--text-1);
    min-height: 100vh;
  }

  /* ---- Top bar ---- */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--surface);
    border-bottom: 0.5px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32px;
    height: 52px;
  }
  .topbar-brand { display: flex; align-items: baseline; gap: 10px; }
  .topbar-brand h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
  .topbar-brand span { font-size: 12px; color: var(--text-3); }

  /* ---- Step indicator ---- */
  .steps { display: flex; align-items: center; gap: 0; }
  .step {
    display: flex; align-items: center; gap: 8px;
    padding: 0 16px; height: 52px;
    font-size: 13px; color: var(--text-3);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    user-select: none;
  }
  .step:hover { color: var(--text-2); }
  .step.active { color: var(--text-1); border-bottom-color: var(--text-1); }
  .step.done { color: var(--text-2); }
  .step-num {
    width: 20px; height: 20px; border-radius: 50%;
    border: 0.5px solid var(--border-md);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 500; flex-shrink: 0;
  }
  .step.active .step-num { background: var(--text-1); color: #fff; border-color: var(--text-1); }
  .step.done .step-num { background: #e6f4ec; color: #2a7a4b; border-color: #c0dece; }
  .step-divider { width: 20px; height: 0.5px; background: var(--border); flex-shrink: 0; }

  /* ---- Layout ---- */
  .content { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }

  .workspace {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 20px;
    align-items: start;
  }
  .image-sidebar {
    position: sticky;
    top: 72px;
  }
  .sidebar-preview {
    border: 0.5px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-2);
    min-height: 220px;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column;
  }
  .sidebar-preview img { width: 100%; object-fit: contain; display: block; }
  .sidebar-placeholder { font-size: 12px; color: var(--text-3); padding: 32px 16px; text-align: center; line-height: 1.6; }
  .sidebar-label { font-size: 11px; color: var(--text-3); padding: 6px 10px; background: var(--surface-2); border-top: 0.5px solid var(--border); text-align: center; width: 100%; }

  .tab-col { min-width: 0; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .section-label {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-3); margin-bottom: 12px;
  }

  /* ---- Cards ---- */
  .card {
    background: var(--surface);
    border: 0.5px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px 24px;
    margin-bottom: 14px;
  }
  .card-header {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-3); margin-bottom: 16px;
  }
  .card-header svg { flex-shrink: 0; }

  /* ---- Upload zones ---- */
  .upload-zone {
    border: 0.5px dashed var(--border-md);
    border-radius: var(--radius-md);
    padding: 22px 16px; text-align: center;
    cursor: pointer; position: relative;
    background: var(--surface-2);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    transition: border-color 0.15s, background 0.15s;
  }
  .upload-zone:hover { border-color: var(--text-2); background: #eceae4; }
  .upload-zone input[type=file] {
    position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
  }
  .uz-icon { font-size: 20px; color: var(--text-3); }
  .uz-label { font-size: 13px; color: var(--text-2); }
  .uz-sub { font-size: 11px; color: var(--text-3); }
  .uz-filename { font-size: 12px; font-weight: 500; color: var(--text-1); margin-top: 2px; }

  /* ---- Method checkboxes ---- */
  .method-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
  .method-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border: 0.5px solid var(--border);
    border-radius: var(--radius-md); font-size: 13px; cursor: pointer;
  }
  .method-row:hover { background: var(--surface-2); }
  .method-row input[type=checkbox] { accent-color: var(--text-1); cursor: pointer; width: 14px; height: 14px; }
  .method-note { font-size: 11px; color: var(--text-3); margin-top: 10px; line-height: 1.6; }

  /* ---- Parameter panels ---- */
  .param-group {
    background: var(--surface-2); border-radius: var(--radius-md);
    padding: 14px 16px; margin-top: 10px; display: none;
  }
  .param-group.visible { display: block; }
  .param-group-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--text-3); margin-bottom: 12px;
  }
  .param-row {
    display: grid; grid-template-columns: 160px 1fr 48px;
    align-items: center; gap: 10px; margin-bottom: 8px;
  }
  .param-row:last-child { margin-bottom: 0; }
  .param-row label { font-size: 12px; color: var(--text-2); }
  .param-row input[type=range] { accent-color: var(--text-1); }
  .param-row .val { font-size: 12px; color: var(--text-1); text-align: right; }

  /* ---- Preview image ---- */
  .preview-frame {
    border: 0.5px solid var(--border);
    border-radius: var(--radius-md); overflow: hidden; margin-top: 14px;
  }
  .preview-frame img {
    width: 100%; max-height: 260px; object-fit: contain;
    background: var(--surface-2); display: none; display: block;
  }
  .preview-placeholder {
    height: 160px; background: var(--surface-2);
    display: flex; align-items: center; justify-content: center;
  }
  .preview-placeholder span { font-size: 12px; color: var(--text-3); }
  .preview-label {
    font-size: 11px; color: var(--text-3); padding: 6px 12px;
    background: var(--surface-2); border-top: 0.5px solid var(--border);
  }

  /* ---- Buttons ---- */
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 500;
    border-radius: var(--radius-md); cursor: pointer;
    border: 0.5px solid var(--border-md);
    background: var(--surface); color: var(--text-1);
    transition: background 0.12s;
  }
  .btn:hover { background: var(--surface-2); }
  .btn:active { opacity: 0.8; }
  .btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .btn-primary {
    background: var(--text-1); color: #fff; border-color: var(--text-1);
  }
  .btn-primary:hover { opacity: 0.85; background: var(--text-1); }

  .action-bar { display: flex; align-items: center; gap: 10px; margin-top: 20px; }
  .status-text { font-size: 12px; color: var(--text-3); }
  .status-error { font-size: 12px; color: #c0392b; }

  /* ---- Progress ---- */
  .progress-wrap { margin-top: 14px; }
  .progress-track {
    height: 3px; background: var(--surface-2);
    border-radius: 2px; overflow: hidden;
    border: 0.5px solid var(--border);
  }
  .progress-bar { height: 100%; width: 0%; background: var(--text-1); border-radius: 2px; transition: width 0.3s; }
  .progress-meta { display: flex; justify-content: space-between; margin-top: 6px; }
  .progress-meta span { font-size: 11px; color: var(--text-3); }

  /* ---- Results ---- */
  .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  #overlay-img { width: 100%; border-radius: var(--radius-md); border: 0.5px solid var(--border); }

  .legend-row { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

  /* ---- Prediction box ---- */
  #prediction-box {
    font-size: 18px; line-height: 2.0;
    min-height: 100px; padding: 4px 0;
    color: var(--text-1);
  }
  .ocr-token {
    cursor: help; position: relative;
    text-decoration: underline; text-decoration-thickness: 2px;
  }
  .conf-red    { text-decoration-color: rgba(192, 57, 43, 0.85); }
  .conf-orange { text-decoration-color: rgba(211, 84, 0, 0.85); }
  .conf-yellow { text-decoration-color: rgba(183, 149, 11, 0.85); }
  .conf-green  { text-decoration-color: rgba(39, 174, 96, 0.85); }
  .ocr-token::after {
    content: attr(data-tooltip);
    white-space: pre-line;
    position: absolute; left: 0; bottom: 120%;
    background: #1a1a1a; color: #f5f5f5;
    padding: 8px 10px; border-radius: 6px;
    font-size: 12px; line-height: 1.5;
    min-width: 180px; max-width: 300px;
    z-index: 1000; opacity: 0; pointer-events: none;
    transition: opacity 0.15s;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  .ocr-token:hover::after { opacity: 1; }

  /* ---- Edit textarea ---- */
  #edited-text {
    width: 100%; min-height: 100px; font-size: 14px;
    padding: 12px; border: 0.5px solid var(--border);
    border-radius: var(--radius-md); resize: vertical;
    font-family: inherit; background: var(--surface-2);
    color: var(--text-1); line-height: 1.7;
  }
  #edited-text:focus { outline: none; border-color: var(--border-md); }

  /* ---- Spinner ---- */
  .spinner {
    display: none; width: 14px; height: 14px;
    border: 1.5px solid rgba(255,255,255,0.3);
    border-top-color: #fff; border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ---- Lightbox ---- */
  .sidebar-preview img { cursor: zoom-in; }
  #lightbox {
    display: none;
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.85);
    align-items: center; justify-content: center;
    cursor: zoom-out;
    animation: lb-in 0.18s ease;
  }
  #lightbox.open { display: flex; }
  #lightbox img {
    max-width: 90vw; max-height: 90vh;
    object-fit: contain;
    border-radius: var(--radius-md);
    box-shadow: 0 8px 48px rgba(0,0,0,0.6);
    pointer-events: none;
  }
  #lightbox-close {
    position: fixed; top: 20px; right: 24px;
    width: 32px; height: 32px;
    background: rgba(255,255,255,0.12);
    border: 0.5px solid rgba(255,255,255,0.2);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: #fff; font-size: 16px;
  }
  #lightbox-close:hover { background: rgba(255,255,255,0.22); }
  @keyframes lb-in { from { opacity: 0; } to { opacity: 1; } }
</style>
</head>
<body>

<!-- Lightbox -->
<div id="lightbox" role="dialog" aria-label="Image zoom" onclick="closeLightbox()">
  <div id="lightbox-close" aria-label="Close" onclick="closeLightbox()">&#x2715;</div>
  <img id="lightbox-img" alt="Manuscript zoomed view">
</div>

<!-- Top bar -->
<header class="topbar">
  <div class="topbar-brand">
    <h1>Handwritten Text Recognition</h1>
    <span>Old Nepali manuscripts</span>
  </div>
  <nav class="steps" aria-label="Workflow steps">
    <div class="step" id="step-0" onclick="switchTab(0)" role="button" tabindex="0">
      <div class="step-num" id="step-num-0">1</div>
      <span>Upload</span>
    </div>
    <div class="step-divider"></div>
    <div class="step" id="step-1" onclick="switchTab(1)" role="button" tabindex="0">
      <div class="step-num" id="step-num-1">2</div>
      <span>Preprocess</span>
    </div>
    <div class="step-divider"></div>
    <div class="step" id="step-2" onclick="switchTab(2)" role="button" tabindex="0">
      <div class="step-num" id="step-num-2">3</div>
      <span>Transcribe</span>
    </div>
  </nav>
</header>

<main class="content">
<div class="workspace">

  <!-- ============================================================
       Persistent image sidebar — visible across all tabs
  ============================================================ -->
  <aside class="image-sidebar">
    <div class="sidebar-preview">
      <div class="sidebar-placeholder" id="sidebar-ph">No image uploaded yet</div>
      <img id="image-preview" alt="Uploaded manuscript" style="display:none;">
      <div class="sidebar-label" id="sidebar-label" style="display:none;"></div>
    </div>
  </aside>

  <!-- ============================================================
       Tab content column
  ============================================================ -->
  <div class="tab-col">

  <!-- Step 1 — Upload -->
  <div class="tab-panel active" id="tab-0">
    <p class="section-label">Input files</p>
    <div class="card">
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div class="upload-zone">
          <input type="file" id="image-file" accept="image/*" onchange="onImageChange(this)">
          <div class="uz-icon">🖼</div>
          <div class="uz-label">Manuscript image</div>
          <div class="uz-sub">JPG or PNG</div>
          <div class="uz-filename" id="img-filename"></div>
        </div>
        <div class="upload-zone">
          <input type="file" id="xml-file" accept=".xml" onchange="onXmlChange(this)">
          <div class="uz-icon">📎</div>
          <div class="uz-label">Segmentation XML</div>
          <div class="uz-sub">Optional · eScriptorium export</div>
          <div class="uz-filename" id="xml-filename"></div>
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button class="btn btn-primary" onclick="proceedToPreprocess()">
        Continue
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h8M7 3l4 4-4 4"/></svg>
      </button>
      <span class="status-error" id="step1-status"></span>
    </div>
  </div>


  <!-- ============================================================
       Step 2 — Preprocess
  ============================================================ -->
  <div class="tab-panel" id="tab-1">
    <p class="section-label">Image preprocessing</p>

    <div class="card">
      <div class="card-header">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><path d="M7 4.5v2.5l1.5 1.5"/></svg>
        Enhancement methods
      </div>
      <div class="method-grid">
        <label class="method-row">
          <input type="checkbox" value="sauvola" onchange="toggleParam('sauvola-params', this); triggerPreview()">
          Sauvola binarisation
        </label>
        <label class="method-row">
          <input type="checkbox" value="clahe" onchange="toggleParam('clahe-params', this); triggerPreview()">
          CLAHE contrast
        </label>
        <label class="method-row">
          <input type="checkbox" value="gaussian" onchange="toggleParam('gaussian-params', this); triggerPreview()">
          Gaussian normalisation
        </label>
        <label class="method-row">
          <input type="checkbox" value="morph" onchange="toggleParam('morph-params', this); triggerPreview()">
          Morphological opening
        </label>
      </div>
      <p class="method-note">Applied sequentially: Gaussian → CLAHE → Sauvola → Morphological. Preview updates automatically.</p>

      <div class="param-group" id="sauvola-params">
        <p class="param-group-title">Sauvola — parameters</p>
        <div class="param-row">
          <label for="sauvola-window">Window size</label>
          <input type="range" id="sauvola-window" min="11" max="101" step="2" value="35"
                 oninput="setVal('sauvola-window-val', this.value); triggerPreview()">
          <span class="val" id="sauvola-window-val">35</span>
        </div>
        <div class="param-row">
          <label for="sauvola-k">Sensitivity (k)</label>
          <input type="range" id="sauvola-k" min="0.05" max="0.5" step="0.01" value="0.2"
                 oninput="setVal('sauvola-k-val', this.value); triggerPreview()">
          <span class="val" id="sauvola-k-val">0.20</span>
        </div>
      </div>

      <div class="param-group" id="clahe-params">
        <p class="param-group-title">CLAHE — parameters</p>
        <div class="param-row">
          <label for="clahe-clip">Clip limit</label>
          <input type="range" id="clahe-clip" min="1" max="80" step="0.5" value="30"
                 oninput="setVal('clahe-clip-val', this.value); triggerPreview()">
          <span class="val" id="clahe-clip-val">30</span>
        </div>
        <div class="param-row">
          <label for="clahe-tile">Tile grid size</label>
          <input type="range" id="clahe-tile" min="2" max="16" step="1" value="4"
                 oninput="setVal('clahe-tile-val', this.value); triggerPreview()">
          <span class="val" id="clahe-tile-val">4</span>
        </div>
      </div>

      <div class="param-group" id="gaussian-params">
        <p class="param-group-title">Gaussian normalisation — parameters</p>
        <div class="param-row">
          <label for="gauss-kernel">Kernel size</label>
          <input type="range" id="gauss-kernel" min="51" max="401" step="2" value="201"
                 oninput="setVal('gauss-kernel-val', this.value); triggerPreview()">
          <span class="val" id="gauss-kernel-val">201</span>
        </div>
        <div class="param-row">
          <label for="gauss-sigma">Sigma</label>
          <input type="range" id="gauss-sigma" min="10" max="400" step="5" value="201"
                 oninput="setVal('gauss-sigma-val', this.value); triggerPreview()">
          <span class="val" id="gauss-sigma-val">201</span>
        </div>
      </div>

      <div class="param-group" id="morph-params">
        <p class="param-group-title">Morphological opening — parameters</p>
        <div class="param-row">
          <label for="morph-kernel">Kernel size</label>
          <input type="range" id="morph-kernel" min="1" max="21" step="2" value="7"
                 oninput="setVal('morph-kernel-val', this.value); triggerPreview()">
          <span class="val" id="morph-kernel-val">7</span>
        </div>
      </div>
    </div>

    <div class="action-bar">
      <button class="btn" onclick="switchTab(0)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7H3M7 11 3 7l4-4"/></svg>
        Back
      </button>
      <button class="btn btn-primary" onclick="confirmAndProceed()">
        Run transcription
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h8M7 3l4 4-4 4"/></svg>
      </button>
      <span class="status-text" id="step2-status"></span>
    </div>
  </div>


  <!-- ============================================================
       Step 3 — Transcribe
  ============================================================ -->
  <div class="tab-panel" id="tab-2">
    <p class="section-label">Model inference</p>

    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <div class="card-header" style="margin:0;">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5"/><path d="M4 7h6M4 4.5h6M4 9.5h4"/></svg>
          HTR model
        </div>
        <button class="btn btn-primary" id="run-btn" onclick="runOCR()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden="true"><path d="M3 2.5l7 4-7 4V2.5z"/></svg>
          Run
          <span class="spinner" id="spinner"></span>
        </button>
      </div>
      <div id="progress-bar-wrap" style="display:none;">
        <div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div>
        <div class="progress-meta">
          <span id="progress-label">Starting…</span>
          <span id="progress-pct">0%</span>
        </div>
      </div>
      <p class="status-text" id="ocr-status" style="margin-top:8px;">Complete steps 1 and 2 first.</p>
    </div>

    <div class="result-grid">
      <div class="card">
        <div class="card-header">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5"/><path d="M4 4h6v6H4z"/></svg>
          Detected regions
        </div>
        <img id="overlay-img" alt="Manuscript with detected line regions overlaid" style="display:none;">
        <div class="preview-placeholder" id="overlay-placeholder">
          <span>Run the model to see detected regions</span>
        </div>
      </div>

      <div class="card">
        <div class="card-header" style="margin-bottom:10px;">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 4h10M2 7h8M2 10h5"/></svg>
          Predicted text
        </div>
        <div class="legend-row">
          <div class="legend-item"><div class="legend-dot" style="background:rgba(39,174,96,0.85)"></div>&gt;60%</div>
          <div class="legend-item"><div class="legend-dot" style="background:rgba(183,149,11,0.85)"></div>40–60%</div>
          <div class="legend-item"><div class="legend-dot" style="background:rgba(211,84,0,0.85)"></div>20–40%</div>
          <div class="legend-item"><div class="legend-dot" style="background:rgba(192,57,43,0.85)"></div>&lt;20%</div>
        </div>
        <div id="prediction-box" aria-live="polite" style="color:var(--text-3); font-size:13px;">
          Transcription will appear here. Hover over underlined characters to view per-token confidence scores and alternative readings.
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9.5 1.5h-7a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7L9.5 1.5z"/><path d="M9 1.5V5h3.5"/></svg>
        Post-correction
      </div>
      <textarea id="edited-text" placeholder="Edit the transcription here after reviewing the prediction above…"></textarea>
      <div class="action-bar" style="margin-top:12px;">
        <button class="btn" onclick="downloadTxt()">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6.5 1.5v7M3.5 6l3 3 3-3M1.5 10.5v1h10v-1"/></svg>
          Download .txt
        </button>
      </div>
    </div>

    <div class="action-bar">
      <button class="btn" onclick="switchTab(1)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7H3M7 11 3 7l4-4"/></svg>
        Back to preprocess
      </button>
    </div>
  </div>

  </div><!-- end tab-col -->
</div><!-- end workspace -->
</main>

<script>
  let previewDebounce = null;

  // ------------------------------------------------------------------
  // Tab / stepper

  function switchTab(i) {
    document.querySelectorAll('.tab-panel').forEach((el, j) => el.classList.toggle('active', j === i));
    document.querySelectorAll('.step').forEach((el, j) => {
      el.classList.toggle('active', j === i);
      const num = document.getElementById('step-num-' + j);
      if (j < i) {
        el.classList.add('done');
        num.innerHTML = '&#10003;';
      } else {
        el.classList.remove('done');
        num.textContent = j + 1;
      }
      if (j === i) el.classList.remove('done');
    });
  }

  // ------------------------------------------------------------------
  // Helpers

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = parseFloat(v).toFixed(id.includes('-k') ? 2 : 0);
  }

  function toggleParam(id, cb) {
    document.getElementById(id).classList.toggle('visible', cb.checked);
  }

  // ------------------------------------------------------------------
  // Upload handlers

  function onImageChange(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('img-filename').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      const img   = document.getElementById('image-preview');
      const ph    = document.getElementById('sidebar-ph');
      const label = document.getElementById('sidebar-label');
      img.src = e.target.result;
      img.style.display = 'block';
      img.onclick = openLightbox;
      ph.style.display = 'none';
      label.textContent = file.name;
      label.style.display = 'block';
      triggerPreview();
    };
    reader.readAsDataURL(file);
  }

  function onXmlChange(input) {
    if (input.files[0]) document.getElementById('xml-filename').textContent = input.files[0].name;
  }

  // ------------------------------------------------------------------
  // Preprocessing preview

  function triggerPreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(doPreview, 400);
  }

  async function doPreview() {
    const imgFile = document.getElementById('image-file').files[0];
    if (!imgFile) return;
    const methods = [...document.querySelectorAll('.method-row input:checked')].map(c => c.value);
    if (methods.length === 0) {
      // No methods selected — restore original image in sidebar
      const orig = document.getElementById('image-preview');
      if (orig.dataset.original) {
        orig.src = orig.dataset.original;
        document.getElementById('sidebar-label').textContent = imgFile.name;
      }
      return;
    }

    const fd = buildFormData(imgFile, methods);
    try {
      const res = await fetch('/preprocess', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.image) {
        const img = document.getElementById('image-preview');
        // Store original src on first preprocess so we can restore it later
        if (!img.dataset.original) img.dataset.original = img.src;
        img.src = 'data:image/png;base64,' + data.image;
        document.getElementById('sidebar-label').textContent = 'Preprocessed preview';
      }
    } catch (err) {
      console.error('Preview error:', err);
    }
  }

  // ------------------------------------------------------------------
  // Step navigation

  function proceedToPreprocess() {
    if (!document.getElementById('image-file').files[0]) {
      document.getElementById('step1-status').textContent = 'Please upload an image first.';
      return;
    }
    document.getElementById('step1-status').textContent = '';
    // Restore original image if a preprocessed version is showing
    const img = document.getElementById('image-preview');
    if (img.dataset.original) {
      img.src = img.dataset.original;
      document.getElementById('sidebar-label').textContent = document.getElementById('img-filename').textContent;
    }
    switchTab(1);
  }

  function confirmAndProceed() {
    document.getElementById('step2-status').textContent = 'Ready.';
    switchTab(2);
    document.getElementById('ocr-status').textContent = 'Ready to run.';
  }

  // ------------------------------------------------------------------
  // FormData builder (shared by preview and OCR)

  function buildFormData(imgFile, methods) {
    const fd = new FormData();
    fd.append('image', imgFile);
    fd.append('methods', JSON.stringify(methods));
    fd.append('sauvola_window', document.getElementById('sauvola-window').value);
    fd.append('sauvola_k',      document.getElementById('sauvola-k').value);
    fd.append('clahe_clip',     document.getElementById('clahe-clip').value);
    fd.append('clahe_tile',     document.getElementById('clahe-tile').value);
    fd.append('gauss_kernel',   document.getElementById('gauss-kernel').value);
    fd.append('gauss_sigma',    document.getElementById('gauss-sigma').value);
    fd.append('morph_kernel',   document.getElementById('morph-kernel').value);
    return fd;
  }

  // ------------------------------------------------------------------
  // OCR runner (SSE streaming)

  async function runOCR() {
    const imgFile = document.getElementById('image-file').files[0];
    if (!imgFile) {
      document.getElementById('ocr-status').textContent = 'No image — return to step 1.';
      return;
    }

    const runBtn   = document.getElementById('run-btn');
    const spinner  = document.getElementById('spinner');
    const statusEl = document.getElementById('ocr-status');
    const progWrap = document.getElementById('progress-bar-wrap');
    const progBar  = document.getElementById('progress-bar');
    const progLbl  = document.getElementById('progress-label');
    const progPct  = document.getElementById('progress-pct');

    runBtn.disabled = true;
    spinner.style.display = 'inline-block';
    statusEl.textContent = 'Running…';
    progWrap.style.display = 'block';
    progBar.style.width = '0%';
    progLbl.textContent = 'Initialising…';
    progPct.textContent = '0%';

    const methods = [...document.querySelectorAll('.method-row input:checked')].map(c => c.value);
    const fd = buildFormData(imgFile, methods);
    const xmlFile = document.getElementById('xml-file').files[0];
    if (xmlFile) fd.append('xml', xmlFile);

    try {
      const res    = await fetch('/ocr', { method: 'POST', body: fd });
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\\n\\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.progress !== undefined) {
            const pct = Math.round((data.progress / data.total) * 100);
            progBar.style.width = pct + '%';
            progLbl.textContent = data.label;
            progPct.textContent = pct + '%';

          } else if (data.done) {
            progBar.style.width = '100%';
            progLbl.textContent = 'Complete';
            progPct.textContent = '100%';
            statusEl.textContent = '';

            const overlayImg  = document.getElementById('overlay-img');
            const overlayPh   = document.getElementById('overlay-placeholder');
            overlayImg.src    = 'data:image/png;base64,' + data.overlay;
            overlayImg.style.display = 'block';
            if (overlayPh) overlayPh.style.display = 'none';

            const predBox = document.getElementById('prediction-box');
            predBox.innerHTML = data.html;
            predBox.style.color = '';
            predBox.style.fontSize = '';

            document.getElementById('edited-text').value = data.plain_text;

          } else if (data.error) {
            statusEl.className = 'status-error';
            statusEl.textContent = 'Error: ' + data.error;
          }
        }
      }
    } catch (err) {
      statusEl.className = 'status-error';
      statusEl.textContent = 'Network error: ' + err.message;
    } finally {
      runBtn.disabled = false;
      spinner.style.display = 'none';
    }
  }

  // ------------------------------------------------------------------
  // Download

  function downloadTxt() {
    const text = document.getElementById('edited-text').value;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transcription.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------------
  // Lightbox

  function openLightbox() {
    const src = document.getElementById('image-preview').src;
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox').classList.add('open');
    document.addEventListener('keydown', onLightboxKey);
  }

  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    document.removeEventListener('keydown', onLightboxKey);
  }

  function onLightboxKey(e) {
    if (e.key === 'Escape') closeLightbox();
  }
</script>
</body>
</html>"""


# ----------------------------------------------------------------------
# Flask routes

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)


@app.route('/preprocess', methods=['POST'])
def preprocess():
    try:
        file = request.files['image']
        methods = json.loads(request.form.get('methods', '[]'))
        pil_img = Image.open(io.BytesIO(file.read())).convert("RGB")
        if "gaussian" in methods:
            pil_img = apply_gaussian_normalization(pil_img,
                kernel_size=int(request.form.get('gauss_kernel', 201)),
                sigma=int(request.form.get('gauss_sigma', 201)))
        if "clahe" in methods:
            pil_img = apply_clahe(pil_img,
                clip_limit=float(request.form.get('clahe_clip', 30.0)),
                tile_grid_size=int(request.form.get('clahe_tile', 4)))
        if "sauvola" in methods:
            pil_img = apply_sauvola(pil_img,
                window_size=int(request.form.get('sauvola_window', 35)),
                k=float(request.form.get('sauvola_k', 0.2)))
        if "morph" in methods:
            pil_img = apply_morph_opening(pil_img,
                kernel_size=int(request.form.get('morph_kernel', 7)))
        return jsonify({'image': pil_to_base64(pil_img)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/ocr', methods=['POST'])
def ocr():
    try:
        file = request.files['image']
        methods = json.loads(request.form.get('methods', '[]'))
        pil_img = Image.open(io.BytesIO(file.read())).convert("RGB")
        if "gaussian" in methods:
            pil_img = apply_gaussian_normalization(pil_img,
                kernel_size=int(request.form.get('gauss_kernel', 201)),
                sigma=int(request.form.get('gauss_sigma', 201)))
        if "clahe" in methods:
            pil_img = apply_clahe(pil_img,
                clip_limit=float(request.form.get('clahe_clip', 30.0)),
                tile_grid_size=int(request.form.get('clahe_tile', 4)))
        if "sauvola" in methods:
            pil_img = apply_sauvola(pil_img,
                window_size=int(request.form.get('sauvola_window', 35)),
                k=float(request.form.get('sauvola_k', 0.2)))
        if "morph" in methods:
            pil_img = apply_morph_opening(pil_img,
                kernel_size=int(request.form.get('morph_kernel', 7)))
        xml_bytes = request.files['xml'].read() if 'xml' in request.files else None

        import queue, threading

        q = queue.Queue()

        def run():
            try:
                result = _run_ocr_on_image(pil_img, xml_bytes, progress_queue=q)
                q.put(('done', result))
            except Exception as e:
                q.put(('error', str(e)))

        threading.Thread(target=run).start()

        def stream():
            while True:
                msg = q.get()
                if msg[0] == 'progress':
                    yield f"data: {json.dumps({'progress': msg[1], 'total': msg[2], 'label': msg[3]})}\n\n"
                elif msg[0] == 'done':
                    overlay_img, predicted_html, plain_text = msg[1]
                    yield f"data: {json.dumps({'done': True, 'overlay': pil_to_base64(overlay_img), 'html': predicted_html, 'plain_text': plain_text})}\n\n"
                    break
                elif msg[0] == 'error':
                    yield f"data: {json.dumps({'error': msg[1]})}\n\n"
                    break

        return app.response_class(stream(), mimetype='text/event-stream')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("Loading model…")
    load_model()
    print("Model ready.")
    app.run(host='0.0.0.0', port=5001)