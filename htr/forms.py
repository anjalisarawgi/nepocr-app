from django import forms
from .models import UploadedImage

class ImageUploadForm(forms.ModelForm): # automatically creates a form based on the UploadedImage model
    class Meta:
        model = UploadedImage
        fields = ['original_image'] # only thing the user needs to provide

