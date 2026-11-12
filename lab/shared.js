// Small helpers shared by the lab demos.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function button(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.className = 'lab-btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function buzz(pattern = 8) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not allowed */ }
}

export const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* A WebGL renderer that fills the stage, with filmic tone mapping, soft shadows and
   studio reflections. Returns a resize() you call before rendering. */
export function makeRenderer(stage, { maxDpr = 2, alpha = false, power = 'high-performance', softShadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, powerPreference: power });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  stage.appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return { renderer, envTex };
}

export function fitRenderer(renderer, camera, stage) {
  const w = stage.clientWidth || 1;
  const h = stage.clientHeight || 1;
  const canvas = renderer.domElement;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }
  return false;
}

export function disposeScene(scene) {
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}

/* How hard the casino's 3D scenes start out working. Phones (small screens) get a lower
   resolution and cheaper shadows; ones that look modest (few cores or little memory) lower
   still. frameGovernor then watches the real frame rate and steps down if it's too slow. */
export function casinoQuality() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const modest = cores <= 4 || mem <= 3;
  return {
    small,
    maxDpr: !small ? 2 : modest ? 1.25 : 1.5,
    shadow: small ? 1024 : 2048,
    softShadows: !small,
    texture: small ? 1024 : 2048,
  };
}

/* Watches the time between frames while a scene animates. If it averages under ~38 frames
   a second, it lowers the resolution, then (if still slow) turns shadows off. tick(now)
   returns true when it changed something, so the caller can resize. */
export function frameGovernor(renderer, scene) {
  let last = 0, n = 0, sum = 0, level = 0;
  const base = renderer.getPixelRatio();
  return {
    tick(now) {
      if (level >= 2) return false;
      if (last && now - last < 250) { sum += now - last; n++; }   // only frames drawn back to back
      last = now;
      if (n < 45) return false;
      const avg = sum / n;
      n = 0; sum = 0;
      if (avg < 26) return false;
      level++;
      if (level === 1 && base > 1) renderer.setPixelRatio(Math.max(1, base * 0.7));
      else {
        level = 2;
        renderer.shadowMap.enabled = false;
        scene.traverse(o => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
      }
      return true;
    },
    idle() { last = 0; },
  };
}

export async function fontReady() {
  try { await document.fonts.load('800 40px Manrope'); } catch (e) { /* fall back to system font */ }
}

/* Lab credits: one play-money balance shared by the lab games, separate from the casino
   wallet. (Slots kept its own balance before; that carries over the first time.) */
const CREDITS_KEY = 'mini-casino.lab-credits';
export const LAB_START = 1000;
export function loadCredits() {
  try {
    const v = JSON.parse(localStorage.getItem(CREDITS_KEY) || 'null');
    if (Number.isFinite(v) && v >= 0) return v;
    const old = JSON.parse(localStorage.getItem('mini-casino.lab-slots') || 'null');
    if (old && Number.isFinite(old.credits) && old.credits >= 0) return old.credits;
  } catch (e) { /* storage unavailable */ }
  return LAB_START;
}
export function saveCredits(n) {
  try { localStorage.setItem(CREDITS_KEY, JSON.stringify(n)); } catch (e) { /* storage unavailable */ }
}

// A small seeded random generator (mulberry32): the same seed always gives the same numbers
export function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function randomSeed() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
  catch (e) { return Math.floor(Math.random() * 4294967296); }
}

/* The money a game plays with. In the casino app the page passes its own `bank`, backed by
   the wallet; in the lab, labBank() stands in with lab credits. Either way:
     balance()                  what's left to bet
     chip()                     the bet size the player picked, or null to let the game choose
     bet(amount, payout, info)  takes a bet whose result is already known (payout, if
                                nothing else happens) and returns an id, or null if it can't
     settle(id, payout?)        pays it out: the known payout, or the one given
     broke()                    out of money: the lab lends more (returns a line to show),
                                the casino can't (returns its own line) */
export function labBank() {
  let credits = Math.round(loadCredits());
  const live = new Map();
  let n = 0;
  return {
    lab: true,
    balance: () => credits,
    chip: () => null,
    bet(amount, payout) {
      if (!(amount > 0) || credits < amount) return null;
      credits -= amount;
      saveCredits(credits);
      live.set(++n, payout);
      return n;
    },
    settle(id, payout) {
      if (!live.has(id)) return;
      credits += payout == null ? live.get(id) : payout;
      live.delete(id);
      saveCredits(credits);
    },
    broke() {
      credits += LAB_START;
      saveCredits(credits);
      return 'The duck lent you $1,000';
    },
  };
}
