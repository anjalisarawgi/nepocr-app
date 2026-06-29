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
        form = ImageUploadForm()

    documents = UploadedImage.objects.filter(user = request.user).order_by('-uploaded_at')

    # for the image / id url
    selected_doc = None
    if pk:
        selected_doc = get_object_or_404(UploadedImage, pk=pk, user=request.user)

    
    return render(request, 'htr/main_page.html', {'form': form, 'documents': documents, 'selected_doc': selected_doc}) # page 1  = upload page  # 


    

@login_required
def delete_image(request, pk):
    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
    image.delete()
    return redirect('main_page')


from django.http import JsonResponse

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



from skimage.filters import threshold_sauvola

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



from kraken import blla
from kraken.lib import vgsl
from PIL import Image
import io

KRAKEN_MODEL_PATH =  '/Users/anjalisarawgi/anaconda3/envs/gnn_hre/lib/python3.8/site-packages/kraken/blla.mlmodel'

@login_required
def run_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

        source_field = image.processed if image.processed else image.locked_image
        source_field.open()
        pil_image = Image.open(io.BytesIO(source_field.read())).convert('RGB')

        model = vgsl.TorchVGSLModel.load_model(KRAKEN_MODEL_PATH)
        result = blla.segment(pil_image, model=model)

        lines = []
        for line in result.lines:
            lines.append({
                'polygon': line.boundary,
                'baseline': line.baseline,
            })

        
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



import json

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


from django.http import HttpResponse
from django.template.loader import render_to_string

@login_required
def export_alto_xml(request, pk):
    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)

    source = image.processed if image.processed else image.locked_image
    width = source.width if source else 0
    height = source.height if source else 0

    xml_content = render_to_string('htr/alto_template.xml', {
        'filename': image.filename,
        'width': width,
        'height': height,
        'lines': image.line_coordinates,
    })

    response = HttpResponse(xml_content, content_type='application/xml')
    response['Content-Disposition'] = f'attachment; filename="{image.filename}_lines.xml"'
    return response



from kraken.lib import segmentation as kraken_segmentation
import json

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

        baseline_tuple = [tuple(p) for p in baseline_points]
        polygons = kraken_segmentation.calculate_polygonal_environment(pil_image, [baseline_tuple])

        polygon = polygons[0] if polygons and polygons[0] is not None else None
        if polygon is None:
            return JsonResponse({'success': False, 'error': 'Could not compute a polygon for this baseline. Try drawing it closer to the text line.'})

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


@login_required
def back_to_segmentation(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        image.status = 'segmented'
        image.save()
        return JsonResponse({'success': True})
    return JsonResponse({'success': False})



### OCR
from functools import lru_cache
import torch
from transformers import VisionEncoderDecoderModel, PreTrainedTokenizerFast, TrOCRProcessor

@lru_cache(maxsize=1)
def load_ocr_model():
    model_path = "AnjaliSarawgi/model-fullset-57k"
    hf_token = os.environ.get("HF_TOKEN")
    model = VisionEncoderDecoderModel.from_pretrained(model_path, token=hf_token)
    tokenizer = PreTrainedTokenizerFast.from_pretrained(model_path, token=hf_token)
    processor = TrOCRProcessor.from_pretrained("microsoft/trocr-large-handwritten", token=None)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()
    return model, tokenizer, processor, device


def clean_ocr_text(text):
    import re
    return re.sub(r"[\u00AD\u200B\u200C\u200D]", "", text)


import pandas as pd
import numpy as np

def predict_line_with_confidence(pil_crop, topk=3):
    model, tokenizer, processor, device = load_ocr_model()
    pixel_values = processor(images=pil_crop.convert("RGB"), return_tensors="pt").pixel_values.to(device)

    with torch.inference_mode():
        out = model.generate(
            pixel_values,
            max_length=128,
            num_beams=1,
            do_sample=False,
            return_dict_in_generate=True,
            output_scores=True,
            use_cache=True,
            eos_token_id=tokenizer.eos_token_id,
        )

    seq = out.sequences[0]
    decoded_text = clean_ocr_text(tokenizer.decode(seq, skip_special_tokens=True))

    beta = load_beta_calibrator()
    rows = []

    for step, (logits, tgt) in enumerate(zip(out.scores, seq[1:]), start=1):
        probs = torch.softmax(logits[0].float().cpu(), dim=-1)
        tgt_id = int(tgt.item())
        conf = float(probs[tgt_id].item())

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

        rows.append({
            "token": alt_tokens[0],
            "confidence": conf,
            "cal_confidence": float(cal_conf),
            "alt_tokens": "|".join(alt_tokens),
            "alt_probs": "|".join([f"{p:.6f}" for p in alt_ps]),
        })

    df_tok = pd.DataFrame(rows)
    highlighted_html = highlight_tokens_with_tooltips(decoded_text, df_tok)
    return decoded_text, highlighted_html

from PIL import ImageDraw

@login_required
def run_ocr(request, pk):
    if request.method == 'POST':
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

        Y_TOLERANCE = 25

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

            text, html = predict_line_with_confidence(crop)
            predictions.append({'line_index': original_idx, 'text': text, 'html': html})
            
        image.ocr_predictions = predictions
        image.ocr_stale = False
        image.save()

        return JsonResponse({'success': True, 'predictions': predictions})

    return JsonResponse({'success': False})



import joblib
import torch
import re

@lru_cache(maxsize=1)
def load_beta_calibrator():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(base_dir, 'beta_calibrator.joblib')
    return joblib.load(path)


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


def html_escape(s):
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def highlight_tokens_with_tooltips(line_text, df_tok):
    aks, spans = split_aksharas(line_text)
    joined = "".join(aks)
    used_ranges = []
    insertions = []
    search_cursor = 0

    for _, row in df_tok.iterrows():
        token = row.get("token", "").strip()
        if not token:
            continue
        start_char_idx = joined.find(token, search_cursor)
        if start_char_idx == -1:
            continue
        search_cursor = start_char_idx + len(token)

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
        token_str = html_escape(line_text[char_start:char_end])

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
            tooltip_lines.append(f"Model probability: {cal:.2f}")
        for t, p in zip(alt_toks, alt_probs):
            try:
                prob = float(p)
            except Exception:
                prob = 0.0
            tooltip_lines.append(f"{html_escape(t)}: {prob:.3f}")

        tooltip = "\n".join(tooltip_lines)
        cls = f"ocr-token {conf_cls}"
        html_token = f"<span class='{cls}' data-tooltip='{html_escape(tooltip)}'>{token_str}</span>"
        insertions.append((char_start, char_end, html_token))

    if not insertions:
        return html_escape(line_text)

    insertions.sort()
    out_parts = []
    last_idx = 0
    for s, e, html_tok in insertions:
        out_parts.append(html_escape(line_text[last_idx:s]))
        out_parts.append(html_tok)
        last_idx = e
    out_parts.append(html_escape(line_text[last_idx:]))
    return "".join(out_parts)


@login_required
def download_ocr_text(request, pk):
    image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
    predictions = image.ocr_predictions or []

    lines = [p.get('text', '') for p in predictions]
    content = "\n".join(lines)

    response = HttpResponse(content, content_type='text/plain; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{image.filename}_predictions.txt"'
    return response