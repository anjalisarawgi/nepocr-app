from django.urls import path 
from . import views


urlpatterns =[
    path('', views.upload_image, name = 'main_page'),
    path('login/', views.login_view, name = 'login'),
    path('logout/', views.logout_view, name = 'logout'),
    path('delete/<int:pk>/', views.delete_image, name='delete_image'),
    path('crop/<int:pk>/', views.crop_image, name='crop_image'),
    path('reset/<int:pk>/', views.reset_image, name='reset_image'),


]

#