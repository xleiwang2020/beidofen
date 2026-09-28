#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline access to macOS' built-in dictionaries through the DictionaryServices C API.

Used at *build* time only (the generated word list is what the web app consumes).
The interesting dictionary here is `牛津英汉汉英词典` (Simplified Chinese - English,
bundle id ``com.apple.dictionary.zh_CN-en.OCD``) which gives us authoritative
Chinese glosses + BrE/AmE IPA for every English headword.

Nothing here needs a network connection and nothing is written to disk.
"""

import ctypes
import ctypes.util
import glob
import os
import re

# ---------------------------------------------------------------- CoreFoundation

_cf_path = ctypes.util.find_library('CoreFoundation') or \
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation'
_cf = ctypes.CDLL(_cf_path)

_cf.CFStringCreateWithCString.restype = ctypes.c_void_p
_cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
_cf.CFStringGetLength.restype = ctypes.c_long
_cf.CFStringGetLength.argtypes = [ctypes.c_void_p]
_cf.CFStringGetCString.restype = ctypes.c_bool
_cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
_cf.CFURLCreateWithFileSystemPath.restype = ctypes.c_void_p
_cf.CFURLCreateWithFileSystemPath.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long, ctypes.c_bool]
_cf.CFArrayGetCount.restype = ctypes.c_long
_cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
_cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
_cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]

_CF_URL_POSIX = 0          # kCFURLPOSIXPathStyle
_UTF8 = 0x08000100         # kCFStringEncodingUTF8


def _mkcf(text):
    return _cf.CFStringCreateWithCString(None, text.encode('utf-8'), _UTF8)


def _cfstr(ref):
    if not ref:
        return None
    n = _cf.CFStringGetLength(ctypes.c_void_p(ref))
    buf = ctypes.create_string_buffer(n * 4 + 8)
    if not _cf.CFStringGetCString(ctypes.c_void_p(ref), buf, len(buf), _UTF8):
        return None
    return buf.value.decode('utf-8', 'replace')


# ------------------------------------------------------------ DictionaryServices


class CFRange(ctypes.Structure):
    _fields_ = [('location', ctypes.c_long), ('length', ctypes.c_long)]


def _load_dictionary_services():
    names = [
        '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/'
        'DictionaryServices.framework/Versions/A/DictionaryServices',
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/'
        'DictionaryServices.framework/DictionaryServices',
    ]
    last = None
    for name in names:
        try:
            return ctypes.CDLL(name, mode=ctypes.RTLD_GLOBAL)
        except OSError as exc:      # pragma: no cover - platform dependent
            last = exc
    raise OSError('cannot load DictionaryServices: %s' % last)


_ds = _load_dictionary_services()
_ds.DCSCopyTextDefinition.restype = ctypes.c_void_p
_ds.DCSCopyTextDefinition.argtypes = [ctypes.c_void_p, ctypes.c_void_p, CFRange]
_ds.DCSDictionaryCreate.restype = ctypes.c_void_p
_ds.DCSDictionaryCreate.argtypes = [ctypes.c_void_p]
_ds.DCSGetActiveDictionaries.restype = ctypes.c_void_p
_ds.DCSDictionaryGetIdentifier.restype = ctypes.c_void_p
_ds.DCSDictionaryGetIdentifier.argtypes = [ctypes.c_void_p]
_ds.DCSDictionaryGetName.restype = ctypes.c_void_p
_ds.DCSDictionaryGetName.argtypes = [ctypes.c_void_p]

# Where macOS keeps dictionaries that are shipped as downloadable assets.
_ASSET_GLOBS = [
    '/System/Library/AssetsV2/'
    'com_apple_MobileAsset_DictionaryServices_dictionary3macOS/*/AssetData/*.dictionary',
    '/System/Library/AssetsV2/'
    'com_apple_MobileAsset_DictionaryServices_dictionaryOSX/*/AssetData/*.dictionary',
    '/Library/Dictionaries/*.dictionary',
    '/System/Library/Dictionaries/*.dictionary',
]

ZH_EN_HINTS = ('chinese - english', 'chinese-english', '英汉', 'zh_cn-en', 'chinese english')


def find_chinese_english_dictionary():
    """Path of an installed English<->Chinese dictionary bundle, or None."""
    candidates = []
    for pattern in _ASSET_GLOBS:
        candidates.extend(sorted(glob.glob(pattern)))
    for path in candidates:
        name = os.path.basename(path).lower()
        if any(h in name for h in ZH_EN_HINTS):
            return path
    return None



class OxfordChineseDictionary(object):
    """Turns ``DCSCopyTextDefinition`` into plain-text lookups (with caching)."""

    def __init__(self, path=None):
        self.path = path or find_chinese_english_dictionary()
        if not self.path:
            raise RuntimeError('no English<->Chinese dictionary installed')
        url = _cf.CFURLCreateWithFileSystemPath(None, _mkcf(self.path), _CF_URL_POSIX, True)
        self.ref = _ds.DCSDictionaryCreate(ctypes.c_void_p(url))
        if not self.ref:
            raise RuntimeError('cannot open dictionary: %s' % self.path)
        self.cache = {}

    def lookup(self, word):
        """Raw definition text for `word`, or None when it is not in the dictionary."""
        key = (word or '').strip()
        if not key:
            return None
        if key in self.cache:
            return self.cache[key]
        s = _mkcf(key)
        res = _ds.DCSCopyTextDefinition(ctypes.c_void_p(self.ref), ctypes.c_void_p(s),
                                        CFRange(0, _cf.CFStringGetLength(ctypes.c_void_p(s))))
        text = _cfstr(res) if res else None
        self.cache[key] = text
        return text


# ------------------------------------------------------------------- text helpers

_HAN_RUN = re.compile(u'[\u3400-\u9fff\uf900-\ufaff]+')
_IPA_BRE = re.compile(r'BrE\s+(.+?)(?:,\s*AmE|\||$)', re.S)
_IPA_AME = re.compile(r'AmE\s+(.+?)(?:\||$)', re.S)


def split_entry(text):
    """Split a raw definition into ``(headword, ipa_brE, ipa_amE, body)``."""
    if not text:
        return None, None, None, None
    parts = text.split('|')
    head = parts[0].strip()
    ipa_bre = ipa_ame = None
    if len(parts) >= 2:
        m = _IPA_BRE.search(parts[1])
        if m:
            ipa_bre = m.group(1).strip()
        m = _IPA_AME.search(parts[1])
        if m:
            ipa_ame = m.group(1).strip()
    body = '|'.join(parts[2:]).strip() if len(parts) >= 3 else ''
    return head, ipa_bre, ipa_ame, body




def glosses_from_body(body, max_senses=2, max_chars=12):
    """Turn an Oxford definition body into short Chinese glosses.

    ``noun (fruit) 苹果 pínguǒ; (tree) 苹果树 pínguǒ shù  ▸ the apple of sb's eye …``
    becomes ``['苹果', '苹果树']`` -- usage examples (everything after ``▸``) and the
    pinyin are dropped so the gloss stays readable for a 10 year old.
    """
    if not body:
        return []
    body = body.split(u'\u25b8')[0]
    body = re.sub(r'\[[^\]]*\]', ' ', body)
    out = []
    for chunk in re.split(u'[\u2460-\u2473]', body):      # circled numbers ①..⑳
        chunk = chunk.replace(u'\u2026', u'').replace(u'\u22ef', u'')
        for run in _HAN_RUN.findall(chunk):
            if run not in out:
                out.append(run)
            if len(out) >= max_senses:
                break
        if len(out) >= max_senses:
            break
    return [g[:max_chars] for g in out[:max_senses]]


def chinese_gloss(dic, word, max_senses=3):
    """Look `word` up; return ``{'ipa', 'ipaUS', 'zh', 'raw'}`` or None."""
    raw = dic.lookup(word)
    if not raw:
        return None
    _head, bre, ame, body = split_entry(raw)
    glosses = glosses_from_body(body, max_senses=max_senses)
    if not glosses:
        return None
    return {'ipa': bre, 'ipaUS': ame, 'zh': u'；'.join(glosses), 'raw': raw}


if __name__ == '__main__':                               # tiny CLI for smoke tests
    import sys
    _d = OxfordChineseDictionary()
    print('dictionary:', _d.path, '\n')
    for _w in (sys.argv[1:] or ['apple', 'angry', 'borrow', 'tummy', 'lorry', 'look after']):
        _g = chinese_gloss(_d, _w)
        if not _g:
            print('%-14s -> NOT FOUND' % _w)
            continue
        print('%-14s /%s/  %s' % (_w, _g['ipa'], _g['zh']))
