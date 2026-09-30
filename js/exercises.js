// exercises.js — 多样化题型生成器
(function () {
  'use strict';

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickDistractors(currentWord, allWords, count = 3, key = 'zh') {
    const currentVal = currentWord[key];
    const pool = allWords.filter(w => w.id !== currentWord.id && w[key] && w[key] !== currentVal);
    const shuffled = shuffle(pool);
    return shuffled.slice(0, count).map(w => w[key]);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 与 scripts/check_sentences.py 的 base_pattern 保持一致：小写比较、独立成词、词组空格可多个
  function basePattern(word) {
    const esc = word.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return new RegExp('(?<![a-z])' + esc + '(?![a-z])', 'g');
  }

  // 找出 sent 里原形的所有位置，用 wrap 渲染匹配段，其余部分转义原样输出；没匹配到返回 ''
  function renderSentence(word, wrap) {
    const text = String(word.sent || '').trim();
    if (!text) return '';
    const re = basePattern(word.word);
    const lower = text.toLowerCase();
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(lower)) !== null) {
      out += escapeHtml(text.slice(last, m.index)) + wrap(text.slice(m.index, m.index + m[0].length));
      last = m.index + m[0].length;
    }
    if (!last) return '';
    return out + escapeHtml(text.slice(last));
  }

  // 题型难度：1 认识、2 回想、3 拼写。答对的难度够当前轮次，才算过了这一轮
  const QUESTION_LEVEL = {
    choice_en_to_zh: 1,
    listening: 1,
    choice_zh_to_en: 2,
    definition_spell: 3,
    spelling: 3,
    dictation: 3
  };

  class ExerciseGenerator {
    constructor(allWords) {
      this.allWords = allWords || [];
    }

    // 题型 1：看英文选中文 (en -> zh)
    buildEnToZh(word) {
      const wrongOptions = pickDistractors(word, this.allWords, 3, 'zh');
      const options = shuffle([
        { text: word.zh, isCorrect: true },
        ...wrongOptions.map(t => ({ text: t, isCorrect: false }))
      ]);

      return {
        type: 'choice_en_to_zh',
        title: '看英文选中文',
        word: word,
        promptWord: word.word,
        promptIpa: word.ipa || '',
        promptPos: word.pos || '',
        options: options,
        autoSpeak: word.word
      };
    }

    // 题型 2：看中文选英文 (zh -> en)
    buildZhToEn(word) {
      const wrongOptions = pickDistractors(word, this.allWords, 3, 'word');
      const options = shuffle([
        { text: word.word, isCorrect: true },
        ...wrongOptions.map(t => ({ text: t, isCorrect: false }))
      ]);

      return {
        type: 'choice_zh_to_en',
        title: '看中文选英文',
        word: word,
        promptZh: word.zh,
        promptPos: word.pos || '',
        options: options,
        autoSpeak: null
      };
    }

    // 题型 3：听音辨义 (listening -> zh)
    buildListening(word) {
      const wrongOptions = pickDistractors(word, this.allWords, 3, 'zh');
      const options = shuffle([
        { text: word.zh, isCorrect: true },
        ...wrongOptions.map(t => ({ text: t, isCorrect: false }))
      ]);

      return {
        type: 'listening',
        title: '听发音选中文',
        word: word,
        promptWord: '🔊 点击重听',
        options: options,
        autoSpeak: word.word
      };
    }

    // 题型 4：拼写单词（给中文 + 音标 + 挖空例句，在五线格上拼出单词）
    buildSpelling(word) {
      return {
        type: 'spelling',
        title: '拼写单词 · 五线格',
        word: word,
        promptZh: word.zh,
        promptPos: word.pos || '',
        promptIpa: word.ipa || '',
        example: this.buildBlankedExample(word),
        targetWord: word.word.toLowerCase().trim(),
        gridMode: true,
        autoSpeak: word.word
      };
    }

    // 把 sent 里所有原形位置挖空：每个单词各挖一段，空格和 - ' . 原样保留
    buildBlankedExample(word) {
      return renderSentence(word, function (m) {
        return escapeHtml(m).replace(/[A-Za-z]+/g, function (run) {
          return '<u>' + '_'.repeat(run.length) + '</u>';
        });
      });
    }

    // 答完题后展示的完整例句，目标词高亮
    buildHighlightedExample(word) {
      return renderSentence(word, function (m) {
        return '<mark>' + escapeHtml(m) + '</mark>';
      });
    }

    // 题型 5：听音拼写（只给读音，在五线格上拼出单词）
    buildDictation(word) {
      return {
        type: 'dictation',
        title: '听音拼写 · 五线格',
        word: word,
        promptZh: '',
        promptPos: '',
        promptIpa: '',
        targetWord: word.word.toLowerCase().trim(),
        gridMode: true,
        autoSpeak: word.word
      };
    }

    // 题型 6：看释义猜词（给中文解释 / 挖空例句，在五线格上拼出单词）
    buildDefinitionSpelling(word) {
      return {
        type: 'definition_spell',
        title: '看释义猜词 · 五线格',
        word: word,
        promptZh: word.zh,
        promptPos: word.pos || '',
        promptIpa: word.ipa || '',
        example: this.buildBlankedExample(word),
        targetWord: word.word.toLowerCase().trim(),
        gridMode: true,
        autoSpeak: null
      };
    }

    // 智能选取合适的题型：
    // 新词 / Box 0: 优先看英文选中文 (降低认知负荷)
    // Box 1: 看英文 / 看中文选词
    // Box 2: 听音辨义 + 看释义猜词(五线格)
    // Box >= 3 或错题: 五线格拼写为主 (KET 写作常考拼写)
    createQuestion(word, box = 0, mode = 'auto') {
      if (mode === 'dictation') return this.buildDictation(word);
      if (mode === 'definition') return this.buildDefinitionSpelling(word);
      if (mode === 'spelling') return this.buildSpelling(word);

      if (box === 0) {
        return this.buildEnToZh(word);
      } else if (box === 1) {
        const r = Math.random();
        if (r < 0.5) return this.buildEnToZh(word);
        if (r < 0.85) return this.buildZhToEn(word);
        return this.buildDefinitionSpelling(word);
      } else if (box === 2) {
        const r = Math.random();
        if (r < 0.3) return this.buildZhToEn(word);
        if (r < 0.55) return this.buildListening(word);
        if (r < 0.85) return this.buildDefinitionSpelling(word);
        return this.buildSpelling(word);
      } else {
        // 高熟练度 / 重点复习: 五线格拼写为主
        const r = Math.random();
        if (r < 0.35) return this.buildSpelling(word);
        if (r < 0.7) return this.buildDefinitionSpelling(word);
        if (r < 0.9) return this.buildDictation(word);
        return this.buildZhToEn(word);
      }
    }

    // 3 轮过词：每轮固定一类题型
    // 第 1 轮 认识（看英文选中文 / 听音选义） → 第 2 轮 回想（看中文选英文 / 看释义猜词）
    // → 第 3 轮 拼写（五线格拼写 / 听音拼写）
    createRoundQuestion(word, round) {
      const coin = Math.random() < 0.5;
      if (round <= 1) return coin ? this.buildEnToZh(word) : this.buildListening(word);
      if (round === 2) return coin ? this.buildZhToEn(word) : this.buildDefinitionSpelling(word);
      return coin ? this.buildSpelling(word) : this.buildDictation(word);
    }

    // 单词本闯关专用题型：短词偏好五线格拼写，长词组用选择题，保证通关节奏
    buildGateQuestion(word, box = 1) {
      const len = word.word.replace(/\s/g, '').length;
      const spellProb = len <= 6 ? 0.75 : len <= 9 ? 0.6 : 0.3;
      if (Math.random() < spellProb) {
        return Math.random() < 0.5 ? this.buildDefinitionSpelling(word) : this.buildDictation(word);
      }
      return box >= 2 ? this.buildZhToEn(word) : this.buildEnToZh(word);
    }
  }

  ExerciseGenerator.levelOf = function (type) {
    return QUESTION_LEVEL[type] || 1;
  };

  window.ExerciseGenerator = ExerciseGenerator;
})();
