# nepocr-app

This is the main project code for the web application for the HTR project for Old Nepali manuscripts. The app is created using Django and integrates the Kraken segmentation model along with a trained transformer model (through Hugging Face). 

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

### 9. Start the server (this is what i used for the development side_
```bash
python manage.py runserver 
```

### Some notes:
##### i. For step 7, we initally created username: admin, and password: admin in my computer setup. But as you prefer?
ii. I am not sure about what the best way to handle login would be. Maybe we can create a login id for a user when the user sends a request / email? and we create it for them? or create a proper registration page which will allow for all safety checks before creating eg verification?
One way to create users is also to: log into `/admin/` with your superuser account. Under the Users section you can create new accounts. Each user can only see their own uploaded documents.


## We have an additional config in `htr/config.py`: i think for this if the system / computer is not strognn enought, we can reduce number of beams to 1, but we prefer 5 is possible, and max length to 256 is possible:
- `NUM_BEAMS` — 1
- `MAX_LEN` — maximum output length per line

- also note that the repo doesnt not have the machine learning model installed but this is cloned internally in the views.py from a framework called hugging face. it might take some time for it to download the first itme ont he computer, but then from the second time it is fine

- additionally, our database also creates a media/ folder, which saves a copy of all the images with the dayabase only storing the paths. this (depending on the number of users can become heavier or take more space but yeah.

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
