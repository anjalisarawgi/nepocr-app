# nepocr-app

A web application for handwritten text recognition (HTR) of Old Nepali manuscripts. This app allows the user to upload manuscript images, clean them, segment text lines, and run OCR to get transcriptions.

## Main requirements
- Python 3.8
- PostgreSQL
- PyTorch
- HuggingFace read token with access to `AnjaliSarawgi/model-fullset-57k`

## Setup

### 1. Please clone the repo
```bash
git clone <https://github.com/anjalisarawgi/nepocr-app>
cd nepocr-app
```

### 2. Create a virtual environment and download the dependencies
```bash
conda create -n nepocr_env
conda activate nepocr_env
pip install -r requirements.txt
```
