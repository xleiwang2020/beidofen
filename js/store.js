// store.js — 状态持久化与管理
(function () {
  'use strict';

  const STORAGE_KEY = 'ket_planet_v1';

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function defaultState() {
    return {
      version: 1,
      createdAt: todayStr(),
      examDate: '2026-12-19', // 预设 2026 年 12 月 KET 考期
      dailyLimit: 0,         // 0 = 自动计算
      soundEnabled: true,
      ttsEnabled: true,
      xp: 0,
      streak: 0,
      lastActiveDate: '',
      // 日志结构: { 'YYYY-MM-DD': { newCount: 0, reviewCount: 0, correctCount: 0, totalCount: 0, xp: 0 } }
      dailyLogs: {},
      // 单词卡片进度映射: { [wordId]: WordRecord }
      // WordRecord: {
      //   box: 0..5,            // Leitner 盒号
      //   reps: 0,              // 累计练习次数
      //   lapses: 0,            // 错题次数
      //   correct: 0,           // 正确次数
      //   interval: 0,          // 当前复习间隔天数
      //   ease: 2.5,            // SM-2 简易度因子
      //   nextReview: '',       // 下次复习日期 YYYY-MM-DD
      //   lastReviewed: '',     // 上次复习日期 YYYY-MM-DD
      //   firstLearned: '',     // 首次学习日期 YYYY-MM-DD
      // }
      words: {},
      // 错词标记（最近错且未通过复习）
      wrongWords: {}
    };
  }

  class Store {
    constructor() {
      this.data = this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        return Object.assign(defaultState(), parsed);
      } catch (e) {
        console.warn('Failed to parse saved state, using default:', e);
        return defaultState();
      }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.error('Failed to save state to localStorage:', e);
      }
    }

    reset() {
      this.data = defaultState();
      this.save();
    }

    exportJSON() {
      return JSON.stringify(this.data, null, 2);
    }

    importJSON(jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('无效的进度文件格式');
      }
      this.data = Object.assign(defaultState(), parsed);
      this.save();
    }

    getWordRecord(id) {
      return this.data.words[id] || null;
    }

    setWordRecord(id, record) {
      this.data.words[id] = record;
      this.save();
    }

    getDailyLog(date = todayStr()) {
      if (!this.data.dailyLogs[date]) {
        this.data.dailyLogs[date] = {
          newCount: 0,
          reviewCount: 0,
          correctCount: 0,
          totalCount: 0,
          xp: 0
        };
      }
      return this.data.dailyLogs[date];
    }

    recordAnswer({ wordId, isCorrect, isNew, xpEarned = 10 }) {
      const t = todayStr();
      const log = this.getDailyLog(t);

      log.totalCount += 1;
      if (isCorrect) log.correctCount += 1;
      if (isNew) {
        log.newCount += 1;
      } else {
        log.reviewCount += 1;
      }
      log.xp += xpEarned;
      this.data.xp += xpEarned;

      // 更新错题集合
      if (!isCorrect) {
        this.data.wrongWords[wordId] = (this.data.wrongWords[wordId] || 0) + 1;
      } else if (this.data.wrongWords[wordId]) {
        // 如果正确且已达一定盒子，可以从错题本移出
        delete this.data.wrongWords[wordId];
      }

      // 维护 streak
      this.updateStreak(t);
      this.save();
    }

    updateStreak(today = todayStr()) {
      const last = this.data.lastActiveDate;
      if (last === today) return;

      if (!last) {
        this.data.streak = 1;
      } else {
        const d1 = new Date(last);
        const d2 = new Date(today);
        const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          this.data.streak += 1;
        } else if (diffDays > 1) {
          this.data.streak = 1;
        }
      }
      this.data.lastActiveDate = today;
    }

    getLevelInfo() {
      // 类似星级冒险等级: 每 150 XP 升一级
      const xp = this.data.xp;
      const level = Math.floor(xp / 150) + 1;
      const currentLevelXP = xp % 150;
      return { level, currentLevelXP, nextLevelXP: 150 };
    }
  }

  window.Store = Store;
  window.todayStr = todayStr;
})();
