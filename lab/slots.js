// Lucky Duck 3000: a deliberately ridiculous 3D slot machine.
//
// A candy-red cabinet with a light-bulb marquee, a rubber duck on top, googly eyes that
// rattle when you pull the lever, three real reel cylinders and a lever you drag down.
// Bloom makes the bulbs glow. Near misses tease you with a slow third reel, wins spit
// coins at the camera, and jackpots launch the duck. Sounds are synthesized on the fly.
// Credits here are lab credits, separate from the casino wallet.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gsap } from 'gsap';
import confetti from 'canvas-confetti';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady } from './shared.js';
import { GLYPH, NAME, PAYS, TWO_CHERRIES, STRIPS, evaluate, bestPossible, randomSymbol, stopFor } from './slots-math.js';

const TAU = Math.PI * 2;
const N = 12;                         // stops around each reel
const STEP = TAU / N;
const OMEGA = 15;                     // reel speed at full tilt, radians a second (about 29 symbols)
const REEL_R = 0.2, REEL_W = 0.16, REEL_GAP = 0.018;
const CAB_W = 0.74, CAB_H = 0.86, CAB_Y = 0.12, CAB_BACK = -0.26;
const BODY_FRONT = 0.06;              // the reel axles; the front panel runs from here to the face
const FACE_Z = 0.28;
const WIN_W = 0.58, WIN_H = 0.31, WIN_Y = 0.63;
const TOP_Y = CAB_Y + CAB_H;
const ARCH_R = 0.37;
const LEVER_Y = 0.6, LEVER_Z = -0.02;
const LEVER_REST = -0.18, LEVER_PULLED = 1.65;
const EYE_R = 0.066, PUPIL_R = 0.03, EYE_Y = 0.885;
const PUPIL_MAX = EYE_R - PUPIL_R - 0.004;
const BETS = [5, 25, 100, 500];
const START_CREDITS = 1000;
const STORE = 'mini-casino.lab-slots';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const QUIPS = {
  idle: ['PULL THE LEVER. YOU KNOW YOU WANT TO.', 'THE DUCK IS WATCHING.', 'NOW WITH 30% MORE SPIN.', 'WARNING: LEVER MAY BE TOO FUN.', 'NO REFUNDS. NO REGRETS.', 'DRAG THE RED KNOB DOWN. HARDER = LONGER SPIN.'],
  spin: ['SPINNING… SPINNING… STILL SPINNING…', 'HERE WE GOOOOOOO', 'WHEEEEEEEEEE', 'CALCULATING YOUR DESTINY…'],
  turbo: ['WHOA. EASY, TIGER.', 'TURBO YANK DETECTED', 'YOU PULLED THAT LIKE IT OWED YOU MONEY'],
  tease: ['OH NO. OH YES?', 'DON’T BLINK.', 'HOLD YOUR DUCKS…', 'THIS IS NOT A DRILL'],
  lose: ['SO CLOSE. (NOT REALLY.)', 'THE MACHINE THANKS YOU FOR YOUR DONATION.', 'TRY PULLING HARDER.', 'THE DUCK FEELS BAD FOR YOU.', 'HAVE YOU TRIED WINNING?', 'NOTHING. NADA. ZILCH. QUACK.'],
  near: ['SO CLOSE IT HURTS.', 'AAAAAND NO.', 'THE THIRD REEL HAS BETRAYED YOU.'],
  small: ['TWO CHERRIES. ADORABLE.', 'A LITTLE CHERRY SOMETHING.'],
  win: ['WINNER WINNER!', 'CHA-CHING!', 'THE DUCK APPROVES.'],
  big: ['BIG WIN! BIG WIN! BIG WIN!', 'CALL YOUR MOTHER!'],
  jackpot: ['QUACK QUACK QUACK QUACK QUACK', 'JACKPOT!!! EVERYBODY STAY CALM!!!'],
  bribe: ['THE DUCK ACCEPTS YOUR BRIBE.', 'THIS NEVER HAPPENED.'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const money = n => '$' + Math.round(n).toLocaleString('en-US');

function rand() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  catch (e) { return Math.random(); }
}

const CSS = `
.slot-fx { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; align-content: center; gap: 8px; pointer-events: none; opacity: 0; }
.slot-title { display: flex; font-weight: 800; line-height: .95; letter-spacing: -.02em; white-space: nowrap; }
.slot-title span { display: inline-block; background: linear-gradient(180deg, #fff6d6 0%, #ffd56b 38%, #e3a52f 62%, #fff1b8 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 #8a1238) drop-shadow(0 10px 24px rgba(0, 0, 0, .6)); }
.slot-title .gap { width: .28em; }
.slot-amount { font-weight: 800; font-size: min(11vw, 52px); color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 0 18px rgba(255, 210, 110, .85), 0 3px 0 rgba(0, 0, 0, .4); }
.slot-float { position: absolute; z-index: 4; left: 0; top: 0; pointer-events: none; opacity: 0; white-space: nowrap;
  font-weight: 800; font-size: 36px; color: #ffe27a; text-shadow: 0 0 14px rgba(255, 190, 60, .9), 0 3px 0 rgba(0, 0, 0, .45); }
.slot-confetti { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3; pointer-events: none; }
.slot-pays { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 5; display: grid; gap: 10px;
  max-height: calc(100% - 24px); overflow: auto; padding: 16px; border-radius: 18px;
  background: rgba(16, 9, 22, .95); border: 1px solid rgba(255, 255, 255, .12); box-shadow: 0 20px 50px rgba(0, 0, 0, .6); }
.slot-pays[hidden] { display: none; }
.slot-pays h3 { margin: 0; color: #e9c46a; font-size: 20px; font-weight: 800; }
.slot-pays table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.slot-pays td { padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, .07); font-size: 15px; color: rgba(245, 240, 227, .8); }
.slot-pays td:first-child { font-size: 22px; letter-spacing: 2px; white-space: nowrap; color: inherit; }
.slot-pays td:last-child { text-align: right; font-weight: 800; color: #e9c46a; }
.slot-pays p { margin: 0; color: rgba(245, 240, 227, .7); font-size: 14px; line-height: 1.4; }
.slot-pays .slot-row { display: flex; gap: 8px; }
.slot-pays .slot-row .lab-btn { flex: 1; }
.slot-7 { color: #ff3b47; font-weight: 900; -webkit-text-stroke: 1px #ffd23f; }
`;

/* ---------- Canvas artwork ---------- */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// A rounded rectangle centered on (cx, cy), as a THREE.Shape or Path
function rrect(path, cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function drawSymbol(g, sym, size) {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (sym === 'seven') {
    g.font = `900 ${Math.round(size * 1.25)}px Manrope, sans-serif`;
    g.lineJoin = 'round';
    g.lineWidth = size * 0.17;
    g.strokeStyle = '#5a0a10';
    g.strokeText('7', 0, size * 0.06);
    g.lineWidth = size * 0.08;
    g.strokeStyle = '#ffd23f';
    g.strokeText('7', 0, size * 0.06);
    const grad = g.createLinearGradient(0, -size / 2, 0, size / 2);
    grad.addColorStop(0, '#ff6a6f');
    grad.addColorStop(1, '#c4101e');
    g.fillStyle = grad;
    g.fillText('7', 0, size * 0.06);
  } else {
    g.font = `${size}px ${EMOJI}`;
    g.fillStyle = '#000';
    g.fillText(GLYPH[sym], 0, size * 0.05);
  }
}

/* One reel's strip. Canvas x runs around the reel (down the screen); canvas y runs across
   it (right to left on screen), so each symbol is drawn turned a quarter turn. */
function reelCanvas(strip) {
  const W = 2048, H = 256, cw = W / N;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#e6d6b6');
  bg.addColorStop(0.16, '#fffaf0');
  bg.addColorStop(0.84, '#fffaf0');
  bg.addColorStop(1, '#e6d6b6');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < N; i++) {
    g.fillStyle = 'rgba(120, 90, 40, .22)';
    g.fillRect(i * cw, 0, 2, H);
    g.save();
    g.translate((i + 0.5) * cw, H / 2);
    g.rotate(-Math.PI / 2);
    drawSymbol(g, strip[i], 116);
    g.restore();
  }
  return c;
}
// The same strip smeared along the direction of spin, swapped in while a reel is fast
function blurCanvas(src) {
  const [c, g] = canvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  const K = 7, step = 9;
  g.globalAlpha = 1.7 / (2 * K + 1);
  for (let k = -K; k <= K; k++) {
    if (!k) continue;
    const dx = k * step;
    g.drawImage(src, dx, 0);
    g.drawImage(src, dx - Math.sign(dx) * src.width, 0);
  }
  return c;
}

function arcText(g, text, cx, cy, r, font, fill, stroke) {
  g.save();
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map(ch => g.measureText(ch).width + 6);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -Math.PI / 2 - total / r / 2;
  for (let i = 0; i < text.length; i++) {
    const w = widths[i] / r;
    a += w / 2;
    g.save();
    g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.rotate(a + Math.PI / 2);
    g.lineJoin = 'round';
    g.lineWidth = 18;
    g.strokeStyle = stroke;
    g.strokeText(text[i], 0, 0);
    g.fillStyle = fill(g);
    g.fillText(text[i], 0, 0);
    g.restore();
    a += w / 2;
  }
  g.restore();
}
// The marquee: a half-disc sign in the top half of a square canvas (CircleGeometry's UVs)
function signCanvas() {
  const S = 1024, cx = S / 2, cy = S / 2, R = S / 2;
  const [c, g] = canvas(S, S);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, Math.PI, 0);
  g.closePath();
  g.clip();
  const bg = g.createRadialGradient(cx, cy, 20, cx, cy, R);
  bg.addColorStop(0, '#6a0c1d');
  bg.addColorStop(1, '#16030b');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 24; i++) {
    const a0 = Math.PI + (i * Math.PI) / 24;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0, a0 + Math.PI / 48);
    g.closePath();
    g.fillStyle = 'rgba(255, 80, 110, .13)';
    g.fill();
  }
  g.restore();
  g.strokeStyle = '#f2c14e';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(cx, cy, R - 34, Math.PI, 0);
  g.stroke();
  const goldFill = gg => {
    const grad = gg.createLinearGradient(0, -50, 0, 50);
    grad.addColorStop(0, '#fff3c4');
    grad.addColorStop(0.5, '#ffcf4a');
    grad.addColorStop(1, '#e09a1f');
    return grad;
  };
  arcText(g, 'LUCKY DUCK', cx, cy, R * 0.68, '900 112px Manrope, sans-serif', goldFill, '#3a0610');
  g.save();
  g.translate(cx, cy - 110);
  g.font = '900 150px Manrope, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 20;
  g.strokeStyle = '#3a0610';
  g.strokeText('3000', 0, 0);
  g.fillStyle = '#ffffff';
  g.fillText('3000', 0, 0);
  g.restore();
  g.font = `64px ${EMOJI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('🦆', cx - 300, cy - 70);
  g.fillText('🦆', cx + 300, cy - 70);
  return c;
}
// A loud casino carpet
function carpetCanvas() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#1c0a2a';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(233, 196, 106, .2)';
  g.lineWidth = 6;
  for (let i = -S; i <= S * 2; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
  }
  const cols = ['#ff3fa4', '#3fe0ff', '#ffd23f', '#7cff6b'];
  g.globalAlpha = 0.32;
  for (let i = 0; i < 70; i++) {
    g.fillStyle = cols[i % 4];
    g.beginPath();
    g.arc(14 + Math.random() * (S - 28), 14 + Math.random() * (S - 28), 3 + Math.random() * 7, 0, TAU);
    g.fill();
  }
  return c;
}

/* ---------- The LED ticker: dot-matrix text that scrolls when it's too long ---------- */
function makeTicker(renderer) {
  const W = 1024, H = 132, P = 6;
  const [c, g] = canvas(W, H);
  const [layer, lg] = canvas(W, H);
  const [mask, mg] = canvas(W, H);
  mg.fillStyle = '#fff';
  for (let y = P / 2; y < H; y += P) for (let x = P / 2; x < W; x += P) { mg.beginPath(); mg.arc(x, y, P * 0.4, 0, TAU); mg.fill(); }
  const [dim, dg] = canvas(W, H);
  dg.fillStyle = '#3a1706';
  dg.fillRect(0, 0, W, H);
  dg.globalCompositeOperation = 'destination-in';
  dg.drawImage(mask, 0, 0);
  const texture = tex(c, renderer);
  const mat = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1.7, 1.7, 1.7) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.0709), mat);
  const s = { text: '', width: 0, since: 0, color: '#ffb340', flash: false, drawn: -1 };
  const FONT = '800 86px Manrope, sans-serif';
  function say(text, opts = {}) {
    s.text = text;
    s.color = opts.color || '#ffb340';
    s.flash = !!opts.flash;
    s.since = performance.now() / 1000;
    lg.font = FONT;
    s.width = lg.measureText(text).width;
    s.drawn = -1;
  }
  function draw(now) {
    const scrolls = s.width > W - 60;
    const frame = Math.floor(now * 30);
    if (!scrolls && !s.flash && s.drawn >= 0) return;
    if (frame === s.drawn) return;
    s.drawn = frame;
    g.fillStyle = '#060201';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.9;
    g.drawImage(dim, 0, 0);
    g.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    if (!(s.flash && Math.floor(now * 5) % 2)) {
      lg.font = FONT;
      lg.textBaseline = 'middle';
      lg.fillStyle = s.color;
      if (scrolls) {
        lg.textAlign = 'left';
        lg.fillText(s.text, W - (((now - s.since) * 260) % (s.width + W)), H / 2 + 4);
      } else {
        lg.textAlign = 'center';
        lg.fillText(s.text, W / 2, H / 2 + 4);
      }
      lg.globalCompositeOperation = 'destination-in';
      lg.drawImage(mask, 0, 0);
      g.drawImage(layer, 0, 0);
    }
    texture.needsUpdate = true;
  }
  return { mesh, texture, say, draw };
}

/* ---------- Sound: tiny synthesized effects, no audio files ---------- */
function makeSound() {
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
    close() { if (ac) ac.close(); },
  };
}

/* ---------- Reel motion ----------
   Each spin is planned up front: a little wind-up backwards, a run-up to full speed, a
   steady spin, a slow-down that lands just past the target stop, then a settle back onto
   it. The steady part is stretched by up to one stop so the reel lands exactly. */
function planReel(phi0, stopAt, Td, targetStop, calm) {
  const W = calm ? 0 : 0.14, B = calm ? 0 : 0.16, A = calm ? 0.05 : 0.22;
  const t2 = W + A;
  const phi2 = phi0 - B + (OMEGA * A) / 2;
  const ov = calm ? 0 : 0.075;
  const target = -(targetStop + 0.5) * STEP;
  const base = phi2 + OMEGA * (stopAt - t2) + (OMEGA * Td) / 2 - ov;
  const phiT = target + Math.ceil((base - target) / TAU) * TAU;
  const tc = stopAt + (phiT - base) / OMEGA;
  const settle = calm ? 0.01 : 0.3;
  return { phi0, W, B, A, t2, phi2, tc, Td, phiT, ov, settle, end: tc + Td + settle };
}
function angleAt(p, t) {
  if (t <= 0) return p.phi0;
  if (t < p.W) return p.phi0 - p.B * Math.sin(((t / p.W) * Math.PI) / 2);
  if (t < p.t2) { const u = t - p.W; return p.phi0 - p.B + (OMEGA * u * u) / (2 * p.A); }
  if (t < p.tc) return p.phi2 + OMEGA * (t - p.t2);
  const phiC = p.phi2 + OMEGA * (p.tc - p.t2);
  if (t < p.tc + p.Td) { const u = t - p.tc; return phiC + OMEGA * u - (OMEGA * u * u) / (2 * p.Td); }
  const u = Math.min(1, (t - p.tc - p.Td) / p.settle);
  return p.phiT + p.ov * (0.5 + 0.5 * Math.cos(Math.PI * u));
}
function speedAt(p, t) {
  if (t < p.W) return 0;
  if (t < p.t2) return (OMEGA * (t - p.W)) / p.A;
  if (t < p.tc) return OMEGA;
  if (t < p.tc + p.Td) return OMEGA * (1 - (t - p.tc) / p.Td);
  return 0;
}

export async function mount({ stage, controls, info }) {
  await fontReady();
  const calm = reducedMotion();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const { renderer, envTex } = makeRenderer(stage);
  const canvasEl = renderer.domElement;
  renderer.toneMappingExposure = 0.92;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12071c);
  scene.environment = envTex;
  scene.environmentIntensity = 0.42;
  scene.fog = new THREE.Fog(0x12071c, 4.5, 11);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const textures = [];
  const keep = t => { textures.push(t); return t; };

  // ---- Framing: fit the whole machine (duck and lever included) on any screen ----
  const view = { w: 0, h: 0, dist: 3, close: 1.5, target: new THREE.Vector3(0.05, 0.82, 0) };
  function fit() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    view.dist = Math.max(0.88 / t, 0.58 / (t * camera.aspect));
    view.close = Math.max(0.28 / t, 0.34 / (t * camera.aspect));   // the reel window, edge to edge
  }

  // ---- Room: carpet, neon and colored rim lights ----
  scene.add(new THREE.HemisphereLight(0xffe9f2, 0x1a0820, 0.3));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
  key.position.set(-1.2, 2.6, 2.4);
  key.target.position.set(0, 0.7, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 2.2, bottom: -0.6, near: 0.5, far: 7 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const rimL = new THREE.PointLight(0xff2bd6, 1.6, 4, 2);
  rimL.position.set(-1.1, 1.3, -0.5);
  const rimR = new THREE.PointLight(0x2be7ff, 1.6, 4, 2);
  rimR.position.set(1.2, 1.1, -0.4);
  const reelLight = new THREE.PointLight(0xfff3d6, 0.08, 1.2, 2);
  reelLight.position.set(0, WIN_Y + 0.12, FACE_Z + 0.25);
  scene.add(rimL, rimR, reelLight);

  const carpet = keep(tex(carpetCanvas(), renderer));
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(14, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  for (const [x, color] of [[-1.5, new THREE.Color(1.6, 0.2, 1.2)], [1.6, new THREE.Color(0.2, 1.2, 1.6)], [-0.9, new THREE.Color(1.5, 1.1, 0.25)], [1.0, new THREE.Color(1.6, 0.2, 1.2)]]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 12), new THREE.MeshBasicMaterial({ color }));
    tube.position.set(x, 1.1, -2.2 - Math.abs(x) * 0.2);
    scene.add(tube);
  }

  // ---- Materials ----
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xa8001c, metalness: 0.2, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f4f6, metalness: 1, roughness: 0.1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0c050, metalness: 1, roughness: 0.22 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.55 });
  const darkChrome = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 1, roughness: 0.25 });

  const machine = new THREE.Group();
  scene.add(machine);
  const add = (mesh, parent = machine) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- Cabinet ----
  add(new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.12, 0.62, 3, 0.025), darkChrome)).position.set(0, 0.06, 0);
  add(new THREE.Mesh(new RoundedBoxGeometry(CAB_W, CAB_H, BODY_FRONT - CAB_BACK, 4, 0.04), paint)).position.set(0, CAB_Y + CAB_H / 2, (BODY_FRONT + CAB_BACK) / 2);
  // The front panel, with a window cut out for the reels
  const bev = 0.018;
  const panelShape = rrect(new THREE.Shape(), 0, CAB_Y + CAB_H / 2, CAB_W - 2 * bev, CAB_H - 2 * bev, 0.04);
  panelShape.holes.push(rrect(new THREE.Path(), 0, WIN_Y, WIN_W + 2 * bev, WIN_H + 2 * bev, 0.035));
  const panel = add(new THREE.Mesh(new THREE.ExtrudeGeometry(panelShape, {
    depth: FACE_Z - BODY_FRONT - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 10,
  }), paint));
  panel.position.z = BODY_FRONT + bev;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W, WIN_H), black);
  backdrop.position.set(0, WIN_Y, BODY_FRONT + 0.001);
  machine.add(backdrop);
  // Chrome bezel around the window
  const bezelShape = rrect(new THREE.Shape(), 0, WIN_Y, WIN_W + 0.05, WIN_H + 0.05, 0.05);
  bezelShape.holes.push(rrect(new THREE.Path(), 0, WIN_Y, WIN_W + 0.008, WIN_H + 0.008, 0.032));
  add(new THREE.Mesh(new THREE.ExtrudeGeometry(bezelShape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 }), chrome)).position.z = FACE_Z;

  // ---- Reels ----
  const reels = STRIPS.map((strip, i) => {
    const sharp = reelCanvas(strip);
    const tSharp = keep(tex(sharp, renderer));
    const tSoft = keep(tex(blurCanvas(sharp), renderer));
    const mat = new THREE.MeshStandardMaterial({ map: tSharp, roughness: 0.6, color: 0xe2ddd4, envMapIntensity: 0.5 });
    const geo = new THREE.CylinderGeometry(REEL_R, REEL_R, REEL_W, 96, 1, true);
    geo.rotateZ(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((i - 1) * (REEL_W + REEL_GAP), WIN_Y, BODY_FRONT);
    mesh.receiveShadow = true;
    machine.add(mesh);
    const stop = Math.floor(rand() * N);
    return { mesh, mat, tSharp, tSoft, phi: -(stop + 0.5) * STEP, plan: null, done: true, cell: 0 };
  });
  for (const x of [-0.5, 0.5]) {
    const divider = add(new THREE.Mesh(new THREE.BoxGeometry(0.008, WIN_H, 0.2), chrome));
    divider.position.set(x * (REEL_W + REEL_GAP), WIN_Y, BODY_FRONT + 0.1);
  }
  const payMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.3), transparent: true, opacity: 0.85 });
  const payline = new THREE.Mesh(new THREE.BoxGeometry(WIN_W - 0.01, 0.005, 0.003), payMat);
  payline.position.set(0, WIN_Y, BODY_FRONT + REEL_R + 0.008);
  machine.add(payline);
  for (const side of [-1, 1]) {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 3), payMat);
    arrow.rotation.z = side * Math.PI / 2;
    arrow.position.set(side * (WIN_W / 2 + 0.045), WIN_Y, FACE_Z + 0.012);
    machine.add(arrow);
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W, WIN_H), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.04, roughness: 0.05, envMapIntensity: 0.5, depthWrite: false,
  }));
  glass.position.set(0, WIN_Y, FACE_Z - 0.003);
  machine.add(glass);

  // ---- LED ticker, coin chute and tray ----
  const led = makeTicker(renderer);
  keep(led.texture);
  add(new THREE.Mesh(new RoundedBoxGeometry(0.585, 0.095, 0.02, 2, 0.008), black)).position.set(0, 0.355, FACE_Z);
  led.mesh.position.set(0, 0.355, FACE_Z + 0.0105);
  machine.add(led.mesh);
  add(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.055, 0.02, 2, 0.01), black)).position.set(0, 0.245, FACE_Z);
  add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.035, 0.16, 3, 0.012), chrome)).position.set(0, 0.15, FACE_Z + 0.06);
  add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.07, 0.02, 2, 0.008), chrome)).position.set(0, 0.175, FACE_Z + 0.135);

  // ---- Marquee ----
  const archShape = new THREE.Shape();
  archShape.moveTo(ARCH_R, 0);
  archShape.absarc(0, 0, ARCH_R, 0, Math.PI, false);
  archShape.lineTo(ARCH_R, 0);
  add(new THREE.Mesh(new THREE.ExtrudeGeometry(archShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 48 }), paint))
    .position.set(0, TOP_Y - 0.01, -0.07);
  const sign = new THREE.Mesh(new THREE.CircleGeometry(ARCH_R - 0.025, 64, 0, Math.PI), new THREE.MeshBasicMaterial({ map: keep(tex(signCanvas(), renderer)), color: new THREE.Color(1.25, 1.25, 1.25) }));
  sign.position.set(0, TOP_Y - 0.01, 0.247);
  machine.add(sign);
  add(new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.004, 0.014, 12, 72, Math.PI), gold)).position.set(0, TOP_Y - 0.01, 0.245);

  // ---- Light bulbs: around the marquee, then down the right edge and up the left ----
  const bulbPos = [];
  for (let k = 0; k < 19; k++) {
    const a = Math.PI - (Math.PI * (k + 0.5)) / 19;
    bulbPos.push([Math.cos(a) * (ARCH_R + 0.004), TOP_Y - 0.01 + Math.sin(a) * (ARCH_R + 0.004), 0.262]);
  }
  for (let k = 0; k < 9; k++) bulbPos.push([CAB_W / 2 - 0.034, 0.9 - k * 0.088, FACE_Z + 0.008]);
  for (let k = 0; k < 9; k++) bulbPos.push([-(CAB_W / 2 - 0.034), 0.9 - (8 - k) * 0.088, FACE_Z + 0.008]);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
  const m4 = new THREE.Matrix4();
  bulbPos.forEach((p, k) => { bulbs.setMatrixAt(k, m4.makeTranslation(p[0], p[1], p[2])); bulbs.setColorAt(k, new THREE.Color(1, 1, 1)); });
  machine.add(bulbs);

  // ---- Googly eyes: the pupils roll around under gravity and rattle when the machine moves ----
  const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.2, clearcoat: 1 });
  const eyes = [-1, 1].map(side => {
    const white = add(new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 40, 20), eyeWhite));
    white.scale.z = 0.42;
    white.position.set(side * 0.145, EYE_Y, FACE_Z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(EYE_R, 0.004, 8, 48), black);
    ring.position.set(side * 0.145, EYE_Y, FACE_Z + 0.002);
    machine.add(ring);
    const pupil = add(new THREE.Mesh(new THREE.SphereGeometry(PUPIL_R, 28, 14), pupilMat));
    pupil.scale.z = 0.25;
    return { side, pupil, p: new THREE.Vector2(0, -PUPIL_MAX), v: new THREE.Vector2() };
  });

  // ---- The lever ----
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.05, 32).rotateZ(Math.PI / 2), chrome)).position.set(CAB_W / 2 + 0.02, LEVER_Y, LEVER_Z);
  const lever = new THREE.Group();
  lever.position.set(CAB_W / 2 + 0.06, LEVER_Y, LEVER_Z);
  machine.add(lever);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), chrome), lever);
  const rod = add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.36, 16), chrome), lever);
  rod.position.y = 0.18;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), chrome), lever).position.y = 0.34;
  const knob = add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 36, 24), new THREE.MeshPhysicalMaterial({ color: 0xe0101e, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })), lever);
  knob.position.y = 0.4;
  // Generous invisible targets so the lever is easy to grab with a thumb
  const grabMat = new THREE.MeshBasicMaterial({ visible: false });
  const grabs = [[0.14, 0.37], [0.1, 0.2]].map(([r, y]) => {
    const g = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), grabMat);
    g.position.y = y;
    lever.add(g);
    return g;
  });
  const lv = { a: LEVER_REST };

  // ---- The duck ----
  const duck = new THREE.Group();
  const duckMat = new THREE.MeshPhysicalMaterial({ color: 0xffcf1a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const beakMat = new THREE.MeshPhysicalMaterial({ color: 0xff7a12, roughness: 0.35, clearcoat: 0.8 });
  add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 36, 24), duckMat), duck).scale.set(1.28, 0.82, 1);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 32, 20), duckMat), duck).position.set(0.075, 0.105, 0);
  const beak = add(new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 12), beakMat), duck);
  beak.scale.set(1.35, 0.42, 1);
  beak.position.set(0.142, 0.09, 0);
  const eyeBlack = new THREE.MeshPhysicalMaterial({ color: 0x080808, roughness: 0.1, clearcoat: 1 });
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 10), eyeBlack), duck).position.set(0.112, 0.128, s * 0.046);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), glint);
    shine.position.set(0.121, 0.134, s * 0.05);
    duck.add(shine);
    const wing = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 12), duckMat), duck);
    wing.scale.set(1, 0.55, 0.32);
    wing.position.set(-0.015, 0.01, s * 0.088);
  }
  const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 20), duckMat), duck);
  tail.position.set(-0.125, 0.045, 0);
  tail.rotation.z = 0.95;
  const DUCK_Y = TOP_Y - 0.01 + ARCH_R + 0.07;
  duck.position.set(-0.02, DUCK_Y, 0.06);
  machine.add(duck);
  const duckFx = { hop: 0, spin: 0, lean: 0, shake: 0 };

  // ---- Coins (one instanced mesh, simple ballistic physics) ----
  const MAX_COINS = 180;
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, 0.006, 24), new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.28 }), MAX_COINS);
  coins.castShadow = true;
  coins.frustumCulled = false;
  coins.count = 0;
  scene.add(coins);
  const live = [];
  const spray = { left: 0, rate: 0, acc: 0 };
  function sprayCoins(n, seconds = 0.6) {
    spray.left += n;
    spray.rate = Math.max(spray.rate, n / Math.max(0.1, seconds));
  }
  function spawnCoin() {
    if (live.length >= MAX_COINS) live.shift();
    live.push({
      p: new THREE.Vector3(gsap.utils.random(-0.07, 0.07), 0.25, FACE_Z + 0.02),
      v: new THREE.Vector3(gsap.utils.random(-0.75, 0.75), gsap.utils.random(0.9, 2.3), gsap.utils.random(0.7, 1.7)),
      r: new THREE.Euler(gsap.utils.random(0, TAU), gsap.utils.random(0, TAU), 0),
      w: new THREE.Vector3(gsap.utils.random(-14, 14), gsap.utils.random(-6, 6), gsap.utils.random(-14, 14)),
      rest: 0, age: 0,
    });
  }
  const q = new THREE.Quaternion(), sc = new THREE.Vector3();
  function stepCoins(dt) {
    if (spray.left > 0) {
      spray.acc += spray.rate * dt;
      while (spray.acc >= 1 && spray.left > 0) { spawnCoin(); spray.acc--; spray.left--; }
    } else spray.rate = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const c = live[i];
      c.age += dt;
      if (c.rest > 0) c.rest += dt;
      if (c.rest > 2.5 || c.age > 9) { live.splice(i, 1); continue; }
      if (!c.rest) {
        c.v.y -= 6.5 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        if (c.p.y < 0.004) {
          c.p.y = 0.004;
          c.v.y *= -0.35;
          c.v.x *= 0.6;
          c.v.z *= 0.6;
          c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.25) { c.rest = 0.001; c.r.x = 0; c.r.z = 0; }
        }
      }
    }
    coins.count = live.length;
    live.forEach((c, i) => {
      const s = c.rest > 2 ? Math.max(0.001, 1 - (c.rest - 2) / 0.5) : 1;
      q.setFromEuler(c.r);
      coins.setMatrixAt(i, m4.compose(c.p, q, sc.set(s, s, s)));
    });
    coins.instanceMatrix.needsUpdate = true;
  }

  // ---- DOM layers: the win title, floating amounts, confetti and the payout table ----
  const fx = document.createElement('div');
  fx.className = 'slot-fx';
  fx.innerHTML = '<div class="slot-title"></div><div class="slot-amount"></div>';
  const titleEl = fx.querySelector('.slot-title');
  const amountEl = fx.querySelector('.slot-amount');
  const floatEl = document.createElement('div');
  floatEl.className = 'slot-float';
  const confettiCanvas = document.createElement('canvas');
  confettiCanvas.className = 'slot-confetti';
  const pays = document.createElement('div');
  pays.className = 'slot-pays';
  pays.hidden = true;
  const glyphHTML = s => (s === 'seven' ? '<span class="slot-7">7</span>' : GLYPH[s]);
  const rows = Object.keys(PAYS).reverse().map(s => `<tr><td>${glyphHTML(s).repeat(3)}</td><td>${s === 'duck' ? 'Duck jackpot' : NAME[s]}</td><td>${PAYS[s]}×</td></tr>`).join('');
  pays.innerHTML = `<h3>Payouts</h3>
    <table>${rows}<tr><td>${GLYPH.cherry}${GLYPH.cherry}</td><td>Any two cherries</td><td>${TWO_CHERRIES}×</td></tr></table>
    <p>Pays on the middle line, as a multiple of your bet. The ${GLYPH.duck} is wild: it counts as whatever completes a win.</p>
    <div class="slot-row"></div>`;
  const bribeBtn = button('Bribe the duck', () => {
    rigged = true;
    led.say(pick(QUIPS.bribe), { color: '#7cff6b' });
    sound.quack();
    pays.hidden = true;
    paysBtn.setAttribute('aria-pressed', 'false');
  });
  pays.querySelector('.slot-row').append(bribeBtn, button('Close', () => { pays.hidden = true; paysBtn.setAttribute('aria-pressed', 'false'); }));
  stage.append(confettiCanvas, fx, floatEl, pays);
  const fire = confetti.create(confettiCanvas, { resize: true, useWorker: true });
  const coinShape = confetti.shapeFromPath({ path: 'M10 0a10 10 0 1 0 0.001 0zM10 3a7 7 0 1 1-0.001 0z' });
  const duckShape = confetti.shapeFromText({ text: '🦆', scalar: 2.2 });

  // ---- State ----
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { /* storage unavailable */ }
  let credits = Number.isFinite(saved.credits) && saved.credits >= 0 ? saved.credits : START_CREDITS;
  let bet = BETS.includes(saved.bet) ? saved.bet : 25;
  let rigged = false;
  const sound = makeSound();
  sound.on = saved.sound !== false;
  const persist = () => {
    try { localStorage.setItem(STORE, JSON.stringify({ credits, bet, sound: sound.on })); } catch (e) { /* storage unavailable */ }
  };
  const st = { spinning: false, t0: 0, line: null, tease: 0, teased: false };
  let mode = 'idle', modeUntil = 0, idleNext = 0;
  const camFx = { dolly: 0 };
  const shake = { amp: 0 };
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  let titleTl = null;

  function hud(extra) {
    info.textContent = extra || `Credits ${money(credits)} · Bet ${money(bet)}`;
    betBtn.textContent = `Bet ${money(bet)}`;
  }
  function setMode(m, seconds) {
    mode = m;
    modeUntil = seconds ? performance.now() / 1000 + seconds : 0;
  }
  function jolt(a) { shake.amp = Math.max(shake.amp, a); }
  function kickEyes(strength) {
    for (const e of eyes) e.v.add(new THREE.Vector2(gsap.utils.random(-1, 1) * strength, gsap.utils.random(0.3, 1) * strength));
  }
  function hop(h = 0.05) {
    gsap.timeline().to(duckFx, { hop: h, duration: 0.14, ease: 'power2.out' }).to(duckFx, { hop: 0, duration: 0.32, ease: 'bounce.out' });
  }

  // ---- A pull ----
  function pull(power = 1) {
    if (st.spinning) return false;
    sound.unlock();
    if (credits < BETS[0]) {
      credits += START_CREDITS;
      persist();
      hud();
      led.say('OUT OF CREDITS. THE DUCK LENT YOU $1,000. NO INTEREST. JUST QUACKS.', { color: '#7cff6b' });
      sound.quack();
      sound.quack(0.25);
      sprayCoins(25, 0.8);
      hop(0.08);
      return false;
    }
    if (credits < bet) {
      bet = [...BETS].reverse().find(b => b <= credits);
      persist();
      hud();
      led.say(`BET LOWERED TO ${money(bet)}. THE DUCK BELIEVES IN YOU.`);
      return false;
    }
    credits -= bet;
    persist();
    hideTitle();
    pays.hidden = true;
    paysBtn.setAttribute('aria-pressed', 'false');
    const line = rigged ? ['duck', 'duck', 'duck'] : [0, 1, 2].map(() => randomSymbol(rand));
    rigged = false;
    const stops = line.map((s, i) => stopFor(i, s, rand));
    const potential = bestPossible(line[0], line[1]);
    st.tease = calm ? 0 : potential >= 100 ? 2 : potential >= 12 ? 1 : 0;
    st.teased = false;
    const extra = calm ? 0 : Math.min(1.2, Math.max(0, power - 1) * 0.6);
    const first = calm ? 0.25 : 0.95 + extra;
    const gap = calm ? 0.2 : 0.5;
    reels.forEach((r, i) => {
      r.phi = ((r.phi % TAU) + TAU) % TAU;
      let stopAt = first + i * gap, Td = calm ? 0.2 : 0.55;
      if (i === 2 && st.tease) { stopAt += st.tease === 2 ? 2.6 : 1.5; Td = st.tease === 2 ? 2.4 : 1.6; }
      r.plan = planReel(r.phi, stopAt, Td, stops[i], calm);
      r.done = false;
      r.cell = Math.floor(r.phi / STEP);
    });
    st.spinning = true;
    st.t0 = performance.now() / 1000;
    st.line = line;
    setMode('spin');
    led.say(power > 1.6 ? pick(QUIPS.turbo) : pick(QUIPS.spin));
    hud('Spinning…');
    jolt(0.012);
    kickEyes(0.9);
    buzz(20);
    sound.pull();
    return true;
  }
  function springBack() {
    gsap.killTweensOf(lv);
    gsap.to(lv, { a: LEVER_REST, duration: 0.9, ease: 'elastic.out(1, 0.32)' });
    sound.boing();
  }
  let pulling = false;
  function autoPull() {
    if (st.spinning || pulling) return;
    sound.unlock();
    pulling = true;
    gsap.killTweensOf(lv);
    let lastClick = 0;
    gsap.to(lv, {
      a: LEVER_PULLED, duration: 0.3, ease: 'power2.in',
      onUpdate() {
        const t = (lv.a - LEVER_REST) / (LEVER_PULLED - LEVER_REST);
        if (t - lastClick > 0.2) { lastClick = t; sound.ratchet(); }
      },
      onComplete() { pulling = false; pull(1); springBack(); },
    });
  }

  function reelStopped(i) {
    sound.clunk();
    buzz(12);
    jolt(0.005);
    kickEyes(0.35);
    hop(0.03);
    if (i === 1 && st.tease && !st.teased) {
      st.teased = true;
      setMode('tease');
      led.say(pick(QUIPS.tease), { flash: true, color: '#ff5d6c' });
      gsap.to(camFx, { dolly: st.tease === 2 ? 0.92 : 0.5, duration: 1.1, ease: 'power2.inOut' });
      gsap.to(duckFx, { lean: -0.38, duration: 0.6, ease: 'power2.out' });
      sound.drum(st.tease === 2 ? 4.2 : 2.8);
    }
    if (reels.every(r => r.done)) finish();
  }

  function finish() {
    st.spinning = false;
    const res = evaluate(st.line);
    const win = bet * res.mult;
    credits += win;
    persist();
    hud(win ? `Won ${money(win)}! · Credits ${money(credits)}` : undefined);
    gsap.to(camFx, { dolly: 0, duration: 1, ease: 'power2.inOut', delay: res.kind === 'lose' ? 0.4 : 1.2 });
    gsap.to(duckFx, { lean: 0, duration: 0.6 });
    if (res.kind === 'lose') {
      setMode('lose', 1.4);
      if (st.tease) { led.say(pick(QUIPS.near), { color: '#ff5d6c' }); sound.sad(); }
      else { led.say(pick(QUIPS.lose)); sound.boop(); }
      gsap.fromTo(duckFx, { shake: 0 }, { shake: 0.5, duration: 0.09, yoyo: true, repeat: 5, ease: 'sine.inOut', onComplete: () => { duckFx.shake = 0; } });
      return;
    }
    floatText(`+${money(win)}`);
    if (res.kind === 'small') {
      setMode('win', 1.5);
      led.say(`${pick(QUIPS.small)} +${money(win)}`, { color: '#7cff6b' });
      sound.win(1);
      sprayCoins(5);
      buzz([10, 40, 10]);
      hop(0.05);
    } else if (res.kind === 'win') {
      setMode('win', 2.6);
      led.say(`${pick(QUIPS.win)} +${money(win)}`, { color: '#7cff6b', flash: true });
      sound.win(2);
      sprayCoins(Math.min(45, 10 + res.mult * 2), 1);
      buzz([15, 50, 25]);
      hop(0.08);
      later(() => hop(0.06), 450);
    } else if (res.kind === 'big') {
      setMode('party', 4.5);
      led.say(`${pick(QUIPS.big)} +${money(win)}`, { color: '#ffd23f', flash: true });
      sound.win(3);
      later(() => sound.fanfare(), 350);
      showTitle('BIG WIN', win, false);
      sprayCoins(90, 2.2);
      jolt(0.03);
      kickEyes(2);
      buzz([30, 40, 60]);
      for (let k = 0; k < 4; k++) later(() => hop(0.09), k * 380);
      if (!calm) cannons(1);
    } else {
      setMode('jackpot', 7);
      const ducks = res.sym === 'duck';
      led.say(`${ducks ? 'DUCK ' : ''}JACKPOT!!! +${money(win)} ${pick(QUIPS.jackpot)}`, { color: '#ffd23f', flash: true });
      sound.fanfare();
      for (let k = 0; k < 6; k++) sound.quack(0.9 + k * 0.22);
      showTitle(ducks ? 'DUCK JACKPOT' : 'JACKPOT', win, true);
      sprayCoins(170, 3.6);
      jolt(0.05);
      kickEyes(3.5);
      buzz([40, 40, 80, 40, 120]);
      if (!calm) {
        gsap.timeline()
          .to(duckFx, { hop: 0.9, spin: duckFx.spin + TAU * 3, duration: 0.9, ease: 'power2.out' })
          .to(duckFx, { hop: 0, duration: 0.8, ease: 'bounce.out' });
        cannons(2);
        later(() => cannons(2), 1300);
      }
    }
  }

  function floatText(text) {
    const p = new THREE.Vector3(0, WIN_Y + 0.06, FACE_Z).applyMatrix4(machine.matrixWorld).project(camera);
    floatEl.textContent = text;
    floatEl.style.left = `${((p.x + 1) / 2) * stage.clientWidth}px`;
    floatEl.style.top = `${((1 - p.y) / 2) * stage.clientHeight}px`;
    gsap.killTweensOf(floatEl);
    gsap.timeline()
      .fromTo(floatEl, { xPercent: -50, yPercent: -50, y: 10, scale: 0.5, opacity: 0 }, { y: -50, scale: 1.15, opacity: 1, duration: 0.45, ease: 'back.out(2.5)' })
      .to(floatEl, { y: -90, opacity: 0, duration: 0.6, ease: 'power1.in' }, '+=0.9');
  }
  function showTitle(text, amount, jackpot) {
    hideTitle();
    titleEl.innerHTML = [...text].map(ch => (ch === ' ' ? '<span class="gap"></span>' : `<span>${ch}</span>`)).join('');
    titleEl.style.fontSize = `min(17vw, 84px, ${(128 / text.length).toFixed(1)}vw)`;
    const letters = titleEl.querySelectorAll('span');
    const counter = { v: 0 };
    amountEl.textContent = '+$0';
    gsap.set(fx, { opacity: 1 });
    titleTl = gsap.timeline()
      .fromTo(letters, { y: 90, scale: 0.2, opacity: 0, rotation: () => gsap.utils.random(-40, 40) },
        { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'back.out(3)', stagger: 0.05 })
      .fromTo(amountEl, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, 0.4)
      .to(counter, { v: amount, duration: jackpot ? 2.6 : 1.6, ease: 'power3.out', onUpdate: () => { amountEl.textContent = '+' + money(counter.v); } }, 0.45)
      .to(fx, { opacity: 0, duration: 0.5 }, jackpot ? 5.5 : 3.6);
    // Goofy wobble while it's up
    gsap.to(letters, { y: -9, rotation: () => gsap.utils.random(-7, 7), duration: 0.32, yoyo: true, repeat: jackpot ? 15 : 9, ease: 'sine.inOut', stagger: 0.05, delay: 0.9 });
  }
  function hideTitle() {
    if (titleTl) titleTl.kill();
    titleTl = null;
    gsap.killTweensOf([fx, amountEl, ...titleEl.children]);
    gsap.set(fx, { opacity: 0 });
  }
  function cannons(power) {
    const party = ['#ffd56b', '#ff3fa4', '#3fe0ff', '#7cff6b', '#ffffff'];
    for (const [x, angle] of [[0, 62], [1, 118]]) {
      fire({ particleCount: Math.round(70 * power), angle, spread: 60, startVelocity: 60, origin: { x, y: 1 }, colors: party, ticks: 260 });
      fire({ particleCount: Math.round(10 * power), angle, spread: 50, startVelocity: 55, origin: { x, y: 1 }, shapes: [duckShape, coinShape], colors: ['#ffd56b'], scalar: 2, ticks: 300 });
    }
  }

  // ---- Lever dragging ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const drag = { on: false, id: 0, y0: 0, t: 0, down: 0, lastY: 0, lastT: 0, vel: 0, click: 0 };
  function overLever(e) {
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects([...grabs, knob, rod], false).length > 0;
  }
  function onDown(e) {
    if (st.spinning || pulling || !overLever(e)) return;
    sound.unlock();
    gsap.killTweensOf(lv);
    Object.assign(drag, { on: true, id: e.pointerId, y0: e.clientY, t: (lv.a - LEVER_REST) / (LEVER_PULLED - LEVER_REST), down: performance.now(), lastY: e.clientY, lastT: performance.now(), vel: 0, click: 0 });
    drag.y0 -= drag.t * Math.max(120, stage.clientHeight * 0.3);
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
    canvasEl.style.cursor = 'grabbing';
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag.on) {
      if (e.pointerType === 'mouse') canvasEl.style.cursor = !st.spinning && overLever(e) ? 'grab' : '';
      return;
    }
    if (e.pointerId !== drag.id) return;
    const range = Math.max(120, stage.clientHeight * 0.3);
    const t = Math.min(1, Math.max(0, (e.clientY - drag.y0) / range));
    if (Math.abs(t - drag.click) > 0.12) { drag.click = t; sound.ratchet(); buzz(3); }
    drag.t = t;
    lv.a = LEVER_REST + t * (LEVER_PULLED - LEVER_REST);
    const now = performance.now();
    if (now > drag.lastT) drag.vel = 0.6 * drag.vel + 0.4 * ((e.clientY - drag.lastY) / (now - drag.lastT));
    drag.lastY = e.clientY;
    drag.lastT = now;
    for (const eye of eyes) eye.v.x += 0.02;   // they watch you do it
  }
  function onUp(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    canvasEl.style.cursor = '';
    const quick = performance.now() - drag.down < 260 && drag.t < 0.08;
    if (quick) { autoPull(); return; }
    if (drag.t > 0.55) pull(1 + Math.min(3, Math.max(0, drag.vel - 0.8)) * 0.5);
    springBack();
  }
  canvasEl.addEventListener('pointerdown', onDown);
  canvasEl.addEventListener('pointermove', onMove);
  canvasEl.addEventListener('pointerup', onUp);
  canvasEl.addEventListener('pointercancel', onUp);
  function onKey(e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    autoPull();
  }
  window.addEventListener('keydown', onKey);

  // ---- Controls ----
  const betBtn = button('', () => {
    if (st.spinning) return;
    bet = BETS[(BETS.indexOf(bet) + 1) % BETS.length];
    persist();
    hud();
    buzz(5);
  });
  const pullBtn = button('Pull', autoPull, 'primary');
  const paysBtn = button('Payouts', () => {
    pays.hidden = !pays.hidden;
    paysBtn.setAttribute('aria-pressed', String(!pays.hidden));
  });
  paysBtn.setAttribute('aria-pressed', 'false');
  const soundBtn = button('', () => {
    sound.on = !sound.on;
    if (sound.on) { sound.unlock(); sound.quack(); }
    persist();
    soundLabel();
  });
  const soundLabel = () => {
    soundBtn.textContent = sound.on ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
    soundBtn.setAttribute('aria-pressed', String(sound.on));
  };
  soundLabel();
  controls.append(betBtn, pullBtn, paysBtn, soundBtn);
  hud();
  led.say(pick(QUIPS.idle));

  // ---- Loop ----
  const col = new THREE.Color();
  const look = new THREE.Vector3();
  const base = new THREE.Vector3();
  const close = new THREE.Vector3();
  const reelFocus = new THREE.Vector3(0, WIN_Y, FACE_Z);
  let raf = 0;
  let last = performance.now();
  let lastTick = 0;
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    fit();

    // Reels
    if (st.spinning) {
      const t = now - st.t0;
      reels.forEach((r, i) => {
        if (r.done) return;
        r.phi = angleAt(r.plan, t);
        r.mat.map = speedAt(r.plan, t) > 7 ? r.tSoft : r.tSharp;
        const cell = Math.floor(r.phi / STEP);
        if (cell !== r.cell) { r.cell = cell; if (nowMs - lastTick > 38) { lastTick = nowMs; sound.tick(); } }
        if (t >= r.plan.end) {
          r.done = true;
          r.phi = r.plan.phiT;
          r.mat.map = r.tSharp;
          reelStopped(i);
        }
      });
    }
    for (const r of reels) r.mesh.rotation.x = r.phi;

    // Lever
    lever.rotation.x = lv.a;

    // Shake the whole machine, and let the duck do its thing
    shake.amp *= Math.pow(0.015, dt);
    machine.position.set((Math.random() * 2 - 1) * shake.amp, Math.random() * shake.amp * 0.5, 0);
    machine.rotation.z = (Math.random() - 0.5) * shake.amp * 0.8;
    duck.position.y = DUCK_Y + Math.sin(now * 2.2) * 0.006 + duckFx.hop;
    duck.rotation.set(0, -0.85 + Math.sin(now * 0.6) * 0.18 + duckFx.spin + Math.sin(now * 40) * duckFx.shake * 0.5, Math.sin(now * 1.9) * 0.05 + duckFx.lean);

    // Googly eyes
    const swirl = st.spinning && !st.teased ? 2.6 : 0;
    for (const e of eyes) {
      const ax = (Math.random() - 0.5) * shake.amp * 900 - e.p.y * swirl * e.side * 60 + (st.teased && st.spinning ? 0.9 : 0);
      const ay = -1.7 + (Math.random() - 0.5) * shake.amp * 900 + e.p.x * swirl * e.side * 60;
      e.v.x += ax * dt;
      e.v.y += ay * dt;
      e.v.multiplyScalar(Math.pow(0.5, dt));
      e.p.addScaledVector(e.v, dt);
      const r = e.p.length();
      if (r > PUPIL_MAX) {
        const nx = e.p.x / r, ny = e.p.y / r;
        e.p.set(nx * PUPIL_MAX, ny * PUPIL_MAX);
        const vn = e.v.x * nx + e.v.y * ny;
        if (vn > 0) { e.v.x -= 1.45 * vn * nx; e.v.y -= 1.45 * vn * ny; e.v.multiplyScalar(0.93); }
      }
      const rr = Math.min(EYE_R * 0.98, Math.hypot(e.p.x, e.p.y));
      e.pupil.position.set(e.side * 0.145 + e.p.x, EYE_Y + e.p.y, FACE_Z + 0.42 * Math.sqrt(EYE_R * EYE_R - rr * rr) + 0.003);
    }

    // Bulbs
    if (modeUntil && now > modeUntil) { setMode('idle'); idleNext = now + 6; }
    if (mode === 'idle' && !st.spinning && now > idleNext) { idleNext = now + 9; if (now - st.t0 > 8) led.say(pick(QUIPS.idle)); }
    const n = bulbPos.length;
    for (let k = 0; k < n; k++) {
      let on = 0.18, hue = -1;
      if (mode === 'idle') on = (k + Math.floor(now * 4)) % 3 === 0 ? 1 : 0.16;
      else if (mode === 'spin') on = (k + Math.floor(now * 16)) % 3 === 0 ? 1 : 0.14;
      else if (mode === 'tease') on = Math.floor(now * 12) % 2 ? 1 : 0.08;
      else if (mode === 'win') on = (k + Math.floor(now * 8)) % 2 ? 1 : 0.1;
      else if (mode === 'party') { on = (k + Math.floor(now * 20)) % 4 < 2 ? 1 : 0.1; hue = (k / n + now * 0.5) % 1; }
      else if (mode === 'jackpot') { on = Math.random() < 0.75 ? 1 : 0.2; hue = ((k / n) * 2 + now * 1.5) % 1; }
      else if (mode === 'lose') on = 0.1 + Math.random() * 0.08;
      if (hue < 0) col.setRGB(3.2 * on, 2.4 * on, 1.1 * on);
      else col.setHSL(hue, 1, 0.55).multiplyScalar(3.4 * on);
      bulbs.setColorAt(k, col);
    }
    bulbs.instanceColor.needsUpdate = true;
    const glow = mode === 'win' || mode === 'party' || mode === 'jackpot' ? 1.5 + Math.sin(now * 18) * 1.5 : 1;
    payMat.color.setRGB(3 * glow, 0.25 * glow, 0.3 * glow);

    stepCoins(dt);
    led.draw(now);

    // Camera: a slow drift, plus a dolly toward the reels while one is teasing you
    base.set(view.target.x + Math.sin(now * 0.35) * 0.04, view.target.y + 0.16, view.dist);
    close.set(0, WIN_Y + 0.05, FACE_Z + view.close);
    camera.position.lerpVectors(base, close, camFx.dolly);
    look.lerpVectors(view.target, reelFocus, camFx.dolly);
    camera.lookAt(look);

    composer.render(dt);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      hideTitle();
      gsap.killTweensOf([lv, camFx, duckFx, floatEl]);
      canvasEl.removeEventListener('pointerdown', onDown);
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      fire.reset();
      sound.close();
      for (const el of [confettiCanvas, fx, floatEl, pays, style]) el.remove();
      disposeScene(scene);
      for (const t of textures) t.dispose();
      bloom.dispose();
      composer.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasEl.remove();
    },
  };
}
