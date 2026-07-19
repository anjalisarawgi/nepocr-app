# rebuild.py
import sys
sys.path.insert(0, '/Users/anjalisarawgi/Desktop/nepali/htr_app')

import django
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from htr.utils.trie import TrieNode
import pandas as pd
import pickle

df = pd.read_csv('data/lemmas.csv')
root = TrieNode()

for _, row in df.iterrows():
    surface = str(row['word_form']).strip()
    lemma = str(row['lemma']).strip()
    if not surface:
        continue
    node = root
    for ch in surface:
        if ch not in node.children:
            node.children[ch] = TrieNode()
        node = node.children[ch]
    node.entries.append({'surface': surface, 'lemma': lemma})

with open('lemma_trie_unormalized.pkl', 'wb') as f:
    pickle.dump(root, f)

print('done')