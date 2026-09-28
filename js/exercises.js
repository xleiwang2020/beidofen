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

    // 题型 4：拼写填空 / 全拼 (spelling)
    buildSpelling(word) {
      return {
        type: 'spelling',
        title: '拼写单词',
        word: word,
        promptZh: word.zh,
        promptPos: word.pos || '',
        promptIpa: word.ipa || '',
        targetWord: word.word.toLowerCase().trim(),
        autoSpeak: word.word
      };
    }

    // 智能选取合适的题型：
    // 新词 / Box 0: 优先看英文选中文 (降低认知负荷)
    // Box 1-2: 混合听音、看中文选英文
    // Box >= 3 或错题: 拼写测试 (KET 写作常考拼写)
    createQuestion(word, box = 0) {
      if (box === 0) {
        return this.buildEnToZh(word);
      } else if (box === 1) {
        return Math.random() < 0.6 ? this.buildEnToZh(word) : this.buildZhToEn(word);
      } else if (box === 2) {
        const r = Math.random();
        if (r < 0.4) return this.buildZhToEn(word);
        if (r < 0.7) return this.buildListening(word);
        return this.buildSpelling(word);
      } else {
        // 高熟练度 / 重点复习: 拼写为主
        return Math.random() < 0.5 ? this.buildSpelling(word) : this.buildZhToEn(word);
      }
    }
  }

  window.ExerciseGenerator = ExerciseGenerator;
})();
