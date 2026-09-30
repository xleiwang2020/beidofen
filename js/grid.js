// grid.js — 五线格拼写输入控件（英文练习格：五条线、四格，字母坐在第 4 条线上）
// 用法：
//   const grid = new RuledGrid({ mount: el, target: 'apple', onSubmit: v => {...} });
(function () {
  'use strict';

  const CELL_NORMAL = 48; // 短词
  const CELL_MID = 38;    // 中等长度
  const CELL_LONG = 30;   // 长词 / 词组，横向可滚动

  function cellWidthFor(len) {
    if (len > 14) return CELL_LONG;
    if (len > 10) return CELL_MID;
    return CELL_NORMAL;
  }

  function normalizeSpelling(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[\u2018\u2019`\u00b4]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLetter(ch) {
    return /[a-z]/i.test(ch);
  }

  // 题面提示：几格、要写几个字母、空格 / 符号已预先画好
  function gridHint(target) {
    const t = normalizeSpelling(target);
    const letters = t.split('').filter(isLetter).length;
    const spaces = (t.match(/ /g) || []).length;
    const marks = t.split('').filter(ch => ch !== ' ' && !isLetter(ch));
    if (letters === t.length) return `✍️ 在五线格里写出单词（${t.length} 格）`;
    const parts = [];
    if (spaces) parts.push(`${spaces} 个空格`);
    if (marks.length) parts.push(`符号 ${Array.from(new Set(marks)).join(' ')}`);
    return `✍️ 在五线格里写出单词（${t.length} 格：写 ${letters} 个字母，${parts.join('、')} 已画好）`;
  }

  class RuledGrid {
    constructor(options) {
      const opts = options || {};
      this.target = normalizeSpelling(opts.target || '');
      this.targetNorm = this.target;
      // 空格和 - ' . 是预填的固定格，孩子只输入字母
      this.fixed = this.target.split('').map(ch => !isLetter(ch));
      this.letterSlots = this.fixed.filter(f => !f).length;
      this.onSubmit = typeof opts.onSubmit === 'function' ? opts.onSubmit : function () {};
      this.onType = typeof opts.onType === 'function' ? opts.onType : function () {};
      this.locked = false;
      this.revealed = false;
      this.cellEls = [];

      const mount = opts.mount;
      if (!mount) throw new Error('RuledGrid: 缺少 mount 容器');

      const root = document.createElement('div');
      root.className = 'ruled-grid';

      const paper = document.createElement('div');
      paper.className = 'grid-paper';

      const lines = document.createElement('div');
      lines.className = 'grid-lines';
      for (let i = 0; i < 5; i++) {
        const line = document.createElement('i');
        line.className = 'gline' + (i === 3 ? ' baseline' : '');
        line.style.top = (i === 4 ? 'calc(100% - 1px)' : (i * 25) + '%');
        lines.appendChild(line);
      }
      paper.appendChild(lines);

      const cells = document.createElement('div');
      cells.className = 'grid-cells';
      paper.appendChild(cells);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'grid-input';
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('enterkeyhint', 'done');
      input.setAttribute('aria-label', '在五线格中输入单词');
      input.maxLength = Math.max(24, this.target.length + 6);

      root.appendChild(paper);
      root.appendChild(input);

      mount.innerHTML = '';
      mount.appendChild(root);

      this.root = root;
      this.paper = paper;
      this.cells = cells;
      this.input = input;

      this.renderCells();

      const self = this;
      paper.addEventListener('click', function () {
        if (!self.locked) self.input.focus();
      });
      input.addEventListener('input', function () { self.sync(); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          self.submit();
        }
      });
    }

    // 多打出来的字母排在目标词后面，格子跟着加长
    cellCountFor(typedLetters) {
      return Math.max(this.target.length + Math.max(0, typedLetters - this.letterSlots), 1);
    }

    renderCells() {
      const len = this.cellCountFor(this.input.value.length);
      const width = cellWidthFor(Math.max(this.target.length, 1));
      let html = '';
      for (let i = 0; i < len; i++) {
        const ch = i < this.target.length && this.fixed[i] ? this.target[i] : '';
        const isSpace = ch === ' ';
        const cls = 'cell' + (ch ? ' fixed' : '') + (isSpace ? ' space' : '');
        const w = isSpace ? Math.round(width * 0.6) : width;
        html += '<div class="' + cls + '" data-idx="' + i + '" style="width:' + w + 'px">' +
                  '<span class="ghost"></span><span class="glyph">' + (ch ? (isSpace ? ' ' : ch) : '') + '</span>' +
                '</div>';
      }
      this.cells.innerHTML = html;
      this.cellEls = Array.prototype.slice.call(this.cells.querySelectorAll('.cell'));
      this.syncGlyphs();
    }

    sync() {
      // 孩子自己敲的空格 / 符号直接忽略，只保留字母
      const clean = this.input.value.replace(/[^A-Za-z]/g, '');
      if (clean !== this.input.value) this.input.value = clean;
      this.syncGlyphs();
      this.onType(this.value);
    }

    syncGlyphs() {
      const letters = this.input.value;
      if (this.cellCountFor(letters.length) !== this.cellEls.length) {
        this.renderCells();
        return;
      }
      let li = 0;
      let cursorSet = false;
      this.cellEls.forEach(cell => {
        if (cell.classList.contains('fixed')) return;
        const glyph = cell.querySelector('.glyph');
        const ch = letters[li] || '';
        li += 1;
        if (glyph.textContent !== ch) glyph.textContent = ch;
        cell.classList.toggle('filled', !!ch);
        const isCursor = !this.locked && !ch && !cursorSet;
        if (isCursor) cursorSet = true;
        cell.classList.toggle('cursor', isCursor);
      });
    }

    // 把字母按顺序填回字母格，拼上预填的空格 / 符号，得到完整答案
    get value() {
      const letters = this.input.value;
      let li = 0;
      let out = '';
      for (let i = 0; i < this.target.length; i++) {
        if (this.fixed[i]) {
          out += this.target[i];
        } else {
          out += letters[li] || '';
          li += 1;
        }
      }
      return out + letters.slice(li);
    }

    setValue(text) {
      this.input.value = String(text == null ? '' : text);
      this.sync();
    }

    submit() {
      if (this.locked) return;
      this.onSubmit(this.value);
    }

    focus() {
      try { this.input.focus(); } catch (e) { /* ignore */ }
    }

    blur() {
      try { this.input.blur(); } catch (e) { /* ignore */ }
    }

    isCorrect() {
      return normalizeSpelling(this.value) === this.targetNorm;
    }

    // 锁定输入并揭示答案对错（逐格标色 + 空缺处浅色补正确答案）
    lock(reveal = true) {
      this.locked = true;
      this.input.disabled = true;
      this.blur();
      if (reveal !== false) this.reveal();
    }

    reveal() {
      if (this.revealed) return;
      this.revealed = true;
      const target = this.target;
      const val = this.value;
      this.cellEls.forEach((cell, i) => {
        const want = target[i] || '';
        const got = val[i] || '';
        cell.classList.remove('cursor');
        if (cell.classList.contains('fixed')) {
          cell.classList.add('ok');
          return;
        }
        if (!want) {
          // 多输入出来的字母
          cell.classList.add('bad');
          return;
        }
        const same = got.toLowerCase() === want.toLowerCase() && !!got;
        cell.classList.toggle('ok', same);
        cell.classList.toggle('bad', !same);
        if (!got) {
          const ghost = cell.querySelector('.ghost');
          if (ghost) ghost.textContent = want;
        }
      });
    }
  }

  window.RuledGrid = RuledGrid;
  window.normalizeSpelling = normalizeSpelling;
  window.gridHint = gridHint;
})();
