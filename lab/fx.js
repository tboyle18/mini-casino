// Shared effects for the lab games: synthesized sounds, and the big-win overlay
// (a bouncing gold title with a counting amount, floating amounts and confetti).

import { gsap } from 'gsap';
import confetti from 'canvas-confetti';

/* ---------- Sound: tiny synthesized effects, no audio files ----------
   Nothing plays until the first tap (browsers require it), so call unlock() from a tap. */
export function makeSound() {
  let ac = null, out = null, noise = null, enabled = true;
  function ctx() {
    if (!enabled) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      out = ac.createGain();
      out.gain.value = 0.55;
      out.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, { type = 'square', vol = 0.15, at = 0, to = null, attack = 0.004 } = {}) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const gn = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function hiss(dur, { vol = 0.2, at = 0, freq = 1000, q = 1 } = {}) {
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + at;
    const src = a.createBufferSource();
    src.buffer = noise;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const gn = a.createGain();
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gn).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
  const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
  return {
    note: tone,
    ping(freq, vol = 0.06) { tone(freq, 0.22, { type: 'triangle', vol, attack: 0.002 }); tone(freq * 2, 0.08, { type: 'sine', vol: vol * 0.4, attack: 0.002 }); },
    get on() { return enabled; },
    set on(v) { enabled = v; if (!v && ac) ac.suspend(); },
    unlock() { ctx(); },
    ratchet() { tone(1500, 0.022, { vol: 0.07 }); },
    tick() { tone(2600, 0.014, { vol: 0.03 }); },
    pull() { hiss(0.12, { vol: 0.22, freq: 600 }); tone(180, 0.15, { type: 'triangle', vol: 0.2, to: 90 }); },
    boing() { tone(200, 0.5, { type: 'sine', vol: 0.16, to: 560 }); },
    clunk() { tone(120, 0.16, { type: 'sine', vol: 0.45, to: 55 }); hiss(0.05, { vol: 0.22, freq: 1800, q: 0.7 }); },
    drum(sec) {
      const n = Math.floor(sec * 16);
      for (let i = 0; i < n; i++) hiss(0.05, { vol: 0.04 + 0.26 * (i / n), at: i / 16, freq: 240, q: 0.8 });
    },
    sad() {
      tone(392, 0.3, { type: 'sawtooth', vol: 0.07, to: 370 });
      tone(370, 0.3, { type: 'sawtooth', vol: 0.07, at: 0.32, to: 349 });
      tone(349, 0.8, { type: 'sawtooth', vol: 0.07, at: 0.64, to: 290 });
    },
    boop() { tone(330, 0.12, { type: 'triangle', vol: 0.1, to: 220 }); },
    win(level) {
      const k = level === 1 ? 3 : level === 2 ? 5 : 6;
      for (let i = 0; i < k; i++) tone(NOTES[i], 0.16, { vol: 0.11, at: i * 0.08 });
    },
    fanfare() {
      const seq = [0, 1, 2, 3, 2, 3, 4, 5];
      seq.forEach((n, i) => tone(NOTES[n], 0.22, { vol: 0.12, at: i * 0.11 }));
      tone(NOTES[5], 1, { vol: 0.11, at: seq.length * 0.11, type: 'triangle' });
    },
    // A sawtooth sweep through a nasal band-pass filter, which is close enough to a quack
    quack(at = 0) {
      const a = ctx();
      if (!a) return;
      const t = a.currentTime + at;
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(540, t);
      o.frequency.exponentialRampToValueAtTime(250, t + 0.17);
      const f = a.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1150;
      f.Q.value = 5;
      const gn = a.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.6, t + 0.015);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
      o.connect(f).connect(gn).connect(out);
      o.start(t);
      o.stop(t + 0.21);
    },
    // A rocket engine: a low sawtooth plus rumble. set(m) raises the pitch as the multiplier climbs.
    engine() {
      const a = ctx();
      if (!a) return { set() {}, stop() {} };
      const t = a.currentTime;
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 70;
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      const src = a.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bp = a.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 350;
      bp.Q.value = 0.7;
      const gn = a.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.1, t + 0.4);
      o.connect(lp).connect(gn);
      src.connect(bp).connect(gn);
      gn.connect(out);
      o.start(t);
      src.start(t);
      let stopped = false;
      return {
        set(m) {
          if (stopped) return;
          const k = Math.log2(Math.max(1, m));
          o.frequency.setTargetAtTime(70 + k * 45, a.currentTime, 0.1);
          bp.frequency.setTargetAtTime(350 + k * 160, a.currentTime, 0.1);
        },
        stop() {
          if (stopped) return;
          stopped = true;
          const n = a.currentTime;
          gn.gain.setTargetAtTime(0.0001, n, 0.06);
          o.stop(n + 0.4);
          src.stop(n + 0.4);
        },
      };
    },
    boom() {
      hiss(1.4, { vol: 0.7, freq: 140, q: 0.35 });
      tone(70, 0.9, { type: 'sine', vol: 0.55, to: 28 });
    },
    close() { if (ac) ac.close(); },
  };
}


const CSS = `
.lab-fx { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; align-content: center; gap: 8px; pointer-events: none; opacity: 0; }
.lab-fx-title { display: flex; font-weight: 800; line-height: .95; letter-spacing: -.02em; white-space: nowrap; }
.lab-fx-title span { display: inline-block; background: linear-gradient(180deg, #fff6d6 0%, #ffd56b 38%, #e3a52f 62%, #fff1b8 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 #8a1238) drop-shadow(0 10px 24px rgba(0, 0, 0, .6)); }
.lab-fx-title .gap { width: .28em; }
.lab-fx-amount { font-weight: 800; font-size: min(11vw, 52px); color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 0 18px rgba(255, 210, 110, .85), 0 3px 0 rgba(0, 0, 0, .4); }
.lab-float { position: absolute; z-index: 4; left: 0; top: 0; pointer-events: none; opacity: 0; white-space: nowrap;
  font-weight: 800; font-size: 36px; color: #ffe27a; text-shadow: 0 0 14px rgba(255, 190, 60, .9), 0 3px 0 rgba(0, 0, 0, .45); }
.lab-confetti { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3; pointer-events: none; }
`;

const money = n => '$' + Math.round(n).toLocaleString('en-US');

/* The overlay layers live inside the stage. Positions for float() and burst() are in
   CSS pixels from the stage's top-left corner. */
export function createWinFx(stage) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'lab-fx';
  root.innerHTML = '<div class="lab-fx-title"></div><div class="lab-fx-amount"></div>';
  const titleEl = root.querySelector('.lab-fx-title');
  const amountEl = root.querySelector('.lab-fx-amount');
  const canvas = document.createElement('canvas');
  canvas.className = 'lab-confetti';
  stage.append(canvas, root);
  const fire = confetti.create(canvas, { resize: true, useWorker: true });
  const coin = confetti.shapeFromPath({ path: 'M10 0a10 10 0 1 0 0.001 0zM10 3a7 7 0 1 1-0.001 0z' });
  const duck = confetti.shapeFromText({ text: '🦆', scalar: 2.2 });
  const party = ['#ffd56b', '#ff3fa4', '#3fe0ff', '#7cff6b', '#ffffff'];
  const floats = new Set();
  let tl = null;

  function hideTitle() {
    if (tl) tl.kill();
    tl = null;
    gsap.killTweensOf([root, amountEl, ...titleEl.children]);
    gsap.set(root, { opacity: 0 });
  }
  function showTitle(text, amount, { jackpot = false } = {}) {
    hideTitle();
    titleEl.innerHTML = [...text].map(ch => (ch === ' ' ? '<span class="gap"></span>' : `<span>${ch}</span>`)).join('');
    titleEl.style.fontSize = `min(17vw, 84px, ${(128 / text.length).toFixed(1)}vw)`;
    const letters = titleEl.querySelectorAll('span');
    const counter = { v: 0 };
    amountEl.textContent = '+$0';
    gsap.set(root, { opacity: 1 });
    tl = gsap.timeline()
      .fromTo(letters, { y: 90, scale: 0.2, opacity: 0, rotation: () => gsap.utils.random(-40, 40) },
        { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(3)', stagger: 0.05 })
      .fromTo(amountEl, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, 0.4)
      .to(counter, { v: amount, duration: jackpot ? 2.6 : 1.6, ease: 'power3.out', onUpdate: () => { amountEl.textContent = '+' + money(counter.v); } }, 0.45)
      .to(root, { opacity: 0, duration: 0.5 }, jackpot ? 5.5 : 3.6);
    // A goofy wobble while it's up
    gsap.to(letters, { y: -9, rotation: () => gsap.utils.random(-7, 7), duration: 0.32, yoyo: true, repeat: jackpot ? 15 : 9, ease: 'sine.inOut', stagger: 0.05, delay: 0.9 });
  }
  // A number that pops up at (x, y) and drifts away. Several can be up at once.
  function float(text, x, y, { color = '#ffe27a', size = 36 } = {}) {
    if (floats.size > 14) return;
    const el = document.createElement('div');
    el.className = 'lab-float';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    stage.appendChild(el);
    floats.add(el);
    gsap.timeline({ onComplete: () => { floats.delete(el); el.remove(); } })
      .fromTo(el, { xPercent: -50, yPercent: -50, y: 10, scale: 0.5, opacity: 0 }, { y: -40, scale: 1.1, opacity: 1, duration: 0.4, ease: 'back.out(2.5)' })
      .to(el, { y: -80, opacity: 0, duration: 0.55, ease: 'power1.in' }, '+=0.7');
  }
  // Confetti from both bottom corners, with a few ducks and coins mixed in
  function cannons(power = 1) {
    for (const [x, angle] of [[0, 62], [1, 118]]) {
      fire({ particleCount: Math.round(70 * power), angle, spread: 60, startVelocity: 60, origin: { x, y: 1 }, colors: party, ticks: 260 });
      fire({ particleCount: Math.round(10 * power), angle, spread: 50, startVelocity: 55, origin: { x, y: 1 }, shapes: [duck, coin], colors: ['#ffd56b'], scalar: 2, ticks: 300 });
    }
  }
  // A pop of coins and confetti at (x, y)
  function burst(x, y, power = 1) {
    const origin = { x: x / (stage.clientWidth || 1), y: y / (stage.clientHeight || 1) };
    fire({ particleCount: Math.round(40 * power), spread: 100, startVelocity: 30 + 10 * power, origin, colors: party, ticks: 200, scalar: 0.9 });
    fire({ particleCount: Math.round(12 * power), spread: 80, startVelocity: 28 + 8 * power, origin, shapes: [coin], colors: ['#ffd56b', '#f4c046'], scalar: 1.6, ticks: 240 });
  }
  function dispose() {
    hideTitle();
    for (const el of floats) { gsap.killTweensOf(el); el.remove(); }
    floats.clear();
    fire.reset();
    canvas.remove();
    root.remove();
    style.remove();
  }
  return { showTitle, hideTitle, float, cannons, burst, dispose };
}
