'use strict';

const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null, drone = null;
  let muted = false;
  const VOL = 0.8;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t0, vol, attack, dur, release) {
    vol = Math.max(0.0002, vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone(freq, dur, o = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.when || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    env(g, t0, o.vol ?? 0.2, o.attack ?? 0.01, dur, o.release ?? dur * 0.6);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, o = {}) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.when || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    f.Q.value = o.q ?? 1;
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t0 + dur);
    const g = ctx.createGain();
    env(g, t0, o.vol ?? 0.2, o.attack ?? 0.005, dur, o.release ?? dur * 0.7);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // 딩동댕동 — glitch=true면 음이 점점 처지고 어긋나는 뒤틀린 종소리
  function bell(glitch) {
    const notes = [659.3, 523.3, 587.3, 392.0, 392.0, 587.3, 659.3, 523.3];
    notes.forEach((f, i) => {
      const k = glitch ? Math.pow(0.975, i) * (1 + (Math.random() - 0.5) * 0.03) : 1;
      const when = glitch ? i * (0.6 + i * 0.035) : i * 0.55;
      tone(f * k, 1.4, { when, vol: 0.15, release: 1.3 });
      tone(f * k * 2.01, 0.8, { when, vol: 0.035, type: 'triangle', release: 0.7 });
      if (glitch) tone(f * k * 0.53, 1.2, { when, vol: 0.045, type: 'sawtooth', release: 1.1 });
    });
  }

  const tick = (hi) => tone(hi ? 1500 : 1100, 0.05, { vol: 0.1, type: 'square', release: 0.04 });

  function step(kind) {
    const v = { sneak: 0.015, walk: 0.06, run: 0.15 }[kind] || 0.05;
    noise(0.07, { vol: v, filter: 'lowpass', freq: kind === 'run' ? 900 : 500, q: 0.7 });
  }

  function heartbeat(k = 1) {
    tone(62, 0.15, { vol: 0.35 * k, release: 0.13 });
    tone(52, 0.18, { when: 0.2, vol: 0.28 * k, release: 0.16 });
  }

  function stinger() {
    [220, 233.1, 311.1, 349.2].forEach((f, i) =>
      tone(f, 1.6, { type: 'sawtooth', vol: 0.06, slide: f * 0.7, when: i * 0.02, release: 1.4 }));
    noise(1.2, { vol: 0.14, freq: 3000, q: 0.4, sweep: 400 });
  }

  function staticNoise(dur = 1.5) {
    noise(dur, { vol: 0.1, freq: 2500, q: 0.4 });
    for (let i = 0; i < 6; i++) noise(0.05, { when: Math.random() * dur, vol: 0.18, freq: 4000, q: 0.5 });
  }

  function scrape(v = 1) {
    noise(0.7, { vol: 0.16 * v, freq: 300, q: 3, sweep: 900 });
    noise(0.5, { vol: 0.07 * v, freq: 2000, q: 6, when: 0.1 });
  }

  function whisper() {
    for (let i = 0; i < 4; i++) noise(0.35, { when: i * 0.28, vol: 0.06, freq: 1800 + Math.random() * 2000, q: 10 });
  }

  const shh = (v = 1) => noise(1.0, { vol: 0.12 * v, filter: 'highpass', freq: 3500, q: 0.5, attack: 0.15 });

  function scream() {
    tone(900, 0.8, { type: 'sawtooth', vol: 0.09, slide: 480 });
    noise(0.8, { vol: 0.18, freq: 1500, q: 1 });
  }

  function jumpscare() {
    noise(1.2, { vol: 0.5, freq: 1200, q: 0.3 });
    [110, 116, 155, 233].forEach((f) => tone(f, 1.3, { type: 'sawtooth', vol: 0.11, slide: f * 0.5 }));
    tone(1800, 0.5, { type: 'square', vol: 0.05, slide: 600 });
  }

  function pickup() {
    tone(880, 0.15, { vol: 0.09 });
    tone(1320, 0.25, { when: 0.1, vol: 0.07 });
  }

  function unlock() {
    tone(200, 0.08, { type: 'square', vol: 0.09 });
    noise(0.1, { when: 0.08, vol: 0.14, freq: 2500 });
    tone(150, 0.3, { when: 0.15, type: 'triangle', vol: 0.09 });
  }

  const page = () => noise(0.25, { vol: 0.07, freq: 3000, q: 0.8 });

  function glitch() {
    for (let i = 0; i < 6; i++) tone(200 + Math.random() * 2000, 0.04, { when: i * 0.05, type: 'square', vol: 0.05 });
  }

  const blip = () => tone(600, 0.03, { vol: 0.03, type: 'square', release: 0.02 });

  function startDrone() {
    if (!ctx || drone) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth';
    o1.frequency.value = 55; o2.frequency.value = 55.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 80;
    lfo.connect(lg); lg.connect(f.frequency);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start(); lfo.start();
    drone = { g, nodes: [o1, o2, lfo] };
  }

  function stopDrone() {
    if (!drone) return;
    const d = drone;
    drone = null;
    d.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
    setTimeout(() => d.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } }), 2500);
  }

  function setDrone(v) {
    if (drone) drone.g.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.8);
  }

  let koVoice = null;
  function speak(text, { pitch = 0.2, rate = 0.75, volume = 0.9 } = {}) {
    if (muted || !window.speechSynthesis) return;
    try {
      if (!koVoice) koVoice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('ko')) || null;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      if (koVoice) u.voice = koVoice;
      u.pitch = pitch; u.rate = rate; u.volume = volume;
      speechSynthesis.speak(u);
    } catch (e) { /* speech unsupported */ }
  }

  function hush() {
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : VOL;
    if (muted && window.speechSynthesis) speechSynthesis.cancel();
    return muted;
  }

  return {
    init, bell, tick, step, heartbeat, stinger, staticNoise, scrape, whisper, shh, scream,
    jumpscare, pickup, unlock, page, glitch, blip, startDrone, stopDrone, setDrone, speak, hush, toggleMute,
  };
})();
