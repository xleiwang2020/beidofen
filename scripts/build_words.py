#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the word-trainer dataset from the official KET Vocabulary List PDF.

Pipeline
--------
1. read the two-column alphabetical word list (pages 4-18 of the PDF)
2. read the four-column topic lists (Appendix 3) and the Appendix 1 word sets
3. enrich every headword with an authoritative Chinese gloss + IPA taken from the
   dictionary that ships with macOS (`牛津英汉汉英词典`)
4. merge everything and write ``data/words.json`` + ``data/words.js``

Run it from anywhere with::

    python3 scripts/build_words.py

Outputs (all under ``data/``)::

    words.json          machine readable dataset (the source of truth)
    words.js            the same data wrapped for the browser (works offline via file://)
    build_report.txt    what was extracted / what still needs a human touch
"""

import json
import os
import re
import sys
import unicodedata
from collections import OrderedDict

import fitz  # PyMuPDF

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apple_dict import (OxfordChineseDictionary, chinese_gloss, glosses_from_body,  # noqa: E402
                        split_entry)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PDF = os.path.join(DATA, 'ket-vocabulary-list.pdf')

LIST_PAGES = range(3, 18)        # PDF pages 4-18  -> alphabetical list
TOPIC_PAGES = range(19, 28)      # PDF pages 20-28 -> Appendix 3 topic lists
WORD_SET_PAGE = 18               # PDF page 19     -> Appendix 1 + Appendix 2

# x positions used by the PDF layout (the list is printed in two columns)
LEFT_ENTRY_X = (48.0, 51.5)      # left column headwords start at 49.6 / 49.7
RIGHT_ENTRY_X = (310.0, 316.0)   # right column headwords start at 312.1 - 313.3
COLUMN_SPLIT = 290.0
LEFT_EXAMPLE_X = 82.0            # left column example text starts at 85.6
RIGHT_EXAMPLE_X = 344.0          # right column example text starts at 348.1

BULLET_HINT = 'Symbol'           # the SymbolMT bullet glyph (U+F0B7)

# part-of-speech tags that may appear inside "(...)" in the PDF
POS_WORDS = {'n', 'v', 'adj', 'adv', 'prep', 'pron', 'det', 'conj', 'art', 'exclam',
             'int', 'phr', 'pl', 'sing', 'num', 'abbr', 'nb'}


# --------------------------------------------------------------------------- PDF

def page_spans(page):
    """All non-empty text spans of a page, as light-weight dicts."""
    out = []
    for block in page.get_text('dict')['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            for span in line['spans']:
                if not span['text'].strip():
                    continue
                out.append({
                    'x': round(span['bbox'][0], 1),
                    'y': round(span['bbox'][1], 1),
                    'text': span['text'],
                    'font': span['font'],
                    'size': round(span['size'], 1),
                })
    return out


def is_entry_x(x):
    return (LEFT_ENTRY_X[0] <= x <= LEFT_ENTRY_X[1]) or (RIGHT_ENTRY_X[0] <= x <= RIGHT_ENTRY_X[1])


POS_SPAN = re.compile(r'^\s*\(([^()]*)\)\s*$')
TRAILING_POS = re.compile(r'^(.*?)\s*\(([^()]*)\)$')


def _looks_like_pos(text):
    """True when ``text`` (the inside of a trailing "(...)") is a part-of-speech tag."""
    tokens = [t for t in re.split(r'[^A-Za-z]+', text) if t]
    return bool(tokens) and all(t.lower() in POS_WORDS for t in tokens)


def parse_alphabetical_list(doc):
    """Return an ordered list of ``{'raw','pos','examples'}`` for the A-Z word list.

    The PDF prints the list in two columns; a headword may be made of several text
    spans (``ice`` + ``cream``) and is always followed by a *bold* part-of-speech
    span ``(n)``.  Usage examples are introduced by a bullet glyph.
    """
    entries = []
    seen = set()
    for page_index in LIST_PAGES:
        spans = page_spans(doc[page_index])
        for side in ('L', 'R'):
            column = [s for s in spans if (s['x'] < COLUMN_SPLIT) == (side == 'L')]
            column.sort(key=lambda s: (s['y'], s['x']))
            current = None
            example = None
            for span in column:
                text = span['text']
                if span['size'] >= 14:                      # letter heading "A", "B", ...
                    continue
                if BULLET_HINT in span['font']:             # • starts a usage example
                    example = {'text': ''}
                    if current is not None:
                        current['examples'].append(example)
                    continue
                if is_entry_x(span['x']):                   # a new headword
                    current = {'raw': text.strip(), 'pos': '', 'examples': []}
                    entries.append(current)
                    example = None
                    continue
                if current is None:
                    continue
                pos_match = POS_SPAN.match(text)
                if pos_match and 'Bold' in span['font']:
                    if not current['pos']:
                        current['pos'] = pos_match.group(1).strip()
                    continue
                at_example_x = (span['x'] >= LEFT_EXAMPLE_X if side == 'L'
                                else span['x'] >= RIGHT_EXAMPLE_X)
                if example is None and not at_example_x:
                    current['raw'] += ' ' + text.strip()    # multi-span headword
                    continue
                if example is None:                        # example without a bullet
                    example = {'text': ''}
                    current['examples'].append(example)
                example['text'] += ' ' + text.strip()

    cleaned = []
    for entry in entries:
        raw = re.sub(r'\s+', ' ', entry['raw']).strip()
        pos = entry['pos']
        if not pos:                                        # "(n)" glued to the headword
            match = TRAILING_POS.match(raw)
            if match and _looks_like_pos(match.group(2)):
                raw, pos = match.group(1).strip(), match.group(2).strip()
        examples = []
        for item in entry['examples']:
            ex = re.sub(r'\s+', ' ', item['text']).strip()
            ex = re.sub(r'\s*\((adj|adv|n|v|prep|pron|det|conj|exclam|phr v)\)\s*$', '', ex)
            ex = ex.replace(u'\u2019', "'")
            if ex and ex not in examples:
                examples.append(ex)
        if not raw:
            continue
        key = (raw.lower(), pos.lower())
        if key in seen:                                    # the PDF repeats a few entries
            continue
        seen.add(key)
        cleaned.append({'raw': raw, 'pos': pos, 'examples': examples})
    return cleaned



# ---------------------------------------------------------------- topic lists

TOPIC_COLUMN_X = (120.0, 270.0, 400.0)   # topic grids print in 4 columns
TOPIC_TITLES = {'Appendix 1', 'Appendix 2', 'Appendix 3', 'Topic Lists', 'Word sets'}


def _join(existing, piece):
    """Join two pieces of text the way the PDF intended (no space before punctuation)."""
    if not existing:
        return piece
    if piece[:1] in '.,!?;:)]%\u2019\'' or existing[-1:] in '([\u2018':
        return existing + piece
    return existing + ' ' + piece


def _ordered(spans):
    """Order spans inside one grid cell: line by line (top to bottom), left to right."""
    lines = []
    for span in sorted(spans, key=lambda s: (s['y'], s['x'])):
        if lines and abs(lines[-1][0] - span['y']) <= 4.0:
            lines[-1][1].append(span)
        else:
            lines.append([span['y'], [span]])
    out = []
    for _y, line in lines:
        out.extend(sorted(line, key=lambda s: s['x']))
    return out


def parse_topic_lists(doc):
    """Return ``OrderedDict{topic: [item, ...]}`` from Appendix 3 (pages 20-28).

    Appendix 3 prints each topic as a bold heading followed by the words in a
    four-column grid, so the page has to be read row by row, not column by column.
    """
    topics = OrderedDict()
    current = None
    for page_index in TOPIC_PAGES:
        spans = [s for s in page_spans(doc[page_index]) if s['size'] < 14]
        rows = []
        for span in sorted(spans, key=lambda s: (s['y'], s['x'])):
            if rows and abs(rows[-1]['y'] - span['y']) <= 3.0:
                rows[-1]['spans'].append(span)
            else:
                rows.append({'y': span['y'], 'spans': [span]})
        for row in rows:
            cells = [[] for _ in range(4)]
            for span in row['spans']:
                for index in range(4):
                    low = 0.0 if index == 0 else TOPIC_COLUMN_X[index - 1]
                    high = TOPIC_COLUMN_X[index] if index < 3 else 10000.0
                    if low <= span['x'] < high:
                        cells[index].append(span)
                        break
            heading = cells[0]
            if len(heading) == 1 and 'Bold' in heading[0]['font']:
                name = re.sub(r'\s+', ' ', heading[0]['text']).strip()
                if name in TOPIC_TITLES:        # page titles are not vocabulary topics
                    continue
                current = name
                topics.setdefault(current, [])
                continue
            if current is None:
                continue
            for cell in cells:
                text = ''
                for span in _ordered(cell):
                    text = _join(text, span['text'].strip())
                text = re.sub(r'\s+', ' ', text).strip()
                text = re.sub(r'\s*\(([a-z &]{1,12})\)\s*$', '', text).strip(' ,')
                if not text or len(text) < 2 or re.match(r'^\(', text):
                    continue
                if text not in topics[current]:
                    topics[current].append(text)
    return topics


# ------------------------------------------------- Appendix 1: fixed word sets

# The PDF only says "one, two, three, etc." / "Monday, Tuesday, etc.", so the sets
# below are spelled out in full (the spelling and the range follow the PDF text).
_CARDINALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
              'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
              'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
              'seventy', 'eighty', 'ninety', 'hundred', 'thousand']
_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
             'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth',
             'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
             'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth',
             'twenty-sixth', 'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth',
             'thirty-first']
_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
           'September', 'October', 'November', 'December']

WORD_SETS = [
    ('Cardinal numbers', _CARDINALS, 'n'),
    ('Ordinal numbers', _ORDINALS, 'adj'),
    ('Days of the week', _DAYS, 'n'),
    ('Months of the year', _MONTHS, 'n'),
]


# ------------------------------------------------------------- normalisation

_PAREN_OPTIONAL = re.compile(r'\(([A-Za-z\[\]]*)\)')


def word_variants(raw):
    """All spellings a PDF entry stands for.

    ``blond(e)`` -> ``blonde``, ``(a)round`` -> ``around``, ``cafe/café`` -> both,
    ``pound (£)`` -> ``pound`` (a trailing note in brackets carries no word),
    ``a, an`` -> ``a`` + ``an``.
    """
    text = raw.replace(u'\u2019', "'").strip()
    text = re.sub(r'\s+\([^()]*\)\s*$', '', text)          # drop trailing notes
    text = _PAREN_OPTIONAL.sub(lambda m: m.group(1).replace('[', '').replace(']', ''), text)
    text = re.sub(r'\s*/\s*', '/', text).replace(', ', '/')
    return [v.strip(' .') if v.strip(' .') else v.strip() for v in text.split('/') if v.strip()]


def display_word(raw):
    return word_variants(raw)[0]


def word_key(raw):
    """Lower-cased key used for topic matching and for the browser's storage ids."""
    return display_word(raw).lower()


def slug(raw):
    return re.sub(r'[^a-z0-9]+', '-', word_key(raw)).strip('-') or 'word'


# The PDF shorthand cannot always be expanded mechanically -> a few手写 corrections.
DISPLAY_FIXES = {
    'kilogramme': 'kilogram',
    'alright': 'all right',
    'p.m.': 'p.m.',
}


# --------------------------------------------------- dictionary gloss + IPA

_HAN_RUN = re.compile(u'[\u3400-\u9fff\uf900-\ufaff]+')
_TAIL_NOISE = re.compile(u'(某人|某物|某事|某处|某个|sb|sth)+$')
_HEAD_NOISE = re.compile(r'\s*\d+\s*$')
CROSS_REF = re.compile(r"^(?:[A-Za-z.,' ]{0,24}?)=\s*([A-Za-z][A-Za-z'\- ]{1,40})\s*$")


def _raw_parts(raw):
    """``(head, ipa, ipaUS, body)`` — tolerant of entries that have no IPA field."""
    if '|' in raw:
        return split_entry(raw)
    head, _sep, rest = raw.partition(' ')
    return head, None, None, rest.strip()


def _norm_head(head):
    """``arm 1`` -> ``arm``, ``I1, i`` -> ``i``, ``OK 1`` -> ``ok``."""
    head = head.split(',')[0]
    head = _HEAD_NOISE.sub('', head)
    return head.strip().lower().rstrip('.')


def _lookup_exact(dic, word, depth=0):
    """Raw Oxford entry when the headword really is `word` (not just a prefix hit)."""
    raw = dic.lookup(word)
    if not raw:
        return None
    head, _bre, _ame, body = _raw_parts(raw)
    if not head:
        return None
    if _norm_head(head) != word.strip().lower().rstrip('.'):
        return None
    if depth == 0 and not glosses_from_body(body):
        # "pronoun = anybody" style entries simply point at another headword
        ref = CROSS_REF.match(body.strip())
        if ref:
            return _lookup_exact(dic, ref.group(1).strip(), depth + 1)
    return raw


def _ipa_of(dic, word):
    raw = _lookup_exact(dic, word)
    if not raw:
        return None
    _head, bre, _ame, _body = _raw_parts(raw)
    return bre


def phrase_gloss(dic, phrase):
    """Best effort gloss for a phrase / phrasal verb.

    Oxford keeps e.g. *look after* inside the entry of *look*; we search the body of
    the first word for the phrase and take the Chinese translation that follows it.
    Every result is listed in the build report so it can be reviewed by a human.
    """
    words = phrase.split()
    if len(words) < 2:
        return None
    raw = dic.lookup(words[0])
    if not raw:
        return None
    body = split_entry(raw)[3]
    low = body.lower()
    start = 0
    while True:
        idx = low.find(phrase.lower(), start)
        if idx < 0:
            return None
        start = idx + 1
        window = re.split(u'[\u25b8\u2022;]', body[idx + len(phrase): idx + len(phrase) + 90])[0]
        window = window.split('(')[0]
        runs = _HAN_RUN.findall(window)
        if not runs:
            continue
        gloss = _TAIL_NOISE.sub('', runs[0]).strip(u'\u2026 ')
        if gloss and gloss != u'\u2026':
            ipas = [_ipa_of(dic, w) for w in words]
            ipa = ' '.join(i for i in ipas if i) if all(ipas) else None
            return {'ipa': ipa, 'ipaUS': None, 'zh': gloss, 'raw': raw, 'src': 'phrase-search'}


def gloss_for(dic, entry):
    """Return ``(gloss_dict_or_None, source)`` for a parsed PDF entry."""
    candidates = word_variants(entry['raw'])
    for cand in candidates:
        raw = _lookup_exact(dic, cand)
        if raw:
            _head, bre, ame, body = _raw_parts(raw)
            glosses = glosses_from_body(body)
            if glosses:
                return ({'ipa': bre, 'ipaUS': ame, 'zh': u'；'.join(glosses),
                         'raw': raw}, 'exact')
    phrase = phrase_gloss(dic, display_word(entry['raw']))
    if phrase:
        return phrase, 'phrase-search'
    return None, 'missing'



def build():
    doc = fitz.open(PDF)
    print('reading %s' % os.path.relpath(PDF, ROOT))
    entries = parse_alphabetical_list(doc)
    topics = parse_topic_lists(doc)
    print('  %d headwords, %d topic lists' % (len(entries), len(topics)))

    # --- index the topic lists ----------------------------------------------
    topic_index = OrderedDict()
    for topic, items in topics.items():
        for item in items:
            key = word_key(item)
            topic_index.setdefault(key, [])
            if topic not in topic_index[key]:
                topic_index[key].append(topic)

    # --- words that only exist in the topic lists ---------------------------
    known = set(word_key(e['raw']) for e in entries)
    topic_only = OrderedDict()
    unmatched = []
    for topic, items in topics.items():
        for item in items:
            key = word_key(item)
            if key in known:
                continue
            if re.search(r'\d|\betc\b|\s-\s|,', item) or len(item.split()) > 4:
                unmatched.append((topic, item))
                continue
            if key not in topic_only:
                topic_only[key] = {'raw': item, 'pos': '', 'examples': [],
                                   'set': topic, 'fromTopic': True}
    entries.extend(topic_only.values())

    # --- Appendix 1 word sets ----------------------------------------------
    for set_name, set_words, pos in WORD_SETS:
        for word in set_words:
            entries.append({'raw': word, 'pos': pos, 'examples': [], 'set': set_name})

    # --- dictionary enrichment ---------------------------------------------
    dic = OxfordChineseDictionary()
    print('  dictionary: %s' % os.path.basename(dic.path))
    overrides = {}
    ov_path = os.path.join(DATA, 'zh_overrides.json')
    if os.path.exists(ov_path):
        with open(ov_path, encoding='utf-8') as handle:
            overrides = json.load(handle)
        print('  overrides: %d' % len(overrides))

    words = []
    report = {'missing': [], 'phrase': [], 'exact': 0, 'override': 0}
    for entry in entries:
        raw = entry['raw']
        key = word_key(raw)
        display = DISPLAY_FIXES.get(display_word(raw), display_word(raw))
        variants = word_variants(raw)
        alt = ' / '.join(variants[1:])
        gloss, source = gloss_for(dic, entry)
        if source == 'exact':
            report['exact'] += 1
        record = {'id': slug(raw), 'w': display, 'pos': entry['pos'],
                  'src': 'topic' if entry.get('fromTopic') else ('set' if entry.get('set') else 'list')}
        if alt:
            record['alt'] = alt
        if gloss:
            record['zh'] = gloss['zh']
            if gloss.get('ipa'):
                record['ipa'] = gloss['ipa']
            if gloss.get('ipaUS'):
                record['ipaUS'] = gloss['ipaUS']
        if source == 'phrase-search':
            report['phrase'].append((display, record.get('zh', '')))
        if entry.get('set'):
            record['t'] = [entry['set']]
        elif key in topic_index:
            record['t'] = topic_index[key]
        if entry['examples']:
            record['ex'] = entry['examples']

        patch = overrides.get(display) or overrides.get(key) or {}
        if patch:
            record.update({k: v for k, v in patch.items() if v})
            if patch.get('zh'):
                report['override'] += 1
        if not record.get('zh'):
            report['missing'].append((display, record['pos']))
        words.append(record)

    # --- merge duplicates (topic lists and A-Z list overlap) ----------------
    unique = OrderedDict()
    for record in words:
        existing = unique.get(record['id'])
        if existing is None:
            unique[record['id']] = record
            continue
        for field in ('zh', 'ipa', 'ipaUS', 'pos', 'alt'):
            if not existing.get(field) and record.get(field):
                existing[field] = record[field]
        for field in ('t', 'ex'):
            if record.get(field):
                merged = existing.setdefault(field, [])
                for value in record[field]:
                    if value not in merged:
                        merged.append(value)
    words = sorted(unique.values(), key=lambda r: (r['w'].lower(), r['id']))
    return words, topics, topic_index, unmatched, report, dic



def write_outputs(words, topics, unmatched, report, dictionary):
    import datetime
    meta = OrderedDict([
        ('title', 'KET 官方词汇表'),
        ('source', 'KET Vocabulary List (UCLES 2009) — data/ket-vocabulary-list.pdf'),
        ('glossary', '牛津英汉汉英词典 (macOS 内置词典)'),
        ('built', datetime.date.today().isoformat()),
        ('count', len(words)),
        ('topics', list(topics.keys())),
        ('wordSets', [name for name, _words, _pos in WORD_SETS]),
    ])
    payload = OrderedDict([('meta', meta), ('words', words)])
    text = json.dumps(payload, ensure_ascii=False, indent=1)

    with open(os.path.join(DATA, 'words.json'), 'w', encoding='utf-8') as handle:
        handle.write(text + '\n')
    with open(os.path.join(DATA, 'words.js'), 'w', encoding='utf-8') as handle:
        handle.write('/* generated by scripts/build_words.py - do not edit by hand */\n')
        handle.write('window.KET_WORDS = ')
        handle.write(text)
        handle.write(';\n')

    lines = ['KET word list build report',
             '=' * 60,
             'headwords with an exact dictionary gloss : %d' % report['exact'],
             'headwords patched from zh_overrides.json: %d' % report['override'],
             'glosses guessed by phrase search        : %d' % len(report['phrase']),
             'headwords still without a gloss        : %d' % len(report['missing']),
             'total words in data/words.json         : %d' % len(words),
             'dictionary used                        : %s' % dictionary.path,
             '',
             '-- REVIEW: multi-word entries -------------------------------']
    lines += ['   %-28s %s' % (w, g) for w, g in sorted(report['phrase'])]
    lines += ['', '-- MISSING: add these to data/zh_overrides.json -------------']
    lines += ['   %-28s %s' % (w, p) for w, p in sorted(report['missing'])]
    lines += ['', '-- topic list entries kept out of the word list ------------']
    lines += ['   %-34s %s' % (t, i) for t, i in sorted(unmatched)]
    lines += ['', '-- topic lists ---------------------------------------------']
    for topic, items in topics.items():
        lines.append('   %-52s %d' % (topic, len(items)))
    lines.append('')
    with open(os.path.join(DATA, 'build_report.txt'), 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines))
    print('\n'.join(lines[:11]))
    print('... full report: data/build_report.txt')


if __name__ == '__main__':
    _words, _topics, _index, _unmatched, _report, _dictionary = build()
    write_outputs(_words, _topics, _unmatched, _report, _dictionary)
