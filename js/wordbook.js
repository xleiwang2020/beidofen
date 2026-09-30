// wordbook.js — ⭐ 单词本闯关闸门
// 规则：打开网页时，若单词本里有词，自动弹出闯关；每个词答对一次才算过关，
//       答错的词排到队尾再来一次；全部过关后才可以继续今日学习。
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

  class WordbookGate {
    constructor(ctx) {
      const c = ctx || {};
      this.store = c.store;
      this.srs = c.srs;
      this.exGen = c.exGen;
      this.speech = c.speech;
      this.allWords = c.allWords || [];
      this.wordMap = new Map();
      this.allWords.forEach(w => this.wordMap.set(w.id, w));

      this.el = {
        gate: document.getElementById('gate'),
        body: document.getElementById('gate-body'),
        progress: document.getElementById('gate-progress'),
        sub: document.getElementById('gate-sub'),
        bar: document.getElementById('gate-bar'),
        start: document.getElementById('gate-start'),
        skip: document.getElementById('gate-skip')
      };

      this.round = null;
      this.onFinished = null;

      this.bind();
    }

    bind() {
      const self = this;
      if (this.el.start) {
        this.el.start.addEventListener('click', function () {
          if (!self.round) return;
          if (self.round.state === 'done') {
            self.finish();
          } else {
            self.startRound();
          }
        });
      }
      if (this.el.skip) {
        this.el.skip.addEventListener('click', function () {
          if (window.confirm('家长跳过：本次不闯关，直接进入学习。\n（跳过会削弱记忆效果，建议让孩子先过关）')) {
            self.finish(true);
          }
        });
      }

      // 键盘：1-4 选项、Enter 继续
      document.addEventListener('keydown', function (e) {
        if (!self.isOpen() || !self.round || self.round.state !== 'playing') return;
        const t = e.target;
        if (t && t.classList && t.classList.contains('grid-input')) return; // 交给五线格处理
        const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
        if (isTyping) return;

        if (e.key === 'Enter' && self.round.answered) {
          e.preventDefault();
          e.stopPropagation();
          self.advance();
          return;
        }
        if (!self.round.answered && ['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(e.key, 10) - 1;
          const opts = self.el.body.querySelectorAll('.opt');
          if (opts[idx]) opts[idx].click();
        }
      });
    }

    isOpen() {
      return !!this.el.gate && !this.el.gate.hasAttribute('hidden');
    }

    /** 取单词本里的词（按收藏时间排序） */
    wordbookWords() {
      return this.store.getWordbookEntries()
        .map(e => this.wordMap.get(e.id))
        .filter(Boolean);
    }

    /** 打开网页时自动弹出（返回是否弹出） */
    maybeAutoOpen() {
      if (this.store.data.wordbookGateEnabled === false) return false;
      if (this.isOpen()) return false;
      const words = this.wordbookWords();
      if (!words.length) return false;
      this.open();
      return true;
    }

    open() {
      const words = this.wordbookWords();
      if (!words.length) return false;

      this.round = {
        state: 'intro',
        words: words,
        queue: [],
        idx: 0,
        total: words.length,
        cleared: 0,
        passedIds: [],
        wrongTotal: 0,
        answered: false,
        q: null,
        grid: null
      };

      this.el.gate.removeAttribute('hidden');
      this.renderIntro();
      return true;
    }

    renderIntro() {
      const r = this.round;
      const today = window.todayStr();
      const passedToday = r.words.filter(w => {
        const e = this.store.getWordbookEntry(w.id);
        return e && e.lastPassed === today;
      }).length;

      this.el.progress.textContent = `共 ${r.total} 词`;
      this.el.sub.textContent = '把单词本里的词全部答对一遍，才能继续今日探险！';
      this.el.bar.style.width = '0%';

      this.el.body.innerHTML = `
        <div class="gate-hero">
          <div class="big">📕</div>
          <p>单词本里有 <b>${r.total}</b> 个词等你过关${passedToday ? `（今天已过 ${passedToday} 个）` : ''}。</p>
          <p class="muted small">答对一次即过关；答错的词会排到队尾，稍后再来一次。只有全部过关才能继续背新词 💪</p>
        </div>
        <div class="word-list small gate-list">
          ${r.words.map(w => `
            <div class="word-row" data-id="${w.id}">
              <button class="icon-btn btn-speak" data-word="${w.word}" title="发音">🔊</button>
              <div class="w-main">
                <div class="w-en">${w.word} <span class="w-pos">${w.pos || ''}</span></div>
                <div class="w-zh">${w.zh}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      this.el.start.textContent = '开始闯关 🚦';
      this.el.start.hidden = false;
      this.el.skip.hidden = true;

      const self = this;
      this.el.body.querySelectorAll('.btn-speak').forEach(btn => {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          self.speech.speak(btn.dataset.word);
        });
      });
    }

    startRound() {
      const r = this.round;
      if (!r) return;
      r.state = 'playing';
      r.queue = shuffle(r.words.slice());
      r.idx = 0;
      r.cleared = 0;
      r.passedIds = [];
      r.wrongTotal = 0;

      this.el.start.hidden = true;
      this.el.skip.hidden = true;
      this.next();
    }

    next() {
      const r = this.round;
      if (!r) return;
      if (r.idx >= r.queue.length) {
        this.renderDone();
        return;
      }
      const word = r.queue[r.idx];
      const rec = this.store.getWordRecord(word.id);
      const box = rec ? rec.box : 1;
      r.q = this.exGen.buildGateQuestion(word, box);
      r.answered = false;
      r.grid = null;

      this.updateProgress();
      this.renderQuestion();
    }

    updateProgress() {
      const r = this.round;
      const pct = Math.round((r.cleared / Math.max(1, r.total)) * 100);
      this.el.bar.style.width = `${pct}%`;
      this.el.progress.textContent = `过 ${r.cleared} / ${r.total}`;
    }


    renderQuestion() {
      const r = this.round;
      const q = r.q;
      let html = `<div class="q-label">${q.title}</div>`;
      html += `<div class="gate-qnum">第 ${r.idx + 1} / ${r.queue.length} 题</div>`;

      if (q.options) {
        html += `
          <div class="q-prompt">
            ${q.promptWord ? `<div class="q-word">${q.promptWord}</div>` : ''}
            ${q.promptZh ? `<div class="q-zh">${q.promptZh}</div>` : ''}
            ${q.promptPos ? `<div class="q-pos">${q.promptPos}</div>` : ''}
          </div>
          <div class="options">
            ${q.options.map((opt, i) => `
              <button class="opt" data-idx="${i}" data-correct="${opt.isCorrect}">
                <kbd>${i + 1}</kbd>
                <span class="opt-text">${opt.text}</span>
              </button>
            `).join('')}
          </div>
        `;
      } else {
        html += `
          <div class="q-prompt">
            ${q.type === 'dictation' ? '<div class="q-pos">🎧 听发音，在五线格里拼出这个单词</div>' : ''}
            ${q.promptZh ? `<div class="q-zh">${q.promptZh}</div>` : ''}
            ${q.promptPos ? `<div class="q-pos">${q.promptPos}</div>` : ''}
            ${q.example ? `<div class="q-sentence">${q.example}</div>` : ''}
          </div>
          <div class="grid-hint">${window.gridHint(q.targetWord)}</div>
          <div id="gate-grid"></div>
          <div class="btn-row" style="justify-content:center;">
            <button class="btn btn-primary btn-xl" id="gate-submit">确认（Enter）</button>
            <button class="btn btn-ghost" id="gate-replay">🔊 听发音</button>
          </div>
        `;
      }

      html += `<div id="gate-feedback"></div>`;
      this.el.body.innerHTML = html;

      const self = this;

      this.el.body.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', function () { self.answerChoice(btn); });
      });

      const mount = this.el.body.querySelector('#gate-grid');
      if (mount) {
        const grid = new window.RuledGrid({
          mount: mount,
          target: q.targetWord,
          onSubmit: function (val) { self.answerText(val); }
        });
        r.grid = grid;
        const submit = this.el.body.querySelector('#gate-submit');
        if (submit) submit.addEventListener('click', function () { grid.submit(); });
        setTimeout(function () { grid.focus(); }, 150);
      }

      this.el.body.querySelectorAll('#gate-replay').forEach(btn => {
        btn.addEventListener('click', function () { self.speech.speak(q.word.word); });
      });

      if (q.autoSpeak) this.speech.speak(q.autoSpeak);
    }

    answerChoice(btn) {
      const r = this.round;
      if (!r || r.answered) return;
      r.answered = true;

      const isCorrect = btn.dataset.correct === 'true';
      if (!isCorrect) {
        this.el.body.querySelectorAll('.opt').forEach(b => {
          if (b.dataset.correct === 'true') b.classList.add('correct');
          else b.classList.add('dim');
        });
      }
      btn.classList.add(isCorrect ? 'correct' : 'wrong');
      this.settle(isCorrect);
    }

    answerText(val) {
      const r = this.round;
      if (!r || r.answered) return;
      r.answered = true;

      const isCorrect = window.normalizeSpelling(val) === window.normalizeSpelling(r.q.targetWord);
      if (r.grid) r.grid.lock(true);
      this.settle(isCorrect);
    }


    settle(isCorrect) {
      const r = this.round;
      const word = r.q.word;

      const submit = this.el.body.querySelector('#gate-submit');
      if (submit) submit.disabled = true;

      if (isCorrect) {
        r.cleared += 1;
        r.passedIds.push(word.id);
        this.speech.playCorrect();
        const res = this.srs.updateWordState(word.id, true, 4);
        this.store.recordAnswer({ wordId: word.id, isCorrect: true, isNew: res.isNew, xpEarned: 12 });
        this.srs.recordPass(word.id, window.ExerciseGenerator.levelOf(r.q.type));
        this.store.markWordbookPassed(word.id);
      } else {
        r.wrongTotal += 1;
        this.speech.playWrong();
        const res = this.srs.updateWordState(word.id, false, 1);
        this.store.recordAnswer({ wordId: word.id, isCorrect: false, isNew: res.isNew, xpEarned: 2 });
        r.queue.push(word); // 排到队尾，稍后重来
      }

      this.updateProgress();
      this.showFeedback(isCorrect, word);

      // 连续答错 4 次以上，给家长一个止损出口
      if (this.el.skip) this.el.skip.hidden = r.wrongTotal < 4;
    }

    showFeedback(isCorrect, word) {
      const fb = this.el.body.querySelector('#gate-feedback');
      if (!fb) return;

      const sentence = this.exGen.buildHighlightedExample(word);
      fb.className = `feedback ${isCorrect ? 'ok' : 'no'}`;
      fb.innerHTML = `
        <div class="fb-text">
          <b>${isCorrect ? '🎉 过关！' : '💪 记一下：' + word.word}</b>
          <div class="fb-sub">${word.word} · ${word.zh}${word.ipa ? ' · /' + word.ipa + '/' : ''}</div>
          ${sentence ? `<div class="fb-sent">${sentence}</div>` : ''}
        </div>
        <div class="fb-actions">
          <button class="btn btn-primary" id="gate-next">继续 (Enter)</button>
        </div>
      `;

      const next = fb.querySelector('#gate-next');
      next.focus();
      const self = this;
      next.addEventListener('click', function () { self.advance(); });
    }

    advance() {
      const r = this.round;
      if (!r) return;
      r.idx += 1;
      this.next();
    }

    renderDone() {
      const r = this.round;
      r.state = 'done';
      this.speech.playFanfare();

      this.el.bar.style.width = '100%';
      this.el.progress.textContent = `${r.total} / ${r.total} 全部过关`;
      this.el.sub.textContent = '太棒了！单词本全部过关 🎉';

      this.el.body.innerHTML = `
        <div class="gate-hero">
          <div class="big">🏆</div>
          <h2>单词本全部过关！</h2>
          <p class="muted">共 ${r.total} 个词，全部答对一遍${r.wrongTotal ? `，途中答错 ${r.wrongTotal} 次` : '，一次也没错！'}。</p>
          <label class="field check">
            <span>把已过关的词从单词本移出（推荐）</span>
            <input type="checkbox" id="gate-remove" checked>
          </label>
        </div>
      `;

      this.el.start.textContent = '进入单词星球 🚀';
      this.el.start.hidden = false;
      this.el.skip.hidden = true;
    }

    finish(forced) {
      const r = this.round;
      const chk = this.el.body.querySelector('#gate-remove');
      if (!forced && chk && chk.checked && r) {
        r.passedIds.forEach(id => this.store.removeFromWordbook(id));
      }
      this.el.gate.setAttribute('hidden', '');
      this.round = null;
      if (typeof this.onFinished === 'function') this.onFinished();
    }
  }

  window.WordbookGate = WordbookGate;
})();

