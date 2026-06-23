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
            # Only back up the very first time this image is cropped
            if not image.original_backup:
                image.original_image.open()
                image.original_backup.save(image.filename, image.original_image, save=False)

            image.original_image.save(image.filename, cropped_file, save=True)
            return JsonResponse({'success': True, 'new_url': image.original_image.url, 'has_backup': True})
    return JsonResponse({'success': False})


@login_required
def reset_image(request, pk):
    if request.method == 'POST':
        image = get_object_or_404(UploadedImage, pk=pk, user=request.user)
        if image.original_backup:
            image.original_image.save(image.filename, image.original_backup, save=True)
            image.original_backup.delete(save=True)
            return JsonResponse({'success': True, 'new_url': image.original_image.url})
    return JsonResponse({'success': False})