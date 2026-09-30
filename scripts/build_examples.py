#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给词库里的每个单词补一条「例句」，并把要拼写的单词挖空备用。

背景：听音拼写 / 看释义猜词环节希望孩子看到的不是孤零零一个词，而是一句话，
      句中那个要拼的单词被挖成空格（填空）。所以每个单词都必须有一条例句，
      且例句里必须出现这个单词本身（原形），否则挖空对不上。

例句四级来源（质量从高到低，逐级兜底，保证 100% 覆盖）：

  1. ket   — KET 官方词汇表 PDF 自带的**完整句**（data/words.json 的 ex 字段）。
             最贴合 10 岁孩子的水平，优先使用。
  2. dict  — macOS 内置牛津词典里 ▸ / • 引导的例句（真实语料）。
             词典体例是「英文例句 + 中文释义 + 拼音」，这里只取英文部分，
             并严格过滤 sb / sth 占位符、uncountable / plural 等词条标签、
             被截断的残句、对话体破折号，只留下干净的句子或短语。
  3. ketp  — 官方 ex 字段里「不是句子」但够用的搭配短语（"An appointment with the
             doctor"、"Pop music"）：只有词典例句读起来费劲时才用，比模板句有信息量。
  4. tpl   — 按词性 / 中文释义套用的模板句（SPECIAL 里为常见虚词手写的句子优先）。
             保证语法通顺、句子简单，用来兜底没有可用例句的词。

用法（离线，不联网，只用 macOS 自带词典）：

    python3 scripts/build_examples.py             # 写入 data/words.json + data/words.js
    python3 scripts/build_examples.py --dry-run   # 只打印统计与抽样，不改文件
    python3 scripts/build_examples.py --dry-run --only tpl --sample 200

写入的字段：
    sent    : 含目标词原形的英文例句（App 负责挖空）
    sentSrc : 'ket'（KET 官方完整句）| 'dict'（牛津词典）| 'ketp'（KET 官方搭配短语）| 'tpl'（模板句）
              方便日后抽查与统计

给 App 的约定：挖空时请把句中**所有**原形出现的位置都挖掉（例如 "As soon as
possible"），否则剩下那处会把答案送出去；小写比较即可，词长与 sent 里一致。

注意：scripts/build_words.py 重建词库后会丢掉这两个字段，重跑本脚本即可补回。
"""

import argparse
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'data')
sys.path.insert(0, HERE)

import apple_dict as ad  # noqa: E402  （同目录脚本，构建期工具）

HAN = re.compile(u'[\u3400-\u9fff\uf900-\ufaff]')          # 汉字
PAREN = re.compile(r'\([^)]*\)|\[[^\]]*\]')
ANGLE = re.compile(u'[\u2039\u203a\u00ab\u00bb]')          # ‹ › « »
CIRCLED = re.compile(u'[\u2460-\u2473\u24ea\u2776-\u277f]')  # ① ⑪ ⑩ …
ELLIPSIS = re.compile(u'[\u2026\u22ef]')
DASH = re.compile(u'[\u2013\u2014]')                        # 词典对话体的破折号
BLANK_META = re.compile(r'\b(?:sb|sth|sbs)\b')             # 词典占位符

# 词典词条体例里的标签词：出现即说明这段是「解释」而不是「例句」
LABELS = (
    'uncountable', 'countable', 'plural', 'singular', 'figurative', 'literal',
    'proverb', 'idiom', 'informal', 'formal', 'humorous', 'literary', 'dated',
    'slang', 'abbreviation', 'transitive', 'intransitive', 'phrasal',
    'adjective', 'adverb', 'preposition', 'pronoun', 'conjunction',
    'determiner', 'exclamation', 'interjection', 'auxiliary', 'modal',
    'attributive', 'predicative', 'noun', 'verb', 'mainly', 'british',
    'american', 'sport', 'cricket', 'baseball', 'mathematics', 'computing',
    'law', 'medicine', 'anatomy', 'euphemistic', 'offensive', 'vulgar',
    'no object', 'with object', 'as adjective', 'as adverb', 'in the plural',
    'usually', 'especially', 'e.g.', 'etc.', 'compare', 'see also',
)

# 词典里被截断的句子常常「以虚词收尾」（"... an article of faith that"、"... the latest
# news is"），这种残句既不能当例句，也不能用来挖空，一律丢掉。
TAIL_STOP = frozenset(
    'to and of the a an for with at in on by from or as that if over into than '
    'about but because while when where which who whose'.split())

# 以助动词收尾：只有「代词 + 助动词」才算完整（"... as he was"），
# 「名词 + 助动词」基本是被截断的（"The latest news is"）。
AUX_TAIL = frozenset(
    'is are was were be been being has have had will would can could shall should '
    'may might must do does did'.split())
PRONOUNS = frozenset('i he she it you we they there this that'.split())


def tail_ok(text):
    """结尾不是虚词，也不是被截断的助动词（截断残句的特征）。"""
    tokens = text.lower().split()
    if not tokens:
        return False
    last = tokens[-1].strip('.,!?;:"').strip("'")
    if not last:
        return False
    if last in AUX_TAIL:
        prev = tokens[-2].strip('.,!?;:"').strip("'") if len(tokens) > 1 else ''
        return prev in PRONOUNS or prev == 'to'   # "... as he was" / "... things to do"
    return last not in TAIL_STOP


# --------------------------------------------------------------- 词典例句抽取

def english_prefix(segment):
    """取一段词典文本里的英文部分（中文释义与拼音之前的部分）。"""
    text = HAN.split(segment)[0]
    text = ANGLE.sub(' ', text)
    text = CIRCLED.sub(' ', text)
    text = ELLIPSIS.sub(' ', text)
    text = text.replace(u'\u2018', "'").replace(u'\u2019', "'")
    text = re.sub(r'\s+', ' ', text)
    return text.strip(' ;,.').strip()


def is_clean(text, word):
    """判断英文片段能不能当例句：必须干净、完整、且含目标词原形。"""
    if not text:
        return False
    low = text.lower()
    if BLANK_META.search(low):
        return False
    for label in LABELS:
        if label in low:
            return False
    if '(' in text or ')' in text:                   # 词典体例里的补充说明
        return False
    if '/' in text or '=' in text or ';' in text:
        return False
    if low.startswith('to '):                        # 词典的「不定式」体例，不是句子
        return False
    if 8 > len(text) or len(text) > 68:
        return False
    if text[0] in '-' or text[-1] in '-,':
        return False
    if re.search(r'\d$', text):                      # 结尾被数字截断（... 2,000）
        return False
    if not re.search(r'[a-z]', text):
        return False
    if len(text.split()) < 2:
        return False
    if not has_verb(text):                           # 名词短语碎片不当例句
        return False
    return contains_word(text, word)


def contains_word(text, word):
    """目标词（含 -s/-es/-ed/-ing 等常见变形）是否出现在句子里。"""
    base = re.escape(word.lower()).replace(r'\ ', r'\s+').replace(r'\-', r'[-\s]?')
    return re.search(r'(?<![a-z])' + base + r'(?![a-z])', text.lower()) is not None


def contains_base(text, word):
    """严格版：必须出现单词原形（保证挖空位置与要拼写的字母完全一致）。"""
    base = re.escape(word.lower()).replace(r'\ ', r'\s+').replace(r'\-', r'[-\s]?')
    return re.search(r'(?<![a-z])' + base + r'(?![a-z])', text.lower()) is not None


def count_base(text, word):
    """原形出现几次：出现 2 次以上的句子挖空后等于送答案，排序时要降权。"""
    base = re.escape(word.lower()).replace(r'\ ', r'\s+').replace(r'\-', r'[-\s]?')
    return len(re.findall(r'(?<![a-z])' + base + r'(?![a-z])', text.lower()))


SENTENCE_STARTERS = (
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'there', 'this', 'that',
    'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'the', 'a',
    'an', 'do', "don't", 'does', 'did', 'can', 'could', 'would', 'will',
    'shall', 'should', 'must', 'may', 'might', 'let', 'please', 'come', 'go',
    'look', 'listen', 'put', 'take', 'give', 'make', 'thank', 'sorry', 'what',
    'how', 'who', 'where', 'when', 'why', 'which', 'is', 'are', 'was', 'were',
    'have', 'has', 'had', 'one', 'some', 'all', 'every', 'no', 'not',
)


def looks_like_sentence(text):
    first = text.split()[0].lower().strip('",')
    return first in SENTENCE_STARTERS or text[-1] in '.!?'


def score(text):
    """例句打分：短、完整、像句子的优先。"""
    tokens = text.split()
    n = len(tokens)
    s = 0.0
    if text[-1] in '.!?':
        s += 3
    if 4 <= n <= 9:
        s += 3
    elif n <= 12:
        s += 1
    if looks_like_sentence(text):
        s += 1.5
    if len(text) <= 48:
        s += 1.5
    if re.search(r'\d', text):
        s -= 1
    if text[0].isupper():
        s += .5
    s -= len(text) * 0.04
    return s


def capitalize(text):
    """句首字母大写（词典例句统一小写），顺便把单独的 i 变成 I。"""
    text = re.sub(r'\bi\b', 'I', text)
    for i, char in enumerate(text):
        if char.isalpha():
            if char.islower():
                text = text[:i] + char.upper() + text[i + 1:]
            break
    return text


# 判断「这段英文是句子而不是名词短语」用的小词表：只要句中出现下列动词/助动词任一，
# 就认为它像句子（词典里的名词短语碎片，如 "A kitchen cupboard"、"The alimentary canal"，
# 会被挡掉，改由模板句兜底）。
VERBS = frozenset("""
be am is are was were been being have has had do does did done can could will would
shall should may might must go goes going went gone get gets getting got give gives
giving gave given take takes taking took taken make makes making made come comes
coming came see sees seeing saw seen look looks looking looked know knows knowing
knew known think thinks thinking thought want wants wanting wanted say says saying
said tell tells telling told put puts putting keep keeps keeping kept let lets
begin begins beginning began begun seem seems seeming seemed help helps helping
helped talk talks talking talked speak speaks speaking spoke spoken like likes liking
liked love loves loving loved need needs needing needed work works working worked
play plays playing played live lives living lived eat eats eating ate eaten drink
drinks drinking drank drunk sleep sleeps sleeping slept read reads reading write
writes writing wrote written buy buys buying bought sell sells selling sold bring
brings bringing brought find finds finding found lose loses losing lost leave
leaves leaving left meet meets meeting met run runs running ran walk walks walking
walked drive drives driving drove driven ride rides riding rode ridden fly flies
flying flew flown swim swims swimming swam swum sing sings singing sang sung open
opens opening opened close closes closing closed start starts starting started
stop stops stopping stopped finish finishes finishing finished wait waits waiting
waited ask asks asking asked answer answers answering answered call calls calling
called send sends sending sent show shows showing showed shown watch watches
watching watched listen listens listening listened hear hears hearing heard feel
feels feeling felt wear wears wearing wore worn wash washes washing washed clean
cleans cleaning cleaned cook cooks cooking cooked pay pays paying paid cost costs
costing spend spends spending spent arrive arrives arriving arrived hope hopes
hoping hoped wish wishes wishing wished try tries trying tried use uses using used
learn learns learning learnt learned teach teaches teaching taught study studies
studying studied remember remembers remembering remembered forget forgets
forgetting forgot forgotten understand understands understanding understood mean
means meaning meant believe believes believing believed choose chooses choosing
chose chosen decide decides deciding decided enjoy enjoys enjoying enjoyed hate
hates hating hated prefer prefers preferring preferred carry carries carrying
carried hold holds holding held catch catches catching caught throw throws
throwing threw thrown jump jumps jumping jumped climb climbs climbing climbed sit
sits sitting sat stand stands standing stood stay stays staying stayed visit visits
visiting visited travel travels travelling travelled rain rains raining rained
snow snows snowing snowed blow blows blowing blew blown shine shines shining shone
fall falls falling fell fallen break breaks breaking broke broken hurt hurts
hurting build builds building built draw draws drawing drew drawn paint paints
painting painted dance dances dancing danced laugh laughs laughing laughed cry
cries crying cried smile smiles smiling smiled shout shouts shouting shouted turn
turns turning turned move moves moving moved pick picks picking picked ring rings
ringing rang rung worry worries worrying worried hurry hurries hurrying hurried
print prints printing printed ride order orders ordering ordered spell spells
spelling spelled dressed dress dresses brush brushes camp camps camping camped
surf surfs surfing surfed skate skates skating skated fish fishes fishing fished
cook go shopping chat chats chatting chatted email emails emailing emailed text
texts texting texted phone phones phoning phoned click clicks clicking clicked
save saves saving saved check checks checking checked find fit fits fitting fitted
rest rests resting rested lie lies lying lay lain hope phone practise practises
practising practised revise revises revising revised copy copies copying copied
tidy tidies tidying tidied water waters watering watered milk nurse nurses nursing
nursed show. don't didn't doesn't can't couldn't won't wouldn't isn't aren't
wasn't weren't haven't hasn't hadn't let's there's that's it's i'm you're we're
they're he's she's what's
""".split())


def has_verb(text):
    for token in re.findall(r"[a-z']+", text.lower()):
        if token in VERBS:
            return True
    return False


def dict_examples(dic, word):
    """从牛津词典词条里挑出可用的英文例句，按分数排序返回。"""
    raw = dic.lookup(word)
    if not raw:
        return []
    _head, _bre, _ame, body = ad.split_entry(raw)
    if not body:
        return []
    found = []
    for segment in re.split(u'[\u25b8\u2022]', body):
        text = english_prefix(segment)
        if not is_clean(text, word):
            continue
        if DASH.search(text):                 # 「May I borrow your pen? — certainly」这类对话体
            continue
        if re.search(r'\b(?:US|UK)\b', text):  # 词条里的国别标签（"A pay station US"）
            continue
        if not contains_base(text, word):     # 只用原形，保证挖空长度与答案一致
            continue
        if not tail_ok(text):
            continue
        text = capitalize(tidy(text))
        if text not in found:
            found.append(text)
    # 先排「像句子的」（主语开头或句尾带标点），再排原形只出现一次的，最后按 score
    found.sort(key=lambda t: (looks_like_sentence(t), count_base(t, word) == 1, score(t)),
               reverse=True)
    return found


# --------------------------------------------------------------- 模板句（兜底）

# 需要手写句子的词：虚词、多词短语、拼写敏感词（套模板会出笑话，比如 "Please die now."）。
# 句子里用 {w} 表示要拼写的单词本身。
SPECIAL = {
    # --- 冠词 / 连词 / 限定词 / 代词 ---
    'a': 'I have {w} new pen.',
    'or': 'Do you want tea {w} coffee?',
    'these': '{w} books are mine.',
    'he': '{w} plays football every day.',
    'she': '{w} is my best friend.',
    'i': '{w} like ice cream.',
    'it': '{w} is very cold today.',
    'me': 'Can you help {w}, please?',
    'us': 'The teacher gave {w} some homework.',
    'you': '{w} are in my class.',
    'who': '{w} is your English teacher?',
    'anyone': '{w} can join the game.',
    'everyone': '{w} in my class likes music.',
    'someone': '{w} is waiting for you at the gate.',
    'no one': '{w} was at home yesterday.',
    # --- 感叹词 ---
    'cheers!': "Everyone shouted '{w}' at the party.",
    'congratulations!': "We said '{w}' to the winner.",
    'hallo': "She said '{w}' with a big smile.",
    # --- 副词 / 介词 / 介词短语 ---
    'a.m': 'The bus leaves at nine {w}.',
    'p.m': 'We have dinner at seven {w}.',
    'as well': 'I like football and I like tennis {w}.',
    'of course': '{w} you can come with us.',
    'straight on': 'Go {w} and then turn left.',
    'suddenly': 'It {w} started to rain.',
    'down': 'Look {w} at the flowers in the garden.',
    'in': 'Come {w} and sit down, please.',
    'at': 'We meet {w} the bus stop every morning.',
    'till': 'We played outside {w} dinner time.',
    'next to': 'The bank is {w} the school.',
    'close to': 'My house is {w} the park.',
    'in front of': 'The car stopped {w} our house.',
    'instead of': 'I had tea {w} coffee.',
    'as well as': 'She plays tennis {w} football.',
    'by post': 'I sent the birthday card {w}.',
    'for sale': 'That old house is {w}.',
    'listen to': 'I {w} music every evening.',
    'piece of cake': 'This game is a {w} for me.',
    'bit of cake': 'I ate a {w} after lunch.',
    'working hours': "My dad's {w} are nine to five.",
    # --- 动词（套模板会出笑话或语法错） ---
    'act': 'The children {w} in the school play.',
    'arrive': 'We {w} at school before eight.',
    'change': 'You must {w} your wet clothes.',
    'could': '{w} you open the window, please?',
    'describe': 'Can you {w} your best friend?',
    'die': 'Plants {w} without water.',
    'explain': 'Please {w} this word to me.',
    'get fit': 'I want to {w} for the race.',
    'have got': 'I {w} a new bike.',
    'have to': 'We {w} be quiet in the library.',
    'make': "Let's {w} a birthday cake.",
    'rent': 'They {w} a small flat in the city.',
    'run': 'I can {w} very fast.',
    'send': 'Please {w} me a postcard.',
    'tidy up': 'Please {w} your bedroom.',
    'take off': 'Please {w} your shoes at the door.',
    'try on': 'Can I {w} this jacket?',
    'wash up': 'I {w} after dinner every evening.',
    'write down': '{w} the new words in your notebook.',
    # --- 形容词（中文释义 / 感情色彩特殊，模板句不合适） ---
    'advanced': 'This is an {w} book for young readers.',
    'amazing': 'The magic show was {w}!',
    'bored': 'The children were {w} on the long trip.',
    'boring': 'That film was really {w}.',
    'closed': 'The shop is {w} on Sundays.',
    'cloudy': 'It is very {w} today.',
    'excited': 'We are {w} about the school trip.',
    'exciting': 'The football match was very {w}.',
    'famous': 'She is a {w} singer.',
    'fried': 'We had {w} chicken for lunch.',
    'indoor': 'We play {w} games when it rains.',
    'interested': 'I am {w} in space.',
    'interesting': 'This book is very {w}.',
    'international': 'It is an {w} school.',
    'long': 'The river is very {w}.',
    'more': 'I need {w} time to finish my homework.',
    'most': 'I like {w} of the songs in the show.',
    'orange': 'I have an {w} bag.',
    'outdoor': 'We play {w} games in summer.',
    'sad': 'She was very {w} yesterday.',
    'thirsty': 'I am very {w} after the game.',
    'windy': 'It is very {w} on the beach.',
    # --- 人（"I can see the dad in the picture" 太怪，手写更自然） ---
    'dad': 'My {w} works in a big shop.',
    'daddy': 'My {w} reads me a story every night.',
    'mum': 'My {w} makes great cakes.',
    'mummy': 'My {w} puts me to bed at eight.',
    'granddad': 'My {w} tells funny stories.',
    'grandpa': 'My {w} lives in the country.',
    'grandma': 'My {w} makes the best soup.',
    'grandfather': 'My {w} was a teacher.',
    'grandmother': 'My {w} grows flowers in the garden.',
    'grandparent': 'My {w} came to my school show.',
    'grandchild': 'She has one {w} and two cats.',
    'granddaughter': 'Their {w} is in my class.',
    'grandson': 'My {w} plays basketball with me.',
    'cousin': 'My {w} lives in London.',
    'parent': 'Every {w} came to the school meeting.',
    'classmate': 'My {w} helps me with maths.',
    'class member': 'Every {w} got a new book.',
    'colleague': 'My mum went to lunch with a {w}.',
    'passenger': 'The {w} waited for the bus.',
    'cleaner': 'The {w} comes to our school every day.',
    'dancer': 'She is a very good {w}.',
    'farmer': 'The {w} works on a big farm.',
    'footballer': 'He wants to be a famous {w}.',
    'writer': 'The {w} wrote a book about animals.',
    'shopper': 'The {w} bought a lot of food.',
    'photographer': 'The {w} took our class photo.',
    'secretary': 'The {w} answers the phone in the office.',
    'shop assistant': 'The {w} helped me find a jacket.',
    'waiter': 'The {w} brought us the menu.',
    'waitress': 'The {w} brought us some water.',
    'tour guide': 'The {w} showed us the old city.',
}

# 第二轮：把模板句逐个抽查后，发现「通用模板读起来别扭」的词手写一遍。
# key 一律小写；{w} 会被替换成单词本身（原形，保证挖空长度对得上）。
SPECIAL_MORE = {
    # --- 动词（"Let's buy in the playground." 这类读着别扭，都带个宾语/补语） ---
    'add': 'Please add some milk to my tea.',
    'borrow': 'Can I borrow your ruler?',
    'burn': 'Be careful not to burn your hand.',
    'buy': 'I want to buy a new bike.',
    'cycle': 'I cycle to school every day.',
    'eat': 'I eat an apple every day.',
    'explore': 'We love to explore the forest.',
    'fry': 'My mum is going to fry some eggs.',
    'grill': 'We grill fish in the garden.',
    'grow up': 'I want to be a pilot when I grow up.',
    'hit': "Don't hit the ball too hard.",
    'phone': 'Please phone me after dinner.',
    'roast': 'We roast potatoes in the oven.',
    'shampoo': 'Wash your hair with shampoo.',
    'skate': 'I can skate on the ice.',
    'ski': 'We ski in the mountains every winter.',
    'smoke': 'Please do not smoke in the hospital.',
    'swim': 'I can swim very well.',
    'teach': 'I can teach you this game.',
    # --- 形容词 ---
    'adult': 'She is an adult now.',
    'blonde': 'She has blonde hair.',
    'brown': 'My dog has brown eyes.',
    'busy': 'My dad is busy today.',
    'classical': 'My sister likes classical music.',
    'crowded': 'The bus was very crowded.',
    'daily': 'She reads a book daily.',
    'dangerous': 'It is dangerous to play near the road.',
    'expensive': 'This watch is very expensive.',
    'foggy': 'It was foggy this morning.',
    'foreign': 'She can speak two foreign languages.',
    'friendly': 'Our new teacher is very friendly.',
    'grey': 'The sky is grey today.',
    'grilled': 'We had grilled fish for dinner.',
    'impossible': 'It is impossible to finish this today.',
    'married': 'My aunt is married.',
    'modern': 'This is a modern school.',
    'national': 'Today is a national holiday.',
    'pink': 'She has a pink bag.',
    'pleasant': 'We had a pleasant day at the beach.',
    'silver': 'She has a silver ring.',
    'sunny': 'It is sunny today.',
    'tired': 'I am tired after the game.',
    'total': 'The total is twenty pounds.',
    'weekly': 'We have a weekly test on Friday.',
    'wonderful': 'We had a wonderful day.',
    # --- 副词 / 代词 ---
    'ago': 'We moved to this city two years ago.',
    'anyone': 'Anyone can join our club.',
    'down': 'The cat ran down the tree.',
    'indoors': 'We play indoors when it rains.',
    'outdoors': 'The children played outdoors all afternoon.',
    'of course': 'Of course you can come with us.',
    'him': 'I gave the book to him.',
    'our': 'Our school is very big.',
    'us': 'The teacher gave us some homework.',
    # --- 人 ---
    'father': 'My father works in a bank.',
    'mother': 'My mother is a teacher.',
    'sister': 'My sister plays the piano.',
    'brother': 'My brother is ten years old.',
    'uncle': 'My uncle lives in Canada.',
    'aunt': 'My aunt has a small shop.',
    'man': 'The man in the blue hat is my teacher.',
    'wife': 'My uncle and his wife live in Japan.',
    'husband': 'Her husband works in a hospital.',
    'daughter': 'Their daughter is in my class.',
    'engineer': 'My uncle is an engineer.',
    'dentist': 'The dentist looked at my teeth.',
    'mechanic': 'The mechanic fixed our car.',
    'pilot': 'My cousin is a pilot.',
    'journalist': 'The journalist asked us some questions.',
    'receptionist': 'The receptionist gave us the room key.',
    'travel agent': 'The travel agent booked our tickets.',
    'pupil': 'The teacher asked a pupil to read.',
    'queen': 'The queen lives in a big palace.',
    'police': 'The police helped us find the way.',
    'police officer': 'The police officer stopped the car.',
    'visitor': 'We had a visitor from Japan.',
    'chemist': 'I buy my medicine at the chemist.',
    'miss': 'Our teacher is Miss Green.',
    'mr': 'Mr Brown is my English teacher.',
    'mrs': 'Mrs Brown lives next door.',
    'ms': 'Ms Lee is our new teacher.',
    # --- 地点 ---
    'entrance': "Let's meet at the entrance.",
    'living room': 'We watch TV in the living room.',
    'dining room': 'We have dinner in the dining room.',
    'sitting room': 'My grandma reads in the sitting room.',
    'road': 'Look both ways before you cross the road.',
    'street': 'I live in a quiet street.',
    'motorway': 'The motorway was very busy today.',
    'railway': 'The railway line goes through our town.',
    'underground': 'We went to the museum by underground.',
    'university': 'My sister goes to university.',
    'department': 'The English department is on the first floor.',
    'factory': 'My dad works in a car factory.',
    'café': 'We had lunch at a café.',
    'car park': 'The car park is behind the shop.',
    'city centre': 'The big shops are in the city centre.',
    'department store': 'She works in a department store.',
    'railway station': 'We met at the railway station.',
    'swimming pool': 'The swimming pool is open in summer.',
    # --- 具体的东西 ---
    'brake': 'Check your brake before you ride.',
    'cheque': 'Dad wrote a cheque for the new bike.',
    'driving licence': 'Dad showed his driving licence.',
    'key': 'Where is the key to my bike?',
    'page': 'Open your book at page ten.',
    'silver': 'She has a silver ring.',
    'stairs': 'We ran up the stairs.',
    'traffic lights': 'Stop at the traffic lights.',
    'uniform': 'We wear a school uniform.',
    'cd': 'I bought a new CD.',
    'cd player': 'She listens to music on her CD player.',
    'mp3 player': 'My MP3 player is in my bag.',
    'dvd': 'We watched a DVD last night.',
    'dvd player': 'The DVD player is under the TV.',
    'tv': 'We watch TV after dinner.',
    'video': 'We made a video of the school show.',
    'video recorder': 'The video recorder is very old now.',
    # --- 衣服（复数词也照样能挖空） ---
    'clothes': 'I put my clothes in the cupboard.',
    'curtains': 'Please close the curtains.',
    'jeans': 'I wear jeans at the weekend.',
    'shoes': 'My new shoes are very clean.',
    'shorts': 'He wears shorts in summer.',
    'trainers': 'I put on my trainers for PE.',
    'trousers': 'These trousers are too long for me.',
    'boots': 'My boots are wet.',
    'swimming costume': 'I take my swimming costume to the pool.',
    # --- 吃的 / 动物 / 其他名词 ---
    'camel': 'The camel lives in the desert.',
    'circus': 'The children loved the circus.',
    'grape': 'There is a grape on the plate.',
    'kite': 'We flew a kite in the park.',
    'parrot': 'The parrot can say my name.',
    'ice cream': 'I would like an ice cream, please.',
    'fast food': 'We had fast food for lunch.',
    'mineral water': 'I would like a bottle of mineral water.',
    'main course': 'The main course was fish and chips.',
    'snack': 'I had a snack after school.',
    'slice': 'I ate a slice of cake.',
    'steak': 'We had steak and potatoes for dinner.',
    'meal': 'We had a big meal after the game.',
    'menu': 'The waiter gave us the menu.',
    'leather': 'These shoes are made of leather.',
    'instrument': 'Can you play an instrument?',
    'prize': 'She won first prize in the race.',
    'song': 'We sang a song in the school show.',
    'sport': 'My favourite sport is swimming.',
    'size': 'What size are your shoes?',
    # --- 音乐/运动/爱好（-ing 名词） ---
    'skiing': 'We go skiing in the mountains.',
    'snowboarding': 'We go snowboarding in winter.',
    'windsurfing': 'We go windsurfing in summer.',
    'surfboarding': 'We go surfboarding in the sea.',
    'ice skating': 'We go ice skating in winter.',
    'shopping': 'We do the shopping on Saturday.',
    'homework': 'I do my homework after dinner.',
    'exam': 'We have an English exam on Friday.',
    'sentence': 'Write a sentence about your family.',
    'story': 'My teacher read us a story.',
    'meeting': 'My parents have a meeting at school.',
    'conversation': 'We had a conversation about our holiday.',
    'information': 'I need some information about the trip.',
    'holidays': 'The summer holidays start next week.',
    'wedding': "My cousin's wedding was in June.",
    'festival': 'There is a music festival in our town.',
    'career': 'She wants a career in music.',
    'job': 'My mum has a new job.',
    'journey': 'We had a long journey by train.',
    'fog': 'There was thick fog this morning.',
    'danger': 'The red sign means danger.',
    'luck': 'Good luck with your exam!',
    'film': 'We watched a funny film last night.',
    'extra': 'I need an extra pencil.',
    'pen-friend': 'I write to my pen-friend in Canada.',
    'internet': 'I found the answer on the internet.',
    'website': 'Our school has a new website.',
    'chatroom': 'We met in a chatroom for football fans.',
    'email': 'I sent an email to my pen-friend.',
    'goodbye': 'I said goodbye and went home.',
    'hallo': 'He said hallo to me this morning.',
    # --- 度量衡（挖空要原形，所以都用单数） ---
    'gram': 'Add one gram of salt to the soup.',
    'kilogram': 'This bag weighs one kilogram.',
    'kilometre': 'I walk one kilometre to school.',
    'centimetre': 'The line is one centimetre long.',
    'metre': 'The table is one metre long.',
    'mile': 'The school is a mile from my house.',
    'litre': 'I drink a litre of water every day.',
    'pound': 'It costs one pound.',
    'pence': 'The apple costs fifty pence.',
    'euro': 'One euro is not enough for this book.',
    'hour': 'Wait here for an hour.',
    # --- 时间 ---
    'afternoon': 'We play football in the afternoon.',
    'evening': 'We watch TV in the evening.',
    'week': 'We have a test every week.',
    'weekend': 'We go swimming at the weekend.',
    # --- 天气 / 方位 ---
    'east': 'The sun rises in the east.',
    'west': 'The sun goes down in the west.',
    'south': 'The beach is in the south of the country.',
    'winter': 'It snows here in winter.',
    # --- 学校科目 ---
    'art': 'In art we learn to draw.',
    'science': 'We have Science on Tuesday.',
    'mathematics': 'My favourite subject is Mathematics.',
    'geography': 'I like Geography and History.',
    # --- 身体 ---
    'arm': 'My arm hurts.',
    'ear': 'My ear hurts.',
    'eye': 'I have something in my eye.',
    'hand': 'Put up your hand if you know.',
    'head': 'I have a hat on my head.',
    'leg': 'My little brother hurt his leg.',
    'mouth': "Please don't talk with your mouth full.",
    'nose': 'The clown has a red nose.',
    'tooth': 'The baby has one new tooth.',
    'hair': 'She has long black hair.',
    # --- 第三轮：还剩「像词不像句」的词 ---
    'adventure': 'Our trip was a big adventure.',
    'apartment': 'We live in a small apartment.',
    'artist': 'The artist drew a picture of my dog.',
    'assistant': 'The assistant helped the teacher.',
    'bed': 'I go to bed at nine.',
    'bedroom': 'My bedroom is next to the bathroom.',
    'bathroom': 'There is a small bathroom upstairs.',
    'beginner': 'This book is good for a beginner.',
    'birthday': 'It is my birthday on Sunday.',
    'breakfast': 'I have breakfast at seven.',
    'businessman': 'The businessman got on the plane.',
    'businesswoman': 'The businesswoman works in a big office.',
    'cartoon': 'We watched a cartoon after dinner.',
    'classroom': 'Our classroom is on the first floor.',
    'clown': 'The clown made us laugh.',
    'countryside': 'We went for a walk in the countryside.',
    'cooker': 'The new cooker is in the kitchen.',
    'disco': 'We danced at the school disco.',
    'discount': 'There is a discount on these shoes.',
    'downstairs': 'My bedroom is downstairs.',
    'electricity': 'The electricity went off last night.',
    'examination': 'We have an examination next week.',
    'exercise': 'I do exercise every morning.',
    'explorer': 'The explorer found a new island.',
    'family': 'There are five people in my family.',
    'fashion': 'She likes fashion and music.',
    'hairdresser': 'The hairdresser cut my hair.',
    'medicine': 'Take this medicine after dinner.',
    'musician': 'The musician plays the violin.',
    'name': 'My name is Tom.',
    'newsagent': 'I buy my comics at the newsagent.',
    'noon': 'We eat lunch at noon.',
    'onion': 'There is an onion in the soup.',
    'painter': 'The painter is painting my room.',
    'pet': 'My pet is a small dog.',
    'plastic': 'The bottle is made of plastic.',
    'plant': 'My plant needs water.',
    'player': 'He is the best player in our team.',
    'rap': 'He likes rap music.',
    'reggae': 'We listened to reggae music.',
    'tennis player': 'My sister wants to be a tennis player.',
    'tour': 'We had a tour of the old town.',
    'tourist': 'The tourist took photos of the castle.',
    'vegetable': 'Carrots are my favourite vegetable.',
    'village': 'My grandma lives in a small village.',
    'wheel': 'The front wheel of my bike is broken.',
    'worker': 'The worker cleaned the street.',
    'diploma': 'She got a diploma from the music school.',
    'music': 'We listen to music in class.',
    'museum': 'We visited a museum last week.',
    # --- 第四轮：剩下的「Do you know the word "..."?」这类兜底句，补成真句子 ---
    'camp': 'We stayed at a summer camp.',
    'campsite': 'The campsite is next to the river.',
    'concert': 'We went to a concert on Saturday.',
    'dance': 'There is a school dance on Friday.',
    'gold': 'The ring is made of gold.',
    'gramme': 'Add one gramme of salt to the soup.',
    'group': 'We work in a group of four.',
    'guidebook': 'I bought a guidebook for our trip.',
    'hip hop': 'My brother likes hip hop.',
    'hobby': 'My hobby is taking photos.',
    'island': 'We took a boat to the island.',
    'picnic': 'We had a picnic in the park.',
    'quiz': 'We had a quiz about animals.',
    'rainforest': 'Many animals live in the rainforest.',
    'soap': 'Wash your hands with soap.',
    'supermarket': 'Mum buys our food at the supermarket.',
    'surfing': 'We go surfing in summer.',
    'tent': 'We slept in a tent last night.',
    'variety': 'The shop sells a variety of sweets.',
    'guest': 'We had a guest for dinner.',
    'golf': 'My dad plays golf at the weekend.',
    'girl': 'The girl in the red hat is my sister.',
    'furniture': 'We bought new furniture for the living room.',
    'photography': 'She is good at photography.',
    'hall': 'The hall is next to our classroom.',
    'party': 'We had a party for my birthday.',
    # --- 第五轮：笼统模板下仍读着别扭的运动/词汇 ---
    'can': 'Can you help me, please?',
    'hockey': 'We play hockey at school in winter.',
    'tennis': 'We play tennis on Saturday.',
    'table-tennis': 'We play table-tennis after school.',
    'baseball': 'We play baseball in the park.',
    'football': 'We play football after school.',
    'volleyball': 'We play volleyball on the beach.',
    'text message': 'I sent a text message to my friend.',
    'petrol': 'The car needs petrol.',
    'student': 'She is a student at my school.',
    'sun': 'The sun is very hot today.',
    'teenager': 'My cousin is a teenager.',
    'test': 'We have a test on Monday.',
    'thunderstorm': 'There was a thunderstorm last night.',
    'opera': 'We went to the opera last night.',
    'pardon': 'Pardon? I did not hear you.',
    'normal': 'Everything is back to normal now.',
    'exhibition': 'We went to an art exhibition.',
}

SPECIAL.update(SPECIAL_MORE)

MONTHS = frozenset(
    'january february march april may june july august september october '
    'november december'.split())

WEEKDAYS = frozenset(
    'monday tuesday wednesday thursday friday saturday sunday'.split())

CARDINALS = frozenset(
    'zero one two three four five six seven eight nine ten eleven twelve '
    'thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty '
    'thirty forty fifty sixty seventy eighty ninety hundred thousand million'.split())

ORDINALS = frozenset(
    'first second third fourth fifth sixth seventh eighth ninth tenth eleventh '
    'twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth '
    'nineteenth twentieth thirtieth thirty-first'.split()
    + ['twenty-' + s for s in ('first', 'second', 'third', 'fourth', 'fifth',
                               'sixth', 'seventh', 'eighth', 'ninth')])

# 中文释义里含这些字：是「地方」，用地点模板（The park is near my house.）
PLACE_HINT = ('场', '馆', '园', '店', '站', '局', '中心', '校', '室', '厅', '房', '院',
              '堂', '城市', '村', '镇', '国', '机场', '车站', '街')
# 是「看得见摸得着的东西」，用图片式模板（I can see the bed in the picture.）
# 宁可漏（漏了只是句子平淡一点），也不要错（错了会出笑话，如 Look at the wedding over there!）
CONCRETE_HINT = (
    '车', '船', '飞机', '机', '器', '书', '笔', '纸', '球', '衣', '裤', '鞋', '靴', '袜',
    '帽', '裙', '衫', '夹', '包', '袋', '箱', '杯', '碗', '盘', '匙', '刀', '叉', '伞',
    '镜', '钟', '表', '灯', '门', '窗', '床', '桌', '椅', '柜', '架', '板', '墙', '帘',
    '毯', '枕', '镜', '梯', '桥', '河', '湖', '海', '山', '林', '树', '花', '草', '果',
    '菜', '肉', '饭', '面', '汤', '水', '茶', '咖啡', '奶', '糖', '油', '药', '卡',
    '票', '信', '图', '照', '玩', '礼物', '动物', '宠物', '鱼', '鸟', '猫', '狗', '马',
    '牛', '羊', '鸡', '猪', '象', '熊', '兔', '蛇', '虫', '蜂', '鼠', '狮', '虎', '鲸',
    '豚', '龙', '鹦鹉', '乐器', '琴', '鼓', '吉他', '色', '布', '皮', '蛋', '豆', '饼',
    '稻', '盐', '椒', '柠檬', '葡萄', '比萨', '三明治', '色拉', '汉堡', '巧克力', '冰',
    '蔬菜', '水果', '词典', '风筝', '杂志', '行李', '护照', '摄影', '蕉', '萝', '茄', '葱',
    '胎', '巾', '炉', '云', '扇', '耳', '眼', '鼻',
    '嘴', '头', '手', '脚', '腿', '脸', '牙', '臂', '发', '人', '员', '者', '客', '警',
)

# 具体东西：像在看图说话，孩子好理解；「a/an + 不可数名词」这种坑要避开，
# 所以一律用 the，配合 picture / over there 这类上下文
CONCRETE_FRAMES = (
    'I can see the {w} in the picture.',
    'Look at the {w} over there!',
    'Where is the {w}? I can see it.',
    'Can you see the {w} in this picture?',
)
# 地点
PLACE_FRAMES = (
    'The {w} is near my house.',
    'We went to the {w} yesterday.',
    'The {w} is in our town.',
    'Is there a {w} near here?',
)
# 抽象词 / 动词 / 形容词等兜底：把单词当「词」来提，语法上永远安全
ABSTRACT_FRAMES = (
    'Do you know the word "{w}"?',
    'We learned the word "{w}" in class today.',
    'Can you spell the word "{w}"?',
    'The teacher wrote "{w}" on the board.',
)
OTHER_FRAMES = ABSTRACT_FRAMES


def pos_class(word):
    """把 pos 归成 n / v / adj / adv / prep / other 六类。"""
    low = (word.get('pos') or '').lower()
    if 'phr v' in low:
        return 'v'
    first = re.split(r'[,&]', low)[0].strip()
    for key in ('prep', 'n', 'v', 'adj', 'adv'):
        if first.startswith(key):
            return key
    return 'other'


def checksum(text):
    return sum(ord(c) * (i + 1) for i, c in enumerate(text))


def template_sentence(word):
    """模板句：保证语法通顺、句子简单，并且一定出现单词原形。"""
    w = word['w']
    key = w.lower()
    if key in SPECIAL:
        return SPECIAL[key].replace('{w}', w)
    if key in ORDINALS:
        return 'Today is the {w} day of the month.'.replace('{w}', w)
    if key in MONTHS:
        return 'My birthday is in {w}.'.replace('{w}', w)
    if key in WEEKDAYS:
        return 'We have PE on {w}.'.replace('{w}', w)
    if key in CARDINALS:
        return 'The number {w} is on the board.'.replace('{w}', w)

    kind = pos_class(word)
    zh = word.get('zh') or ''
    if kind == 'n':
        if any(h in zh for h in PLACE_HINT):
            frames = PLACE_FRAMES
        elif any(h in zh for h in CONCRETE_HINT):
            frames = CONCRETE_FRAMES
        else:
            frames = ABSTRACT_FRAMES
    else:
        frames = OTHER_FRAMES
    return frames[checksum(key) % len(frames)].replace('{w}', w)


# ------------------------------------------------------------------ 组装 & 输出

def tidy(text):
    text = re.sub(r'\s+', ' ', text or '').strip()
    text = re.sub(r'\s+([.,!?])', r'\1', text)   # 只收掉句号前的空格，引号前的空格要留
    for fancy, plain in ((u'\u2018', "'"), (u'\u2019', "'"),
                         (u'\u201c', '"'), (u'\u201d', '"')):
        text = text.replace(fancy, plain)        # 弯引号统一成直引号
    return text.strip()


# KET 词汇表 ex 字段里，很多条目是搭配短语而不是句子（"a heavy blanket"、
# "to travel by air"、"Be able to"）。短语比模板句有信息量，但毕竟没有谓语，
# 所以排在「词典例句」之后当兜底。
def ket_is_sentence(text):
    if '(' in text or ')' in text or '/' in text or '=' in text:
        return False
    low = text.lower()
    if low.startswith('to '):
        return False
    if not has_verb(text):
        return False
    return tail_ok(text)


# 这些词的官方「短语」不适合挖空（'Dear Anne,' / 'Dot com'），留给词典或模板句
PHRASE_SKIP = frozenset(('dear', 'dot'))

# 词典例句「够简单」的判定：主语/祈使句开头、且不太长。
# 简单的直接用词典句；不简单的（'The book has a pop at astrology…'）宁可退回
# 官方短语（'Pop music'），孩子读着更轻松。
SIMPLE_START = frozenset(
    'i you he she it we they my your his her our their there this that these those '
    'what who where when why how do does did can could will would please let'.split())


def dict_simple(text):
    tokens = text.split()
    if len(tokens) > 12:
        return False
    first = re.sub(r"[^a-z']", '', tokens[0].lower())
    if first in SIMPLE_START:
        return True
    return len(tokens) <= 8 and text[-1] in '.!?'


def period(text):
    """词典例句 / 官方短语大多不带句尾标点，补一个句号，读起来才像一句话。"""
    if text and text[-1] not in '.!?"\u2019':
        return text + '.'
    return text


def build_sentence(word, dic):
    """返回 (例句, 来源)：KET 完整句 → 牛津例句 → KET 搭配短语 → 模板句。"""
    sentences, phrases = [], []
    for raw in (word.get('ex') or []):
        text = tidy(raw)
        if not contains_base(text, word['word']):
            continue
        if '(' in text or ')' in text or '/' in text or '=' in text:
            continue
        if ket_is_sentence(text):
            sentences.append(text)
        elif tail_ok(text) and len(text.split()) >= 2:
            phrases.append(text)
    if sentences:
        return period(capitalize(max(
            sentences,
            key=lambda t: (count_base(t, word['word']) == 1, score(t))))), 'ket'
    phrase = ''
    if phrases and word['word'].lower() not in PHRASE_SKIP:
        phrase = period(capitalize(max(
            phrases,
            key=lambda t: (count_base(t, word['word']) == 1, score(t)))))
    found = dict_examples(dic, word['word'])
    if found and (dict_simple(found[0]) or not phrase):
        return period(found[0]), 'dict'
    if phrase:
        return phrase, 'ketp'
    if found:
        return period(found[0]), 'dict'
    return capitalize(tidy(template_sentence(word))), 'tpl'


def write_outputs(payload):
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, 'words.json'), 'w', encoding='utf-8') as handle:
        handle.write(text + '\n')
    with open(os.path.join(DATA, 'words.js'), 'w', encoding='utf-8') as handle:
        handle.write('/* generated by scripts/build_words.py + scripts/build_examples.py'
                     ' - do not edit by hand */\n')
        handle.write('window.KET_WORDS = ')
        handle.write(text)
        handle.write(';\n')


def main():
    ap = argparse.ArgumentParser(description='给词库补例句（写入 sent / sentSrc 字段）')
    ap.add_argument('--dry-run', action='store_true', help='只打印统计与抽样，不写文件')
    ap.add_argument('--sample', type=int, default=25, help='每种来源抽样打印多少条')
    ap.add_argument('--only', default='', help='只抽样某个来源：ket / ketp / dict / tpl')
    args = ap.parse_args()

    path = os.path.join(DATA, 'words.json')
    with open(path, encoding='utf-8') as handle:
        payload = json.load(handle)
    words = payload['words']

    dic = ad.OxfordChineseDictionary()
    print('词典: %s' % os.path.basename(dic.path))

    stats = collections.Counter()
    samples = collections.defaultdict(list)
    problems = []
    for word in words:
        sent, src = build_sentence(word, dic)
        if not sent or not contains_base(sent, word['word']):
            problems.append((word['word'], src, sent))
            continue
        word['sent'] = sent
        word['sentSrc'] = src
        stats[src] += 1
        if len(samples[src]) < args.sample:
            samples[src].append((word['word'], sent))

    total = sum(stats.values())
    print('\n例句来源统计（共 %d / %d 词有例句）' % (total, len(words)))
    for src, label in (('ket', 'KET 官方句'), ('dict', '牛津词典例句'),
                       ('ketp', 'KET 官方短语'), ('tpl', '模板句')):
        print('   %-8s %-14s %4d  %5.1f%%' % (src, label, stats[src],
                                              stats[src] * 100.0 / max(1, len(words))))
    if problems:
        print('\n!! 以下 %d 个词没能生成合格例句（例句必须含单词原形）：' % len(problems))
        for word, src, sent in problems[:20]:
            print('   %-20s %-5s %s' % (word, src, sent))
        sys.exit(1)

    print('\n抽样：')
    for src in ('ket', 'ketp', 'dict', 'tpl'):
        if args.only and args.only != src:
            continue
        print('\n-- %s --' % src)
        for word, sent in samples[src]:
            print('   %-18s %s' % (word, sent))

    if args.dry_run:
        print('\n(--dry-run：没有写入文件)')
        return
    write_outputs(payload)
    print('\n已写入 data/words.json 与 data/words.js')


if __name__ == '__main__':
    main()


