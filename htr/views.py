from django.shortcuts import render, redirect
import cv2 
import numpy as np 
from django.core.files.base import ContentFile
from .models import UploadedImage
from .forms import ImageUploadForm
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required



def login_view(request):
    if request.user.is_authenticated:
        return redirect('upload')
    if request.method == 'POST':
        form = AuthenticationForm(data = request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            return redirect('upload')
        
    else: 
        form = AuthenticationForm()
    return render(request, 'htr/login.html', {'form': form})
        

def logout_view(request):
    logout(request)
    return redirect('login')


        



@login_required
def upload_image(request):
    if request.method == 'POST':
        form = ImageUploadForm(request.POST, request.FILES) # POST contains the form fields eg text, checkboxes adn FILES contains the uploaded files
        if form.is_valid(): # checks if valid, and if not, go to else and if yes, save it to the database and redirect to the preprocess page
            instance = form.save(commit=False) # create an instance of the UploadedImage model but dont save it to the database yet
            instance.user = request.user # attach the loggedin user
            instance.save() # now save to db
            request.session['current_image_pk']= instance.pk # save to session
            return redirect('preprocess', pk = instance.pk)
    else:
        form = ImageUploadForm()

    current_pk = request.session.get('current_image_pk')
    current_image = None
    if current_pk:
        current_image = UploadedImage.objects.filter(pk = current_pk, user = request.user).first()# user = request.user makes sure that the user can only ever se etheir own image, 
    return render(request, 'htr/upload.html', {'form': form, 'current_pk': current_pk, 'current_image': current_image}) # page 1  = upload page  # 



@login_required
def preprocess_image(request, pk):
    instance = UploadedImage.objects.get(pk=pk, user=request.user) # get the uploaded image instance from the database, and make sure it belongs to the logged in user
    request.session['current_image_pk'] = pk
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

    return render(request, 'htr/preprocess.html', {'instance': instance, 'current_pk': pk}) # instance is 


@login_required
def history_view(request):
    images = UploadedImage.objects.filter(user = request.user).order_by('-uploaded_at')
    return render(request, 'htr/history.html', {'images': images})


@login_required
def run_ocr(request):
    current_pk = request.session.get('current_image_pk')
    return render(request, 'htr/run_ocr.html', {'current_pk': current_pk})


@login_required
def export(request):
    current_pk = request.session.get('current_image_pk')
    return render(request, 'htr/export.html', {'current_pk': current_pk})

@login_required
def segment(request):
    current_pk = request.session.get('current_image_pk')
    return render(request, 'htr/segment.html', {'current_pk': current_pk})

@login_required
def clear_current_image(request):
    request.session.pop('current_image_pk', None)
    return redirect('upload')