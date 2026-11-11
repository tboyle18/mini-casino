// Duck Drop: 3D plinko, where the balls are rubber ducks.
//
// A candy-red arcade cabinet with a neon-framed peg board and a light-bulb marquee. Ducks
// tumble down twelve rows of pegs; every peg they hit lights up and plays a note (higher
// rows, lower notes), so a drop plays a little tune. They land in one of 13 buckets that
// pay a multiple of the bet: small in the middle, huge at the edges. Three risk levels
// trade safe middles for bigger edges. ×10 drops a storm of ducks at once.
// Bounces come from the physics in plinko-physics.js. It plays with the shared lab credits.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gsap } from 'gsap';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady, loadCredits, saveCredits, LAB_START } from './shared.js';
import { makeSound, createWinFx } from './fx.js';
import { canvas, tex, rrect, signCanvas, casinoScene, bloomComposer } from './arcade.js';
import { ROWS, BUCKETS, SPACING, ROW_H, PEG_R, BALL_R, BOTTOM_Y, STEP, RISKS, pegLayout, makeBall, stepBall } from './plinko-physics.js';

const TAU = Math.PI * 2;
const TOP = 1.34;                         // world height of the top row of pegs
const BOARD_W = 0.98;
const BOARD_BOTTOM = BOTTOM_Y - 0.1;      // board coordinates, relative to TOP
const BOARD_TOP = 0.12;
const BUCKET_TOP = -(ROWS - 1) * ROW_H - 0.016;
const BUCKET_H = 0.075;
const DUCK_Z = BALL_R + 0.002;
const BASE_H = TOP + BOARD_BOTTOM;        // the cabinet under the board reaches up to the board
const ARCH_R = 0.36;
const BETS = [5, 25, 100, 500];
const STORM = 10;
const MAX_DUCKS = 60;
const STORE = 'mini-casino.lab-plinko';
// A note for each row: C major pentatonic, climbing as the duck falls
const NOTES = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568, 1760];

const CSS = `
.pk-risk { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); z-index: 5; display: grid; grid-template-columns: repeat(3, auto); gap: 4px; padding: 4px;
  border-radius: 12px; background: rgba(0, 0, 0, .5); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.pk-risk button { appearance: none; border: 0; border-radius: 9px; padding: 8px 12px; background: transparent; color: rgba(245, 240, 227, .75);
  font: 700 13px/1 Manrope, sans-serif; cursor: pointer; -webkit-user-select: none; user-select: none; }
.pk-risk button[aria-pressed="true"] { background: #e9c46a; color: #2a1d05; }
`;

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtMult = m => `${m}×`;
function rand() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  catch (e) { return Math.random(); }
}
// Bucket colors: yellow in the middle, through orange, to hot red at the edges
function heat(i) {
  const d = Math.abs(i - (BUCKETS - 1) / 2) / ((BUCKETS - 1) / 2);
  return new THREE.Color().setHSL((48 - 48 * d) / 360, 0.9, 0.46);
}

// One rubber duck as a single mesh with vertex colors, so every duck on the board can be
// drawn in one go. It's sized to its collision circle and turned to face the camera.
function duckGeometry() {
  const part = (geo, hex) => {
    const color = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(c, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  };
  const parts = [
    part(new THREE.SphereGeometry(1, 20, 14).scale(1.25, 0.85, 1), 0xffcf1a),
    part(new THREE.SphereGeometry(0.68, 18, 12).translate(0.72, 0.95, 0), 0xffcf1a),
    part(new THREE.SphereGeometry(0.4, 14, 8).scale(1.35, 0.42, 1).translate(1.35, 0.85, 0), 0xff7a12),
    part(new THREE.SphereGeometry(0.13, 8, 6).translate(1.06, 1.2, 0.42), 0x111111),
    part(new THREE.SphereGeometry(0.13, 8, 6).translate(1.06, 1.2, -0.42), 0x111111),
    part(new THREE.ConeGeometry(0.4, 0.8, 12).rotateZ(0.95).translate(-1.2, 0.45, 0), 0xffcf1a),
  ];
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  g.translate(-0.15, -0.25, 0);
  g.rotateY(-0.8);
  g.scale(BALL_R * 1.1, BALL_R * 1.1, BALL_R * 1.1);
  return g;
}

function boardCanvas() {
  const [c, g] = canvas(512, 512);
  const bg = g.createRadialGradient(256, 200, 20, 256, 256, 380);
  bg.addColorStop(0, '#3a1260');
  bg.addColorStop(1, '#13051f');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.5;
  for (let i = 0; i < 160; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#ffd56b';
    g.beginPath();
    g.arc(Math.random() * 512, Math.random() * 512, Math.random() * 1.6 + 0.4, 0, TAU);
    g.fill();
  }
  return c;
}
function labelCanvas(pays) {
  const cw = 128, H = 160;   // one cell per bucket, the same shape as the bucket's front
  const [c, g] = canvas(cw * BUCKETS, H);
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  pays.forEach((m, i) => {
    const num = String(m);
    const size = num.length >= 3 ? 50 : 66;
    g.font = `900 ${size}px Manrope, sans-serif`;
    const w = g.measureText(num).width;
    g.font = `800 ${Math.round(size * 0.6)}px Manrope, sans-serif`;
    const wx = g.measureText('×').width;
    const x0 = (i + 0.5) * cw - (w + wx) / 2;
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(40, 8, 20, .85)';
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.font = `900 ${size}px Manrope, sans-serif`;
    g.strokeText(num, x0, H / 2 + 3);
    g.fillText(num, x0, H / 2 + 3);
    g.font = `800 ${Math.round(size * 0.6)}px Manrope, sans-serif`;
    g.strokeText('×', x0 + w, H / 2 + 8);
    g.fillText('×', x0 + w, H / 2 + 8);
  });
  return c;
}

export async function mount({ stage, controls, info }) {
  await fontReady();
  const calm = reducedMotion();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const { renderer, envTex } = makeRenderer(stage);
  const canvasEl = renderer.domElement;
  const textures = [];
  const keep = t => { textures.push(t); return t; };
  const scene = casinoScene(renderer, envTex, keep);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
  const composer = bloomComposer(renderer, scene, camera);

  // ---- Framing: the board and its sign fill the screen; the cabinet can run off the bottom ----
  const view = { w: 0, h: 0, dist: 3, target: new THREE.Vector3(0, TOP - 0.13, 0) };
  function fit() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    view.dist = Math.max(0.66 / t, 0.56 / (t * camera.aspect));
  }

  // ---- Materials ----
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xa8001c, metalness: 0.2, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f4f6, metalness: 1, roughness: 0.1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0c050, metalness: 1, roughness: 0.22 });
  const add = (mesh, parent = scene) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- Cabinet, board and neon frame ----
  add(new THREE.Mesh(new RoundedBoxGeometry(BOARD_W + 0.08, BASE_H, 0.42, 4, 0.04), paint)).position.set(0, BASE_H / 2, -0.12);
  const board = new THREE.Group();
  board.position.set(0, TOP, 0);
  scene.add(board);
  const boardH = BOARD_TOP - BOARD_BOTTOM;
  const backing = add(new THREE.Mesh(new RoundedBoxGeometry(BOARD_W, boardH, 0.05, 3, 0.02),
    new THREE.MeshPhysicalMaterial({ map: keep(tex(boardCanvas(), renderer)), roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.35 })), board);
  backing.position.set(0, (BOARD_TOP + BOARD_BOTTOM) / 2, -0.025);
  const frameShape = rrect(new THREE.Shape(), 0, (BOARD_TOP + BOARD_BOTTOM) / 2, BOARD_W + 0.03, boardH + 0.03, 0.035);
  frameShape.holes.push(rrect(new THREE.Path(), 0, (BOARD_TOP + BOARD_BOTTOM) / 2, BOARD_W - 0.012, boardH - 0.012, 0.025));
  const neon = new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.012, bevelEnabled: false, curveSegments: 10 }),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.1, 1.4) }));
  board.add(neon);

  // ---- Pegs, each with a cap that lights up when a duck hits it ----
  const rows = pegLayout();
  const pegList = rows.flat();
  const m4 = new THREE.Matrix4();
  const pegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(PEG_R, PEG_R, 0.032, 12).rotateX(Math.PI / 2), chrome, pegList.length);
  const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(PEG_R * 1.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), pegList.length);
  pegList.forEach(p => {
    pegs.setMatrixAt(p.i, m4.makeTranslation(p.x, p.y, 0.016));
    caps.setMatrixAt(p.i, m4.makeTranslation(p.x, p.y, 0.033));
    caps.setColorAt(p.i, new THREE.Color(1, 1, 1));
  });
  pegs.castShadow = true;
  board.add(pegs, caps);
  const glow = new Float32Array(pegList.length);

  // ---- Buckets, dividers and their multiplier labels ----
  const buckets = [];
  for (let i = 0; i < BUCKETS; i++) {
    const color = heat(i);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.06, roughness: 0.4, metalness: 0.1 });
    const mesh = add(new THREE.Mesh(new RoundedBoxGeometry(SPACING * 0.86, BUCKET_H, 0.05, 2, 0.01), mat), board);
    const x = (i - (BUCKETS - 1) / 2) * SPACING;
    mesh.position.set(x, BUCKET_TOP - BUCKET_H / 2, 0.005);
    buckets.push({ mesh, mat, x, flash: 0 });
  }
  for (let k = 0; k <= BUCKETS; k++) {
    const d = add(new THREE.Mesh(new THREE.BoxGeometry(0.005, BUCKET_H + 0.02, 0.04), chrome), board);
    d.position.set((k - BUCKETS / 2) * SPACING, BUCKET_TOP - BUCKET_H / 2 + 0.01, 0.01);
  }
  const labelTex = keep(tex(labelCanvas(RISKS.medium.pays), renderer));
  const labels = new THREE.Mesh(new THREE.PlaneGeometry(SPACING * BUCKETS, (SPACING * 160) / 128),
    new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, color: new THREE.Color(1.15, 1.15, 1.15) }));
  labels.position.set(0, BUCKET_TOP - BUCKET_H / 2, 0.034);
  board.add(labels);

  // ---- The duck dispenser at the top ----
  const funnel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.022, 0.05, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f6, metalness: 1, roughness: 0.12, side: THREE.DoubleSide })), board);
  funnel.position.set(0, ROW_H * 0.9 + 0.03, DUCK_Z);

  // ---- Marquee sign and bulbs ----
  const archY = TOP + BOARD_TOP - 0.005;
  const archShape = new THREE.Shape();
  archShape.moveTo(ARCH_R + 0.02, 0);
  archShape.absarc(0, 0, ARCH_R + 0.02, 0, Math.PI, false);
  archShape.lineTo(ARCH_R + 0.02, 0);
  add(new THREE.Mesh(new THREE.ExtrudeGeometry(archShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 48 }), paint))
    .position.set(0, archY, -0.07);
  const sign = new THREE.Mesh(new THREE.CircleGeometry(ARCH_R - 0.01, 64, 0, Math.PI),
    new THREE.MeshBasicMaterial({ map: keep(tex(signCanvas('DUCK DROP', 'PLINKO'), renderer)), color: new THREE.Color(1.25, 1.25, 1.25) }));
  sign.position.set(0, archY, 0.004);
  scene.add(sign);
  add(new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.012, 0.013, 12, 72, Math.PI), gold)).position.set(0, archY, 0.002);
  const bulbPos = [];
  for (let k = 0; k < 19; k++) {
    const a = Math.PI - (Math.PI * (k + 0.5)) / 19;
    bulbPos.push([Math.cos(a) * (ARCH_R + 0.012), archY + Math.sin(a) * (ARCH_R + 0.012), 0.018]);
  }
  for (let k = 0; k < 6; k++) bulbPos.push([BOARD_W / 2 + 0.005, BASE_H - 0.06 - k * 0.085, 0.095]);
  for (let k = 0; k < 6; k++) bulbPos.push([-(BOARD_W / 2 + 0.005), BASE_H - 0.06 - (5 - k) * 0.085, 0.095]);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
  bulbPos.forEach((p, k) => { bulbs.setMatrixAt(k, m4.makeTranslation(p[0], p[1], p[2])); bulbs.setColorAt(k, new THREE.Color(1, 1, 1)); });
  scene.add(bulbs);

  // ---- Ducks ----
  const duckMesh = new THREE.InstancedMesh(duckGeometry(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }), MAX_DUCKS);
  duckMesh.castShadow = true;
  duckMesh.frustumCulled = false;
  duckMesh.count = 0;
  board.add(duckMesh);
  const ducks = [];

  // ---- Overlays and state ----
  const winFx = createWinFx(stage);
  const riskBar = document.createElement('div');
  riskBar.className = 'pk-risk';
  riskBar.setAttribute('role', 'group');
  riskBar.setAttribute('aria-label', 'Risk');
  stage.appendChild(riskBar);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { /* storage unavailable */ }
  let credits = Math.round(loadCredits());
  let bet = BETS.includes(saved.bet) ? saved.bet : 25;
  let risk = RISKS[saved.risk] ? saved.risk : 'medium';
  const sound = makeSound();
  sound.on = saved.sound !== false;
  const persist = () => {
    saveCredits(credits);
    try { localStorage.setItem(STORE, JSON.stringify({ bet, risk, sound: sound.on })); } catch (e) { /* storage unavailable */ }
  };
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const shake = { amp: 0 };
  let party = 0, blink = 0, lastPing = 0, net = null;

  for (const key of Object.keys(RISKS)) {
    const b = document.createElement('button');
    b.textContent = RISKS[key].label;
    b.dataset.risk = key;
    b.setAttribute('aria-label', `${RISKS[key].label} risk`);
    b.addEventListener('click', () => { risk = key; persist(); paintRisk(); buzz(5); });
    riskBar.appendChild(b);
  }
  function paintRisk() {
    for (const b of riskBar.children) b.setAttribute('aria-pressed', String(b.dataset.risk === risk));
    const c = labelCanvas(RISKS[risk].pays);
    labelTex.image = c;
    labelTex.needsUpdate = true;
  }
  function hud() {
    const inPlay = ducks.filter(d => !d.ball.done).length;
    let line = `Credits ${money(credits)} · Bet ${money(bet)}`;
    if (net) line = `${net} · ${money(credits)}`;
    else if (inPlay) line += ` · ${inPlay} falling`;
    info.textContent = line;
    betBtn.textContent = `Bet ${money(bet)}`;
  }

  // ---- Dropping ducks ----
  function releaseOne() {
    if (ducks.length >= MAX_DUCKS) return false;
    if (credits < bet) return false;
    credits -= bet;
    persist();
    const ball = makeBall(rand);
    ducks.push({ ball, bet, pays: RISKS[risk].pays, rot: rand() * TAU, spin: (rand() - 0.5) * 6, landed: 0, restY: 0, x0: 0 });
    gsap.fromTo(funnel.scale, { x: 1.25, z: 1.25 }, { x: 1, z: 1, duration: 0.35, ease: 'elastic.out(1, 0.4)' });
    sound.note(220, 0.08, { type: 'triangle', vol: 0.12, to: 440 });
    buzz(8);
    net = null;
    hud();
    return true;
  }
  function drop(n) {
    sound.unlock();
    if (credits < BETS[0]) {
      credits += LAB_START;
      persist();
      hud();
      winFx.float('The duck lent you $1,000', view.w / 2, view.h * 0.3, { color: '#7cff6b', size: 22 });
      sound.quack();
      sound.quack(0.25);
      return;
    }
    if (credits < bet) {
      bet = [...BETS].reverse().find(b => b <= credits);
      persist();
      hud();
      winFx.float(`Bet lowered to ${money(bet)}`, view.w / 2, view.h * 0.3, { color: '#ffe27a', size: 22 });
      return;
    }
    if (!releaseOne()) return;
    if (n > 1) {
      sound.quack();
      for (let i = 1; i < n; i++) later(() => { if (!releaseOne()) return; }, i * (calm ? 200 : 110));
    }
  }

  const tmp = new THREE.Vector3();
  function screenOf(x, y) {
    tmp.set(x, y, 0.04).applyMatrix4(board.matrixWorld).project(camera);
    return [((tmp.x + 1) / 2) * view.w, ((1 - tmp.y) / 2) * view.h];
  }
  function landed(d) {
    const i = d.ball.bucket;
    const mult = d.pays[i];
    const win = Math.round(d.bet * mult);   // whole dollars
    credits += win;
    persist();
    const b = buckets[i];
    b.flash = 1;
    const [sx, sy] = screenOf(b.x, BUCKET_TOP + 0.02);
    const color = mult >= 1 ? '#' + heat(i).getHexString() : '#b9b2c8';
    winFx.float(fmtMult(mult), sx, sy - 10, { color, size: mult >= 10 ? 34 : 24 });
    const gain = win - d.bet;
    net = gain >= 0 ? `+${money(gain)}` : `−${money(-gain)}`;
    if (mult >= 100) {
      winFx.showTitle('DUCK JACKPOT', win, { jackpot: true });
      if (!calm) { winFx.cannons(2); later(() => winFx.cannons(1.5), 1200); }
      winFx.burst(sx, sy, 2);
      sound.fanfare();
      for (let k = 0; k < 5; k++) sound.quack(0.8 + k * 0.22);
      shake.amp = 0.03;
      party = performance.now() / 1000 + 6;
      buzz([40, 40, 80, 40, 120]);
    } else if (mult >= 25) {
      winFx.showTitle('BIG WIN', win);
      if (!calm) winFx.cannons(1);
      winFx.burst(sx, sy, 1.6);
      sound.win(3);
      later(() => sound.fanfare(), 300);
      shake.amp = 0.02;
      party = performance.now() / 1000 + 4;
      buzz([30, 40, 60]);
    } else if (mult >= 8) {
      winFx.burst(sx, sy, 1);
      sound.win(3);
      sound.quack(0.35);
      shake.amp = Math.max(shake.amp, 0.008);
      blink = performance.now() / 1000 + 1.6;
      buzz([15, 50, 25]);
    } else if (mult >= 2) {
      sound.win(2);
      blink = performance.now() / 1000 + 1;
      buzz(12);
    } else if (mult >= 1) {
      sound.win(1);
    } else {
      sound.note(300, 0.1, { type: 'triangle', vol: 0.06, to: 200 });
    }
    hud();
  }

  // ---- Controls ----
  const betBtn = button('', () => {
    bet = BETS[(BETS.indexOf(bet) + 1) % BETS.length];
    persist();
    net = null;
    hud();
    buzz(5);
  });
  const dropBtn = button('Drop', () => drop(1), 'primary');
  const stormBtn = button(`×${STORM}`, () => drop(STORM));
  stormBtn.setAttribute('aria-label', `Drop ${STORM} ducks`);
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
  controls.append(betBtn, dropBtn, stormBtn, soundBtn);
  paintRisk();
  hud();
  function onKey(e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    drop(1);
  }
  window.addEventListener('keydown', onKey);

  // ---- Loop ----
  const col = new THREE.Color();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const look = new THREE.Vector3();
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  function onHit(p, speed) {
    glow[p.i] = Math.min(1, glow[p.i] + speed * 1.6);
    const now = performance.now();
    if (speed > 0.06 && now - lastPing > 30) {
      lastPing = now;
      sound.ping(NOTES[p.r], Math.min(0.07, 0.025 + speed * 0.05));
    }
  }
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    fit();

    // Physics in fixed steps, so the odds match the simulation
    acc = Math.min(acc + dt, 0.1);
    while (acc >= STEP) {
      acc -= STEP;
      for (const d of ducks) {
        if (d.ball.done) continue;
        stepBall(d.ball, rows, rand, onHit);
        if (d.ball.done) {
          d.landed = now;
          d.x0 = d.ball.x;
          landed(d);
        }
      }
    }

    // Ducks: tumble while falling, plop into the bucket, then shrink away
    for (let i = ducks.length - 1; i >= 0; i--) {
      const d = ducks[i];
      if (d.landed && now - d.landed > 1.3) ducks.splice(i, 1);
    }
    duckMesh.count = ducks.length;
    ducks.forEach((d, i) => {
      let x = d.ball.x, y = d.ball.y, s = 1;
      if (d.landed) {
        // Half-sunk in the bucket, with a couple of little bounces, turning upright
        const t = now - d.landed;
        const bx = buckets[d.ball.bucket].x;
        x = d.x0 + (bx - d.x0) * Math.min(1, t * 5);
        y = BUCKET_TOP - 0.012 + Math.abs(Math.sin(t * 9)) * 0.025 * Math.exp(-t * 4);
        s = t > 0.9 ? Math.max(0.001, 1 - (t - 0.9) / 0.4) : 1;
        const upright = Math.round(d.rot / TAU) * TAU;
        d.rot += (upright - d.rot) * Math.min(1, dt * 8);
      } else {
        d.rot += (d.spin - d.ball.vx * 14) * dt;
      }
      q.setFromAxisAngle(zAxis, d.rot);
      duckMesh.setMatrixAt(i, m4.compose(pos.set(x, y, DUCK_Z), q, sc.set(s, s, s)));
    });
    duckMesh.instanceMatrix.needsUpdate = true;

    // Peg caps: a slow wave of light down the rows, plus a flash on every hit
    const decay = Math.pow(0.02, dt);
    pegList.forEach(p => {
      glow[p.i] *= decay;
      const wave = 0.45 + 0.25 * Math.sin(now * 3 - p.r * 0.7);
      const g = glow[p.i];
      col.setRGB(1.1 * wave + 3.2 * g, 0.7 * wave + 2.6 * g, 1.3 * wave + 1.3 * g);
      caps.setColorAt(p.i, col);
    });
    caps.instanceColor.needsUpdate = true;

    // Buckets flash and dip when a duck lands
    for (const b of buckets) {
      b.flash *= Math.pow(0.08, dt);
      b.mat.emissiveIntensity = 0.06 + b.flash * 2.6;
      b.mesh.position.y = BUCKET_TOP - BUCKET_H / 2 - b.flash * 0.008;
    }

    // Bulbs: a lazy chase, faster while ducks are falling, rainbow on a big win
    const falling = ducks.some(d => !d.ball.done);
    const n = bulbPos.length;
    for (let k = 0; k < n; k++) {
      let on, hue = -1;
      if (now < party) { on = (k + Math.floor(now * 20)) % 4 < 2 ? 1 : 0.12; hue = (k / n + now * 0.6) % 1; }
      else if (now < blink) on = Math.floor(now * 10) % 2 ? 1 : 0.1;
      else on = (k + Math.floor(now * (falling ? 14 : 4))) % 3 === 0 ? 1 : 0.16;
      if (hue < 0) col.setRGB(3.2 * on, 2.4 * on, 1.1 * on);
      else col.setHSL(hue, 1, 0.55).multiplyScalar(3.4 * on);
      bulbs.setColorAt(k, col);
    }
    bulbs.instanceColor.needsUpdate = true;

    // Camera: slightly off to one side so the pegs read as 3D, with a slow drift
    shake.amp *= Math.pow(0.02, dt);
    const sx = calm ? 0 : (Math.random() * 2 - 1) * shake.amp;
    const sy = calm ? 0 : (Math.random() * 2 - 1) * shake.amp;
    camera.position.set(view.target.x + 0.12 + Math.sin(now * 0.3) * 0.05 + sx, view.target.y + 0.08 + sy, view.dist);
    look.copy(view.target);
    camera.lookAt(look);

    if (Math.floor(now * 4) !== Math.floor((now - dt) * 4)) hud();
    composer.render(dt);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      // Ducks still in the air get their bets back
      const refund = ducks.filter(d => !d.ball.done).reduce((a, d) => a + d.bet, 0);
      if (refund) { credits += refund; saveCredits(credits); }
      gsap.killTweensOf(funnel.scale);
      window.removeEventListener('keydown', onKey);
      winFx.dispose();
      sound.close();
      riskBar.remove();
      style.remove();
      disposeScene(scene);
      for (const t of textures) t.dispose();
      composer.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasEl.remove();
    },
  };
}
