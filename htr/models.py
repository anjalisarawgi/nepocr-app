from django.db import models
from django.contrib.auth.models import User
import os
# Create your models here.

from datetime import datetime
def user_upload_path(instance, filename):
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S%f')
    return os.path.join('uploads', timestamp, filename)



class UploadedImage(models.Model):
    STATUS_CHOICES = [
        ("uploaded", "Uploaded"),
        ("preprocessed", "Preprocessed"),
        ("segmented", "Segmented"), 
        ("ocr_done", "OCR Complete")
    ]

    user = models.ForeignKey(User, on_delete = models.CASCADE, null=True, blank=True) # this field will link the uploaded image to the user who uploaded it, and if the user is deleted, the image will also be deleted
    original_image = models.ImageField(upload_to=user_upload_path) # file path of the image the user uploads
    processed = models.ImageField(upload_to = "processed/", blank = True, null = True) # this field will store the file path of the image after preprocessing
    uploaded_at = models.DateTimeField(auto_now_add=True) # timestamp of when the image was uploaded
    original_backup = models.ImageField(upload_to="backups/", blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default = "uploaded")
    locked_image = models.ImageField(upload_to="locked/", blank=True, null=True)
    preprocessing_settings = models.JSONField(default=dict, blank=True)
    line_coordinates = models.JSONField(default=list, blank=True)
    ocr_predictions = models.JSONField(default=list, blank=True)
    ocr_stale = models.BooleanField(default=False)



    @property
    def filename(self):
        return os.path.basename(self.original_image.name)
    

    @property
    def file_label(self):
        ext = os.path.splitext(self.original_image.name)[1].lower()  # gets '.png', '.jpg', etc.
        return f"image{ext}"
    

