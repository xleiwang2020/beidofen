#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 data/words.json 的例句字段（sent / sentSrc）是否合格。

用途：scripts/build_words.py 重建词库会把 sent / sentSrc 丢掉，
      重跑 scripts/build_examples.py 之后用它做一次体检；也可放进提交前检查。

检查项：
  1. 每个词都有 sent，且 sentSrc 是 ket / ketp / dict / tpl 之一；
  2. sent 里必须出现单词原形（小写、独立成词），否则挖空长度对不上；
  3. sent 句首字母大写、句尾有 . ! ?（App 直接展示，不额外加工）；
  4. 提示「原形出现 2 次以上」的句子（挖空时要把所有位置都挖掉，别只挖一处）。

用法：
    python3 scripts/check_sentences.py        # 有问题时退出码 1
"""

import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = ('ket', 'ketp', 'dict', 'tpl')


def base_pattern(word):
    """和 build_examples.py 的 contains_base 保持一致（好在这里可读性优先）。"""
    return (r'(?<![a-z])' + re.escape(word.lower()).replace(r'\ ', r'\s+')
            + r'(?![a-z])')


def main():
    path = os.path.join(ROOT, 'data', 'words.json')
    with open(path, encoding='utf-8') as handle:
        words = json.load(handle)['words']

    problems = []
    for word in words:
        text = word.get('sent') or ''
        src = word.get('sentSrc')
        if not text:
            problems.append((word['word'], '缺 sent'))
            continue
        if src not in SOURCES:
            problems.append((word['word'], 'sentSrc 非法：%r' % src))
        if not re.search(base_pattern(word['word']), text.lower()):
            problems.append((word['word'], '例句里没有单词原形：%s' % text))
        if text[-1] not in '.!?':
            problems.append((word['word'], '句尾没有标点：%s' % text))
        first = next((c for c in text if c.isalpha()), '')
        if first.islower():
            problems.append((word['word'], '句首没大写：%s' % text))

    multi = [word['word'] for word in words
             if len(re.findall(base_pattern(word['word']), word['sent'].lower())) > 1]

    stats = collections.Counter(word.get('sentSrc') for word in words)
    print('例句体检：%d 个词' % len(words))
    for src in SOURCES:
        print('   %-5s %4d' % (src, stats[src]))
    if multi:
        print('提醒：这些词的例句里原形出现 2 次以上，挖空要把每处都挖掉：%s' % ', '.join(multi))
    if problems:
        print('\n!! 有 %d 处问题：' % len(problems))
        for word, why in problems[:30]:
            print('   %-20s %s' % (word, why))
        return 1
    print('全部通过 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
