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
            return redirect('main_page')
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
        opening_on = request.POST.get('opening') == 'true'

        if not any([gaussian_on, clahe_on, sauvola_on, opening_on]):
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
        opening_size = int(request.POST.get('opening_size', 3))

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

        if opening_on:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            inverted = cv2.bitwise_not(gray)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (opening_size, opening_size))

            opened = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, kernel)
            img = cv2.bitwise_not(opened)

        success, buffer = cv2.imencode('.jpg', img)
        content = ContentFile(buffer.tobytes())
        

        image.preprocessing_settings = {
            'gaussian': gaussian_on,
            'clahe': clahe_on,
            'sauvola': sauvola_on,
            'opening': opening_on,
            'kernel_size': kernel_size,
            'sigma': sigma,
            'clip_limit': clip_limit,
            'tile_size': tile_size,
            'window_size': window_size,
            'k': k,
            'opening_size': opening_size,
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

