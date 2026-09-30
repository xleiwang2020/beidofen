// srs.js — Leitner + SM-2 混合间隔复习引擎与目标调度
(function () {
  'use strict';

  function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysBetween(startStr, endStr) {
    const d1 = new Date(startStr);
    const d2 = new Date(endStr);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  // 间隔调度（天数）阶梯：
  // Box 0: 0天（当天重来）
  // Box 1: 1天
  // Box 2: 3天
  // Box 3: 7天
  // Box 4: 15天
  // Box 5: 30天
  const BOX_INTERVALS = [0, 1, 3, 7, 15, 30];

  // 3 轮过词：计划起始日 → 考前 5 天，按 31 : 25 : 19 天切成 3 轮，剩下几天只刷错词
  const ROUNDS = 3;
  const ROUND_SHARES = [31, 25, 19];
  const BUFFER_DAYS = 5;
  const ROUND_NAMES = ['认识单词', '回想英文', '拼写单词'];
  const UNTAGGED_TOPIC = 'General';

  function passesOf(rec) {
    return (rec && rec.passes) || 0;
  }

  class SRSEngine {
    constructor(store, allWords) {
      this.store = store;
      this.allWords = allWords || [];
      this.wordMap = new Map();
      this.allWords.forEach(w => this.wordMap.set(w.id, w));
    }

    // 计算到考期的倒计时天数与每日目标新词数
    getExamPacing() {
      const today = window.todayStr();
      const examDate = this.store.data.examDate || '2026-12-19';
      const daysLeft = Math.max(1, daysBetween(today, examDate));

      const totalWords = this.allWords.length;
      let unlearned = 0;
      let underCovered = 0; // reps < 3

      for (const w of this.allWords) {
        const rec = this.store.getWordRecord(w.id);
        if (!rec || rec.reps === 0) unlearned += 1;
        if (passesOf(rec) < ROUNDS) underCovered += 1;
      }

      // 如果手动指定了每天限制，优先使用
      const manualLimit = this.store.data.dailyLimit || 0;
      let targetNewPerDay;

      if (manualLimit > 0) {
        targetNewPerDay = manualLimit;
      } else {
        // 目标：在倒计时天数内，使所有单词完成至少 3 遍复习
        // 简单节奏：前 60% 的天数完成第一遍，后 40% 天数打磨第二、三遍
        const phase1Days = Math.max(1, Math.floor(daysLeft * 0.55));
        targetNewPerDay = Math.ceil(unlearned / phase1Days);
        if (targetNewPerDay < 15) targetNewPerDay = 15;
        if (targetNewPerDay > 50) targetNewPerDay = 50;
      }

      return {
        daysLeft,
        examDate,
        totalWords,
        unlearned,
        underCovered,
        coveredCount: totalWords - underCovered,
        coveredPct: Math.round(((totalWords - underCovered) / (totalWords || 1)) * 100),
        targetNewPerDay
      };
    }

    // 计算今天到期需要复习的单词
    getDueReviewWords(today = window.todayStr()) {
      const due = [];
      for (const w of this.allWords) {
        const rec = this.store.getWordRecord(w.id);
        if (!rec || rec.reps === 0) continue;
        // nextReview <= today
        if (rec.nextReview && rec.nextReview <= today) {
          due.push({ word: w, record: rec });
        }
      }
      // 优先级：盒子小（不熟）、错题多的排在前面
      due.sort((a, b) => {
        if (a.record.box !== b.record.box) return a.record.box - b.record.box;
        return (b.record.lapses || 0) - (a.record.lapses || 0);
      });
      return due.map(d => d.word);
    }

    // 获取今天建议学习的新词列表
    getCandidateNewWords(limit = 20) {
      const candidates = [];
      for (const w of this.allWords) {
        const rec = this.store.getWordRecord(w.id);
        if (!rec || rec.reps === 0) {
          candidates.push(w);
          if (candidates.length >= limit) break;
        }
      }
      return candidates;
    }

    // 获取错词本单词
    getWrongWords() {
      const ids = Object.keys(this.store.data.wrongWords || {});
      const list = [];
      for (const id of ids) {
        const w = this.wordMap.get(id);
        if (w) list.push(w);
      }
      return list;
    }

    // 核心算法：根据单次作答结果（正确/错误，以及反应质量 0..5），更新单词的 SRS 状态
    updateWordState(wordId, isCorrect, quality = 4) {
      const today = window.todayStr();
      let rec = this.store.getWordRecord(wordId);
      const isNew = !rec || rec.reps === 0;

      if (!rec) {
        rec = {
          box: 0,
          reps: 0,
          lapses: 0,
          correct: 0,
          interval: 0,
          ease: 2.5,
          nextReview: today,
          lastReviewed: today,
          firstLearned: today
        };
      }

      rec.reps += 1;
      rec.lastReviewed = today;

      if (isCorrect) {
        rec.correct += 1;
        // Leitner: 升盒
        rec.box = Math.min(5, rec.box + 1);

        // SM-2 简易度因子修正
        // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        const q = Math.max(3, Math.min(5, quality));
        rec.ease = Math.max(1.3, rec.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

        const baseInterval = BOX_INTERVALS[rec.box] || 1;
        rec.interval = Math.round(baseInterval * (rec.ease / 2.5));
        rec.nextReview = addDays(today, Math.max(1, rec.interval));
      } else {
        rec.lapses += 1;
        // 降盒：降回 box 1（或 0，视情况重新加急学习）
        rec.box = 1;
        rec.ease = Math.max(1.3, rec.ease - 0.2);
        rec.interval = 1;
        rec.nextReview = addDays(today, 1);
      }

      this.store.setWordRecord(wordId, rec);
      return { record: rec, isNew };
    }

    // ----------------------------------------------------------- 3 轮过词
    // 每一轮的截止日（含当天），由计划起始日和考试日期推出
    getRoundSchedule() {
      const start = this.store.data.planStart || '2026-10-01';
      const examDate = this.store.data.examDate || '2026-12-19';
      const finalDay = addDays(examDate, -BUFFER_DAYS);
      const span = Math.max(ROUNDS, daysBetween(start, finalDay) + 1);
      const totalShare = ROUND_SHARES.reduce((a, b) => a + b, 0);
      let cum = 0;
      return ROUND_SHARES.map((share, i) => {
        cum += share;
        return {
          round: i + 1,
          name: ROUND_NAMES[i],
          deadline: addDays(start, Math.round((span * cum) / totalShare) - 1)
        };
      });
    }

    // 当前轮次 = 全部单词里最少过了几轮 + 1；3 轮都过完返回 ROUNDS + 1（冲刺错词）
    getRoundPlan(today = window.todayStr()) {
      const counts = new Array(ROUNDS + 1).fill(0); // counts[k] = 恰好过了 k 轮的词数
      for (const w of this.allWords) {
        counts[Math.min(ROUNDS, passesOf(this.store.getWordRecord(w.id)))] += 1;
      }
      let round = ROUNDS + 1;
      for (let k = 0; k < ROUNDS; k++) {
        if (counts[k] > 0) { round = k + 1; break; }
      }

      const total = this.allWords.length;
      const schedule = this.getRoundSchedule();
      const doneToday = this.store.getDailyLog(today).passCount || 0;
      const passedPerRound = schedule.map((_, i) =>
        counts.slice(i + 1).reduce((a, b) => a + b, 0));

      if (round > ROUNDS) {
        return { round, name: '冲刺错词', total, remaining: 0, dailyTarget: 0, doneToday, schedule, passedPerRound, behind: false, deadline: '' };
      }

      const cur = schedule[round - 1];
      const remaining = total - passedPerRound[round - 1];
      // 今天已经过掉的也算进今天的任务里，免得边学边涨目标
      const remainingAtDayStart = remaining + doneToday;
      let daysLeft = daysBetween(today, cur.deadline) + 1;
      const behind = daysLeft <= 0;
      if (behind) {
        // 已经过了本轮截止日：按剩余工作量把到考前 5 天的日子重新分给本轮
        const finalDay = schedule[ROUNDS - 1].deadline;
        const allRemaining = passedPerRound.reduce((sum, p) => sum + (total - p), 0);
        const daysToFinal = Math.max(1, daysBetween(today, finalDay) + 1);
        daysLeft = Math.max(1, Math.round(daysToFinal * remaining / Math.max(1, allRemaining)));
      }
      const manualLimit = this.store.data.dailyLimit || 0;
      const dailyTarget = manualLimit > 0
        ? manualLimit
        : Math.ceil(remainingAtDayStart / Math.max(1, daysLeft));

      return {
        round,
        name: cur.name,
        deadline: cur.deadline,
        daysLeft: Math.max(1, daysLeft),
        total,
        remaining,
        dailyTarget,
        doneToday,
        schedule,
        passedPerRound,
        behind
      };
    }

    // 答对一题后调用：难度够下一轮、且今天还没过过轮，就记为过了一轮
    recordPass(wordId, level, today = window.todayStr()) {
      const rec = this.store.getWordRecord(wordId);
      if (!rec) return false;
      const next = passesOf(rec) + 1;
      if (next > ROUNDS || level < next || rec.lastPassDate === today) return false;
      rec.passes = next;
      rec.lastPassDate = today;
      this.store.setWordRecord(wordId, rec);
      this.store.recordPass(today);
      return true;
    }

    // 本轮还没过的词：错得多的先来，其余按词表顺序
    getRoundQueue(round, limit) {
      const list = [];
      this.allWords.forEach((w, idx) => {
        const rec = this.store.getWordRecord(w.id);
        if (passesOf(rec) !== round - 1) return;
        list.push({ w, idx, lapses: (rec && rec.lapses) || 0 });
      });
      list.sort((a, b) => (b.lapses - a.lapses) || (a.idx - b.idx));
      return list.slice(0, limit).map(x => x.w);
    }

    // ----------------------------------------------------------- 主题
    wordsForTopic(topic) {
      if (topic === UNTAGGED_TOPIC) return this.allWords.filter(w => !(w.topics && w.topics.length));
      return this.allWords.filter(w => (w.topics || []).includes(topic));
    }

    // 按主题听写：到期复习 → 学过但不牢（盒子小、错得多） → 新词，取满 limit 个后打乱
    getTopicPracticeQueue(topic, limit = 15, today = window.todayStr()) {
      const due = [];
      const learned = [];
      const fresh = [];
      for (const w of this.wordsForTopic(topic)) {
        const rec = this.store.getWordRecord(w.id);
        if (!rec || rec.reps === 0) fresh.push(w);
        else if (rec.nextReview && rec.nextReview <= today) due.push({ w, rec });
        else learned.push({ w, rec });
      }
      const weakFirst = (a, b) => (a.rec.box - b.rec.box) || ((b.rec.lapses || 0) - (a.rec.lapses || 0));
      due.sort(weakFirst);
      learned.sort(weakFirst);
      const picked = [...due.map(x => x.w), ...learned.map(x => x.w), ...fresh].slice(0, limit);
      for (let i = picked.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [picked[i], picked[j]] = [picked[j], picked[i]];
      }
      return picked;
    }

    // 按主题统计进度（用于星球图 / 主题选择）
    getTopicStats() {
      const stats = {};
      for (const w of this.allWords) {
        const topics = w.topics && w.topics.length ? w.topics : [UNTAGGED_TOPIC];
        for (const t of topics) {
          if (!stats[t]) {
            stats[t] = {
              topic: t,
              label: t === UNTAGGED_TOPIC ? '未分类' : t,
              total: 0, covered: 0, mastered: 0, words: []
            };
          }
          stats[t].total += 1;
          stats[t].words.push(w);
          const rec = this.store.getWordRecord(w.id);
          if (rec) {
            if (passesOf(rec) >= ROUNDS) stats[t].covered += 1;
            if (rec.box >= 4) stats[t].mastered += 1;
          }
        }
      }
      return Object.values(stats);
    }
  }

  SRSEngine.ROUNDS = ROUNDS;
  SRSEngine.passesOf = passesOf;

  window.SRSEngine = SRSEngine;
})();
