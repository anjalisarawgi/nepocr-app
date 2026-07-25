# nepocr-app

A web application for handwritten text recognition (HTR) of Old Nepali manuscripts. This app allows the user to upload manuscript images, clean them, segment text lines, and run OCR to get transcriptions.

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

### 9. Start the server
```bash
python manage.py runserver 0.0.0.0:8000
```

## Adding users
Log into `/admin/` with your superuser account. Under the Users section you can create new accounts. Each user can only see their own uploaded documents.

## Files included in the repo
- `models/lemma_trie.json` — Nepali dictionary for word matching
- `beta_calibrator.joblib` — confidence calibration for OCR
- `htr/config.py` — model settings and constants

## Model settings
Adjustable in `htr/config.py`:
- `OCR_MODEL_PATH` — HuggingFace model name
- `NUM_BEAMS` — beam search width
- `MAX_LEN` — maximum output length per line
- `TRIE_MIN_LEN` — minimum word length for dictionary matching
- `Y_TOLERANCE` — pixel tolerance for grouping lines into rows

