from django.urls import path 
from . import views


urlpatterns =[
    path('', views.upload_image, name = 'upload'),
    path('preprocess/<int:pk>/', views.preprocess_image, name = 'preprocess'),
    path('login/', views.login_view, name = 'login'),
    path('logout/', views.logout_view, name = 'logout'),
    path('history/', views.history_view, name = 'history'),
]

#