// app.js — 核心控制器与 UI 协调层
(function () {
  'use strict';

  let allWords = [];
  let store = null;
  let srs = null;
  let exGen = null;
  let speech = window.speechManager;

  // 会话运行状态
  let currentSession = null;

  // DOM 元素引用
  const el = {};

  function $(id) { return document.getElementById(id); }

  function initElements() {
    el.boot = $('boot');
    el.bootMsg = $('boot-msg');
    el.app = $('app');
    el.tabbar = $('tabbar');

    // 顶栏
    el.chipLevel = $('chip-level');
    el.chipStreak = $('chip-streak');
    el.chipExam = $('chip-exam');
    el.btnSound = $('btn-sound');

    // 今日
    el.todayGreeting = $('today-greeting');
    el.todaySummary = $('today-summary');
    el.petBody = $('pet-body');
    el.petName = $('pet-name');
    el.ringFg = $('ring-fg');
    el.ringNum = $('ring-num');
    el.ringSub = $('ring-sub');
    el.sNew = $('s-new');
    el.sReview = $('s-review');
    el.sAcc = $('s-acc');
    el.sCovered = $('s-covered');
    el.btnStart = $('btn-start');
    el.todayHint = $('today-hint');
    el.quests = $('quests');
    el.bars = $('bars');

    // 学习
    el.screenStudy = $('screen-study');
    el.btnQuit = $('btn-quit');
    el.sessionBar = $('session-bar');
    el.sessionCombo = $('session-combo');
    el.sessionXp = $('session-xp');
    el.studyCard = $('study-card');
    el.kbdHint = $('kbd-hint');

    // 星球
    el.units = $('units');

    // 单词库
    el.search = $('search');
    el.filterTopic = $('filter-topic');
    el.filterState = $('filter-state');
    el.wordsCount = $('words-count');
    el.wordList = $('word-list');
    el.btnMore = $('btn-more');

    // 报告与设置
    el.reportStats = $('report-stats');
    el.hardWords = $('hard-words');
    el.setExam = $('set-exam');
    el.setLimit = $('set-limit');
    el.setSfx = $('set-sfx');
    el.setTts = $('set-tts');
    el.btnExport = $('btn-export');
    el.btnImport = $('btn-import');
    el.btnPrint = $('btn-print');
    el.btnReset = $('btn-reset');
    el.fileImport = $('file-import');

    // 全局
    el.toasts = $('toasts');
    el.overlay = $('overlay');
    el.fx = $('fx');
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toasts.appendChild(t);
    setTimeout(() => {
      t.remove();
    }, 2400);
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('active', b.dataset.go === name);
    });
    document.querySelectorAll('.screen').forEach(s => {
      if (s.dataset.screen === name) {
        s.removeAttribute('hidden');
      } else {
        s.setAttribute('hidden', '');
      }
    });

    if (name === 'today') renderToday();
    if (name === 'planets') renderPlanets();
    if (name === 'words') renderWordList();
    if (name === 'report') renderReport();
  }

  // ------------------------------------------------------------- 今日界面
  function renderToday() {
    const pacing = srs.getExamPacing();
    const today = window.todayStr();
    const log = store.getDailyLog(today);
    const dueWords = srs.getDueReviewWords(today);

    // 顶栏芯片
    const lvl = store.getLevelInfo();
    el.chipLevel.textContent = `Lv.${lvl.level} (${lvl.currentLevelXP}/${lvl.nextLevelXP} XP)`;
    el.chipStreak.textContent = `🔥 ${store.data.streak} 天`;
    el.chipExam.textContent = `距考试 ${pacing.daysLeft} 天`;

    // 宠物状态
    const petIcons = ['🚀', '🛸', '⭐', '🪐', '👑'];
    const petNames = ['探险火箭', '星际飞船', '闪烁星灵', '行星守护者', '银河霸主'];
    const petTier = Math.min(petIcons.length - 1, Math.floor(lvl.level / 5));
    el.petBody.textContent = petIcons[petTier];
    el.petBody.className = `pet-body lv${petTier + 1}`;
    el.petName.textContent = petNames[petTier];

    // 今日问候与汇总
    const hr = new Date().getHours();
    const greet = hr < 12 ? '早上好！' : hr < 18 ? '下午好！' : '晚上好！';
    el.todayGreeting.textContent = `${greet} 今天的探险开始啦`;

    const dailyTarget = pacing.targetNewPerDay + dueWords.length;
    const completedToday = (log.newCount || 0) + (log.reviewCount || 0);

    el.todaySummary.textContent = `目标学习 ${dailyTarget} 词（新词 ${pacing.targetNewPerDay} · 需复习 ${dueWords.length}）`;

    // 进度环
    el.ringNum.textContent = completedToday;
    el.ringSub.textContent = `/ ${dailyTarget}`;
    const circumference = 327; // 2 * PI * 52
    const pct = Math.min(1, completedToday / Math.max(1, dailyTarget));
    el.ringFg.style.strokeDashoffset = circumference - circumference * pct;

    // 四格统计
    el.sNew.textContent = log.newCount || 0;
    el.sReview.textContent = log.reviewCount || 0;
    const acc = log.totalCount ? Math.round((log.correctCount / log.totalCount) * 100) : null;
    el.sAcc.textContent = acc !== null ? `${acc}%` : '—';
    el.sCovered.textContent = `${pacing.coveredPct}%`;

    // 开始按钮
    if (completedToday >= dailyTarget && dailyTarget > 0) {
      el.btnStart.textContent = '今日目标已完成！继续刷词 ⚡';
    } else {
      el.btnStart.textContent = `开始探险（还有 ${Math.max(0, dailyTarget - completedToday)} 词）`;
    }
    el.todayHint.textContent = `目标在考试前学满 3 遍：已有 ${pacing.coveredCount} / ${pacing.totalWords} 词达标`;

    // 任务清单
    renderQuests(log, pacing, dueWords);

    // 14 天柱状图
    render14Days();
  }

  function renderQuests(log, pacing, dueWords) {
    const q1Done = (log.newCount || 0) >= pacing.targetNewPerDay;
    const q2Done = dueWords.length === 0;
    const q3Done = (log.totalCount || 0) >= 30;

    el.quests.innerHTML = `
      <li class="${q1Done ? 'done' : ''}">
        <span class="tick">${q1Done ? '✓' : '1'}</span>
        <span class="q-text">完成今日新词 (${log.newCount || 0} / ${pacing.targetNewPerDay})</span>
      </li>
      <li class="${q2Done ? 'done' : ''}">
        <span class="tick">${q2Done ? '✓' : '2'}</span>
        <span class="q-text">清空今日复习任务 (剩余 ${dueWords.length})</span>
      </li>
      <li class="${q3Done ? 'done' : ''}">
        <span class="tick">${q3Done ? '✓' : '3'}</span>
        <span class="q-text">今日答题达 30 题 (${log.totalCount || 0} / 30)</span>
      </li>
    `;
  }

  function render14Days() {
    const days = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${day}`);
    }

    const tStr = window.todayStr();
    let maxCount = 20;
    days.forEach(k => {
      const c = (store.data.dailyLogs[k]?.totalCount) || 0;
      if (c > maxCount) maxCount = c;
    });

    el.bars.innerHTML = days.map(dStr => {
      const c = (store.data.dailyLogs[dStr]?.totalCount) || 0;
      const h = Math.max(3, Math.round((c / maxCount) * 80));
      const isToday = dStr === tStr;
      const dayNum = dStr.slice(8);
      return `
        <div class="bar ${isToday ? 'today' : ''} ${c >= 20 ? 'goal' : ''}" style="height: ${h}px" title="${dStr}: ${c}题">
          ${c > 0 ? `<em>${c}</em>` : ''}
          <i>${dayNum}</i>
        </div>
      `;
    }).join('');
  }

  // ------------------------------------------------------------- 学习会话
  function startSession(customWords = null) {
    let wordQueue = [];

    if (customWords && customWords.length) {
      wordQueue = customWords.slice();
    } else {
      const due = srs.getDueReviewWords();
      const pacing = srs.getExamPacing();
      const news = srs.getCandidateNewWords(pacing.targetNewPerDay);

      wordQueue = [...due, ...news];
      if (wordQueue.length === 0) {
        wordQueue = allWords.slice(0, 15);
      }
    }

    currentSession = {
      queue: wordQueue,
      currentIndex: 0,
      total: wordQueue.length,
      correctInSession: 0,
      combo: 0,
      xpGained: 0,
      currentQuestion: null,
      answered: false
    };

    document.querySelectorAll('.screen').forEach(s => s.setAttribute('hidden', ''));
    el.screenStudy.removeAttribute('hidden');
    el.tabbar.setAttribute('hidden', '');

    loadNextQuestion();
  }

  function loadNextQuestion() {
    if (!currentSession) return;
    if (currentSession.currentIndex >= currentSession.queue.length) {
      showSessionSummary();
      return;
    }

    const word = currentSession.queue[currentSession.currentIndex];
    const rec = store.getWordRecord(word.id);
    const box = rec ? rec.box : 0;

    const q = exGen.createQuestion(word, box);
    currentSession.currentQuestion = q;
    currentSession.answered = false;

    const pct = ((currentSession.currentIndex) / currentSession.total) * 100;
    el.sessionBar.style.width = `${pct}%`;
    el.sessionCombo.textContent = `连对 ${currentSession.combo}`;
    el.sessionXp.textContent = `+${currentSession.xpGained} XP`;

    renderQuestionCard(q);

    if (q.autoSpeak) {
      speech.speak(q.autoSpeak);
    }
  }

  function renderQuestionCard(q) {
    let html = `<div class="q-label">${q.title}</div>`;

    if (q.type === 'choice_en_to_zh') {
      html += `
        <div class="q-prompt">
          <div class="q-word">${q.promptWord}</div>
          ${q.promptIpa ? `<div class="q-ipa">/${q.promptIpa}/</div>` : ''}
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
    } else if (q.type === 'choice_zh_to_en') {
      html += `
        <div class="q-prompt">
          <div class="q-zh">${q.promptZh}</div>
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
    } else if (q.type === 'listening') {
      html += `
        <div class="q-prompt">
          <button class="btn btn-ghost" id="btn-replay" style="font-size: 1.4rem; padding: 1rem 1.8rem;">
            🔊 点击重听
          </button>
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
    } else if (q.type === 'spelling') {
      const hint = q.targetWord.replace(/[a-zA-Z]/g, '_ ');
      html += `
        <div class="q-prompt">
          <div class="q-zh">${q.promptZh}</div>
          ${q.promptIpa ? `<div class="q-ipa">/${q.promptIpa}/</div>` : ''}
          ${q.promptPos ? `<div class="q-pos">${q.promptPos}</div>` : ''}
        </div>
        <div class="spell-hint" id="spell-hint">${hint}</div>
        <div class="answer-row">
          <input type="text" class="type-input" id="type-input" autofocus autocomplete="off" spellcheck="false" placeholder="输入拼写…">
          <button class="btn btn-primary" id="btn-submit-type">确认</button>
        </div>
      `;
    }

    html += `<div id="card-feedback"></div>`;
    el.studyCard.innerHTML = html;

    if (q.type.startsWith('choice') || q.type === 'listening') {
      el.studyCard.querySelectorAll('.opt').forEach(btn => {
        btn.addEventListener('click', () => handleChoiceAnswer(btn));
      });
      const replay = el.studyCard.querySelector('#btn-replay');
      if (replay) replay.addEventListener('click', () => speech.speak(q.word.word));
    } else if (q.type === 'spelling') {
      const input = el.studyCard.querySelector('#type-input');
      const submit = el.studyCard.querySelector('#btn-submit-type');
      submit.addEventListener('click', () => handleSpellingAnswer(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSpellingAnswer(input.value);
      });
      setTimeout(() => input.focus(), 80);
    }
  }

  function handleChoiceAnswer(chosenBtn) {
    if (currentSession.answered) return;
    currentSession.answered = true;

    const isCorrect = chosenBtn.dataset.correct === 'true';
    applyAnswerResult(isCorrect, chosenBtn);
  }

  function handleSpellingAnswer(val) {
    if (currentSession.answered) return;
    currentSession.answered = true;

    const input = el.studyCard.querySelector('#type-input');
    const target = currentSession.currentQuestion.targetWord;
    const isCorrect = val.trim().toLowerCase() === target;

    if (input) {
      input.disabled = true;
      input.classList.add(isCorrect ? 'correct' : 'wrong');
    }
    applyAnswerResult(isCorrect, null);
  }

  function applyAnswerResult(isCorrect, optBtn) {
    const q = currentSession.currentQuestion;
    const word = q.word;

    if (isCorrect) {
      currentSession.correctInSession += 1;
      currentSession.combo += 1;
      const xpEarned = 10 + Math.min(20, currentSession.combo * 2);
      currentSession.xpGained += xpEarned;

      speech.playCorrect();
      if (optBtn) optBtn.classList.add('correct');

      const { isNew } = srs.updateWordState(word.id, true, 4);
      store.recordAnswer({ wordId: word.id, isCorrect: true, isNew, xpEarned });

      showFeedback(true, word);
    } else {
      currentSession.combo = 0;
      speech.playWrong();

      if (optBtn) optBtn.classList.add('wrong');
      el.studyCard.querySelectorAll('.opt').forEach(b => {
        if (b.dataset.correct === 'true') b.classList.add('correct');
        else b.classList.add('dim');
      });

      const { isNew } = srs.updateWordState(word.id, false, 1);
      store.recordAnswer({ wordId: word.id, isCorrect: false, isNew, xpEarned: 2 });

      currentSession.queue.push(word);
      currentSession.total += 1;

      showFeedback(false, word);
    }
  }

  function showFeedback(isCorrect, word) {
    const fb = el.studyCard.querySelector('#card-feedback');
    if (!fb) return;

    fb.className = `feedback ${isCorrect ? 'ok' : 'no'}`;
    fb.innerHTML = `
      <div class="fb-text">
        <b>${isCorrect ? '🎉 太棒了！回答正确' : '💪 记一下：' + word.word}</b>
        <div class="fb-sub">${word.zh} · /${word.ipa || ''}/</div>
      </div>
      <button class="btn btn-primary" id="btn-next">下一步 (Enter)</button>
    `;

    const nextBtn = fb.querySelector('#btn-next');
    nextBtn.focus();
    nextBtn.addEventListener('click', advanceToNext);
  }

  function advanceToNext() {
    if (!currentSession) return;
    currentSession.currentIndex += 1;
    loadNextQuestion();
  }

  function showSessionSummary() {
    speech.playFanfare();
    const correct = currentSession.correctInSession;
    const total = currentSession.total;
    const acc = total ? Math.round((correct / total) * 100) : 100;

    let star = '⭐⭐⭐';
    if (acc < 70) star = '⭐';
    else if (acc < 90) star = '⭐⭐';

    el.studyCard.innerHTML = `
      <div class="results">
        <div class="big">🚀</div>
        <div class="stars">${star}</div>
        <h2>太棒了！探险完成</h2>
        <div class="row">
          <div><b>${correct}</b><span>答对题数</span></div>
          <div><b>${acc}%</b><span>正确率</span></div>
          <div><b>+${currentSession.xpGained}</b><span>获得 XP</span></div>
        </div>
        <button class="btn btn-primary btn-xl" id="btn-finish-session">返回星球基地</button>
      </div>
    `;

    el.studyCard.querySelector('#btn-finish-session').addEventListener('click', exitSession);
  }

  function exitSession() {
    currentSession = null;
    el.screenStudy.setAttribute('hidden', '');
    el.tabbar.removeAttribute('hidden');
    switchTab('today');
  }

  // ------------------------------------------------------------- 星球图
  function renderPlanets() {
    const stats = srs.getTopicStats();
    const planetIcons = ['🪐', '🌍', '🌕', '☀️', '⭐', '☄️', '🌌', '🚀', '🛰️', '🛸'];

    el.units.innerHTML = stats.map((s, idx) => {
      const pct = Math.round((s.covered / (s.total || 1)) * 100);
      const isDone = s.covered === s.total;
      const icon = planetIcons[idx % planetIcons.length];
      return `
        <div class="unit ${isDone ? 'done' : ''}" data-topic="${s.topic}">
          <div class="planet">${icon}</div>
          <div class="u-name">${s.topic}</div>
          <div class="u-bar"><i style="width: ${pct}%"></i></div>
          <div class="u-meta">
            <span>3遍覆盖 ${s.covered}/${s.total}</span>
            <span>${pct}%</span>
          </div>
        </div>
      `;
    }).join('');

    el.units.querySelectorAll('.unit').forEach(u => {
      u.addEventListener('click', () => {
        const topic = u.dataset.topic;
        const topicWords = allWords.filter(w => (w.topics || []).includes(topic));
        startSession(topicWords);
      });
    });
  }

  // ------------------------------------------------------------- 单词库
  let wordListLimit = 50;

  function renderWordList(resetLimit = true) {
    if (resetLimit) wordListLimit = 50;

    if (!el.filterTopic.options.length) {
      const topics = new Set();
      allWords.forEach(w => (w.topics || []).forEach(t => topics.add(t)));
      el.filterTopic.innerHTML = `<option value="">全部主题</option>` +
        Array.from(topics).sort().map(t => `<option value="${t}">${t}</option>`).join('');
    }

    const query = (el.search.value || '').trim().toLowerCase();
    const topic = el.filterTopic.value;
    const stateFilter = el.filterState.value;

    const filtered = allWords.filter(w => {
      if (query) {
        const matchEn = w.word.toLowerCase().includes(query);
        const matchZh = (w.zh || '').includes(query);
        if (!matchEn && !matchZh) return false;
      }
      if (topic && !(w.topics || []).includes(topic)) return false;

      const rec = store.getWordRecord(w.id);
      if (stateFilter === 'new') {
        if (rec && rec.reps > 0) return false;
      } else if (stateFilter === 'learning') {
        if (!rec || rec.reps === 0 || rec.reps >= 3) return false;
      } else if (stateFilter === 'covered') {
        if (!rec || rec.reps < 3) return false;
      } else if (stateFilter === 'mastered') {
        if (!rec || rec.box < 4) return false;
      } else if (stateFilter === 'wrong') {
        if (!store.data.wrongWords || !store.data.wrongWords[w.id]) return false;
      }
      return true;
    });

    el.wordsCount.textContent = `共找到 ${filtered.length} 个单词（已显示前 ${Math.min(wordListLimit, filtered.length)} 个）`;

    const visible = filtered.slice(0, wordListLimit);
    el.wordList.innerHTML = visible.map(w => {
      const rec = store.getWordRecord(w.id);
      let stateTag = '未学';
      let stateClass = 's0';
      if (rec && rec.reps > 0) {
        if (rec.reps >= 3) {
          stateTag = `已学${rec.reps}遍 · Box${rec.box}`;
          stateClass = 's3';
        } else {
          stateTag = `已学${rec.reps}遍`;
          stateClass = 's1';
        }
      }
      return `
        <div class="word-row" data-id="${w.id}">
          <button class="icon-btn btn-speak" data-word="${w.word}" title="发音">🔊</button>
          <div class="w-main">
            <div class="w-en">${w.word} <span class="w-pos">${w.pos || ''}</span></div>
            <div class="w-zh">${w.zh}</div>
          </div>
          <span class="w-state ${stateClass}">${stateTag}</span>
        </div>
      `;
    }).join('');

    el.btnMore.hidden = visible.length >= filtered.length;

    el.wordList.querySelectorAll('.btn-speak').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speech.speak(btn.dataset.word);
      });
    });

    el.wordList.querySelectorAll('.word-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const w = allWords.find(x => x.id === id);
        if (w) showWordModal(w);
      });
    });
  }

  function showWordModal(w) {
    const rec = store.getWordRecord(w.id);
    el.overlay.innerHTML = `
      <div class="modal">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0">${w.word}</h2>
          <button class="icon-btn" id="modal-close">✕</button>
        </div>
        <p class="muted">${w.pos || ''} · /${w.ipa || ''}/</p>
        <p style="font-size:1.2rem; margin: .8rem 0;">${w.zh}</p>
        ${w.example ? `<p class="q-example" style="margin:.8rem 0;">${w.example}</p>` : ''}
        <div style="margin-top:1rem; font-size:.85rem; color:var(--muted);">
          主题：${(w.topics || []).join(', ') || '通用'}<br>
          学习次数：${rec ? rec.reps : 0} 次 · 错题：${rec ? rec.lapses : 0} 次 · 当前 Box：${rec ? rec.box : 0}
        </div>
        <div class="btn-row" style="margin-top:1.2rem;">
          <button class="btn btn-primary" id="modal-speak">🔊 朗读</button>
          <button class="btn btn-ghost" id="modal-practice">单挑练习这个词</button>
        </div>
      </div>
    `;
    el.overlay.removeAttribute('hidden');

    el.overlay.querySelector('#modal-close').addEventListener('click', () => el.overlay.setAttribute('hidden', ''));
    el.overlay.querySelector('#modal-speak').addEventListener('click', () => speech.speak(w.word));
    el.overlay.querySelector('#modal-practice').addEventListener('click', () => {
      el.overlay.setAttribute('hidden', '');
      startSession([w]);
    });
  }

  // ------------------------------------------------------------- 报告与设置
  function renderReport() {
    const pacing = srs.getExamPacing();
    const wrong = srs.getWrongWords();

    el.reportStats.innerHTML = `
      <div class="stat"><b>${pacing.coveredCount}</b><span>已完成3遍</span></div>
      <div class="stat"><b>${pacing.underCovered}</b><span>待满3遍</span></div>
      <div class="stat"><b>${wrong.length}</b><span>当前错词</span></div>
      <div class="stat"><b>${store.data.xp}</b><span>累计 XP</span></div>
    `;

    if (wrong.length === 0) {
      el.hardWords.innerHTML = `<p class="muted">太棒了！错词本空空如也 🎯</p>`;
    } else {
      el.hardWords.innerHTML = wrong.slice(0, 15).map(w => `
        <div class="word-row" data-id="${w.id}">
          <div class="w-main">
            <div class="w-en">${w.word}</div>
            <div class="w-zh">${w.zh}</div>
          </div>
          <button class="btn btn-ghost small" style="padding:.3rem .6rem;" data-practice="${w.id}">练练</button>
        </div>
      `).join('');

      el.hardWords.querySelectorAll('[data-practice]').forEach(b => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const w = allWords.find(x => x.id === b.dataset.practice);
          if (w) startSession([w]);
        });
      });
    }

    el.setExam.value = store.data.examDate || '2026-12-19';
    el.setLimit.value = store.data.dailyLimit || 0;
    el.setSfx.checked = store.data.soundEnabled !== false;
    el.setTts.checked = store.data.ttsEnabled !== false;
  }

  // ------------------------------------------------------------- 全局事件绑定
  function bindGlobalEvents() {
    el.tabbar.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.go));
    });

    el.btnSound.addEventListener('click', () => {
      store.data.soundEnabled = !store.data.soundEnabled;
      speech.soundEnabled = store.data.soundEnabled;
      el.btnSound.textContent = speech.soundEnabled ? '🔊' : '🔇';
      store.save();
      showToast(speech.soundEnabled ? '音效已开启' : '音效已静音');
    });

    el.btnStart.addEventListener('click', () => startSession());

    el.btnQuit.addEventListener('click', () => {
      if (confirm('确定要暂停这次练习吗？已答进度已自动保存。')) {
        exitSession();
      }
    });

    el.search.addEventListener('input', () => renderWordList(true));
    el.filterTopic.addEventListener('change', () => renderWordList(true));
    el.filterState.addEventListener('change', () => renderWordList(true));
    el.btnMore.addEventListener('click', () => {
      wordListLimit += 50;
      renderWordList(false);
    });

    el.setExam.addEventListener('change', () => {
      store.data.examDate = el.setExam.value;
      store.save();
      showToast('考试日期已保存');
    });
    el.setLimit.addEventListener('change', () => {
      store.data.dailyLimit = parseInt(el.setLimit.value, 10) || 0;
      store.save();
      showToast('每日限额已更新');
    });
    el.setSfx.addEventListener('change', () => {
      store.data.soundEnabled = el.setSfx.checked;
      speech.soundEnabled = el.setSfx.checked;
      el.btnSound.textContent = speech.soundEnabled ? '🔊' : '🔇';
      store.save();
    });
    el.setTts.addEventListener('change', () => {
      store.data.ttsEnabled = el.setTts.checked;
      speech.ttsEnabled = el.setTts.checked;
      store.save();
    });

    el.btnExport.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(store.exportJSON());
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = `ket-planet-progress-${window.todayStr()}.json`;
      a.click();
    });

    el.btnImport.addEventListener('click', () => el.fileImport.click());
    el.fileImport.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          store.importJSON(evt.target.result);
          showToast('进度导入成功！🎉');
          renderToday();
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      reader.readAsText(file);
    });

    el.btnPrint.addEventListener('click', () => {
      const wrong = srs.getWrongWords();
      if (!wrong.length) {
        alert('当前没有错词需要打印！');
        return;
      }
      const printWin = window.open('', '_blank');
      printWin.document.write(`
        <html><head><title>KET 错词本 - 打印</title>
        <style>body { font-family: sans-serif; padding: 20px; } table { width:100%; border-collapse:collapse; } th, td { border:1px solid #ccc; padding:8px; text-align:left; }</style>
        </head><body>
        <h2>KET 错词专项默写本 (${wrong.length} 词)</h2>
        <table><tr><th>#</th><th>英文</th><th>音标/词性</th><th>中文释义</th><th>默写核对</th></tr>
        ${wrong.map((w, idx) => '<tr><td>' + (idx+1) + '</td><td><b>' + w.word + '</b></td><td>/' + (w.ipa || '') + '/ ' + (w.pos || '') + '</td><td>' + w.zh + '</td><td></td></tr>').join('')}
        </table>
        <script>window.print();</script>
        </body></html>
      `);
      printWin.document.close();
    });

    el.btnReset.addEventListener('click', () => {
      if (confirm('确定要清空所有学习记录吗？此操作无法撤销！')) {
        store.reset();
        showToast('进度已重置');
        renderToday();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!currentSession || el.screenStudy.hasAttribute('hidden')) return;

      const fb = el.studyCard.querySelector('#card-feedback');
      if (fb && e.key === 'Enter') {
        e.preventDefault();
        advanceToNext();
        return;
      }

      if (['1', '2', '3', '4'].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const opts = el.studyCard.querySelectorAll('.opt');
        if (opts[idx] && !currentSession.answered) {
          opts[idx].click();
        }
      }
    });
  }

  // ------------------------------------------------------------- 启动流程
  function boot() {
    initElements();

    // 兼容对象结构 { meta: {...}, words: [...] } 或直接数组
    let raw = window.KET_WORDS;
    if (raw && Array.isArray(raw.words)) {
      raw = raw.words;
    }

    if (!Array.isArray(raw) || !raw.length) {
      el.bootMsg.textContent = '错误：未能加载 data/words.js 数据集。';
      return;
    }

    allWords = raw;
    store = new window.Store();
    srs = new window.SRSEngine(store, allWords);
    exGen = new window.ExerciseGenerator(allWords);

    speech.soundEnabled = store.data.soundEnabled !== false;
    speech.ttsEnabled = store.data.ttsEnabled !== false;
    el.btnSound.textContent = speech.soundEnabled ? '🔊' : '🔇';

    bindGlobalEvents();

    setTimeout(() => {
      el.boot.setAttribute('hidden', '');
      el.app.removeAttribute('hidden');
      switchTab('today');
    }, 400);
  }

  window.addEventListener('DOMContentLoaded', boot);






})();
