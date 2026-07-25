# nepocr-app

This is the main project code for the web application for the HTR project for Old Nepali manuscripts. The app is created using Django (Python) and a JavaScript frontend. It also integrates the Kraken segmentation model along with a trained transformer model (through Hugging Face). 

## Main requirements
- Python 3.8
- PostgreSQL
- PyTorch 

## Setup

### 1. Please clone the repo
```bash
git clone https://github.com/anjalisarawgi/nepocr-app
cd nepocr-app
```

### 2. Create a virtual environment and download the dependencies
```bash
conda create -n nepocr_env
conda activate nepocr_env
```

```bash
pip install -r requirements.txt
```

### 3. Setup PostgreSQL
Open PostgreSQL:
```bash
sudo -u postgres psql
```
Then run:
```sql
CREATE DATABASE htr_app;
CREATE USER htruser WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE htr_app TO htruser;
\q
```
Replace `htruser` and `yourpassword` with your own values.

### 4. Create a .env file
Create a file called `.env` in the project root (same folder as `manage.py`). There is also a `.env.example` file in the project root for reference. 
```
SECRET_KEY=
DEBUG=False
DB_NAME=htr_app
DB_USER=htruser
DB_PASSWORD=yourpassword
DB_HOST=localhost
DB_PORT=5432
KRAKEN_MODEL_PATH=models/kraken_segmentation_finetuned/blla.mlmodel
```

### 5. Enter the fields in the `.env` file:

First, to generate a secure secret key (for `SECRET_KEY`), please run:
```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```
Copy the output and paste it as the value for `SECRET_KEY`.

Similarly, for `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT`, please use the same values you chose while setting up the database in step 3. 

### 6. Run migrations
```bash
python manage.py migrate
```

### 7. Create an admin user
```bash
python manage.py createsuperuser
```

### 8. Collect static files
```bash
python manage.py collectstatic
```

### 9. Start the server (for local deployment only)
```bash
python manage.py runserver 
```

### 10. Server Deployment
Before deploying, please update `ALLOWED_HOSTS` and   `CSRF_TRUSTED_ORIGINS` with the domain host names in  `config/settings.py`

```python
ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'university.edu']
CSRF_TRUSTED_ORIGINS = ['https://university.edu']
```

Note: While deploying the app, if using Gunicorn, we require a timeout of at least 300 seconds:  `--timeout 300`.

## Project structure
```
nepocr-app/
├── config/
│   ├── settings.py       # django settings
│   ├── urls.py           # root url routes
├── htr/
│   ├── config.py         # model settings and constants
│   ├── views.py          # all app logic
│   ├── models.py         # database models
│   ├── urls.py           # url routes
│   ├── templates/        # html templates
│   ├── static/           # css and javascript
│   └── utils/            # helper functions
├── data/                 # some helper .csv files
├── models/
│   ├── kraken_segmentation_finetuned   # kraken segmentation model (blla.model)
│   └── lemma_trie.json   # nepali dictionary trie
├── requirements.txt
├── manage.py
└── README.md

```



## Some Notes:
### ML model:
The machine learning model downloads from HuggingFace automatically on the first run; it may take a few minutes. This also requires an internet connection on the server.

---
### Media folder:
The uploaded and processed images are saved in a `media/` folder on the disk: it should be writable and requires storage

---

### Adding users and login setup:
For now, the user accounts can only be created manually by the admin. To create a new user, we can use the following steps:

1. Go to `<appurl>/admin/`
2. Log in with the superuser credentials we create from step 7
3. Then click on Users -> Add User and create a new user account

Here, each user can only see their own documents.

**Note**: I am not sure about what the best way to handle login would be. Right now, there is no self-registration page, and users need to contact us to get an account.

---

### Changeable model settings:
Some parameters can be adjusted in `htr/config.py`, if the server capacity is not sufficient:
- `NUM_BEAMS` — Default is 5, but can be reduced to 1
- `MAX_LEN` — Default is 256, but can be reduced to 128

---

### Database structure:
The app right now uses two main tables in PostgreSQL:

**`auth_user`** (Django built-in)
- Stores user accounts (id, username, hashed password)

**`htr_uploadedimage`** (app table)
- One row per uploaded document
- Linked to `auth_user` via `user_id` (each document belongs to one user)
- Stores document metadata: status, preprocessing settings, segmentation coordinates, OCR predictions
- Stores image file paths only (actual images are stored in `media/` on disk)

**`media/` folder**
- Actual image files are saved here on disk, organised into subfolders:
  - `uploads/` — original uploaded images
  - `processed/` — cleaned images (from step 1)
  - `locked/` — images locked copy (cropped) before preprocessing
  - `backups/` — original image backups

