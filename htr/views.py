from django.shortcuts import render, redirect
import cv2 
import numpy as np 
from django.core.files.base import ContentFile
from .models import UploadedImage
from .forms import ImageUploadForm


def upload_image(request):
    if request.method == 'POST':
        form = ImageUploadForm(request.POST, request.FILES) # POST contains the form fields eg text, checkboxes adn FILES contains the uploaded files
        if form.is_valid(): # checks if valid, and if not, go to else and if yes, save it to the database and redirect to the preprocess page
            instance = form.save() 
            return redirect('preprocess', pk = instance.pk)
    else:
        form = ImageUploadForm()
    return render(request, 'htr/upload.html', {'form': form}) # page 1  = upload page




def preprocess_image(request, pk):
    instance = UploadedImage.objects.get(pk=pk)

    # read the uploaded image:
    img_path = instance.original_image.path
    img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)

    # gaussian background normalization: (preprocessing method 1)
    blur = cv2.GaussianBlur(img, (201, 201), 201)
    normalized = cv2.divide(img, blur, scale = 255)

    # saving the processed image:
    _, buffer = cv2.imencode('.png', normalized)
    file_content = ContentFile(buffer.tobytes(), name = f'processed_{pk}.png') # convert the processed image to a format that can be saved in the database
    instance.processed.save(f'processed_{pk}.png', file_content, save = True) # save the processed image to the database

    return render(request, 'htr/result.html', {'instance': instance}) # instance is 

