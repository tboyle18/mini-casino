// Casino floor (beta): the games laid out on a casino floor. You don't walk around: the camera
// glides along a fixed path from one station to the next as you swipe, and tapping a station
// takes you down into its seat, where that station's own lab game takes over. A small 2D map
// in the corner shows where you are on the floor; tap it to jump to a station.
//
// The floor itself only draws stand-in models (they're cheap); the seated games are the real
// lab modules, mounted on top while the floor stops drawing.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';
import { EMOJI, canvas, tex, carpetCanvas, signCanvas, duckGeometry } from './arcade.js';

const TAU = Math.PI * 2;
const ROOM = { x0: -5, x1: 5, z0: -4.4, z1: 3 };   // the part of the floor the map shows
const FOV = 55;

/* The stations, left to right along the path. pos is [x, z] on the floor; yaw turns the
   station toward the aisle; w and h are how much of it the overview must fit on screen;
   look is the height the camera aims at; seat is [distance, height] of the seated view. */
const STATIONS = [
  { id: 'table', name: 'Blackjack', blurb: 'Deal a hand at the 3D table', color: '#5ee08a', pos: [-2.6, -0.5], yaw: 0.45, w: 2.1, h: 1.1, look: 0.72, seat: [1.25, 1.45], load: () => import('./table.js') },
  { id: 'roulette', name: 'Roulette', blurb: 'Spin the real-physics wheel', color: '#ff5d6c', pos: [0, -1.9], yaw: 0, w: 2.5, h: 1.1, look: 0.78, seat: [1.15, 1.55], load: () => import('./roulette.js') },
  { id: 'slots', name: 'Lucky Duck 3000', blurb: 'Pull the lever. The duck is wild', color: '#ffd23f', pos: [2.3, -0.4], yaw: -0.3, w: 1.2, h: 2.3, look: 1.05, seat: [1.15, 1.35], load: () => import('./slots.js') },
  { id: 'cashier', name: 'Cashier', blurb: 'Your balance and stats', color: '#e9c46a', pos: [4.3, -1.3], yaw: -0.4, w: 1.9, h: 2.3, look: 1.15, seat: [1.2, 1.5], load: () => import('./cashier.js') },
];
const LAST = STATIONS.length - 1;

const CSS = `
.floor-map { position: absolute; right: 12px; top: 42px; width: 132px; height: 104px; z-index: 3; border-radius: 14px; touch-action: none; cursor: pointer;
  background: rgba(10, 8, 6, .72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12), 0 6px 18px rgba(0, 0, 0, .4); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: opacity .3s; }
#stage canvas.floor-map { width: 132px; height: 104px; }   /* the lab stretches every stage canvas */
.floor-map.off { opacity: 0; pointer-events: none; }
.floor-seat { position: absolute; inset: 0; z-index: 2; background: #0b0907; opacity: 0; transition: opacity .35s; }
.floor-seat.on { opacity: 1; }
.floor-tag { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; pointer-events: none; text-align: center; white-space: nowrap;
  padding: 8px 14px; border-radius: 12px; background: rgba(10, 8, 6, .72); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: opacity .3s; }
.floor-tag b { display: block; font-size: 17px; }
.floor-tag span { font-size: 13px; color: rgba(245, 240, 227, .7); }
.floor-tag.off { opacity: 0; }
.floor-hop { position: absolute; top: 42px; z-index: 3; appearance: none; border: 0; cursor: pointer; padding: 9px 12px; border-radius: 12px; max-width: 46%;
  background: rgba(10, 8, 6, .72); color: #e9c46a; font: 800 14px/1.1 Manrope, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: inset 0 0 0 1px rgba(233, 196, 106, .35); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.floor-hop.prev { left: 12px; }
.floor-hop.next { right: 12px; }
.floor-hop:active { transform: scale(.96); }
`;

export async function mount({ stage, controls, info }) {
  await fontReady();
  const calm = reducedMotion();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const q = casinoQuality();
  const { renderer, envTex } = makeRenderer(stage, { maxDpr: q.maxDpr, softShadows: q.softShadows });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  const canvasEl = renderer.domElement;
  const textures = [];
  const keep = t => { textures.push(t); return t; };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12071c);
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;
  scene.fog = new THREE.Fog(0x12071c, 7, 17);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 40);

  // ---- Materials ----
  const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const M = {
    felt: std(0x0d6b3a, 0.95),
    wood: std(0x5a2e14, 0.45),
    woodDark: std(0x2a140a, 0.5),
    leather: std(0x1a0d08, 0.35),
    gold: std(0xd9a93c, 0.3, 0.9),
    chrome: std(0xdddddd, 0.2, 1),
    seat: std(0x7a1020, 0.5),
    red: std(0xc8102e, 0.35, 0.1),
    white: std(0xf4f1ea, 0.5),
    wall: std(0x1d0c2a, 0.9),
  };
  const glowMat = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });

  // ---- The room ----
  scene.add(new THREE.HemisphereLight(0xffe9f2, 0x1a0820, 0.55));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.5);
  key.position.set(-2, 6, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -4, near: 1, far: 14 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const carpet = keep(tex(carpetCanvas(), renderer));
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(12, 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = 1;
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), M.wall);
  backWall.position.set(0, 2.5, ROOM.z0);
  scene.add(backWall);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), M.wall);
    wall.position.set(side * 5.6, 2.5, 1);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
  }
  // Neon running along the walls
  const neon = [[0, ROOM.z0 + 0.02, 0, 10, 0xff2bd6, 2.9], [0, ROOM.z0 + 0.02, 0, 10, 0x2be7ff, 0.35]];
  for (const [x, z, , len, color, y] of neon) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.035), glowMat(color));
    tube.position.set(x, y, z);
    scene.add(tube);
  }
  for (const side of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 7), glowMat(side < 0 ? 0xff2bd6 : 0x2be7ff));
    tube.position.set(side * 5.58, 2.9, -0.9);
    scene.add(tube);
  }

  // A row of slot machines along the back wall (just scenery for now: themed machines go here later)
  const ROW = 10;
  const cabGeo = new RoundedBoxGeometry(0.62, 1.55, 0.5, 2, 0.04);
  const cabs = new THREE.InstancedMesh(cabGeo, std(0xffffff, 0.4, 0.1), ROW);
  const screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.44, 0.32), new THREE.MeshBasicMaterial({ toneMapped: false }), ROW);
  const toppers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.16, 0.06), new THREE.MeshBasicMaterial({ toneMapped: false }), ROW);
  const cabCols = [0x8a1424, 0x1d3f8a, 0x6a1a8a, 0x146a52];
  const scrCols = [0xff6bb5, 0x6be7ff, 0xffd23f, 0x7cff6b, 0xff8a3d];
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  const rowX = [];
  for (let i = 0; i < ROW; i++) {
    const x = -4.5 + i * 0.9;
    rowX.push(x);
    const z = ROOM.z0 + 0.5;
    cabs.setMatrixAt(i, m4.makeTranslation(x, 0.775, z));
    cabs.setColorAt(i, c.setHex(cabCols[i % cabCols.length]));
    screens.setMatrixAt(i, m4.makeTranslation(x, 1.1, z + 0.252));
    screens.setColorAt(i, c.setHex(scrCols[i % scrCols.length]).multiplyScalar(0.9));
    toppers.setMatrixAt(i, m4.makeTranslation(x, 1.62, z + 0.2));
    toppers.setColorAt(i, c.setHex(scrCols[(i + 2) % scrCols.length]));
  }
  cabs.castShadow = cabs.receiveShadow = true;
  scene.add(cabs, screens, toppers);

  // ---- Small canvas artwork ----
  function signTex(text, color) {
    const [cv, g] = canvas(1024, 256);
    g.font = '900 120px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 36;
    g.lineWidth = 10;
    g.strokeStyle = color;
    g.strokeText(text, 512, 132);
    g.shadowBlur = 12;
    g.fillStyle = '#fff8e6';
    g.fillText(text, 512, 132);
    return keep(tex(cv, renderer));
  }
  function rouletteLayoutTex() {
    const [cv, g] = canvas(1024, 384);
    g.fillStyle = '#0d6b3a';
    g.fillRect(0, 0, 1024, 384);
    const cw = 72, ch = 96, x0 = 112, y0 = 48;
    const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    g.font = '800 34px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(255, 248, 230, .85)';
    g.lineWidth = 3;
    g.fillStyle = '#0d8a4a';
    g.fillRect(x0 - 80, y0, 80, ch * 3);
    g.strokeRect(x0 - 80, y0, 80, ch * 3);
    g.fillStyle = '#fff';
    g.fillText('0', x0 - 40, y0 + ch * 1.5);
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 3; row++) {
        const n = col * 3 + (3 - row);
        const x = x0 + col * cw, y = y0 + row * ch;
        g.fillStyle = RED.has(n) ? '#b3122e' : '#141414';
        g.beginPath();
        g.ellipse(x + cw / 2, y + ch / 2, 24, 24, 0, 0, TAU);
        g.fill();
        g.strokeRect(x, y, cw, ch);
        g.fillStyle = '#fff';
        g.fillText(String(n), x + cw / 2, y + ch / 2 + 1);
      }
    }
    return keep(tex(cv, renderer));
  }
  function rotorTex() {
    const S = 512, R = S / 2;
    const [cv, g] = canvas(S, S);
    g.fillStyle = '#2a140a';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 37; i++) {
      const a0 = (i / 37) * TAU, a1 = ((i + 1) / 37) * TAU;
      g.beginPath();
      g.moveTo(R, R);
      g.arc(R, R, R * 0.92, a0, a1);
      g.closePath();
      g.fillStyle = i === 0 ? '#0d8a4a' : i % 2 ? '#b3122e' : '#141414';
      g.fill();
    }
    g.fillStyle = '#5a2e14';
    g.beginPath();
    g.arc(R, R, R * 0.55, 0, TAU);
    g.fill();
    g.strokeStyle = '#d9a93c';
    g.lineWidth = 6;
    for (const r of [0.55, 0.92]) { g.beginPath(); g.arc(R, R, R * r, 0, TAU); g.stroke(); }
    return keep(tex(cv, renderer));
  }
  function reelsTex() {
    const [cv, g] = canvas(512, 256);
    g.fillStyle = '#20060c';
    g.fillRect(0, 0, 512, 256);
    g.font = `110px ${EMOJI}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ['🍒', '🦆', '🔔'].forEach((s, i) => {
      const x = 16 + i * 164;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#bdb6a6');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#bdb6a6');
      g.fillStyle = grad;
      g.fillRect(x, 12, 152, 232);
      g.fillText(s, x + 76, 134);
    });
    g.fillStyle = 'rgba(255, 40, 60, .85)';
    g.fillRect(0, 124, 512, 6);
    return keep(tex(cv, renderer));
  }
  function sign(text, color, width) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: signTex(text, color), transparent: true, toneMapped: false, depthWrite: false }));
    return m;
  }
  const shadowy = o => { o.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };

  // ---- Stations (stand-in models: the seated view is the real game) ----
  function stool(x, z) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.07, 20), M.seat);
    seat.position.y = 0.68;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.64, 8), M.chrome);
    pole.position.y = 0.33;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.03, 20), M.chrome);
    foot.position.y = 0.015;
    g.add(seat, pole, foot);
    g.position.set(x, 0, z);
    return g;
  }
  function buildBlackjack() {
    const g = new THREE.Group();
    const top = 0.78;
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.04, 48, 1, false, -Math.PI / 2, Math.PI), M.felt);
    felt.position.y = top;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 48, Math.PI), M.leather);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = top + 0.03;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.09, 0.1), M.wood);
    back.position.set(0, top + 0.005, -0.03);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.45, 40, 1, true, -Math.PI / 2, Math.PI), M.woodDark);
    skirt.position.y = top - 0.25;
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.45, 0.04), M.woodDark);
    front.position.set(0, top - 0.25, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.55, 16), M.woodDark);
    leg.position.set(0, 0.275, 0.35);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.13), M.woodDark);
    tray.position.set(0, top + 0.035, 0.1);
    g.add(felt, rail, back, skirt, front, leg, tray);
    const chipCols = [0x7a2bb5, 0x7a2bb5, 0x222222, 0x222222, 0x1f5fbf, 0x1f5fbf, 0xc8102e, 0xc8102e];
    chipCols.forEach((col, i) => {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 16), std(col, 0.4));
      chip.position.set(-0.21 + i * 0.06, top + 0.07, 0.1);
      g.add(chip);
    });
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.22), std(0x5a0c18, 0.4));
    shoe.position.set(0.6, top + 0.07, 0.16);
    g.add(shoe);
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.45;
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), M.white);
      card.rotation.set(-Math.PI / 2, 0, -a);
      card.position.set(Math.sin(a) * 0.68, top + 0.022, Math.cos(a) * 0.68);
      const card2 = card.clone();
      card2.position.x += 0.025;
      card2.position.z -= 0.01;
      card2.position.y += 0.001;
      g.add(card, card2);
      g.add(stool(Math.sin(a) * 1.35, Math.cos(a) * 1.35));
    }
    return g;
  }
  let rotor = null, ballPivot = null;
  function buildRoulette() {
    const g = new THREE.Group();
    const top = 0.8;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.72, 1.05), M.woodDark);
    body.position.y = 0.38;
    const rim = new THREE.Mesh(new RoundedBoxGeometry(2.62, 0.08, 1.17, 2, 0.03), M.wood);
    rim.position.y = top - 0.03;
    const felt = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.02, 1.03), M.felt);
    felt.position.y = top + 0.01;
    const layout = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshStandardMaterial({ map: rouletteLayoutTex(), roughness: 0.95 }));
    layout.rotation.x = -Math.PI / 2;
    layout.position.set(0.32, top + 0.021, 0.05);
    g.add(body, rim, felt, layout);
    const wheel = new THREE.Group();
    wheel.position.set(-0.85, top, 0);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.14, 48), M.wood);
    bowl.position.y = 0.07;
    rotor = new THREE.Group();
    rotor.position.y = 0.13;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 48), [M.woodDark, new THREE.MeshStandardMaterial({ map: rotorTex(), roughness: 0.4 }), M.woodDark]);
    const turret = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 16), M.gold);
    turret.position.y = 0.07;
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), M.gold);
      spoke.rotation.set(0, (i * Math.PI) / 2, Math.PI / 2);
      spoke.position.y = 0.04;
      rotor.add(spoke);
    }
    rotor.add(disc, turret);
    ballPivot = new THREE.Group();
    ballPivot.position.y = 0.155;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), M.white);
    ball.position.x = 0.36;
    ballPivot.add(ball);
    wheel.add(bowl, rotor, ballPivot);
    g.add(wheel);
    for (let i = 0; i < 4; i++) g.add(stool(-0.6 + i * 0.55, 0.95));
    return g;
  }
  const bulbs = [];
  let duck = null;
  function buildSlots() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.82, 1.6, 0.62, 3, 0.06), M.red);
    body.position.y = 0.8;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: reelsTex(), toneMapped: false }));
    win.position.set(0, 1.18, 0.312);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.37, 0.02), M.chrome);
    bezel.position.set(0, 1.18, 0.302);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.06, 0.2), M.chrome);
    deck.position.set(0, 0.86, 0.36);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), M.chrome);
    tray.position.set(0, 0.22, 0.34);
    const marquee = new THREE.Mesh(new THREE.CircleGeometry(0.41, 40, 0, Math.PI), new THREE.MeshBasicMaterial({ map: keep(tex(signCanvas('LUCKY DUCK', '3000'), renderer)), toneMapped: false }));
    marquee.position.set(0, 1.6, 0.14);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.3, 40, 1, false, -Math.PI / 2, Math.PI), M.red);
    arch.rotation.x = Math.PI / 2;
    arch.position.set(0, 1.6, -0.02);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), M.chrome);
    rod.position.set(0.47, 1.2, 0.05);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), std(0xe8102e, 0.25));
    knob.position.set(0.47, 1.47, 0.05);
    g.add(body, win, bezel, deck, tray, marquee, arch, rod, knob);
    const bulbGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const on = glowMat(0xffe7a0), off = glowMat(0x6a4a20);
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      const b = new THREE.Mesh(bulbGeo, on);
      b.position.set(Math.cos(a) * 0.45, 1.6 + Math.sin(a) * 0.45, 0.15);
      b.userData = { on, off, i };
      bulbs.push(b);
      g.add(b);
    }
    duck = new THREE.Mesh(duckGeometry(0.11), std(0xffffff, 0.35, 0, { vertexColors: true }));
    duck.position.set(0, 2.14, 0);
    g.add(duck);
    g.add(stool(0, 0.75));
    return g;
  }

  // The cashier's cage: a wood booth with brass bars, a window and a counter
  function buildCashier() {
    const g = new THREE.Group();
    const W = 1.8, H = 2.3, D = 0.9;
    const booth = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), M.woodDark);
    booth.position.set(0, H / 2, -D / 2);
    const counter = new THREE.Mesh(new RoundedBoxGeometry(W + 0.12, 0.08, 0.36, 2, 0.02), M.wood);
    counter.position.set(0, 1.08, 0.12);
    const front = new THREE.Mesh(new THREE.BoxGeometry(W, 1.04, 0.06), M.wood);
    front.position.set(0, 0.52, 0.03);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, 0.95), new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: 0x6a4418, emissiveIntensity: 0.6, roughness: 0.8 }));
    inside.position.set(0, 1.6, 0.01);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.12, 0.1), M.gold);
    lintel.position.set(0, 2.14, 0.04);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.05, 0.08), M.gold);
    sill.position.set(0, 1.13, 0.03);
    g.add(booth, counter, front, inside, lintel, sill);
    // Brass bars, with a gap in the middle for the window
    const xs = [];
    for (let i = 0; i < 17; i++) {
      const x = -W / 2 + 0.1 + (i * (W - 0.2)) / 16;
      if (Math.abs(x) > 0.2) xs.push(x);
    }
    const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.98, 8), M.gold, xs.length);
    xs.forEach((x, i) => bars.setMatrixAt(i, m4.makeTranslation(x, 1.63, 0.06)));
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.014, 8, 24, Math.PI), M.gold);
    arch.position.set(0, 1.5, 0.06);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), glowMat(0xffe2a0));
    lamp.position.set(0.55, 1.3, 0.05);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 16, 1, true), M.gold);
    shade.position.set(0.55, 1.36, 0.05);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.22), M.chrome);
    tray.position.set(0, 1.13, 0.16);
    [0x7a2bb5, 0x222222, 0x1f5fbf, 0xc8102e, 0x2a8a4a].forEach((col, i) => {
      const h = 0.04 + i * 0.015;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 16), std(col, 0.4));
      stack.position.set(-0.6 + i * 0.075, 1.14 + h / 2, 0.16);
      g.add(stack);
    });
    g.add(bars, arch, lamp, shade, tray);
    return g;
  }
  const builders = { table: buildBlackjack, roulette: buildRoulette, slots: buildSlots, cashier: buildCashier };
  const groups = [];
  const DIRS = [];
  STATIONS.forEach((st, k) => {
    const g = shadowy(builders[st.id]());
    g.position.set(st.pos[0], 0, st.pos[1]);
    g.rotation.y = st.yaw;
    g.userData.k = k;
    const s = sign(st.name.toUpperCase(), st.color, st.id === 'slots' ? 1.6 : 1.8);
    s.position.set(0, st.id === 'slots' ? 2.65 : st.id === 'cashier' ? 2.55 : 2.05, st.id === 'roulette' ? -0.7 : st.id === 'cashier' ? 0.06 : -0.3);
    s.castShadow = s.receiveShadow = false;
    g.add(s);
    // A warm pool of light over each station
    const spot = new THREE.SpotLight(0xffe2b0, 14, 7, 0.55, 0.7, 1.2);
    spot.position.set(st.pos[0], 4.2, st.pos[1] + 0.6);
    spot.target = g;
    scene.add(spot, g);
    groups.push(g);
    DIRS.push(new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw)));
  });

  // ---- The camera path ----
  // Each station has a stop in front of it, far enough back that the station fits the screen
  // (phones in portrait need more room). The path curves through the aisle between stops.
  const stops = [], targets = [], seats = [];
  let curve = null;
  function layoutPath(aspect) {
    const vf = THREE.MathUtils.degToRad(FOV) / 2;
    const hf = Math.atan(Math.tan(vf) * aspect);
    stops.length = targets.length = seats.length = 0;
    STATIONS.forEach((st, k) => {
      const dist = Math.max(st.w / 2 / Math.tan(hf), st.h / 2 / Math.tan(vf)) * 1.08 + 0.4;
      const p = new THREE.Vector3(st.pos[0], 0, st.pos[1]);
      const look = p.clone().setY(st.look);
      targets.push(look);
      stops.push(p.clone().addScaledVector(DIRS[k], dist).setY(st.look + dist * 0.38));
      seats.push(p.clone().addScaledVector(DIRS[k], st.seat[0]).setY(st.seat[1]));
    });
    const pts = [];
    stops.forEach((s, k) => {
      pts.push(s);
      if (k < LAST) pts.push(s.clone().lerp(stops[k + 1], 0.5).add(new THREE.Vector3(0, 0, 0.6)));
    });
    curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }

  const cam = { s: 0, seat: 0 };          // s: where along the path, in stations; seat: 0 standing … 1 seated
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  function pose() {
    const s = THREE.MathUtils.clamp(cam.s, 0, LAST);
    curve.getPoint(s / LAST, pos);
    const k = Math.min(LAST - 1, Math.floor(s));
    const f = THREE.MathUtils.smoothstep(s - k, 0, 1);
    look.lerpVectors(targets[k], targets[k + 1], f);
    // Rubber band past either end: lean a little that way
    if (cam.s !== s) pos.x += (cam.s - s) * 0.6;
    if (cam.seat > 0) {
      const e = cam.seat;
      pos.lerp(tmp.lerpVectors(seats[k], seats[k + 1], f), e);
      look.y -= 0.08 * e;
    }
    camera.position.copy(pos);
    camera.lookAt(look);
  }

  // ---- Overlay: the station's name, and the map ----
  const tag = document.createElement('div');
  tag.className = 'floor-tag';
  tag.innerHTML = '<b></b><span></span>';
  stage.appendChild(tag);
  const map = document.createElement('canvas');
  map.className = 'floor-map';
  map.setAttribute('role', 'img');
  map.setAttribute('aria-label', 'Map of the casino floor');
  stage.appendChild(map);
  const MAP_W = 132, MAP_H = 104, PAD = 9;
  const mg = map.getContext('2d');
  const toMap = (x, z) => [PAD + ((x - ROOM.x0) / (ROOM.x1 - ROOM.x0)) * (MAP_W - PAD * 2), PAD + ((z - ROOM.z0) / (ROOM.z1 - ROOM.z0)) * (MAP_H - PAD * 2)];
  function drawMap() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (map.width !== MAP_W * dpr) { map.width = MAP_W * dpr; map.height = MAP_H * dpr; }
    mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    mg.clearRect(0, 0, MAP_W, MAP_H);
    // The walls and the row of machines along the back
    const [ax, az] = toMap(ROOM.x0, ROOM.z0), [bx, bz] = toMap(ROOM.x1, ROOM.z1);
    mg.strokeStyle = 'rgba(255, 255, 255, .18)';
    mg.lineWidth = 1;
    mg.beginPath();
    mg.moveTo(ax, bz); mg.lineTo(ax, az); mg.lineTo(bx, az); mg.lineTo(bx, bz);
    mg.stroke();
    mg.fillStyle = 'rgba(255, 255, 255, .22)';
    for (const x of rowX) { const [mx, mz] = toMap(x, ROOM.z0 + 0.5); mg.fillRect(mx - 3, mz - 2.5, 6, 5); }
    // The path
    mg.setLineDash([2, 3]);
    mg.strokeStyle = 'rgba(233, 196, 106, .45)';
    mg.beginPath();
    for (let i = 0; i <= 40; i++) {
      const p = curve.getPoint(i / 40, tmp);
      const [mx, mz] = toMap(p.x, p.z);
      if (i) mg.lineTo(mx, mz); else mg.moveTo(mx, mz);
    }
    mg.stroke();
    mg.setLineDash([]);
    // Stations
    const here = Math.round(cam.s);
    STATIONS.forEach((st, k) => {
      const [mx, mz] = toMap(st.pos[0], st.pos[1]);
      mg.save();
      mg.translate(mx, mz);
      mg.rotate(-st.yaw);
      mg.fillStyle = st.color;
      mg.globalAlpha = k === here ? 1 : 0.6;
      mg.beginPath();
      if (st.id === 'table') { mg.arc(0, 0, 9, 0, Math.PI); mg.closePath(); }
      else if (st.id === 'roulette') { mg.rect(-11, -4.5, 22, 9); }
      else if (st.id === 'cashier') { mg.rect(-9, -3, 18, 6); }
      else { mg.rect(-4.5, -4.5, 9, 9); }
      mg.fill();
      if (k === here) { mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.stroke(); }
      mg.restore();
    });
    // You: a dot and the way you're looking
    const [cx, cz] = toMap(camera.position.x, camera.position.z);
    const ang = Math.atan2(look.z - camera.position.z, look.x - camera.position.x);
    const g = mg.createRadialGradient(cx, cz, 0, cx, cz, 22);
    g.addColorStop(0, 'rgba(233, 196, 106, .55)');
    g.addColorStop(1, 'rgba(233, 196, 106, 0)');
    mg.fillStyle = g;
    mg.beginPath();
    mg.moveTo(cx, cz);
    mg.arc(cx, cz, 22, ang - 0.45, ang + 0.45);
    mg.closePath();
    mg.fill();
    mg.fillStyle = '#e9c46a';
    mg.strokeStyle = '#2a1d05';
    mg.lineWidth = 1.5;
    mg.beginPath();
    mg.arc(cx, cz, 4, 0, TAU);
    mg.fill();
    mg.stroke();
  }
  function onMapTap(e) {
    if (seated || busy) return;
    const r = map.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = Infinity;
    STATIONS.forEach((st, k) => {
      const [mx, mz] = toMap(st.pos[0], st.pos[1]);
      const d = Math.hypot(mx - x, mz - y);
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) { buzz(5); go(best); }
    e.stopPropagation();
  }
  map.addEventListener('pointerup', onMapTap);

  // ---- Moving along the floor ----
  let here = -1;
  function changed() {
    const k = Math.round(THREE.MathUtils.clamp(cam.s, 0, LAST));
    if (k === here) return;
    here = k;
    const st = STATIONS[k];
    tag.querySelector('b').textContent = st.name;
    tag.querySelector('span').textContent = `${st.blurb} · tap to sit`;
    info.textContent = 'Swipe to move around the floor';
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === LAST;
    sitBtn.textContent = `Sit at ${st.name}`;
  }
  let glide = null;
  function go(k) {
    k = THREE.MathUtils.clamp(k, 0, LAST);
    if (glide) glide.kill();
    const d = Math.abs(k - cam.s);
    glide = gsap.to(cam, { s: k, duration: calm ? 0.25 : Math.min(1.6, 0.55 + d * 0.5), ease: 'power2.inOut', onUpdate: changed, onComplete: () => { glide = null; } });
  }

  // ---- Sitting down and getting up ----
  let seated = null, busy = false;
  async function sit() {
    if (seated || busy) return;
    busy = true;
    if (glide) { glide.kill(); glide = null; }
    const k = Math.round(THREE.MathUtils.clamp(cam.s, 0, LAST));
    const st = STATIONS[k];
    buzz(10);
    tag.classList.add('off');
    map.classList.add('off');
    const loading = st.load();
    await new Promise(done => gsap.to(cam, { s: k, seat: 1, duration: calm ? 0.2 : 1.05, ease: 'power2.inOut', onComplete: done }));
    if (dead) return;
    await seatAt(k, loading);
  }
  // The seated game for station k goes on top, and the floor stops drawing underneath
  async function seatAt(k, loading) {
    const st = STATIONS[k];
    const overlay = document.createElement('div');
    overlay.className = 'floor-seat';
    stage.appendChild(overlay);
    controls.textContent = '';
    controls.append(button('‹ Floor', stand));
    info.textContent = 'Loading…';
    seated = { k, overlay, inst: null };
    try {
      const mod = await loading;
      const inst = await mod.mount({ stage: overlay, controls, info });
      if (dead || !seated || seated.overlay !== overlay) { inst.dispose(); return; }
      seated.inst = inst;
    } catch (err) {
      console.error(err);
      info.textContent = `${st.name} couldn’t start here: ${(err && err.message) || err}`;
    }
    requestAnimationFrame(() => overlay.classList.add('on'));
    hops(k);
    await new Promise(done => setTimeout(done, 380));
    if (seated && seated.overlay === overlay) pause();
    busy = false;
  }
  // Get up from this game, leaving its view to fade out over the floor
  function leaveSeat() {
    const { overlay, inst } = seated;
    seated = null;
    hops(-1);
    resume();
    overlay.classList.remove('on');
    setTimeout(() => {
      if (inst) { try { inst.dispose(); } catch (e) { /* already gone */ } }
      overlay.remove();
    }, 360);
  }
  // Straight to the next seat over: up a little, along the floor, and down into it
  async function hop(dir) {
    if (!seated || busy) return;
    const k = seated.k + dir;
    if (k < 0 || k > LAST) return;
    busy = true;
    buzz(8);
    leaveSeat();
    controls.textContent = '';   // the last game's buttons go with it
    info.textContent = `Over to ${STATIONS[k].name}…`;
    const loading = STATIONS[k].load();
    const t = calm ? 0.3 : 1.25;
    await new Promise(done => gsap.timeline({ onComplete: done })
      .to(cam, { s: k, duration: t, ease: 'power2.inOut' }, 0)
      .to(cam, { seat: 0.45, duration: t / 2, ease: 'sine.out' }, 0)
      .to(cam, { seat: 1, duration: t / 2, ease: 'sine.in' }, t / 2));
    if (dead) return;
    await seatAt(k, loading);
  }
  const hopPrev = document.createElement('button'), hopNext = document.createElement('button');
  hopPrev.className = 'floor-hop prev';
  hopNext.className = 'floor-hop next';
  hopPrev.addEventListener('click', () => hop(-1));
  hopNext.addEventListener('click', () => hop(1));
  stage.append(hopPrev, hopNext);
  function hops(k) {
    hopPrev.hidden = k < 1;
    hopNext.hidden = k < 0 || k >= LAST;
    if (k > 0) { hopPrev.textContent = `‹ ${STATIONS[k - 1].name}`; hopPrev.setAttribute('aria-label', `Move to ${STATIONS[k - 1].name}`); }
    if (k >= 0 && k < LAST) { hopNext.textContent = `${STATIONS[k + 1].name} ›`; hopNext.setAttribute('aria-label', `Move to ${STATIONS[k + 1].name}`); }
  }
  hops(-1);
  // A sideways swipe on a trackpad hops seats too (the games use up and down for zoom)
  let sideways = 0, sideTimer = 0;
  function onSeatWheel(e) {
    if (!seated || busy || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    sideways += e.deltaX;
    clearTimeout(sideTimer);
    sideTimer = setTimeout(() => { sideways = 0; }, 250);
    if (Math.abs(sideways) > 90) { const d = Math.sign(sideways); sideways = 0; hop(d); }
  }
  stage.addEventListener('wheel', onSeatWheel, { passive: false, capture: true });
  function stand() {
    if (!seated || busy) return;
    busy = true;
    leaveSeat();
    floorControls();
    here = -1;
    changed();
    tag.classList.remove('off');
    map.classList.remove('off');
    gsap.to(cam, { seat: 0, duration: calm ? 0.2 : 0.9, ease: 'power2.inOut', delay: 0.15, onComplete: () => { busy = false; } });
  }

  // ---- Input: swipe, tap, wheel, keys ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const drag = { on: false, id: 0, x: 0, s0: 0, moved: false, vx: 0, lx: 0, lt: 0 };
  function onDown(e) {
    if (seated || busy) return;
    if (glide) { glide.kill(); glide = null; }
    Object.assign(drag, { on: true, id: e.pointerId, x: e.clientX, s0: cam.s, moved: false, vx: 0, lx: e.clientX, lt: performance.now() });
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { /* released */ }
  }
  function onMove(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 7) return;
    drag.moved = true;
    const w = stage.clientWidth || 1;
    let s = drag.s0 - dx / (w * 0.6);
    if (s < 0) s *= 0.35;
    if (s > LAST) s = LAST + (s - LAST) * 0.35;
    cam.s = s;
    const now = performance.now();
    if (now > drag.lt) drag.vx = 0.7 * drag.vx + 0.3 * ((e.clientX - drag.lx) / (now - drag.lt));
    drag.lx = e.clientX;
    drag.lt = now;
    changed();
  }
  function onUp(e) {
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    if (drag.moved) {
      // Flick: carry on toward the next station if you swiped fast
      const fling = -drag.vx * 0.9;
      go(Math.round(cam.s + THREE.MathUtils.clamp(fling, -0.6, 0.6)));
      return;
    }
    const r = canvasEl.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(groups, true)[0];
    let o = hit && hit.object;
    while (o && o.userData.k == null) o = o.parent;
    if (!o) return;
    const k = o.userData.k;
    if (k === Math.round(cam.s) && Math.abs(cam.s - k) < 0.15) sit();
    else { buzz(5); go(k); }
  }
  let wheelTimer = 0;
  function onWheel(e) {
    if (seated || busy) return;
    e.preventDefault();
    if (glide) { glide.kill(); glide = null; }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    cam.s = THREE.MathUtils.clamp(cam.s + d * 0.0025, -0.15, LAST + 0.15);
    changed();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => go(Math.round(cam.s)), 140);
  }
  function onKey(e) {
    if (seated || busy) return;
    if (e.key === 'ArrowLeft') go(Math.round(cam.s) - 1);
    else if (e.key === 'ArrowRight') go(Math.round(cam.s) + 1);
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) sit();
    else return;
    e.preventDefault();
  }
  canvasEl.addEventListener('pointerdown', onDown);
  canvasEl.addEventListener('pointermove', onMove);
  canvasEl.addEventListener('pointerup', onUp);
  canvasEl.addEventListener('pointercancel', onUp);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  // ---- Controls ----
  const prevBtn = button('‹', () => go(Math.round(cam.s) - 1));
  const nextBtn = button('›', () => go(Math.round(cam.s) + 1));
  const sitBtn = button('Sit down', sit, 'primary');
  prevBtn.setAttribute('aria-label', 'Previous station');
  nextBtn.setAttribute('aria-label', 'Next station');
  prevBtn.style.flex = nextBtn.style.flex = '0 0 64px';
  function floorControls() {
    controls.textContent = '';
    controls.append(prevBtn, sitBtn, nextBtn);
  }
  floorControls();

  // ---- Loop ----
  const governor = frameGovernor(renderer, scene);
  let raf = 0, last = performance.now(), paused = false, dead = false, aspect = 0;
  function fit() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    const px = renderer.getPixelRatio();
    if (canvasEl.width !== Math.round(w * px) || canvasEl.height !== Math.round(h * px)) renderer.setSize(w, h, false);
    if (w / h !== aspect) {
      aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      layoutPath(aspect);
    }
  }
  function frame(nowMs) {
    raf = 0;
    if (paused || dead) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    if (governor.tick(nowMs)) aspect = 0;
    fit();
    if (rotor) rotor.rotation.y += dt * 0.9;
    if (ballPivot) ballPivot.rotation.y -= dt * 2.1;
    for (const b of bulbs) b.material = (b.userData.i + Math.floor(now * 5)) % 3 ? b.userData.on : b.userData.off;
    if (duck) duck.rotation.y = Math.sin(now * 0.8) * 0.4;
    if (duck) duck.position.y = 2.14 + Math.sin(now * 2.2) * 0.01;
    pose();
    renderer.render(scene, camera);
    drawMap();
  }
  function pause() { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; governor.idle(); }
  function resume() { if (!paused) return; paused = false; last = performance.now(); raf = requestAnimationFrame(frame); }

  fit();
  changed();
  pose();
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (e) { /* draws anyway */ } }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      gsap.killTweensOf(cam);
      if (seated) { try { seated.inst && seated.inst.dispose(); } catch (e) { /* already gone */ } seated.overlay.remove(); seated = null; }
      canvasEl.removeEventListener('pointerdown', onDown);
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
      canvasEl.removeEventListener('wheel', onWheel);
      stage.removeEventListener('wheel', onSeatWheel, { capture: true });
      clearTimeout(sideTimer);
      hopPrev.remove();
      hopNext.remove();
      window.removeEventListener('keydown', onKey);
      map.remove();
      tag.remove();
      style.remove();
      disposeScene(scene);
      for (const t of textures) t.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasEl.remove();
    },
  };
}
