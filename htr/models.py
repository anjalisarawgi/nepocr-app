from django.db import models
from django.contrib.auth.models import User

# Create your models here.

class UploadedImage(models.Model):
    user = models.ForeignKey(User, on_delete = models.CASCADE, null=True, blank=True) # this field will link the uploaded image to the user who uploaded it, and if the user is deleted, the image will also be deleted
    original_image = models.ImageField(upload_to="uploads/") # file path of the image the user uploads
    processed = models.ImageField(upload_to = "processed/", blank = True, null = True) # this field will store the file path of the image after preprocessing
    uploaded_at = models.DateTimeField(auto_now_add=True) # timestamp of when the image was uploaded

