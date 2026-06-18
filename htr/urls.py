from django.urls import path 
from . import views


urlpatterns =[
    path('', views.upload_image, name = 'upload'),
    path('preprocess/<int:pk>/', views.preprocess_image, name = 'preprocess'),
    path('login/', views.login_view, name = 'login'),
    path('logout/', views.logout_view, name = 'logout'),
    path('history/', views.history_view, name = 'history'),
    path('run_ocr/', views.run_ocr, name = 'run_ocr'),
    path('export/', views.export, name = 'export'),
    path('segment/', views.segment, name = 'segment'),
]

#