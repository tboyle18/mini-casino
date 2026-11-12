// Big-win celebration: GSAP choreography plus canvas-confetti.
//
// A light-ray sunburst, a gold title that bounces in letter by letter with a shine
// sweeping across it, the winnings counting up, and confetti, coins and sparkles.
// Three flavours: a roulette big win, a blackjack (card suits fly), and a jackpot.

import { gsap } from 'gsap';
import confetti from 'canvas-confetti';
import { buzz, reducedMotion } from './shared.js';

const CSS = `
.win-stage { position: absolute; inset: 0; overflow: hidden; display: grid; place-items: center;
  background: radial-gradient(ellipse 90% 70% at 50% 42%, #1c8c5a 0%, #0c5636 45%, #062a1a 100%); }
.win-stage.dim::after { content: ""; position: absolute; inset: 0; background: rgba(0, 0, 0, .35); pointer-events: none; }
.win-idle { position: relative; z-index: 2; text-align: center; color: rgba(245,240,227,.7); font-weight: 700; padding: 0 30px; }
.win-idle b { display: block; color: #e9c46a; font-size: 26px; font-weight: 800; letter-spacing: -.01em; margin-bottom: 6px; }
.win-rays { position: absolute; width: 190vmax; height: 190vmax; left: 50%; top: 46%; margin: -95vmax 0 0 -95vmax; opacity: 0; z-index: 1;
  background: repeating-conic-gradient(from 0deg, rgba(255, 220, 130, .22) 0deg 7deg, transparent 7deg 18deg);
  -webkit-mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.7) 25%, transparent 60%); mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.7) 25%, transparent 60%); }
.win-card { position: relative; z-index: 2; display: grid; justify-items: center; gap: 10px; opacity: 0; pointer-events: none; }
.win-kicker { font-weight: 800; font-size: 13px; letter-spacing: .3em; text-transform: uppercase; color: rgba(255, 240, 200, .85); }
.win-title { position: relative; display: flex; font-weight: 800; font-size: min(19vw, 96px); line-height: .95; letter-spacing: -.02em; white-space: nowrap; }
.win-title span { display: inline-block; background: linear-gradient(180deg, #fff6d6 0%, #ffd56b 38%, #e3a52f 62%, #fff1b8 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 4px 0 #7a5212) drop-shadow(0 10px 24px rgba(0, 0, 0, .55)); }
.win-title .gap { width: .28em; }
.win-shine { position: absolute; inset: -10% -20%; background: linear-gradient(100deg, transparent 35%, rgba(255, 255, 255, .85) 50%, transparent 65%);
  mix-blend-mode: overlay; pointer-events: none; }
.win-amount { font-weight: 800; font-size: min(12vw, 56px); letter-spacing: -.02em; color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 0 18px rgba(255, 210, 110, .8), 0 3px 0 rgba(0, 0, 0, .35); }
.win-hint { margin-top: 14px; font-size: 13px; font-weight: 700; color: rgba(245,240,227,.55); opacity: 0; }
.win-canvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3; pointer-events: none; }
/* Over the casino: the whole screen, darkened, above everything */
.win-layer { position: fixed; inset: 0; z-index: 1000; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.win-stage.over { background: radial-gradient(ellipse 90% 70% at 50% 42%, rgba(16, 52, 34, .9) 0%, rgba(4, 3, 2, .95) 100%); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.win-stage.over.dim::after { display: none; }
`;

const GOLDS = ['#ffe9a3', '#ffd56b', '#f4c046', '#e3a52f', '#fff6d6'];
const PARTY = ['#ffd56b', '#ff5d6c', '#4cc3ff', '#7cf29a', '#ffffff', '#c58bff'];

const FLAVOURS = {
  big: { label: 'Big win', title: 'BIG WIN', kicker: 'Roulette · 17 Black', amount: 12500, coins: 1, confetti: 1, shake: 0 },
  bj: { label: 'Blackjack!', title: 'BLACKJACK', kicker: 'Pays 3 to 2', amount: 1500, coins: 0.4, confetti: 1, suits: true, shake: 0 },
  jackpot: { label: 'Jackpot', title: 'JACKPOT', kicker: 'All on 0 · 35 to 1', amount: 1000000, coins: 2.4, confetti: 1.8, shake: 1, long: 1 },
};

/* The celebration's layer inside parent, with play(f) and clear(). The demo below and the
   casino's celebrate() both use it. */
function createStage(parent, label = () => {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'win-stage';
  root.innerHTML = `
    <div class="win-rays"></div>
    <div class="win-idle"><b>Pick a win below</b>Each one plays a different celebration.</div>
    <div class="win-card">
      <div class="win-kicker"></div>
      <div class="win-title"></div>
      <div class="win-amount">$0</div>
      <div class="win-hint">Tap to collect</div>
    </div>
    <canvas class="win-canvas"></canvas>`;
  parent.appendChild(root);
  const rays = root.querySelector('.win-rays');
  const idle = root.querySelector('.win-idle');
  const card = root.querySelector('.win-card');
  const kicker = root.querySelector('.win-kicker');
  const title = root.querySelector('.win-title');
  const amountEl = root.querySelector('.win-amount');
  const hint = root.querySelector('.win-hint');
  const fire = confetti.create(root.querySelector('.win-canvas'), { resize: true, useWorker: true });

  const coin = confetti.shapeFromPath({ path: 'M10 0a10 10 0 1 0 0.001 0zM10 3a7 7 0 1 1-0.001 0z' });
  const suits = ['♠', '♥', '♦', '♣'].map((t, i) => confetti.shapeFromText({ text: t, scalar: 2.4, color: i === 1 || i === 2 ? '#e0313f' : '#14161a' }));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const calm = reducedMotion();

  let tl = null;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function clear() {
    if (tl) tl.kill();
    tl = null;
    for (const t of timers) clearTimeout(t);
    timers = [];
    gsap.killTweensOf([rays, card, root, hint, kicker, amountEl, ...title.children]);
    fire.reset();
  }

  function play(f) {
    clear();
    idle.style.display = 'none';
    root.classList.add('dim');
    kicker.textContent = f.kicker;
    title.innerHTML = [...f.title].map(ch => (ch === ' ' ? '<span class="gap"></span>' : `<span>${ch}</span>`)).join('') + '<div class="win-shine"></div>';
    title.style.fontSize = `min(19vw, 96px, ${(140 / f.title.length).toFixed(1)}vw)`;   // long words shrink to fit the screen
    const letters = title.querySelectorAll('span');
    const shine = title.querySelector('.win-shine');
    amountEl.textContent = '$0';
    label(f.label);
    buzz([30, 40, 60]);

    const counter = { v: 0 };
    let lastTick = 0;
    tl = gsap.timeline();
    tl.set(card, { opacity: 1 })
      .fromTo(rays, { scale: 0.2, opacity: 0, rotation: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'power3.out' }, 0)
      .fromTo(kicker, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.15)
      .fromTo(letters, { y: 80, scale: 0.2, opacity: 0, rotation: () => gsap.utils.random(-30, 30) },
        { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.75, ease: 'back.out(3)', stagger: 0.055 }, 0.2)
      .fromTo(amountEl, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, 0.55)
      .to(counter, {
        v: f.amount, duration: f.long ? 3.2 : 2, ease: 'power3.out',
        onUpdate() {
          amountEl.textContent = money(counter.v);
          const step = Math.floor((counter.v / f.amount) * 12);
          if (step > lastTick) { lastTick = step; buzz(6); }
        },
      }, 0.6)
      .fromTo(shine, { xPercent: -120 }, { xPercent: 120, duration: 1.1, ease: 'power2.inOut', repeat: -1, repeatDelay: 0.9 }, 0.9)
      .to(hint, { opacity: 1, duration: 0.5 }, '>-1.6');
    gsap.to(rays, { rotation: 360, duration: 24, ease: 'none', repeat: -1 });
    gsap.to(letters, { y: -6, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: { each: 0.08, from: 'start' }, delay: 1.2 });

    if (f.shake && !calm) {
      gsap.fromTo(root, { x: 0, y: 0 }, { x: 'random(-8, 8)', y: 'random(-6, 6)', duration: 0.05, repeat: 14, yoyo: true, ease: 'none', clearProps: 'x,y', delay: 0.25 });
    }
    if (calm) return;

    // Confetti cannons from both bottom corners
    const cannons = () => {
      fire({ particleCount: Math.round(90 * f.confetti), angle: 62, spread: 58, startVelocity: 62, origin: { x: 0, y: 1 }, colors: PARTY, scalar: 1.1, ticks: 260 });
      fire({ particleCount: Math.round(90 * f.confetti), angle: 118, spread: 58, startVelocity: 62, origin: { x: 1, y: 1 }, colors: PARTY, scalar: 1.1, ticks: 260 });
    };
    later(cannons, 250);
    if (f.confetti > 1) later(cannons, 1100);

    // A burst of gold stars behind the title
    later(() => fire({ particleCount: 70, spread: 360, startVelocity: 28, gravity: 0.6, decay: 0.92, origin: { x: 0.5, y: 0.42 }, shapes: ['star'], colors: GOLDS, scalar: 1.4, ticks: 160 }), 420);

    // Coins rain down from the top for a couple of seconds
    if (f.coins) {
      const until = performance.now() + 2200 * f.coins;
      const rain = () => {
        if (performance.now() > until) return;
        fire({ particleCount: Math.ceil(3 * f.coins), angle: 270, spread: 40, startVelocity: 8, gravity: 1.3, drift: gsap.utils.random(-0.4, 0.4),
          origin: { x: Math.random(), y: -0.08 }, shapes: [coin, 'circle'], colors: GOLDS, scalar: 2.1, ticks: 420, flat: false });
        timers.push(setTimeout(rain, 60));
      };
      later(rain, 500);
    }

    // Card suits for a blackjack
    if (f.suits) {
      later(() => fire({ particleCount: 40, spread: 100, startVelocity: 45, origin: { x: 0.5, y: 0.75 }, shapes: suits, scalar: 2.4, ticks: 300, gravity: 0.9 }), 350);
      later(() => fire({ particleCount: 30, spread: 140, startVelocity: 38, origin: { x: 0.5, y: 0.75 }, shapes: suits, scalar: 2.4, ticks: 300, gravity: 0.9 }), 900);
    }

    // Sparkles twinkling around the title while the amount counts
    const sparkle = () => fire({ particleCount: 6, spread: 360, startVelocity: 6, gravity: 0.15, decay: 0.9, ticks: 70, shapes: ['star'], colors: ['#ffffff', '#ffe9a3'], scalar: 0.9,
      origin: { x: 0.5 + gsap.utils.random(-0.32, 0.32), y: 0.42 + gsap.utils.random(-0.12, 0.12) } });
    for (let i = 0; i < 14; i++) later(sparkle, 700 + i * 180);
  }

  return { root, rays, card, hint, idle, play, clear, isPlaying: () => !!tl };
}

const STYLE_ID = 'win-style';
function addStyle() {
  if (document.getElementById(STYLE_ID)) return null;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return style;
}

/* The casino's big wins: the celebration over the whole screen, for a few seconds or until
   tapped. kind is 'big', 'bj' or 'jackpot'; kicker is the line above the title (the game and
   what won); amount is what you won. Only one plays at a time. */
let current = null;
export function celebrate({ kind = 'big', kicker = '', amount = 0 }) {
  if (current) current.close();
  addStyle();
  const layer = document.createElement('div');
  layer.className = 'win-layer';
  document.body.appendChild(layer);
  const S = createStage(layer);
  S.root.classList.add('over');
  S.idle.remove();
  const f = { ...FLAVOURS[kind] || FLAVOURS.big, kicker, amount: Math.max(0, amount) };
  S.play(f);
  let shut = false;
  const me = {
    close() {
      if (shut) return;
      shut = true;
      clearTimeout(timer);
      S.clear();
      if (current === me) current = null;
      gsap.to(layer, { opacity: 0, duration: 0.3, onComplete: () => layer.remove() });
    },
  };
  const timer = setTimeout(me.close, kind === 'jackpot' ? 7000 : kind === 'bj' ? 4200 : 5500);
  layer.addEventListener('click', me.close);
  current = me;
  return me;
}
