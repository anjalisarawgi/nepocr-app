# Deployment Guide (if required)

This guide is for server deployment when using **Gunicorn + Nginx**. For initial setup (dependencies, database, migrations, static files), please follow the first 9 steps in the README first.

## Architecture

```
Internet → Nginx → Gunicorn → Django app
             ↓
        Static & media files served directly by Nginx (making it faster)
```

---


## 1. Update Django settings

In `config/settings.py`, update with the university server's hostname:

```python
ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'university.edu']
CSRF_TRUSTED_ORIGINS = ['https://university.edu']
```


## 2. Then setup up systemd (to ensure the app is always running )

First, please create a service file:

```bash
sudo nano /etc/systemd/system/nepocr.service
```

Then paste the following (update paths and User, in <> brackets):

```ini
[Unit]
Description=Gunicorn daemon for nepocr-app
After=network.target

[Service]
User=<youruser>
Group=www-data
WorkingDirectory=</path/to/nepocr-app>
EnvironmentFile=</path/to/nepocr-app/.env>
ExecStart=</path/to/nepocr-app/venv/bin/gunicorn> \
    --workers 3 \
    --timeout 300 
    --bind unix:/run/nepocr.sock \
    config.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nepocr
sudo systemctl start nepocr
sudo systemctl status nepocr   # should show "active (running)"
```


## 3. Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/nepocr
```

Paste the following (update paths and hostname, in <> brackets):

```nginx
server {
    listen 80;
    server_name <university.edu>;

    location /static/ {
        alias </path/to/nepocr-app/staticfiles/>;
    }

    location /media/ {
        alias </path/to/nepocr-app/media/>;
    }

    location / {
        proxy_pass http://unix:/run/nepocr.sock;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

Finally, enable and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/nepocr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```


## 4. Check if webapp is hosted
Visit the app URL hosted (e.g.: `http://univerisity.edu`) in the browser, and the app should be running. 

