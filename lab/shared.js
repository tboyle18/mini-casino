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
export function makeRenderer(stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
