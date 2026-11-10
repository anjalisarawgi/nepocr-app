SUMMARY_PROMPT = """

Below is a machine (HTR) transcription of an Old Nepali text. Note that it may contain recognition errors, abbreviations, and lack word boundaries (scriptio continua).

Transcription:
{text}

Instructions:
Write a 4 to 6 sentence summary including:
1. Title and Document Type: A concise title and document type (e.g., administrative order/purjī, receipt, letter, land grant, legal petition).
2. Key Content & Entities: Main individuals, locations, dates, offices, or allowances/items mentioned.
3. Main Purpose: What action is being taken or ordered in the document any additonal details (if any) mentioning what it is talking about in 1-3 sentences.

Strict Rules to Prevent Hallucination:
- Rely strictly on the text provided. If details are ambiguous or unclear due to HTR noise, explicitly state that in the summary.
- Return ONLY the final summary text (no conversational preamble or intro/outro text).
"""




# SUMMARY_PROMPT = """
# Below is a machine (HTR) transcription of an Old Nepali text. It may contain recognition errors, and no word boundaries (scriptio continua).

# Transcription:
# {text}

# Write a synopsis:
# 1. try to cover all what is said in the document as far as possible, including all the named entities (transliterated in IAST format)
# 2. Only cover what is said in the document, and if anything is unclear, give your best guess and put [?] after that part.
# """

EXPLAIN_PROMPT = """You are helping a historian read a handwritten Old Nepali document written in Devanagari.
The text below comes from an OCR model, so it has errors: missing word spaces, wrong characters,
and words split across lines. Each line starts with its number (L1, L2, ...).

Group the lines into short meaning units (one phrase or sentence, usually 1-3 lines).
For each unit give exactly these four fields:

- "lines": the line numbers in this unit, e.g. [3, 4]. Every line appears in exactly one unit, in order.
- "romanized": the unit's text in IAST transliteration (Latin letters with diacritics, e.g. "svasti śrī"),
  with word spaces added where you can. Romanize the text as transcribed, without silently fixing errors.
  Never Devanagari.
- "translation": a plain English translation of the unit. Base it on the most likely correct reading.
  After each important name, title, office, place, or technical term, add the original Devanagari
  in brackets, copied exactly from the text, e.g. "Munshi Lal Singh (मुन्सीलालसिंह)".
  Devanagari may appear ONLY inside these brackets; everything else is English.
  If part of the meaning is unclear, give your best guess and put [?] after that part.
  If nothing can be understood, write "[unclear]".
- "note": at most one short English sentence of useful context (a person, a title, a place, a date,
  a standard letter formula). You may cite a Devanagari term in brackets here too.
  Use "" if there is nothing useful. Do NOT write things like "continues on L5".

Output ONLY one JSON object, with no markdown and no text before or after it, in exactly this shape:
{{"segments": [{{"lines": [1], "romanized": "...", "translation": "...", "note": "..."}}]}}

Example input:
L1: स्वस्तिश्रीसर्वोपमा
L2: योग्यमुन्सीलालसिंहके
Example output:
{{"segments": [{{"lines": [1, 2], "romanized": "svasti śrī sarvopamāyogya munsī lālasiṃha ke", "translation": "Hail! To the most worthy (सर्वोपमायोग्य) Munshi Lal Singh (मुन्सीलालसिंह)", "note": "Standard respectful opening (स्वस्तिश्री) of a letter."}}]}}

Text:
{text}
"""