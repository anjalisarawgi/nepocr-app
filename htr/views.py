from django.shortcuts import render, redirect
import cv2 
import numpy as np 
from django.core.files.base import ContentFile
from .models import UploadedImage
from .forms import ImageUploadForm
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
import os
from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from skimage.filters import threshold_sauvola
from kraken import blla
from kraken.lib import vgsl
from PIL import Image
import json
from django.http import HttpResponse
from django.template.loader import render_to_string
import io
from functools import lru_cache
import torch
from transformers import VisionEncoderDecoderModel, PreTrainedTokenizerFast, TrOCRProcessor
import joblib
import torch
import re
import pandas as pd
import numpy as np
from kraken.lib import segmentation as kraken_segmentation
import json
from PIL import ImageDraw
import pickle
import regex as re_regex  # rename to avoid clashing with stdlib `re` already imported above
from .config import * 
from .utils.trie import load_trie, TrieNode
import requests
from paddleocr import TextDetection   # imported only when Paddle is used
from .prompts import SUMMARY_PROMPT, EXPLAIN_PROMPT


### path defined in the .env file
KRAKEN_MODEL_PATH =  os.environ.get('KRAKEN_MODEL_PATH')
QWEN_API_KEY = os.environ.get('QWEN_API_KEY')
# qwen
QWEN_BASE_URL = (os.environ.get('QWEN_BASE_URL') or '').rstrip('/')
if QWEN_BASE_URL.endswith('/chat/completions'):
    QWEN_BASE_URL = QWEN_BASE_URL[: -len('/chat/completions')]

QWEN_MODEL = os.environ.get('QWEN_MODEL', 'Qwen/Qwen3.8-27B')

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')

GPT_OSS_BASE_URL = (os.environ.get('GPT_OSS_BASE_URL') or 'https://api.ai.nws.netways.de/v1').rstrip('/')
GPT_OSS_MODEL = os.environ.get('GPT_OSS_MODEL', 'openai/gpt-oss-20b')

# every provider speaks the OpenAI /chat/completions format
SUMMARY_PROVIDERS = {
    'qwen': {
        'label': 'Qwen',
        'api_key': QWEN_API_KEY,
        'base_url': QWEN_BASE_URL,
        'model': QWEN_MODEL,
        'extra': {'chat_template_kwargs': {'enable_thinking': False}},  # vLLM only
        'suffix': '\n/no_think',
    },
    'gpt_oss': {
        'label': 'GPT-OSS',
        'api_key': QWEN_API_KEY,          # same key as Qwen
        'base_url': GPT_OSS_BASE_URL,
        'model': GPT_OSS_MODEL,
        'extra': {'reasoning_effort': 'low'},
        'suffix': '',
    },
    'gemini': {
        'label': 'Gemini',
        'api_key': GEMINI_API_KEY,
        'base_url': 'https://generativelanguage.googleapis.com/v1beta/openai',
        'model': GEMINI_MODEL,
        'extra': {},
        'suffix': '',
        'json_mode': True,
    },
}

#################################################

def call_llm(provider, prompt, max_tokens, timeout=120):
    """Send one prompt to an OpenAI-compatible provider. Returns (text, finish_reason)."""
    resp = requests.post(
        f"{provider['base_url']}/chat/completions",
        headers={'Authorization': f"Bearer {provider['api_key']}", 'Content-Type': 'application/json'},
        json={
            'model': provider['model'],
            'messages': [{'role': 'user', 'content': prompt + provider['suffix']}],
            'temperature': 0.2,
            'max_tokens': max_tokens,
            **provider['extra'],
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    choice = resp.json()['choices'][0]
    content = choice['message'].get('content') or ''
    content = re.sub(r'<think>.*?(</think>|$)', '', content, flags=re.S).strip()
    return content, choice.get('finish_reason')


def parse_json_reply(content):
    """Models sometimes wrap JSON in ```json fences or add a sentence; take the outer {...}."""
    start, end = content.find('{'), content.rfind('}')
    if start == -1 or end <= start:
        raise ValueError('no JSON object found')
    return json.loads(content[start:end + 1])





def available_summary_providers():
    return [{'id': k, 'label': v['label']}
            for k, v in SUMMARY_PROVIDERS.items() if v['api_key'] and v['base_url']]

### PaddleOCR (text box detection)
PADDLE_DET_MODEL = os.environ.get('PADDLE_DET_MODEL', 'PP-OCRv5_server_det')
PADDLE_MIN_SCORE = 0.5   # ignore weak detections


@lru_cache(maxsize=1)
def load_paddle_detector():
    return TextDetection(model_name=PADDLE_DET_MODEL)


def segment_with_paddle(pil_image):
    """Plain PaddleOCR text detection: one editable box per detected text region."""
    detector = load_paddle_detector()
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)   # Paddle expects BGR
    result = detector.predict(img)

    lines = []
    for res in result:
        polys = res['dt_polys']
        scores = res.get('dt_scores', [1.0] * len(polys))
        for poly, score in zip(polys, scores):
            if score < PADDLE_MIN_SCORE or len(poly) < 3:
                continue
            lines.append({
                'polygon': [[float(p[0]), float(p[1])] for p in poly],
                'baseline': [],          # Paddle gives boxes only, no baselines
            })
    return lines


### user login and logout
def login_view(request):
    if request.user.is_authenticated:
        return redirect('main_page')
    if request.method == 'POST':
        form = AuthenticationForm(data = request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            return redirect('main_page')
        
    else: 
        form = AuthenticationForm()
    return render(request, 'htr/login.html', {'form': form})
        

def logout_view(request):
    logout(request)
    return redirect('login')



### helpers for lemma and trie matching
@lru_cache(maxsize=1)
def load_trie_cached():
    trie_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../models/lemma_trie.json')
    return load_trie(trie_path)

def get_graphemes(text):
    return re_regex.findall(r'\X', text)

def greedy_match_line(trie_root, text, min_len=2, max_len=30):
    graphemes = get_graphemes(text)
    i = 0
    matches = []
    while i < len(graphemes):
        node = trie_root
        longest = None
        for j in range(i, min(len(graphemes), i + max_len)):
            g = graphemes[j]
            for ch in g:
                if ch not in node.children:
                    node = None
                    break
                node = node.children[ch]
            if node is None:
                break
            if node.entries and (j + 1 - i) >= min_len:
                longest = (i, j + 1)
        if longest:
            matches.append(longest)
            i = longest[1]
        else:
            i += 1
    char_offsets = [0]
    for g in graphemes:
        char_offsets.append(char_offsets[-1] + len(g))
    return [(char_offsets[i], char_offsets[j]) for i, j in matches]

def get_matched_words(trie, text, min_len):
    spans = greedy_match_line(trie, text, min_len=min_len)
    seen = set()
    results = []
    for s, e in spans:
        word = text[s:e]
        if word not in seen:
            seen.add(word)
            # walk trie to get lemma
            node = trie
            for ch in word:
                if ch not in node.children:
                    node = None
                    break
                node = node.children[ch]
            lemma = node.entries[0]['lemma'] if node and node.entries else word
            results.append({'word': word, 'lemma': lemma})
    return results



##### upload image
@login_required
def upload_image(request, pk = None):
    if request.method == 'POST':
        form = ImageUploadForm(request.POST, request.FILES) # POST contains the form fields eg text, checkboxes adn FILES contains the uploaded files
        if form.is_valid(): # checks if valid, and if not, go to else and if yes, save it to the database and redirect to the preprocess page
            instance = form.save(commit=False)  # create an instance of the UploadedImage model but dont save it to the database yet
            instance.user = request.user
            instance.save()
            return redirect('view_image', pk=instance.pk)  
    else:
        form = ImageUploadForm() # GET: someone just visited the page -- show empty form 

    ## show the old files::
    documents = UploadedImage.objects.filter(user = request.user).order_by('-uploaded_at')

    # for the selected image
    selected_doc = None
    if pk:
        selected_doc = get_object_or_404(UploadedImage, pk=pk, user=request.user) # get_object_or_404 = go to the database, find the document with that id, belonging to this user, if it does not exist, show a 404 error page

    if selected_doc and selected_doc.ocr_predictions:
        for pred in selected_doc.ocr_predictions:
            pred['char_conf_json'] = json.dumps(pred.get('char_conf', []))
            if 'matched_words_json' not in pred:
                pred['matched_words_json'] = json.dumps(
                    pred.get('matched_words', []), ensure_ascii=False
                )
    return render(request, 'htr/main_page.html', {
        'form': form, 'documents': documents, 'selected_doc': selected_doc,
        'summary_providers': available_summary_providers(),
    })

    
## delete image
@login_required
def delete_image(request, pk):
    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
    image.delete()
    return redirect('main_page')



@login_required
def crop_image(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        cropped_file = request.FILES.get('cropped_image')
        if cropped_file:
            if not image.original_backup:
                image.original_image.open()
                image.original_backup.save(image.filename, image.original_image, save=False)

            image.original_image.save(image.filename, cropped_file, save=False)
            image.status = 'uploaded'
            image.save()
            return JsonResponse({'success': True, 'new_url': image.original_image.url, 'has_backup': True})
    return JsonResponse({'success': False})

@login_required
def reset_image(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        if image.original_backup:
            image.original_image.save(image.filename, image.original_backup, save=False)
            image.original_backup.delete(save=False)
            image.status = 'uploaded'
            image.save()
            return JsonResponse({'success': True, 'new_url': image.original_image.url})
    return JsonResponse({'success': False})


### preprocessing
@login_required
def advance_to_preprocessing(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.original_image.open()
        image.locked_image.save(image.filename, image.original_image, save=False)
        image.status = 'preprocessed'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})


@login_required
def apply_preprocessing(request, pk):
    if request.method == "POST":
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

        gaussian_on = request.POST.get('gaussian') == 'true'
        clahe_on = request.POST.get('clahe') == 'true'
        sauvola_on = request.POST.get('sauvola') == 'true'
        # opening_on = request.POST.get('opening') == 'true'

        if not any([gaussian_on, clahe_on, sauvola_on]):
            image.processed.delete(save=True)
            image.preprocessing_settings = {}
            image.processed.delete(save=True)
            return JsonResponse({'success': True, 'new_url': image.locked_image.url})

        kernel_size = int(request.POST.get('kernel_size', 201))
        sigma = int(request.POST.get('sigma', 201))
        clip_limit = float(request.POST.get('clip_limit', 2.0))
        tile_size = int(request.POST.get('tile_size', 8))
        window_size = int(request.POST.get('window_size', 25))
        k = float(request.POST.get('k', 0.2))

        if kernel_size % 2 == 0:
            kernel_size += 1
        if window_size % 2 == 0:
            window_size += 1

        image.locked_image.open()
        file_bytes = np.frombuffer(image.locked_image.read(), np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

        if gaussian_on:
            image_float = img.astype(np.float32)
            background = cv2.GaussianBlur(image_float, (kernel_size, kernel_size), sigmaX=sigma)
            normalized = np.clip(image_float / background * 255, 0, 255).astype(np.uint8)
            img = cv2.GaussianBlur(normalized, (3, 3), 0)

        if clahe_on:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_size, tile_size))
            equalized = clahe.apply(gray)
            img = cv2.cvtColor(equalized, cv2.COLOR_GRAY2BGR)

        if sauvola_on:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            thresh = threshold_sauvola(gray, window_size=window_size, k=k)
            binary = (gray > thresh).astype(np.uint8) * 255
            img = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


        success, buffer = cv2.imencode('.jpg', img)
        content = ContentFile(buffer.tobytes())
        

        image.preprocessing_settings = {
            'gaussian': gaussian_on,
            'clahe': clahe_on,
            'sauvola': sauvola_on,
            'kernel_size': kernel_size,
            'sigma': sigma,
            'clip_limit': clip_limit,
            'tile_size': tile_size,
            'window_size': window_size,
            'k': k,
        }
        
        image.processed.save(image.filename, content, save=True)

        return JsonResponse({'success': True, 'new_url': image.processed.url})

    return JsonResponse({'success': False})




@login_required
def advance_to_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.status = 'segmented'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})





#### segmentation
@login_required
def run_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        source_field = image.processed if image.processed else image.locked_image
        source_field.open()
        pil_image = Image.open(io.BytesIO(source_field.read())).convert('RGB')


        engine = request.POST.get('engine', 'kraken')

        if engine == 'paddle':
            try:
                lines = segment_with_paddle(pil_image)
                for line in lines:
                    line['source'] = 'paddle'
            except ImportError:
                return JsonResponse({'success': False, 'error': 'PaddleOCR is not installed on the server.'})
            except Exception as e:
                import traceback; traceback.print_exc()   # full error still printed in the terminal
                return JsonResponse({'success': False, 'error': f'PaddleOCR failed: {e}'})
        else:
            model = vgsl.TorchVGSLModel.load_model(KRAKEN_MODEL_PATH)
            result = blla.segment(pil_image, model=model)
            lines = [{'polygon': line.boundary, 'baseline': line.baseline, 'source': 'kraken'}
                     for line in result.lines]

        
        image.line_coordinates = lines
        if image.ocr_predictions:
            image.ocr_stale = True
        image.save()

        return JsonResponse({
            'success': True,
            'lines': lines,
            'page_width': pil_image.width,
            'page_height': pil_image.height,
        })

    return JsonResponse({'success': False})




@login_required
def save_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        data = json.loads(request.body)
        image.line_coordinates = data.get('lines', [])
        if image.ocr_predictions:
            image.ocr_stale = True
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})



@login_required
def add_baseline_polygon(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        data = json.loads(request.body)
        baseline_points = data.get('baseline', [])

        if len(baseline_points) < 2:
            return JsonResponse({'success': False, 'error': 'Baseline needs at least 2 points.'})

        source_field = image.processed if image.processed else image.locked_image
        source_field.open()
        pil_image = Image.open(io.BytesIO(source_field.read())).convert('RGB')

        ##
        baseline_tuple = [tuple(p) for p in baseline_points]
        polygons = kraken_segmentation.calculate_polygonal_environment(pil_image, [baseline_tuple])

        polygon = polygons[0] if polygons and polygons[0] is not None else None
        if polygon is None:
            return JsonResponse({'success': False, 'error': 'Could not compute a polygon for this baseline. Please try drawing it closer to the text line.'})

        polygon_points = [[float(p[0]), float(p[1])] for p in polygon]

        return JsonResponse({
            'success': True,
            'polygon': polygon_points,
            'baseline': baseline_points,
        })

    return JsonResponse({'success': False})



@login_required
def back_to_preprocessing(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.status = 'preprocessed'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})



@login_required
def advance_to_ocr(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.status = 'ocr_done'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})




### OCR
@lru_cache(maxsize=1)
def load_ocr_model():
    # hf_token = os.environ.get("HF_TOKEN")
    model = VisionEncoderDecoderModel.from_pretrained(OCR_MODEL_PATH)
    tokenizer = PreTrainedTokenizerFast.from_pretrained(OCR_MODEL_PATH)
    processor = TrOCRProcessor.from_pretrained("microsoft/trocr-large-handwritten")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()
    return model, tokenizer, processor, device

import re
DOT_REPLACEMENT = "\u2219" 
def clean_ocr_text(text):
    text = re.sub(r"[\u00AD\u200B\u200C\u200D]", "", text)
    return text.replace(".", DOT_REPLACEMENT)


def predict_line_with_confidence(pil_crop, topk=3):
    model, tokenizer, processor, device = load_ocr_model()
    pixel_values = processor(images=pil_crop.convert("RGB"), return_tensors="pt").pixel_values.to(device)

    with torch.inference_mode():
        out = model.generate(
            pixel_values,
            max_length=MAX_LEN,
            num_beams=NUM_BEAMS,
            do_sample=False,
            return_dict_in_generate=True,
            output_scores=True,
            use_cache=True,
            eos_token_id=tokenizer.eos_token_id,
        )

    seq = out.sequences[0]
    decoded_text = clean_ocr_text(tokenizer.decode(seq, skip_special_tokens=True))
    rows = []

    for step, (logits, tgt) in enumerate(zip(out.scores, seq[1:]), start=1):
        probs = torch.softmax(logits[0].float().cpu(), dim=-1)
        tgt_id = int(tgt.item())
        conf = float(probs[tgt_id].item())

        # p = np.clip(conf, 1e-6, 1 - 1e-6)
        # cal_conf = beta.predict_proba([[np.log(p), np.log(1 - p)]])[0, 1]

        tk_vals, tk_idx = torch.topk(probs, k=min(3, probs.shape[0]))
        tk_idx = tk_idx.tolist()
        tk_vals = tk_vals.tolist()

        alt_tokens = [clean_ocr_text(tokenizer.decode([i], skip_special_tokens=True)) for i in tk_idx]
        alt_probs  = tk_vals

        rows.append({
            "token":      alt_tokens[0],
            "confidence": alt_probs[0],
            "alt_tokens": "|".join(alt_tokens),
            "alt_probs":  "|".join([f"{p:.6f}" for p in alt_probs]),
        })

    df_tok = pd.DataFrame(rows)
    highlighted_html = highlight_tokens_with_tooltips(decoded_text, df_tok)
    line_conf = float(np.mean([r["confidence"] for r in rows])) if rows else 0.0

    # which characters of the final text each token produced, with its confidence
    gen_ids = seq[1:].tolist()
    char_conf = []
    prev_len = 0
    pending = 1.0
    pending_alts = None
    for k, r in enumerate(rows):
        if r["confidence"] <= pending:
            pending = r["confidence"]
            pending_alts = [
                r["alt_tokens"].split("|"),
                [round(float(p), 4) for p in r["alt_probs"].split("|")],
            ]
        prefix = clean_ocr_text(tokenizer.decode(gen_ids[:k + 1], skip_special_tokens=True)).rstrip("\ufffd")
        cur_len = len(prefix)
        if cur_len > prev_len:
            char_conf.append([prev_len, cur_len, round(pending, 4), pending_alts])
            prev_len = cur_len
            pending = 1.0
            pending_alts = None

    return decoded_text, highlighted_html, line_conf, char_conf



@login_required
def run_ocr(request, pk):
    if request.method == 'POST':
        trie = load_trie_cached()
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

        source_field = image.processed if image.processed else image.locked_image
        source_field.open()
        pil_image = Image.open(io.BytesIO(source_field.read())).convert('RGB')

        lines = image.line_coordinates or []

        def is_vertical_line(line):
            baseline = line.get('baseline', [])
            if len(baseline) < 2:
                polygon = line.get('polygon', [])
                if len(polygon) < 2:
                    return False
                xs = [p[0] for p in polygon]
                ys = [p[1] for p in polygon]
                width = max(xs) - min(xs)
                height = max(ys) - min(ys)
                return height > width

            x1, y1 = baseline[0]
            x2, y2 = baseline[-1]
            dx = abs(x2 - x1)
            dy = abs(y2 - y1)
            return dy > dx


        def line_sort_key(line):
            polygon = line.get('polygon', [])
            xs = [p[0] for p in polygon] if polygon else [0]
            ys = [p[1] for p in polygon] if polygon else [0]
            min_x = min(xs)
            min_y = min(ys)

            if is_vertical_line(line):
                return (1, min_x, min_y)
            else:
                row_bucket = round(min_y / Y_TOLERANCE)
                return (0, row_bucket, min_x)

        indexed_lines = list(enumerate(lines))
        sorted_indexed_lines = sorted(indexed_lines, key=lambda item: line_sort_key(item[1]))

        predictions = []

        for original_idx, line in sorted_indexed_lines:
            polygon = line.get('polygon', [])
            if len(polygon) < 3:
                continue

            pts = [(int(p[0]), int(p[1])) for p in polygon]
            mask = Image.new('L', pil_image.size, 0)
            ImageDraw.Draw(mask).polygon(pts, outline=1, fill=255)

            seg_img = Image.new('RGB', pil_image.size, (255, 255, 255))
            seg_img.paste(pil_image, mask=mask)

            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            crop_box = (
                max(0, min(xs)), max(0, min(ys)),
                min(pil_image.width, max(xs)), min(pil_image.height, max(ys)),
            )
            crop = seg_img.crop(crop_box)

            text, html, line_conf, char_conf = predict_line_with_confidence(crop)
            matched_words = get_matched_words(trie, text, min_len=TRIE_MIN_LEN)
            print(f"Line: {text[:30]}... → matches: {matched_words}")

            predictions.append({'line_index': original_idx, 'text': text, 'html': html, 'confidence': round(line_conf, 4), 'char_conf': char_conf, 'matched_words': matched_words, 'matched_words_json': json.dumps(matched_words, ensure_ascii=False), })
            
        image.ocr_predictions = predictions
        image.ocr_stale = False
        image.ai_summary = ''
        image.ai_explanation = {}
        image.ai_outputs = {}
        image.save()

        return JsonResponse({'success': True, 'predictions': predictions})

    return JsonResponse({'success': False})





# @lru_cache(maxsize=1)
# def load_beta_calibrator():
#     base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
#     path = os.path.join(base_dir, 'beta_calibrator.joblib')
#     return joblib.load(path)



def html_escape(s):
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def highlight_tokens_with_tooltips(line_text, df_tok):
    parts = []

    for _, row in df_tok.iterrows():
        token = row.get("token", "")
        if not token:
            continue

        conf = row.get("confidence", 0.0)

        if conf >= 0.80:
            conf_cls = "conf-green"
        elif conf >= 0.60:
            conf_cls = "conf-yellow"
        elif conf >= 0.40:
            conf_cls = "conf-orange"
        else:
            conf_cls = "conf-red"

        alt_toks = row.get("alt_tokens", "").split("|")
        alt_probs = row.get("alt_probs", "").split("|")

        tooltip_lines = []
        for t, p_str in zip(alt_toks, alt_probs):
            try:
                prob = float(p_str)
            except ValueError:
                prob = 0.0
            tooltip_lines.append(f"{html_escape(t) or '∅'}: {prob:.3f}")

        tooltip = html_escape("\n".join(tooltip_lines))
        parts.append(f"<span class='ocr-token {conf_cls}' data-tooltip='{tooltip}'>{html_escape(token)}</span>")
    return "".join(parts)


@login_required
def download_ocr_text(request, pk):
    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
    predictions = image.ocr_predictions or []

    lines = [p.get('text', '') for p in predictions]
    content = "\n".join(lines)

    response = HttpResponse(content, content_type='text/plain; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{image.filename}_predictions.txt"'
    return response



@login_required
def edit_ocr(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        data = json.loads(request.body)
        updated = data.get('predictions', [])
        predictions = image.ocr_predictions or []
        updated_map = {p['line_index']: p['text'] for p in updated}

        changed = False
        for pred in predictions:
            if pred['line_index'] in updated_map:
                new_text = updated_map[pred['line_index']]
                if new_text != pred.get('text', ''):
                    changed = True
                if 'original_text' not in pred:
                    pred['original_text'] = pred.get('text', '')
                pred['text'] = new_text

        image.ocr_predictions = predictions

        # AI results were made from the old text → mark them as outdated
        if changed and image.ai_outputs:
            for out in image.ai_outputs.values():
                if out.get('summary'):
                    out['summary_stale'] = True
                if out.get('explanation'):
                    out['explanation_stale'] = True

        image.save()
        return JsonResponse({'success': True, 'changed': changed})
    return JsonResponse({'success': False})


@login_required
def summarize_transcription(request, pk):
    if request.method != 'POST':
        return JsonResponse({'success': False})

    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

    provider_id = request.POST.get('provider', 'qwen')
    provider = SUMMARY_PROVIDERS.get(provider_id)
    if not provider or not provider['api_key'] or not provider['base_url']:
        return JsonResponse({'success': False, 'error': f'{provider_id} is not configured on the server.'})

    lines = [p.get('text', '').strip() for p in (image.ocr_predictions or [])]
    lines = [l for l in lines if l]
    if not lines:
        return JsonResponse({'success': False, 'error': 'There is no transcription to summarize yet.'})
    text = "\n".join(lines)[:6000]

    try:
        resp = requests.post(
            f"{provider['base_url']}/chat/completions",
            headers={'Authorization': f"Bearer {provider['api_key']}", 'Content-Type': 'application/json'},
            json={
                'model': provider['model'],
                'messages': [{'role': 'user', 'content': SUMMARY_PROMPT.format(text=text) + provider['suffix']}],
                'temperature': 0.3,
                'max_tokens': 6000,   # Gemini 2.5+ counts its thinking tokens here too
                **provider['extra'],
            },
            timeout=90,
        )
        resp.raise_for_status()
        choice = resp.json()['choices'][0]
        content = choice['message'].get('content') or ''
        finish_reason = choice.get('finish_reason')
    except requests.HTTPError as e:
        detail = e.response.text[:300] if e.response is not None else ''
        return JsonResponse({'success': False, 'error': f"{provider['label']} error: {e} {detail}"})
    except requests.RequestException as e:
        return JsonResponse({'success': False, 'error': f"{provider['label']} service error: {e}"})
    except (KeyError, IndexError, ValueError):
        return JsonResponse({'success': False, 'error': f"Unexpected answer from {provider['label']}."})

    summary = re.sub(r'<think>.*?(</think>|$)', '', content, flags=re.S).strip()
    summary = re.sub(r'\*\*(.+?)\*\*', r'\1', summary)          # drop **bold** markers
    summary = re.sub(r'\s+(?=\d\.\s)', '\n', summary)            # put "2. " and "3. " on new lines
    if not summary:
        msg = 'The model ran out of tokens before writing a summary.' if finish_reason == 'length' \
              else 'The model returned an empty summary.'
        return JsonResponse({'success': False, 'error': msg})

    outputs = image.ai_outputs or {}
    entry = outputs.setdefault(provider_id, {})
    entry['summary'] = summary
    entry['summary_stale'] = False
    image.ai_outputs = outputs
    image.save()
    return JsonResponse({'success': True, 'summary': summary, 'provider': provider_id})


@login_required
def back_to_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.status = 'segmented'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})




@login_required
def explain_transcription(request, pk):
    if request.method != 'POST':
        return JsonResponse({'success': False})

    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

    provider_id = request.POST.get('provider', 'qwen')
    provider = SUMMARY_PROVIDERS.get(provider_id)
    if not provider or not provider['api_key'] or not provider['base_url']:
        return JsonResponse({'success': False, 'error': f'{provider_id} is not configured on the server.'})

    preds = image.ocr_predictions or []
    if not any(p.get('text', '').strip() for p in preds):
        return JsonResponse({'success': False, 'error': 'There is no transcription to explain yet.'})

    # same numbering as the rows on screen (1, 2, 3, ...)
    numbered = "\n".join(f"L{i}: {p.get('text', '').strip()}" for i, p in enumerate(preds, 1))

    try:
        content, finish_reason = call_llm(provider, EXPLAIN_PROMPT.format(text=numbered[:8000]), max_tokens=6000)
    except requests.HTTPError as e:
        detail = e.response.text[:300] if e.response is not None else ''
        return JsonResponse({'success': False, 'error': f"{provider['label']} error: {e} {detail}"})
    except requests.RequestException as e:
        return JsonResponse({'success': False, 'error': f"{provider['label']} service error: {e}"})
    except (KeyError, IndexError, ValueError):
        return JsonResponse({'success': False, 'error': f"Unexpected answer from {provider['label']}."})

    try:
        raw_segments = parse_json_reply(content)['segments']
    except (ValueError, KeyError, TypeError):
        msg = ('The model ran out of tokens before finishing.' if finish_reason == 'length'
               else 'The model did not return a readable answer. Please try again.')
        return JsonResponse({'success': False, 'error': msg})

    segments = []
    used = set()                                   # each line belongs to one segment only
    for s in raw_segments:
        nums = []
        for x in s.get('lines', []):
            try:
                n = int(x)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= len(preds) and n not in used:
                nums.append(n)
        if not nums:
            continue
        used.update(nums)

        segments.append({
            'lines': nums,
            'line_indices': [preds[n - 1]['line_index'] for n in nums],
            'reading': ''.join(preds[n - 1].get('text', '').strip() for n in nums),
            'translation': str(s.get('translation', '')).strip(),
            'note': str(s.get('note', '')).strip(),
        })


    if not segments:
        return JsonResponse({'success': False, 'error': 'The model returned an empty explanation.'})

    outputs = image.ai_outputs or {}
    entry = outputs.setdefault(provider_id, {})
    entry['explanation'] = {'segments': segments}
    entry['explanation_stale'] = False
    image.ai_outputs = outputs
    image.save()

    return JsonResponse({'success': True, 'segments': segments, 'provider': provider_id})