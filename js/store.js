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
      planStart: '2026-10-01', // 3 轮过词计划的起始日
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
      //   passes: 0,            // 3 轮过词：已经过了几轮（0..3）
      //   lastPassDate: '',     // 最近一次过轮的日期（同一天最多过 1 轮）
      // }
      words: {},
      // 错词标记（最近错且未通过复习）
      wrongWords: {},
      // ⭐ 单词本：孩子主动收藏的「不熟悉」单词
      // WordbookEntry: { addedAt: 'YYYY-MM-DD', passes: 0, lastPassed: '', source: 'manual' }
      wordbook: {},
      // 是否强制「单词本过关后才能开始今日学习」
      wordbookGateEnabled: true
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

    // ------------------------------------------------------------- ⭐ 单词本
    wordbookIds() {
      const wb = this.data.wordbook || {};
      return Object.keys(wb);
    }

    wordbookCount() {
      return this.wordbookIds().length;
    }

    isInWordbook(id) {
      return !!(this.data.wordbook && this.data.wordbook[id]);
    }

    getWordbookEntry(id) {
      return (this.data.wordbook && this.data.wordbook[id]) || null;
    }

    // 按收藏时间返回 [{ id, entry }]
    getWordbookEntries() {
      const wb = this.data.wordbook || {};
      return Object.keys(wb)
        .map(id => ({ id: id, entry: wb[id] }))
        .sort((a, b) => String(a.entry.addedAt).localeCompare(String(b.entry.addedAt)));
    }

    addToWordbook(id, source = 'manual') {
      if (!this.data.wordbook) this.data.wordbook = {};
      if (!this.data.wordbook[id]) {
        this.data.wordbook[id] = {
          addedAt: todayStr(),
          passes: 0,
          lastPassed: '',
          source: source
        };
        this.save();
      }
      return this.data.wordbook[id];
    }

    removeFromWordbook(id) {
      if (this.data.wordbook && this.data.wordbook[id]) {
        delete this.data.wordbook[id];
        this.save();
      }
    }

    // 返回 true 表示已加入单词本，false 表示已移出
    toggleWordbook(id, source = 'manual') {
      if (this.isInWordbook(id)) {
        this.removeFromWordbook(id);
        return false;
      }
      this.addToWordbook(id, source);
      return true;
    }

    markWordbookPassed(id, when = todayStr()) {
      const entry = this.data.wordbook && this.data.wordbook[id];
      if (!entry) return null;
      entry.passes = (entry.passes || 0) + 1;
      entry.lastPassed = when;
      this.save();
      return entry;
    }

    getDailyLog(date = todayStr()) {
      if (!this.data.dailyLogs[date]) {
        this.data.dailyLogs[date] = {
          newCount: 0,
          reviewCount: 0,
          correctCount: 0,
          totalCount: 0,
          passCount: 0,
          xp: 0
        };
      }
      return this.data.dailyLogs[date];
    }

    recordPass(date = todayStr()) {
      const log = this.getDailyLog(date);
      log.passCount = (log.passCount || 0) + 1;
      this.save();
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
