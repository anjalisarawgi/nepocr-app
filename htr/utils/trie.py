import pandas as pd
import json

class TrieNode:
    def __init__(self):
        self.children = {}
        self.entries = []

def build_trie(csv_path, surface_col='word_form_norm', lemma_col='lemma_norm'):
    df = pd.read_csv(csv_path)
    df = df.drop_duplicates(subset=[surface_col, lemma_col])
    
    root = TrieNode()
    for _, row in df.iterrows():
        surface = str(row[surface_col]).strip()
        lemma = str(row[lemma_col]).strip()
        if not surface:
            continue
        node = root
        for ch in surface:
            if ch not in node.children:
                node.children[ch] = TrieNode()
            node = node.children[ch]
        node.entries.append({'surface': surface, 'lemma': lemma})
    
    print(f"Built trie with entries from {csv_path}")
    return root

def save_trie(root, path):
    def to_dict(node):
        return {
            'entries': node.entries,
            'children': {ch: to_dict(child) for ch, child in node.children.items()}
        }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(to_dict(root), f, ensure_ascii=False)
    print(f"Saved to {path}")

def load_trie(path):
    def from_dict(d):
        node = TrieNode()
        node.entries = d.get('entries', [])
        for ch, child in d.get('children', {}).items():
            node.children[ch] = from_dict(child)
        return node
    with open(path, 'r', encoding='utf-8') as f:
        return from_dict(json.load(f))

if __name__ == '__main__':
    root = build_trie('data/lemmas_normalized.csv')
    save_trie(root, 'lemma_trie.json')