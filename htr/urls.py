from django.urls import path 
from . import views


urlpatterns =[
    path('', views.upload_image, name = 'main_page'),
    path('login/', views.login_view, name = 'login'),
    path('logout/', views.logout_view, name = 'logout'),
    path('delete/<int:pk>/', views.delete_image, name='delete_image'),
    path('crop/<int:pk>/', views.crop_image, name='crop_image'),
    path('reset/<int:pk>/', views.reset_image, name='reset_image'),
    path('image/<int:pk>/', views.upload_image, name='view_image'),
    path('advance/<int:pk>/', views.advance_to_preprocessing, name='advance_to_preprocessing'),
    # path('gaussian/<int:pk>/', views.apply_gaussian, name='apply_gaussian'),
    path('preprocess/<int:pk>/', views.apply_preprocessing, name='apply_preprocessing'),
    path('advance-segmentation/<int:pk>/', views.advance_to_segmentation, name='advance_to_segmentation'),
    path('segment/<int:pk>/', views.run_segmentation, name='run_segmentation'),
    path('save-segmentation/<int:pk>/', views.save_segmentation, name='save_segmentation'),
    path('add-baseline/<int:pk>/', views.add_baseline_polygon, name='add_baseline_polygon'),
    path('back-to-preprocessing/<int:pk>/', views.back_to_preprocessing, name='back_to_preprocessing'),
    path('advance-ocr/<int:pk>/', views.advance_to_ocr, name='advance_to_ocr'),
    path('back-to-segmentation/<int:pk>/', views.back_to_segmentation, name='back_to_segmentation'),
]   
