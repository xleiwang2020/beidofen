// speech.js — Web Speech API 语音朗读与简单 Web Audio 音效
(function () {
  'use strict';

  class SpeechManager {
    constructor() {
      this.synth = window.speechSynthesis;
      this.voice = null;
      this.audioCtx = null;
      this.soundEnabled = true;
      this.ttsEnabled = true;

      this.initVoice();
    }

    initVoice() {
      if (!this.synth) return;
      const setBestVoice = () => {
        const voices = this.synth.getVoices();
        // 优先使用英式英语 (en-GB)，因为 KET 是剑桥考试
        // 备选美式英语 (en-US) 或任意 en 语音
        const gb = voices.find(v => v.lang === 'en-GB' || v.lang.startsWith('en_GB'));
        const us = voices.find(v => v.lang === 'en-US' || v.lang.startsWith('en_US'));
        const anyEn = voices.find(v => v.lang.startsWith('en'));
        this.voice = gb || us || anyEn || null;
      };

      setBestVoice();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = setBestVoice;
      }
    }

    speak(text, rate = 0.9) {
      if (!this.ttsEnabled || !this.synth) return;
      try {
        this.synth.cancel(); // 停止上一段朗读
        const utter = new SpeechSynthesisUtterance(text);
        if (this.voice) utter.voice = this.voice;
        utter.lang = 'en-GB';
        utter.rate = rate; // 略微放慢语速，适合小学生
        utter.pitch = 1.05;
        this.synth.speak(utter);
      } catch (e) {
        console.warn('Speech synthesis error:', e);
      }
    }

    ensureAudio() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    // 纯合成轻快音效，无需加载外部音效文件
    playCorrect() {
      if (!this.soundEnabled) return;
      this.ensureAudio();
      if (!this.audioCtx) return;

      const t = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      // 升调: 523Hz (C5) -> 659Hz (E5) -> 784Hz (G5)
      osc.frequency.setValueAtTime(523.25, t);
      osc.frequency.exponentialRampToValueAtTime(783.99, t + 0.18);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    }

    playWrong() {
      if (!this.soundEnabled) return;
      this.ensureAudio();
      if (!this.audioCtx) return;

      const t = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      // 低沉两声
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.linearRampToValueAtTime(140, t + 0.2);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    }

    playFanfare() {
      if (!this.soundEnabled) return;
      this.ensureAudio();
      if (!this.audioCtx) return;

      // 小通关胜利琶音
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const start = this.audioCtx.currentTime;
      notes.forEach((freq, idx) => {
        const t = start + idx * 0.1;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    }
  }

  window.speechManager = new SpeechManager();
})();
