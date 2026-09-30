// app.js — 核心控制器与 UI 协调层
(function () {
  'use strict';

  let allWords = [];
  let store = null;
  let srs = null;
  let exGen = null;
  let speech = window.speechManager;
  let wordbookGate = null;

  // 会话运行状态
  let currentSession = null;
  let currentTab = 'today';

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
    el.practiceWbNum = $('practice-wb-num');
    el.practiceTopic = $('practice-topic');
    el.btnPracticeDictation = $('btn-practice-dictation');
    el.btnPracticeDefinition = $('btn-practice-definition');
    el.btnPracticeWordbook = $('btn-practice-wordbook');

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

    // 单词本
    el.wbList = $('wb-list');
    el.wbCount = $('wb-count');
    el.wbMeta = $('wb-meta');
    el.wbHint = $('wb-hint');
    el.btnWbGate = $('btn-wb-gate');
    el.btnWbPractice = $('btn-wb-practice');
    el.btnWbPrint = $('btn-wb-print');
    el.btnWbClear = $('btn-wb-clear');
    el.tabWbBadge = $('tab-wb-badge');

    // 报告与设置
    el.reportStats = $('report-stats');
    el.hardWords = $('hard-words');
    el.setExam = $('set-exam');
    el.setLimit = $('set-limit');
    el.setSfx = $('set-sfx');
    el.setTts = $('set-tts');
    el.setGate = $('set-gate');
    el.btnExport = $('btn-export');
    el.btnImport = $('btn-import');
    el.btnPrint = $('btn-print');
    el.btnPrintWb = $('btn-print-wb');
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
    currentTab = name;
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
    if (name === 'wordbook') renderWordbook();
    if (name === 'report') renderReport();
  }

  // 更新单词本角标
  function updateWordbookBadge() {
    const n = store.wordbookCount();
    if (el.tabWbBadge) {
      el.tabWbBadge.textContent = n > 99 ? '99+' : String(n);
      if (n > 0) el.tabWbBadge.removeAttribute('hidden');
      else el.tabWbBadge.setAttribute('hidden', '');
    }
    if (el.practiceWbNum) el.practiceWbNum.textContent = `(${n})`;
  }

  // 把单词加入 / 移出单词本，并同步所有 ⭐ 按钮的状态
  function toggleWordbookWord(id, source) {
    const added = store.toggleWordbook(id, source || 'manual');
    updateWordbookBadge();
    // 同步页面上所有该词的星标按钮
    document.querySelectorAll(`[data-star="${id}"]`).forEach(b => {
      b.classList.toggle('on', added);
      const ico = b.querySelector('.star-ico');
      const lbl = b.querySelector('.star-lbl');
      if (ico) ico.textContent = added ? '⭐' : '☆';
      else if (!lbl) b.textContent = added ? '⭐' : '☆';
      if (lbl) lbl.textContent = added ? '已在单词本' : '收进单词本';
      b.title = added ? '已收藏到单词本' : '加入单词本';
    });
    showToast(added ? `已加入单词本 ⭐（共 ${store.wordbookCount()} 词）` : '已从单词本移出');
    if (currentTab === 'wordbook') renderWordbook();
    return added;
  }

  // ------------------------------------------------------------- 今日界面
  function renderToday() {
    updateWordbookBadge();
    const pacing = srs.getExamPacing();
    const plan = srs.getRoundPlan();
    const today = window.todayStr();
    const log = store.getDailyLog(today);

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

    const allDone = plan.round > window.SRSEngine.ROUNDS;
    const dailyTarget = plan.dailyTarget;
    const completedToday = plan.doneToday;

    if (allDone) {
      el.todaySummary.textContent = '3 轮全部完成！考前冲刺：刷错词和单词本 🏁';
    } else {
      el.todaySummary.textContent =
        `第 ${plan.round} 轮 · ${plan.name}（${shortDate(plan.deadline)} 前过完）：今天过 ${dailyTarget} 词` +
        (plan.behind ? ' · ⚠️ 进度落后，已自动加量' : '');
    }

    // 进度环：今天过了几个词
    el.ringNum.textContent = completedToday;
    el.ringSub.textContent = `/ ${dailyTarget}`;
    const circumference = 327; // 2 * PI * 52
    const pct = allDone ? 1 : Math.min(1, completedToday / Math.max(1, dailyTarget));
    el.ringFg.style.strokeDashoffset = circumference - circumference * pct;

    // 四格统计
    el.sNew.textContent = completedToday;
    el.sReview.textContent = plan.remaining;
    const acc = log.totalCount ? Math.round((log.correctCount / log.totalCount) * 100) : null;
    el.sAcc.textContent = acc !== null ? `${acc}%` : '—';
    el.sCovered.textContent = `${pacing.coveredPct}%`;

    // 开始按钮
    if (allDone) {
      el.btnStart.textContent = '冲刺错词 ⚡';
    } else if (completedToday >= dailyTarget && dailyTarget > 0) {
      el.btnStart.textContent = '今日目标已完成！再过一组 ⚡';
    } else {
      el.btnStart.textContent = `开始第 ${plan.round} 轮（今天还差 ${Math.max(0, dailyTarget - completedToday)} 词）`;
    }
    el.todayHint.textContent = plan.schedule
      .map((s, i) => `第${s.round}轮 ${plan.passedPerRound[i]}/${plan.total}`)
      .join(' · ');

    renderPracticeTopics();

    // 任务清单
    renderQuests(log, plan);

    // 14 天柱状图
    render14Days();
  }

  function shortDate(dateStr) {
    return dateStr ? `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8))}` : '';
  }

  // 今日页的主题下拉框：第一项保留原来的「今日词」行为
  function renderPracticeTopics() {
    if (!el.practiceTopic) return;
    const current = el.practiceTopic.value;
    const stats = srs.getTopicStats().sort((a, b) => b.total - a.total);
    el.practiceTopic.innerHTML = `<option value="">今日词（不限主题）</option>` +
      stats.map(s => `<option value="${s.topic}">${s.label}（${s.total}）</option>`).join('');
    el.practiceTopic.value = current;
  }

  function renderQuests(log, plan) {
    const allDone = plan.round > window.SRSEngine.ROUNDS;
    const q1Done = allDone || plan.doneToday >= plan.dailyTarget;
    const q2Done = allDone || plan.remaining === 0;
    const q3Done = (log.totalCount || 0) >= 30;
    const roundText = allDone
      ? '3 轮全部过完 🎉'
      : `第 ${plan.round} 轮还剩 ${plan.remaining} 词（${shortDate(plan.deadline)} 截止）`;

    el.quests.innerHTML = `
      <li class="${q1Done ? 'done' : ''}">
        <span class="tick">${q1Done ? '✓' : '1'}</span>
        <span class="q-text">今天过词 (${plan.doneToday} / ${plan.dailyTarget})</span>
      </li>
      <li class="${q2Done ? 'done' : ''}">
        <span class="tick">${q2Done ? '✓' : '2'}</span>
        <span class="q-text">${roundText}</span>
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
  const ROUND_BATCH = 15; // 每组过 15 个词，一组做完能喘口气

  function startSession(customWords = null, mode = 'auto') {
    let wordQueue = [];
    let round = 0;

    if (customWords && customWords.length) {
      wordQueue = customWords.slice();
    } else {
      const plan = srs.getRoundPlan();
      if (plan.round <= window.SRSEngine.ROUNDS) {
        // 3 轮过词：取本轮还没过的词
        round = plan.round;
        mode = 'round';
        const left = plan.dailyTarget - plan.doneToday;
        wordQueue = srs.getRoundQueue(round, left > 0 ? Math.min(ROUND_BATCH, left) : ROUND_BATCH);
      } else {
        // 3 轮都过完：冲刺错词 + 到期复习
        const seen = {};
        wordQueue = [...srs.getWrongWords(), ...srs.getDueReviewWords()]
          .filter(w => !seen[w.id] && (seen[w.id] = true))
          .slice(0, ROUND_BATCH * 2);
      }
      if (wordQueue.length === 0) {
        wordQueue = allWords.slice(0, ROUND_BATCH);
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
      answered: false,
      mode: mode,
      round: round,
      passedInSession: 0,
      grid: null
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

    const q = currentSession.mode === 'round'
      ? exGen.createRoundQuestion(word, currentSession.round)
      : exGen.createQuestion(word, box, currentSession.mode || 'auto');
    currentSession.currentQuestion = q;
    currentSession.answered = false;
    currentSession.grid = null;

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
    } else if (q.gridMode) {
      let prompt = '';
      if (q.type === 'dictation') {
        prompt = `
          <div class="q-prompt">
            <button class="btn btn-ghost" id="btn-replay">🔊 听发音</button>
            <div class="q-pos">🎧 听发音，在五线格里拼出这个单词</div>
          </div>
        `;
      } else {
        prompt = `
          <div class="q-prompt">
            <div class="q-zh">${q.promptZh || ''}</div>
            ${q.promptPos ? `<div class="q-pos">${q.promptPos}</div>` : ''}
            ${q.type === 'spelling' && q.promptIpa ? `<div class="q-ipa">/${q.promptIpa}/</div>` : ''}
            ${q.example ? `<div class="q-sentence">${q.example}</div>` : ''}
          </div>
        `;
      }
      html += `${prompt}
        <div class="grid-hint">${window.gridHint(q.targetWord)}</div>
        <div id="grid-mount"></div>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn btn-primary btn-xl" id="btn-submit-type">确认（Enter）</button>
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
    } else if (q.gridMode) {
      const mount = el.studyCard.querySelector('#grid-mount');
      const grid = new window.RuledGrid({
        mount: mount,
        target: q.targetWord,
        onSubmit: (val) => handleSpellingAnswer(val)
      });
      currentSession.grid = grid;
      const submit = el.studyCard.querySelector('#btn-submit-type');
      if (submit) submit.addEventListener('click', () => grid.submit());
      const replay = el.studyCard.querySelector('#btn-replay');
      if (replay) replay.addEventListener('click', () => speech.speak(q.word.word));
      setTimeout(() => grid.focus(), 120);
    }
  }

  function handleChoiceAnswer(chosenBtn) {
    if (currentSession.answered) return;
    currentSession.answered = true;

    const isCorrect = chosenBtn.dataset.correct === 'true';
    applyAnswerResult(isCorrect, chosenBtn);
  }

  function handleSpellingAnswer(val) {
    if (!currentSession || currentSession.answered) return;
    currentSession.answered = true;

    const q = currentSession.currentQuestion;
    const isCorrect = window.normalizeSpelling(val) === window.normalizeSpelling(q.targetWord);

    if (currentSession.grid) currentSession.grid.lock(true);
    const submit = el.studyCard.querySelector('#btn-submit-type');
    if (submit) submit.disabled = true;

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
      if (srs.recordPass(word.id, window.ExerciseGenerator.levelOf(q.type))) {
        currentSession.passedInSession += 1;
      }

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

    const inWb = store.isInWordbook(word.id);
    const sentence = exGen.buildHighlightedExample(word);
    fb.className = `feedback ${isCorrect ? 'ok' : 'no'}`;
    fb.innerHTML = `
      <div class="fb-text">
        <b>${isCorrect ? '🎉 太棒了！回答正确' : '💪 记一下：' + word.word}</b>
        <div class="fb-sub">${word.zh} · /${word.ipa || ''}/</div>
        ${sentence ? `<div class="fb-sent">${sentence}</div>` : ''}
      </div>
      <div class="fb-actions">
        <button class="btn btn-ghost small star-btn ${inWb ? 'on' : ''}" id="fb-star" data-star="${word.id}">
          <span class="star-ico">${inWb ? '⭐' : '☆'}</span> <span class="star-lbl">${inWb ? '已在单词本' : '收进单词本'}</span>
        </button>
        <button class="btn btn-primary" id="btn-next">下一步 (Enter)</button>
      </div>
    `;

    const star = fb.querySelector('#fb-star');
    if (star) {
      star.addEventListener('click', () => toggleWordbookWord(word.id, 'feedback'));
    }

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

    // 3 轮过词：还有没过的词就给「再来一组」
    const isRound = currentSession.mode === 'round';
    const plan = isRound ? srs.getRoundPlan() : null;
    const canContinue = isRound && plan.round <= window.SRSEngine.ROUNDS && plan.remaining > 0;
    const roundLine = isRound
      ? `<p class="muted">这组过了 ${currentSession.passedInSession} 个词 · 今天 ${plan.doneToday} / ${plan.dailyTarget}${plan.round <= window.SRSEngine.ROUNDS ? ` · 第 ${plan.round} 轮还剩 ${plan.remaining} 词` : ' · 3 轮全部过完！'}</p>`
      : '';

    el.studyCard.innerHTML = `
      <div class="results">
        <div class="big">🚀</div>
        <div class="stars">${star}</div>
        <h2>太棒了！探险完成</h2>
        ${roundLine}
        <div class="row">
          <div><b>${correct}</b><span>答对题数</span></div>
          <div><b>${acc}%</b><span>正确率</span></div>
          <div><b>+${currentSession.xpGained}</b><span>获得 XP</span></div>
        </div>
        <div class="btn-row" style="justify-content:center;">
          ${canContinue ? '<button class="btn btn-primary btn-xl" id="btn-next-batch">再来一组 ⚡</button>' : ''}
          <button class="btn ${canContinue ? 'btn-ghost' : 'btn-primary btn-xl'}" id="btn-finish-session">返回星球基地</button>
        </div>
      </div>
    `;

    el.studyCard.querySelector('#btn-finish-session').addEventListener('click', exitSession);
    const nextBatch = el.studyCard.querySelector('#btn-next-batch');
    if (nextBatch) nextBatch.addEventListener('click', () => startSession());
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
          <div class="u-name">${s.label}</div>
          <div class="u-bar"><i style="width: ${pct}%"></i></div>
          <div class="u-meta">
            <span>3 轮完成 ${s.covered}/${s.total}</span>
            <span>${pct}%</span>
          </div>
        </div>
      `;
    }).join('');

    el.units.querySelectorAll('.unit').forEach(u => {
      u.addEventListener('click', () => {
        startSession(srs.wordsForTopic(u.dataset.topic));
      });
    });
  }

  // ------------------------------------------------------------- 单词库
  // 单词库一次列出全部单词，每行直接带例句
  function renderWordList() {
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
      const passes = window.SRSEngine.passesOf(rec);
      if (stateFilter === 'new') {
        if (rec && rec.reps > 0) return false;
      } else if (stateFilter === 'learning') {
        if (!rec || rec.reps === 0 || passes >= 3) return false;
      } else if (stateFilter === 'covered') {
        if (passes < 3) return false;
      } else if (stateFilter === 'mastered') {
        if (!rec || rec.box < 4) return false;
      } else if (stateFilter === 'wrong') {
        if (!store.data.wrongWords || !store.data.wrongWords[w.id]) return false;
      }
      return true;
    });

    el.wordsCount.textContent = `共找到 ${filtered.length} 个单词`;

    el.wordList.innerHTML = filtered.map(w => {
      const rec = store.getWordRecord(w.id);
      let stateTag = '未学';
      let stateClass = 's0';
      if (rec && rec.reps > 0) {
        const passes = window.SRSEngine.passesOf(rec);
        if (passes >= 3) {
          stateTag = `3 轮完成 · Box${rec.box}`;
          stateClass = 's3';
        } else {
          stateTag = passes ? `已过 ${passes} 轮` : '学习中';
          stateClass = 's1';
        }
      }
      const inWb = store.isInWordbook(w.id);
      const sentence = exGen.buildHighlightedExample(w);
      return `
        <div class="word-row" data-id="${w.id}">
          <button class="icon-btn btn-speak" data-word="${w.word}" title="发音">🔊</button>
          <div class="w-main">
            <div class="w-en">${w.word} <span class="w-pos">${w.pos || ''}</span></div>
            <div class="w-zh">${w.zh}</div>
            ${sentence ? `<div class="w-sent">${sentence}</div>` : ''}
          </div>
          <span class="w-state ${stateClass}">${stateTag}</span>
          <button class="icon-btn star-btn ${inWb ? 'on' : ''}" data-star="${w.id}" title="${inWb ? '已收藏到单词本' : '加入单词本'}">${inWb ? '⭐' : '☆'}</button>
        </div>
      `;
    }).join('');
  }

  function showWordModal(w) {
    const rec = store.getWordRecord(w.id);
    const inWb = store.isInWordbook(w.id);
    el.overlay.innerHTML = `
      <div class="modal">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0">${w.word}</h2>
          <button class="icon-btn" id="modal-close">✕</button>
        </div>
        <p class="muted">${w.pos || ''} · /${w.ipa || ''}/</p>
        <p style="font-size:1.2rem; margin: .8rem 0;">${w.zh}</p>
        ${w.sent ? `<p class="q-example" style="margin:.8rem 0;">${exGen.buildHighlightedExample(w) || w.sent}</p>` : ''}
        <div style="margin-top:1rem; font-size:.85rem; color:var(--muted);">
          主题：${(w.topics || []).join(', ') || '未分类'}<br>
          已过 ${window.SRSEngine.passesOf(rec)} / 3 轮 · 学习次数：${rec ? rec.reps : 0} 次 · 错题：${rec ? rec.lapses : 0} 次 · 当前 Box：${rec ? rec.box : 0}
        </div>
        <div class="btn-row" style="margin-top:1.2rem;">
          <button class="btn btn-primary" id="modal-speak">🔊 朗读</button>
          <button class="btn btn-ghost" id="modal-dictation">✍️ 听写这个词</button>
          <button class="btn btn-ghost" id="modal-practice">单挑练习这个词</button>
          <button class="btn btn-ghost star-btn ${inWb ? 'on' : ''}" id="modal-star" data-star="${w.id}">
            <span class="star-ico">${inWb ? '⭐' : '☆'}</span> <span class="star-lbl">${inWb ? '已在单词本' : '收进单词本'}</span>
          </button>
        </div>
      </div>
    `;
    el.overlay.removeAttribute('hidden');

    el.overlay.querySelector('#modal-close').addEventListener('click', () => el.overlay.setAttribute('hidden', ''));
    el.overlay.querySelector('#modal-speak').addEventListener('click', () => speech.speak(w.word));
    el.overlay.querySelector('#modal-star').addEventListener('click', () => toggleWordbookWord(w.id, 'modal'));
    el.overlay.querySelector('#modal-dictation').addEventListener('click', () => {
      el.overlay.setAttribute('hidden', '');
      startSession([w], 'dictation');
    });
    el.overlay.querySelector('#modal-practice').addEventListener('click', () => {
      el.overlay.setAttribute('hidden', '');
      startSession([w]);
    });
  }

  // ------------------------------------------------------------- ⭐ 单词本
  function renderWordbook() {
    updateWordbookBadge();

    const entries = store.getWordbookEntries();
    const words = entries.map(e => allWords.find(w => w.id === e.id)).filter(Boolean);
    const today = window.todayStr();
    const passedToday = entries.filter(e => e.entry.lastPassed === today).length;

    el.wbCount.textContent = `${words.length} 词`;
    el.wbHint.textContent = words.length
      ? `今天已过关 ${passedToday} 个 · 下次打开网页会自动弹出闯关`
      : '';
    el.btnWbGate.disabled = words.length === 0;
    el.btnWbPractice.disabled = words.length === 0;
    el.btnWbPrint.disabled = words.length === 0;
    el.btnWbClear.disabled = words.length === 0;

    if (!words.length) {
      el.wbList.innerHTML = `<p class="muted">单词本还是空的。在「单词库」或答题反馈里点 ☆，把不熟的词收进来吧！</p>`;
      return;
    }

    el.wbList.innerHTML = words.map(w => {
      const e = store.getWordbookEntry(w.id);
      const done = e && e.lastPassed === today;
      return `
        <div class="word-row" data-id="${w.id}">
          <button class="icon-btn btn-speak" data-word="${w.word}" title="发音">🔊</button>
          <div class="w-main">
            <div class="w-en">${w.word} <span class="w-pos">${w.pos || ''}</span></div>
            <div class="w-zh">${w.zh}</div>
          </div>
          <span class="w-state ${done ? 's3' : 's1'}">${done ? '今日已过关' : '待过关'}</span>
          <button class="icon-btn star-btn on" data-star="${w.id}" title="移出单词本">⭐</button>
        </div>
      `;
    }).join('');

    el.wbList.querySelectorAll('.btn-speak').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        speech.speak(btn.dataset.word);
      });
    });

    el.wbList.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleWordbookWord(btn.dataset.star, 'wordbook');
      });
    });

    el.wbList.querySelectorAll('.word-row').forEach(row => {
      row.addEventListener('click', () => {
        const w = allWords.find(x => x.id === row.dataset.id);
        if (w) showWordModal(w);
      });
    });
  }

  // 专项练习：只用某一类题型刷今天的词；听写可按主题出题
  function practiceMode(mode, limit = 15) {
    const topic = mode === 'dictation' && el.practiceTopic ? el.practiceTopic.value : '';
    if (topic) {
      const queue = srs.getTopicPracticeQueue(topic, limit);
      const opt = el.practiceTopic.selectedOptions[0];
      const name = opt ? opt.textContent.replace(/（\d+）$/, '') : topic;
      if (!queue.length) {
        showToast('这个主题里还没有单词哦');
        return;
      }
      showToast(`✍️ 听音拼写 · ${name}，共 ${queue.length} 词`);
      startSession(queue, mode);
      return;
    }
    const due = srs.getDueReviewWords();
    const news = srs.getCandidateNewWords(limit);
    let queue = [];
    const seen = {};
    [...due, ...news].forEach(w => {
      if (queue.length >= limit) return;
      if (seen[w.id]) return;
      seen[w.id] = true;
      queue.push(w);
    });
    if (!queue.length) queue = allWords.slice(0, limit);
    const label = mode === 'dictation' ? '听音拼写' : '看释义猜词';
    showToast(`✍️ ${label}开始，共 ${queue.length} 词`);
    startSession(queue, mode);
  }

  // ------------------------------------------------------------- 报告与设置
  function renderReport() {
    const pacing = srs.getExamPacing();
    const wrong = srs.getWrongWords();

    el.reportStats.innerHTML = `
      <div class="stat"><b>${pacing.coveredCount}</b><span>已完成3遍</span></div>
      <div class="stat"><b>${pacing.underCovered}</b><span>待满3遍</span></div>
      <div class="stat"><b>${wrong.length}</b><span>当前错词</span></div>
      <div class="stat"><b>${store.wordbookCount()}</b><span>⭐ 单词本</span></div>
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
    el.setGate.checked = store.data.wordbookGateEnabled !== false;
  }

  // 打印单词列表（错词本 / 单词本共用）
  function printWords(title, words) {
    if (!words.length) {
      alert('这个列表里还没有单词哦！');
      return;
    }
    const printWin = window.open('', '_blank');
    printWin.document.write(`
      <html><head><title>${title} - 打印</title>
      <style>body { font-family: sans-serif; padding: 20px; } table { width:100%; border-collapse:collapse; } th, td { border:1px solid #ccc; padding:8px; text-align:left; }</style>
      </head><body>
      <h2>${title}（${words.length} 词）</h2>
      <table><tr><th>#</th><th>英文</th><th>音标/词性</th><th>中文释义</th><th>默写核对</th></tr>
      ${words.map((w, idx) => '<tr><td>' + (idx + 1) + '</td><td><b>' + w.word + '</b></td><td>/' + (w.ipa || '') + '/ ' + (w.pos || '') + '</td><td>' + (w.zh || '') + '</td><td></td></tr>').join('')}
      </table>
      <script>window.print();</script>
      </body></html>
    `);
    printWin.document.close();
  }

  function wordbookWords() {
    return store.getWordbookEntries()
      .map(e => allWords.find(w => w.id === e.id))
      .filter(Boolean);
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

    // 专项练习入口（五线格听写 / 看释义猜词 / 单词本闯关）
    el.btnPracticeDictation.addEventListener('click', () => practiceMode('dictation'));
    el.btnPracticeDefinition.addEventListener('click', () => practiceMode('definition'));
    el.btnPracticeWordbook.addEventListener('click', () => {
      if (!store.wordbookCount()) {
        showToast('单词本还是空的，先收藏几个不熟的词吧 ☆');
        switchTab('wordbook');
        return;
      }
      wordbookGate.open();
    });

    el.btnQuit.addEventListener('click', () => {
      if (confirm('确定要暂停这次练习吗？已答进度已自动保存。')) {
        exitSession();
      }
    });

    el.search.addEventListener('input', () => renderWordList());
    el.filterTopic.addEventListener('change', () => renderWordList());
    el.filterState.addEventListener('change', () => renderWordList());

    // 单词库一次渲染上千行，用事件委托代替逐行绑定
    el.wordList.addEventListener('click', (e) => {
      const speak = e.target.closest('.btn-speak');
      if (speak) {
        speech.speak(speak.dataset.word);
        return;
      }
      const star = e.target.closest('.star-btn');
      if (star) {
        toggleWordbookWord(star.dataset.star, 'word-list');
        return;
      }
      const row = e.target.closest('.word-row');
      if (row) {
        const w = allWords.find(x => x.id === row.dataset.id);
        if (w) showWordModal(w);
      }
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
    el.setGate.addEventListener('change', () => {
      store.data.wordbookGateEnabled = el.setGate.checked;
      store.save();
      showToast(el.setGate.checked ? '已开启：打开网页先过单词本关' : '已关闭：不再强制单词本闯关');
    });

    // ---------------------------------------------------------- 单词本按钮
    el.btnWbGate.addEventListener('click', () => {
      if (!store.wordbookCount()) {
        showToast('单词本还是空的哦 ☆');
        return;
      }
      wordbookGate.open();
    });
    el.btnWbPractice.addEventListener('click', () => {
      const queue = wordbookWords().slice(0, 20);
      if (!queue.length) {
        showToast('单词本还是空的哦 ☆');
        return;
      }
      startSession(queue, 'definition');
    });
    el.btnWbPrint.addEventListener('click', () => printWords('我的 KET 单词本', wordbookWords()));
    el.btnWbClear.addEventListener('click', () => {
      if (!store.wordbookCount()) return;
      if (confirm(`确定要清空单词本里的 ${store.wordbookCount()} 个词吗？`)) {
        store.data.wordbook = {};
        store.save();
        updateWordbookBadge();
        renderWordbook();
        showToast('单词本已清空');
      }
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
          updateWordbookBadge();
          if (currentTab === 'wordbook') renderWordbook();
          renderToday();
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      reader.readAsText(file);
    });

    el.btnPrint.addEventListener('click', () => {
      printWords('KET 错词专项默写本', srs.getWrongWords());
    });
    el.btnPrintWb.addEventListener('click', () => {
      printWords('我的 KET 单词本', wordbookWords());
    });

    el.btnReset.addEventListener('click', () => {
      if (confirm('确定要清空所有学习记录吗？此操作无法撤销！（单词本也会一起清空）')) {
        store.reset();
        updateWordbookBadge();
        if (currentTab === 'wordbook') renderWordbook();
        showToast('进度已重置');
        renderToday();
      }
    });

    window.addEventListener('keydown', (e) => {
      // 单词本闸门打开时，后面的学习界面不响应任何快捷键
      if (wordbookGate && wordbookGate.isOpen()) return;
      if (!currentSession || el.screenStudy.hasAttribute('hidden')) return;
      // 五线格有自己的 Enter 处理
      if (e.target && e.target.classList && e.target.classList.contains('grid-input')) return;

      const fb = el.studyCard.querySelector('#card-feedback');
      // 只有已经答题（反馈区已展示）时 Enter 才进入下一题
      if (fb && fb.classList.contains('feedback') && e.key === 'Enter') {
        e.preventDefault();
        advanceToNext();
        return;
      }

      if (!currentSession.answered && ['1', '2', '3', '4'].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const opts = el.studyCard.querySelectorAll('.opt');
        if (opts[idx]) {
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

    // ⭐ 单词本闯关闸门
    wordbookGate = new window.WordbookGate({
      store: store,
      srs: srs,
      exGen: exGen,
      speech: speech,
      allWords: allWords
    });
    wordbookGate.onFinished = () => {
      updateWordbookBadge();
      renderToday();
      if (currentTab === 'wordbook') renderWordbook();
      if (currentTab === 'report') renderReport();
    };

    bindGlobalEvents();

    setTimeout(() => {
      el.boot.setAttribute('hidden', '');
      el.app.removeAttribute('hidden');
      switchTab('today');
      // 打开网页先弹出单词本闯关（单词本为空或已关闭该设置则跳过）
      wordbookGate.maybeAutoOpen();
    }, 400);
  }

  window.addEventListener('DOMContentLoaded', boot);






})();
