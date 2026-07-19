import json
import unicodedata
import re
from collections import defaultdict
import pandas as pd
from torchmetrics.functional.text import char_error_rate


VIRAMA = "\u094D"
NUKTA = "\u093C"
MACRON_PATTERN = re.compile(r"\u0304+")
HYPHEN_COLLAPSE = re.compile(r'(?:\s*-\s*)+')
# Patterns
_PATTERNS = {
    "removed_invis_chars": re.compile(r"[\u00AD\u200B\u200C\u200D]"),
    "bullet_to_dot": re.compile(r"[·•‧∙]"),
    "removed_single_quotes": re.compile(r"[`'‘’]"),
    # "removed_whitespace": re.compile(r"\s+", re.UNICODE),
    "noisy_char": re.compile(r"[\u0300\u0301]") ,
    "normalize_dashes": re.compile(r"[–—−]")
}

def normalize_digits(s, counter, line_counter):
    digit_map = str.maketrans("0123456789", "०१२३४५६७८९")
    if re.search(r"[0-9]", s):
        count = sum(s.count(d) for d in "0123456789")
        s = s.translate(digit_map)
        counter["converted_digits_to_deva"] += count
        line_counter["converted_digits_to_deva"] += 1
    return s

def normalize_text(s, counter, line_counter):
    s = unicodedata.normalize("NFKC", s)

    for key, pattern in _PATTERNS.items():
        s_new, n = pattern.subn({
            "bullet_to_dot": ".",
            "removed_single_quotes": "",
            "removed_invis_chars": "",
            # "removed_whitespace": "", 
            "noisy_char": "", 
            "normalize_dashes": "-"
        }[key], s)
        if n > 0:
            counter[key] += n
            line_counter[key] += 1
            s = s_new

    if "||" in s:
        s = s.replace("||", "॥")
        counter["pipe_to_double_danda"] += 1
        line_counter["pipe_to_double_danda"] += 1
    if "|" in s:
        s = s.replace("|", "।")
        counter["pipe_to_danda"] += 1
        line_counter["pipe_to_danda"] += 1

    if MACRON_PATTERN.search(s):
        matches = MACRON_PATTERN.findall(s)
        total_len = sum(len(m) for m in matches)
        counter["removed_macrons"] += total_len
        line_counter["removed_macrons"] += 1

        s = MACRON_PATTERN.sub("", s)

    # this probably is not a contribution 
    if "\u0310" in s:
        count = s.count("\u0310")
        s = s.replace("\u0310", "\u0901")
        counter["cleaned_chandrabindu"] += count
        line_counter["cleaned_chandrabindu"] += 1
    
    # s = re.sub(r'\s{2,}', ' ', s)
    new_s, n = re.subn(r'\s{2,}', ' ', s)
    # if n > 0:
    #     counter["normalized_whitespace"] += n
    #     line_counter["normalized_whitespace"] += 1
    s = new_s

    s = HYPHEN_COLLAPSE.sub("-", s)
    # s = re.sub(r'[-\.]+$', '', s)
    # s = normalize_digits(s, counter, line_counter)


    s = s.strip()
    return s

def normalize_lemmas_csv( input_csv, output_csv):
    df = pd.read_csv(input_csv)

    counter = defaultdict(int)
    line_counter = defaultdict(int)

    df["lemma_norm"] = df["lemma"].apply(lambda x: normalize_text(str(x), counter, line_counter))
    df["word_form_norm"] = df["word_form"].apply(lambda x: normalize_text(str(x), counter, line_counter))

    df.to_csv(output_csv, index=False)

    print("Saved:", output_csv)
    print("Normalization summary:")
    for k in sorted(counter):
        print(f"{k:30s}: {counter[k]}")



if __name__ == "__main__":
    normalize_lemmas_csv(
        input_csv="data/lemmas.csv",
        output_csv="lemmas_normalized_new.csv"
    )
