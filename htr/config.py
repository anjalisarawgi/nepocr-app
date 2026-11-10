import os

OCR_MODEL_PATH =  "AnjaliSarawgi/model-fullset-batch4" #"AnjaliSarawgi/model-fullset-57k"
NUM_BEAMS = 5  # recommended 5, min = 1
MAX_LEN = 256 # recommended 256, min = 128
TRIE_MIN_LEN = 3 # recommended 3
Y_TOLERANCE  = 25 # recommended 25
PADDLE_DET_MODEL = os.environ.get('PADDLE_DET_MODEL', 'PP-OCRv5_server_det')
PADDLE_MIN_SCORE = 0.5   