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
        if (!rec || rec.reps === 0) {
          unlearned += 1;
          underCovered += 1;
        } else if (rec.reps < 3) {
          underCovered += 1;
        }
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

    // 按主题统计进度（用于星球图）
    getTopicStats() {
      const stats = {};
      for (const w of this.allWords) {
        const topics = w.topics && w.topics.length ? w.topics : ['General'];
        for (const t of topics) {
          if (!stats[t]) {
            stats[t] = { topic: t, total: 0, covered: 0, mastered: 0, words: [] };
          }
          stats[t].total += 1;
          stats[t].words.push(w);
          const rec = this.store.getWordRecord(w.id);
          if (rec) {
            if (rec.reps >= 3) stats[t].covered += 1;
            if (rec.box >= 4) stats[t].mastered += 1;
          }
        }
      }
      return Object.values(stats);
    }
  }

  window.SRSEngine = SRSEngine;
})();
