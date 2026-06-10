"""
Flask application for performing OCR on scanned Old Nepali documents.
2-page layout: Page 1 = Upload + Preprocessing, Page 2 = Run OCR
"""

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

    total = len(boxes) if boxes else 1
    concatenated_parts = []

    if boxes:
        for idx, b in enumerate(boxes, 1):
            if progress_queue:
                progress_queue.put(('progress', idx, total, f"Line {idx} of {total}"))
            # ... rest of loop unchanged
# ----------------------------------------------------------------------
# HTML

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HTR — Old Nepali Manuscripts</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f5f4f0; color: #1a1a1a; min-height: 100vh; }
  header { background: #1a1a1a; color: #f5f4f0; padding: 20px 40px; display: flex; align-items: baseline; gap: 16px; }
  header h1 { font-size: 20px; font-weight: 600; }
  header span { font-size: 13px; opacity: 0.5; }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  .tabs { display: flex; margin-bottom: 32px; border-bottom: 2px solid #1a1a1a; }
  .tab-btn { padding: 10px 24px; font-size: 14px; font-weight: 500; background: none; border: none; cursor: pointer; color: #666; border-bottom: 3px solid transparent; margin-bottom: -2px; }
  .tab-btn.active { color: #1a1a1a; border-bottom-color: #1a1a1a; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .card { background: #fff; border: 1px solid #e0ddd6; border-radius: 10px; padding: 24px; margin-bottom: 20px; }
  .card h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; color: #333; }
  .upload-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .upload-box { border: 2px dashed #ccc; border-radius: 8px; padding: 24px; text-align: center; cursor: pointer; position: relative; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .upload-box:hover { border-color: #888; }
  .upload-box input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .upload-box .icon { font-size: 28px; margin-bottom: 8px; }
  .upload-box .label { font-size: 13px; color: #666; }
  .upload-box .filename { font-size: 12px; color: #1a1a1a; margin-top: 6px; font-weight: 500; }
  #image-preview { max-width: 100%; max-height: 200px; margin-top: 10px; border-radius: 6px; display: none; }
  .method-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
  .method-check { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid #e0ddd6; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .method-check:hover { background: #f5f4f0; }
  .method-check input { accent-color: #1a1a1a; width: 15px; height: 15px; cursor: pointer; }
  .param-panel { display: none; padding: 14px; background: #f9f8f5; border-radius: 8px; margin-bottom: 12px; }
  .param-panel.visible { display: block; }
  .param-panel h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #444; }
  .param-row { display: grid; grid-template-columns: 160px 1fr 48px; align-items: center; gap: 10px; margin-bottom: 8px; }
  .param-row label { font-size: 12px; color: #555; }
  .param-row input[type=range] { accent-color: #1a1a1a; }
  .param-row span { font-size: 12px; color: #333; text-align: right; }
  #preprocessed-preview { max-width: 100%; max-height: 280px; border-radius: 8px; display: none; margin-top: 8px; }
  .btn { padding: 11px 24px; font-size: 14px; font-weight: 500; border: none; border-radius: 7px; cursor: pointer; }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #1a1a1a; color: #fff; }
  .btn-secondary { background: #e0ddd6; color: #1a1a1a; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .ocr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  #overlay-img { max-width: 100%; border-radius: 8px; }
  #prediction-box { border: 1px solid #e0ddd6; padding: 16px; border-radius: 8px; background: #faf9f7; font-size: 18px; line-height: 1.8; min-height: 120px; }
  .ocr-token { cursor: help; position: relative; display: inline; text-decoration: underline; text-decoration-thickness: 2px; }
  .conf-red    { text-decoration-color: rgba(220,38,38,0.9); }
  .conf-orange { text-decoration-color: rgba(249,115,22,0.9); }
  .conf-yellow { text-decoration-color: rgba(234,179,8,0.9); }
  .conf-green  { text-decoration-color: rgba(34,197,94,0.9); }
  .ocr-token::after { content: attr(data-tooltip); white-space: pre-line; position: absolute; left: 0; bottom: 120%; background: #222; color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 13px; line-height: 1.4; min-width: 180px; max-width: 320px; z-index: 1000; opacity: 0; pointer-events: none; transition: opacity 0.15s; }
  .ocr-token:hover::after { opacity: 1; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 2px; }
  textarea#edited-text { width: 100%; min-height: 120px; font-size: 15px; padding: 12px; border: 1px solid #e0ddd6; border-radius: 8px; resize: vertical; font-family: inherit; background: #faf9f7; }
  .status { font-size: 13px; color: #666; margin-top: 8px; min-height: 20px; }
  .status.error { color: #dc2626; }
  .spinner { display: none; width: 18px; height: 18px; border: 2px solid #ccc; border-top-color: #1a1a1a; border-radius: 50%; animation: spin 0.6s linear infinite; margin-left: 10px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header>
  <h1>Handwritten Text Recognition</h1>
  <span>Old Nepali Manuscripts</span>
</header>
<div class="container">
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab(0)">📄 Step 1 — Upload & Preprocess</button>
    <button class="tab-btn" onclick="switchTab(1)">🔍 Step 2 — Run OCR</button>
  </div>

  <!-- PAGE 1 -->
  <div class="tab-panel active" id="tab-0">
    <div class="card">
      <h2>Upload files</h2>
      <div class="upload-row">
        <div class="upload-box">
          <input type="file" id="image-file" accept="image/*" onchange="onImageChange(this)">
          <div class="icon">🖼</div>
          <div class="label">Click to upload manuscript image<br><small>JPG, PNG</small></div>
          <div class="filename" id="img-filename"></div>
        </div>
        <div class="upload-box">
          <input type="file" id="xml-file" accept=".xml" onchange="onXmlChange(this)">
          <div class="icon">📎</div>
          <div class="label">Segmentation XML (optional)<br><small>.xml from eScriptorium</small></div>
          <div class="filename" id="xml-filename"></div>
        </div>
      </div>
      <img id="image-preview">
    </div>

    <div class="card">
      <h2>Preprocessing</h2>
      <div class="method-grid">
        <label class="method-check"><input type="checkbox" value="sauvola" onchange="togglePanel('sauvola-panel', this); triggerPreview()"> Sauvola binarization</label>
        <label class="method-check"><input type="checkbox" value="clahe" onchange="togglePanel('clahe-panel', this); triggerPreview()"> CLAHE lighting fix</label>
        <label class="method-check"><input type="checkbox" value="gaussian" onchange="togglePanel('gaussian-panel', this); triggerPreview()"> Gaussian normalization</label>
        <label class="method-check"><input type="checkbox" value="morph" onchange="togglePanel('morph-panel', this); triggerPreview()"> Morphological opening</label>
      </div>

      <div class="param-panel" id="sauvola-panel">
        <h3>Sauvola parameters</h3>
        <div class="param-row"><label>Window size</label><input type="range" id="sauvola-window" min="11" max="101" step="2" value="35" oninput="updateVal('sauvola-window-val', this.value); triggerPreview()"><span id="sauvola-window-val">35</span></div>
        <div class="param-row"><label>k (sensitivity)</label><input type="range" id="sauvola-k" min="0.05" max="0.5" step="0.01" value="0.2" oninput="updateVal('sauvola-k-val', this.value); triggerPreview()"><span id="sauvola-k-val">0.2</span></div>
      </div>
      <div class="param-panel" id="clahe-panel">
        <h3>CLAHE parameters</h3>
        <div class="param-row"><label>Clip limit</label><input type="range" id="clahe-clip" min="1" max="80" step="0.5" value="30" oninput="updateVal('clahe-clip-val', this.value); triggerPreview()"><span id="clahe-clip-val">30</span></div>
        <div class="param-row"><label>Tile grid size</label><input type="range" id="clahe-tile" min="2" max="16" step="1" value="4" oninput="updateVal('clahe-tile-val', this.value); triggerPreview()"><span id="clahe-tile-val">4</span></div>
      </div>
      <div class="param-panel" id="gaussian-panel">
        <h3>Gaussian normalization parameters</h3>
        <div class="param-row"><label>Kernel size</label><input type="range" id="gauss-kernel" min="51" max="401" step="2" value="201" oninput="updateVal('gauss-kernel-val', this.value); triggerPreview()"><span id="gauss-kernel-val">201</span></div>
        <div class="param-row"><label>Sigma</label><input type="range" id="gauss-sigma" min="10" max="400" step="5" value="201" oninput="updateVal('gauss-sigma-val', this.value); triggerPreview()"><span id="gauss-sigma-val">201</span></div>
      </div>
      <div class="param-panel" id="morph-panel">
        <h3>Morphological opening parameters</h3>
        <div class="param-row"><label>Kernel size</label><input type="range" id="morph-kernel" min="1" max="21" step="2" value="7" oninput="updateVal('morph-kernel-val', this.value); triggerPreview()"><span id="morph-kernel-val">7</span></div>
      </div>

      <div style="margin-top:8px;"><strong style="font-size:13px;">Preprocessed preview</strong><img id="preprocessed-preview"></div>
    </div>

    <button class="btn btn-primary" onclick="confirmAndProceed()">Confirm & proceed to OCR →</button>
    <div id="progress-bar-wrap" style="display:none; margin-top:12px;">
    <div style="background:#e0ddd6; border-radius:999px; height:10px; overflow:hidden;">
        <div id="progress-bar" style="height:100%; width:0%; background:#1a1a1a; border-radius:999px; transition:width 0.3s;"></div>
    </div>
    <div id="progress-label" style="font-size:12px; color:#666; margin-top:4px;"></div>
    </div>
    <div class="status" id="step1-status"></div>
  </div>

  <!-- PAGE 2 -->
  <div class="tab-panel" id="tab-1">
    <div class="card">
      <h2>Image to process</h2>
      <img id="page2-preview" style="max-width:100%; max-height:200px; border-radius:8px;">
      <div class="status" id="step2-status">Upload and preprocess an image in Step 1 first.</div>
    </div>

    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:rgba(34,197,94,0.9)"></div><span><b>Green</b> &gt;60%</span></div>
      <div class="legend-item"><div class="legend-dot" style="background:rgba(234,179,8,0.9)"></div><span><b>Yellow</b> 40–60%</span></div>
      <div class="legend-item"><div class="legend-dot" style="background:rgba(249,115,22,0.9)"></div><span><b>Orange</b> 20–40%</span></div>
      <div class="legend-item"><div class="legend-dot" style="background:rgba(220,38,38,0.9)"></div><span><b>Red</b> &lt;20%</span></div>
    </div>

    <button class="btn btn-primary" id="run-btn" onclick="runOCR()">▶ Run HTR model <span class="spinner" id="spinner"></span></button>
    <div class="status" id="ocr-status"></div>
    <br><br>

    <div class="ocr-grid">
      <div class="card"><h2>Detected regions</h2><img id="overlay-img"></div>
      <div class="card"><h2>Predictions</h2><div id="prediction-box"></div></div>
    </div>

    <div class="card" style="margin-top:0;">
      <h2>Edit predicted text</h2>
      <textarea id="edited-text"></textarea>
      <br><br>
      <button class="btn btn-secondary" onclick="downloadTxt()">⬇ Download .txt</button>
    </div>

    <button class="btn btn-secondary" style="margin-top:8px;" onclick="switchTab(0)">← Back to Step 1</button>
  </div>
</div>

<script>
  let previewDebounce = null;

  function switchTab(i) {
    document.querySelectorAll('.tab-btn').forEach((b, j) => b.classList.toggle('active', i === j));
    document.querySelectorAll('.tab-panel').forEach((p, j) => p.classList.toggle('active', i === j));
  }

  function updateVal(id, v) { document.getElementById(id).textContent = v; }

  function togglePanel(id, cb) {
    document.getElementById(id).classList.toggle('visible', cb.checked);
  }

  function onImageChange(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('img-filename').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      const prev = document.getElementById('image-preview');
      prev.src = e.target.result;
      prev.style.display = 'block';
      document.getElementById('page2-preview').src = e.target.result;
      triggerPreview();
    };
    reader.readAsDataURL(file);
  }

  function onXmlChange(input) {
    if (input.files[0]) document.getElementById('xml-filename').textContent = input.files[0].name;
  }

  function triggerPreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(doPreview, 400);
  }

  async function doPreview() {
    const imgFile = document.getElementById('image-file').files[0];
    if (!imgFile) return;
    const methods = [...document.querySelectorAll('.method-check input:checked')].map(c => c.value);
    if (methods.length === 0) return;
    const fd = new FormData();
    fd.append('image', imgFile);
    fd.append('methods', JSON.stringify(methods));
    fd.append('sauvola_window', document.getElementById('sauvola-window').value);
    fd.append('sauvola_k', document.getElementById('sauvola-k').value);
    fd.append('clahe_clip', document.getElementById('clahe-clip').value);
    fd.append('clahe_tile', document.getElementById('clahe-tile').value);
    fd.append('gauss_kernel', document.getElementById('gauss-kernel').value);
    fd.append('gauss_sigma', document.getElementById('gauss-sigma').value);
    fd.append('morph_kernel', document.getElementById('morph-kernel').value);
    const res = await fetch('/preprocess', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.image) {
      const prev = document.getElementById('preprocessed-preview');
      prev.src = 'data:image/png;base64,' + data.image;
      prev.style.display = 'block';
      document.getElementById('page2-preview').src = prev.src;
    }
  }

  function confirmAndProceed() {
    if (!document.getElementById('image-file').files[0]) {
      document.getElementById('step1-status').textContent = 'Please upload an image first.';
      return;
    }
    document.getElementById('step1-status').textContent = 'Ready!';
    switchTab(1);
    document.getElementById('step2-status').textContent = 'Ready to run OCR.';
  }

  async function runOCR() {
    const imgFile = document.getElementById('image-file').files[0];
    if (!imgFile) { document.getElementById('ocr-status').textContent = 'No image — go back to Step 1.'; return; }
    const runBtn = document.getElementById('run-btn');
    runBtn.disabled = true;
    document.getElementById('ocr-status').textContent = 'Running…';
    document.getElementById('progress-bar-wrap').style.display = 'block';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-label').textContent = 'Starting…';

    const methods = [...document.querySelectorAll('.method-check input:checked')].map(c => c.value);
    const xmlFile = document.getElementById('xml-file').files[0];
    const fd = new FormData();
    fd.append('image', imgFile);
    fd.append('methods', JSON.stringify(methods));
    fd.append('sauvola_window', document.getElementById('sauvola-window').value);
    fd.append('sauvola_k', document.getElementById('sauvola-k').value);
    fd.append('clahe_clip', document.getElementById('clahe-clip').value);
    fd.append('clahe_tile', document.getElementById('clahe-tile').value);
    fd.append('gauss_kernel', document.getElementById('gauss-kernel').value);
    fd.append('gauss_sigma', document.getElementById('gauss-sigma').value);
    fd.append('morph_kernel', document.getElementById('morph-kernel').value);
    if (xmlFile) fd.append('xml', xmlFile);

    const res = await fetch('/ocr', { method: 'POST', body: fd });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop();
        for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.progress !== undefined) {
            const pct = Math.round((data.progress / data.total) * 100);
            document.getElementById('progress-bar').style.width = pct + '%';
            document.getElementById('progress-label').textContent = data.label;
        } else if (data.done) {
            document.getElementById('progress-bar').style.width = '100%';
            document.getElementById('progress-label').textContent = 'Done!';
            document.getElementById('overlay-img').src = 'data:image/png;base64,' + data.overlay;
            document.getElementById('prediction-box').innerHTML = data.html;
            document.getElementById('edited-text').value = data.plain_text;
            document.getElementById('ocr-status').textContent = 'Done!';
        } else if (data.error) {
            document.getElementById('ocr-status').className = 'status error';
            document.getElementById('ocr-status').textContent = 'Error: ' + data.error;
        }
        }
    }
    runBtn.disabled = false;
    }

  function downloadTxt() {
    const text = document.getElementById('edited-text').value;
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'predictions.txt';
    a.click();
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
            pil_img = apply_gaussian_normalization(pil_img, kernel_size=int(request.form.get('gauss_kernel', 201)), sigma=int(request.form.get('gauss_sigma', 201)))
        if "clahe" in methods:
            pil_img = apply_clahe(pil_img, clip_limit=float(request.form.get('clahe_clip', 30.0)), tile_grid_size=int(request.form.get('clahe_tile', 4)))
        if "sauvola" in methods:
            pil_img = apply_sauvola(pil_img, window_size=int(request.form.get('sauvola_window', 35)), k=float(request.form.get('sauvola_k', 0.2)))
        if "morph" in methods:
            pil_img = apply_morph_opening(pil_img, kernel_size=int(request.form.get('morph_kernel', 7)))
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
            pil_img = apply_gaussian_normalization(pil_img, kernel_size=int(request.form.get('gauss_kernel', 201)), sigma=int(request.form.get('gauss_sigma', 201)))
        if "clahe" in methods:
            pil_img = apply_clahe(pil_img, clip_limit=float(request.form.get('clahe_clip', 30.0)), tile_grid_size=int(request.form.get('clahe_tile', 4)))
        if "sauvola" in methods:
            pil_img = apply_sauvola(pil_img, window_size=int(request.form.get('sauvola_window', 35)), k=float(request.form.get('sauvola_k', 0.2)))
        if "morph" in methods:
            pil_img = apply_morph_opening(pil_img, kernel_size=int(request.form.get('morph_kernel', 7)))
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
    print("Loading model...")
    load_model()
    print("Model ready!")
    app.run(host='0.0.0.0', port=5001)