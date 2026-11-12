// Casino floor (beta): the games laid out on a casino floor. You don't walk around: the camera
// glides along a fixed path from one station to the next as you swipe, and tapping a station
// takes you down into its seat, where the casino opens that game's screen. A small 2D map in
// the corner shows where you are on the floor; tap it to jump to a station.
//
// The floor only draws stand-in models (they're cheap); the games themselves are the casino's.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';
import { EMOJI, canvas, tex, carpetCanvas, signCanvas, duckGeometry } from './arcade.js';

const TAU = Math.PI * 2;
const ROOM = { x0: -9.2, x1: 9.2, z0: -4.4, z1: 7 };   // the part of the floor the map shows
const MID = (ROOM.x0 + ROOM.x1) / 2, SPAN = ROOM.x1 - ROOM.x0;
const FOV = 55;

/* The stations, left to right along the path. pos is [x, z] on the floor; yaw turns the
   station toward the aisle; w and h are how much of it the overview must fit on screen;
   look is the height the camera aims at; seat is [distance, height] of the seated view. */
const CARD = { w: 2.1, h: 1.1, look: 0.72, seat: [1.25, 1.45] };   // the half-moon card tables
const STATIONS = [
  { id: 'table', name: 'Blackjack', blurb: 'Beat the dealer to 21', color: '#5ee08a', pos: [-7.7, -0.7], yaw: 0.35, ...CARD },
  { id: 'threecard', name: 'Three Card Poker', blurb: 'Your three cards against the dealer’s', color: '#6bb8ff', pos: [-5.6, -1.7], yaw: 0.2, ...CARD },
  { id: 'war', name: 'Casino War', blurb: 'One card each. High card wins', color: '#ff8a5c', pos: [-3.5, -0.6], yaw: 0.1, ...CARD },
  { id: 'reddog', name: 'Red Dog', blurb: 'Will the third card fall between?', color: '#ff6b9a', pos: [-1.4, -1.7], yaw: 0.05, ...CARD },
  { id: 'roulette', name: 'Roulette', blurb: 'Spin the real-physics wheel', color: '#ff5d6c', pos: [1, -1.9], yaw: 0, w: 2.5, h: 1.1, look: 0.78, seat: [1.15, 1.55] },
  { id: 'baccarat', name: 'Baccarat', blurb: 'Player or Banker, closest to 9', color: '#c9a2ff', pos: [3.6, -0.6], yaw: -0.1, w: 2.7, h: 1.1, look: 0.72, seat: [1.3, 1.5] },
  { id: 'poker', name: 'Video Poker', blurb: 'Hold, draw, and hope for a royal', color: '#5ee0e0', pos: [5.5, -1.7], yaw: -0.2, w: 1.3, h: 2.7, look: 1.15, seat: [1, 1.3] },
  { id: 'slots', name: 'Lucky Duck 3000', blurb: 'Pull the lever. The duck is wild', color: '#ffd23f', pos: [7, -0.5], yaw: -0.3, w: 1.2, h: 2.3, look: 1.05, seat: [1.15, 1.35] },
  // Round the corner: the arcade machines along the right-hand wall…
  { id: 'plinko', name: 'Duck Drop', blurb: 'Drop ducks down the peg board. The edges pay big', color: '#7cff6b', pos: [8.75, 1.9], yaw: -1.35, w: 1.7, h: 4, look: 1.85, seat: [1.15, 1.6], seatLook: 1.55 },
  { id: 'crash', name: 'Duck Rocket', blurb: 'Cash out before the rocket blows', color: '#ff8a3d', pos: [8.8, 4.1], yaw: -1.8, w: 1.2, h: 3.2, look: 1.4, seat: [0.4, 1.45], seatLook: 1.45 },
  // …and the cashier on the front wall, on your way out
  { id: 'cashier', name: 'Cashier', blurb: 'Your balance and stats', color: '#e9c46a', pos: [6.4, 5.95], yaw: Math.PI + 0.45, w: 1.9, h: 2.3, look: 1.15, seat: [1.2, 1.5] },
];
const LAST = STATIONS.length - 1;

const CSS = `
.floor-map { position: absolute; right: 12px; top: 42px; width: 140px; height: 92px; z-index: 3; border-radius: 14px; touch-action: none; cursor: pointer;
  background: rgba(10, 8, 6, .72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12), 0 6px 18px rgba(0, 0, 0, .4); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: opacity .3s; }
canvas.floor-map { width: 140px !important; height: 92px !important; }   /* the lab and the casino stretch every stage canvas */
.floor-map.off { opacity: 0; pointer-events: none; }
.floor-tag { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; pointer-events: none; text-align: center; white-space: nowrap;
  padding: 8px 14px; border-radius: 12px; background: rgba(10, 8, 6, .72); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: opacity .3s; }
.floor-tag b { display: block; font-size: 17px; }
.floor-tag span { font-size: 13px; color: rgba(245, 240, 227, .7); }
.floor-tag.off { opacity: 0; }
`;

/* Sitting down calls casino.sit(id) once the camera is in the seat, and the casino opens its
   game screen for that station. casino.start can put the camera at a station when the floor
   opens: { at, seated } to stand up from that seat, or { at, hop } to glide from that seat
   into another one (the casino's seat-to-seat arrows). */
export async function mount({ stage, controls, info, casino }) {
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
  key.position.set(MID - 2, 6, 3);
  key.target.position.set(MID, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(key.shadow.camera, { left: -SPAN / 2 - 0.4, right: SPAN / 2 + 0.4, top: 6, bottom: -6, near: 1, far: 16 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const carpet = keep(tex(carpetCanvas(), renderer));
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(Math.round(SPAN + 2), 12);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SPAN + 2, 12), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(MID, 0, 1);
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(SPAN + 2, 5), M.wall);
  backWall.position.set(MID, 2.5, ROOM.z0);
  scene.add(backWall);
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(SPAN + 2, 5), M.wall);
  frontWall.position.set(MID, 2.5, ROOM.z1 + 0.05);
  frontWall.rotation.y = Math.PI;
  scene.add(frontWall);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), M.wall);
    wall.position.set(MID + side * (SPAN / 2 + 0.6), 2.5, 1);
    wall.rotation.y = -side * Math.PI / 2;
    scene.add(wall);
  }
  // Neon running along the walls
  const neon = [[MID, ROOM.z0 + 0.02, 0, SPAN + 1.2, 0xff2bd6, 2.9], [MID, ROOM.z0 + 0.02, 0, SPAN + 1.2, 0x2be7ff, 0.35], [MID, ROOM.z1 + 0.02, 0, SPAN + 1.2, 0x2be7ff, 2.9]];
  for (const [x, z, , len, color, y] of neon) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.035), glowMat(color));
    tube.position.set(x, y, z);
    scene.add(tube);
  }
  for (const side of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 11.4), glowMat(side < 0 ? 0xff2bd6 : 0x2be7ff));
    tube.position.set(MID + side * (SPAN / 2 + 0.58), 2.9, 1.3);
    scene.add(tube);
  }

  // A row of slot machines along the back wall (just scenery for now: themed machines go here later)
  const ROW = Math.floor((SPAN - 1.3) / 0.9) + 1;
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
    const x = ROOM.x0 + 0.65 + i * 0.9;
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
    const fit = Math.min(1, 900 / g.measureText(text).width);
    if (fit < 1) g.font = `900 ${Math.floor(120 * fit)}px Manrope, sans-serif`;
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
  // Printing on the felt: the table's name or its bets, in gold
  function feltTex(text) {
    const [cv, g] = canvas(1024, 128);
    g.font = '800 64px Manrope, sans-serif';
    const fit = Math.min(1, 980 / g.measureText(text).width);
    if (fit < 1) g.font = `800 ${Math.floor(64 * fit)}px Manrope, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(233, 196, 106, .9)';
    g.fillText(text, 512, 66);
    return keep(tex(cv, renderer));
  }
  function feltPrint(text, width, x, y, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), new THREE.MeshBasicMaterial({ map: feltTex(text), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }
  const cardBack = std(0x9a1628, 0.5);
  function card(x, y, z, turn, up = true) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), up ? M.white : cardBack);
    m.rotation.set(-Math.PI / 2, 0, turn);
    m.position.set(x, y, z);
    return m;
  }
  function chipStack(col, x, y, z, h = 0.05) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, h, 16), std(col, 0.4));
    m.position.set(x, y + h / 2, z);
    return m;
  }
  const CHIP_COLS = [0x7a2bb5, 0x222222, 0x1f5fbf, 0xc8102e];
  /* The half-moon card tables. per is how many cards sit at each of the five spots (dealt
     side by side), dealer how many face-down in front of the dealer, middle cards dealt in a
     row across the middle (Red Dog's spread) */
  function buildCardTable({ felt, print, per = 2, dealer = 0, middle = 0 }) {
    const g = new THREE.Group();
    const top = 0.78;
    const feltMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.04, 48, 1, false, -Math.PI / 2, Math.PI), std(felt, 0.95));
    feltMesh.position.y = top;
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
    g.add(feltMesh, rail, back, skirt, front, leg, tray, feltPrint(print, 1.0, 0, top + 0.021, 0.42));
    [0, 0, 1, 1, 2, 2, 3, 3].forEach((c, i) => g.add(chipStack(CHIP_COLS[c], -0.21 + i * 0.06, top + 0.045, 0.1)));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.22), std(0x5a0c18, 0.4));
    shoe.position.set(0.6, top + 0.07, 0.16);
    g.add(shoe);
    for (let i = 0; i < dealer; i++) g.add(card((i - (dealer - 1) / 2) * 0.08, top + 0.022, 0.26, 0, false));
    for (let i = 0; i < middle; i++) g.add(card((i - (middle - 1) / 2) * 0.09, top + 0.022, 0.32, 0, i !== 1));
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.45;
      for (let j = 0; j < per; j++) {
        const off = (j - (per - 1) / 2) * 0.03;
        g.add(card(Math.sin(a) * 0.68 + off * Math.cos(a), top + 0.022 + j * 0.001, Math.cos(a) * 0.68 - off * Math.sin(a), -a));
      }
      g.add(chipStack(CHIP_COLS[(i + 2) % 4], Math.sin(a) * 0.84, top + 0.02, Math.cos(a) * 0.84, 0.03));
      g.add(stool(Math.sin(a) * 1.35, Math.cos(a) * 1.35));
    }
    return g;
  }
  const buildBlackjack = () => buildCardTable({ felt: 0x0d6b3a, print: 'BLACKJACK PAYS 3 TO 2', per: 2, dealer: 2 });
  const buildThreeCard = () => buildCardTable({ felt: 0x123f78, print: 'PAIR PLUS · ANTE · PLAY', per: 3, dealer: 3 });
  const buildWar = () => buildCardTable({ felt: 0x7a1f1a, print: 'CASINO WAR · TIES GO TO WAR', per: 1, dealer: 1 });
  const buildRedDog = () => buildCardTable({ felt: 0x4b1f6e, print: 'RED DOG · THE SPREAD PAYS', per: 0, middle: 3 });

  // Baccarat: a long oval table, Player and Banker boxes down the middle
  function buildBaccarat() {
    const g = new THREE.Group();
    const top = 0.78, SX = 1.35, SZ = 0.72;
    const oval = m => { m.scale.set(SX, 1, SZ); return m; };
    const felt = oval(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.04, 56), std(0x0b5a3a, 0.95)));
    felt.position.y = top;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 56), M.leather);
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(SX, SZ, 1);
    rail.position.y = top + 0.03;
    const skirt = oval(new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.94, 0.45, 48, 1, true), M.woodDark));
    skirt.position.y = top - 0.25;
    const legs = [-0.7, 0.7].map(x => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.55, 16), M.woodDark); l.position.set(x, 0.275, 0); return l; });
    g.add(felt, rail, skirt, ...legs, feltPrint('PLAYER', 0.8, -0.42, top + 0.021, 0.14), feltPrint('BANKER', 0.8, 0.42, top + 0.021, 0.14), feltPrint('TIE PAYS 8 TO 1', 0.9, 0, top + 0.021, 0.44));
    for (const x of [-0.42, 0.42]) for (const d of [-0.045, 0.045]) g.add(card(x + d, top + 0.022, -0.05, 0));
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.13), M.woodDark);
    tray.position.set(0, top + 0.035, -0.5);
    g.add(tray);
    [0, 0, 1, 1, 2, 2, 3, 3, 1].forEach((c, i) => g.add(chipStack(CHIP_COLS[c], -0.24 + i * 0.06, top + 0.045, -0.5)));
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.42;
      g.add(stool(Math.sin(a) * SX * 1.18, Math.cos(a) * SZ * 1.18 + 0.3));
    }
    return g;
  }

  // Video poker: a bar-top machine with a slanted screen and a row of hold buttons
  function vpScreenTex() {
    const [cv, g] = canvas(512, 320);
    g.fillStyle = '#0a1f7a';
    g.fillRect(0, 0, 512, 320);
    g.font = '900 40px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f';
    g.fillText('JACKS OR BETTER', 256, 46);
    ['A', 'K', 'Q', 'J', '10'].forEach((r, i) => {
      const x = 16 + i * 98;
      g.fillStyle = '#fbf8f0';
      g.fillRect(x, 96, 86, 124);
      g.fillStyle = i % 2 ? '#141414' : '#c8102e';
      g.font = '900 46px Manrope, sans-serif';
      g.fillText(r, x + 43, 158);
    });
    g.font = '800 26px Manrope, sans-serif';
    g.fillStyle = '#fff';
    g.fillText('ROYAL FLUSH  ·  800 FOR 1', 256, 270);
    return keep(tex(cv, renderer));
  }
  function buildVideoPoker() {
    const g = new THREE.Group();
    const blue = std(0x15306a, 0.4, 0.1);
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.95, 0.6, 3, 0.05), blue);
    base.position.y = 0.475;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.26), M.chrome);
    deck.position.set(0, 0.97, 0.2);
    deck.rotation.x = 0.18;
    g.add(base, deck);
    const btnGeo = new THREE.BoxGeometry(0.08, 0.025, 0.05);
    const lit = glowMat(0xffd23f);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(btnGeo, i === 2 ? glowMat(0xff5d6c) : lit);
      b.position.set(-0.24 + i * 0.12, 1.0, 0.24);
      b.rotation.x = 0.18;
      g.add(b);
    }
    const head = new THREE.Group();
    head.position.set(0, 1.0, 0.0);
    head.rotation.x = -0.22;
    const box = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.72, 0.36, 3, 0.04), blue);
    box.position.y = 0.36;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.375), new THREE.MeshBasicMaterial({ map: vpScreenTex(), toneMapped: false }));
    screen.position.set(0, 0.38, 0.182);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.42, 0.01), M.chrome);
    bezel.position.set(0, 0.38, 0.176);
    head.add(box, bezel, screen);
    const topper = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.08), glowMat(0x5ee0e0));
    topper.position.set(0, 1.76, -0.13);
    g.add(head, topper);
    g.add(stool(0, 0.75));
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

  // Duck Drop: a big stand-alone peg-board machine, a duck bouncing down behind the glass
  let dropDuck = null;
  const DROP = { top: 2.42, bottom: 0.98, rows: 9, gap: 0.135 };
  function dropBinsTex() {
    const pays = ['10×', '3×', '1.5×', '1×', '0.5×', '1×', '1.5×', '3×', '10×'];
    const cols = ['#ff3d6e', '#ff8a3d', '#ffd23f', '#7cff6b', '#6be7ff', '#7cff6b', '#ffd23f', '#ff8a3d', '#ff3d6e'];
    const [cv, g] = canvas(1024, 128);
    g.fillStyle = '#12061e';
    g.fillRect(0, 0, 1024, 128);
    g.font = '900 40px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    pays.forEach((t, i) => {
      const x = 8 + i * 112;
      g.fillStyle = cols[i];
      g.fillRect(x, 14, 104, 100);
      g.fillStyle = '#12061e';
      g.fillText(t, x + 52, 66);
    });
    return keep(tex(cv, renderer));
  }
  function buildPlinko() {
    const g = new THREE.Group();
    const W = 1.4, purple = std(0x3a1260, 0.45, 0.1);
    const base = new THREE.Mesh(new RoundedBoxGeometry(W + 0.1, 0.8, 0.7, 3, 0.05), purple);
    base.position.y = 0.4;
    const cab = new THREE.Mesh(new RoundedBoxGeometry(W, 1.85, 0.36, 3, 0.05), purple);
    cab.position.set(0, 1.72, -0.12);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.16, 1.6), new THREE.MeshStandardMaterial({ color: 0x150828, emissive: 0x2a0d4a, emissiveIntensity: 0.8, roughness: 0.6 }));
    board.position.set(0, 1.74, 0.061);
    const bins = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.16, 0.16), new THREE.MeshBasicMaterial({ map: dropBinsTex(), toneMapped: false }));
    bins.position.set(0, DROP.bottom - 0.04, 0.063);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, 1.78), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    glass.position.set(0, 1.72, 0.1);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.06, 0.32), M.chrome);
    ledge.position.set(0, 0.83, 0.2);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 24), glowMat(0x7cff6b));
    btn.position.set(0, 0.88, 0.24);
    const marquee = new THREE.Mesh(new THREE.CircleGeometry(0.66, 40, 0, Math.PI), new THREE.MeshBasicMaterial({ map: keep(tex(signCanvas('DUCK DROP', 'UP TO 10×'), renderer)), toneMapped: false }));
    marquee.position.set(0, 2.64, -0.02);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.3, 40, 1, false, -Math.PI / 2, Math.PI), purple);
    arch.rotation.x = Math.PI / 2;
    arch.position.set(0, 2.64, -0.18);
    g.add(base, cab, board, bins, glass, ledge, btn, marquee, arch);
    // The pegs: a triangle of glowing studs
    const xs = [];
    for (let r = 0; r < DROP.rows; r++) for (let i = 0; i <= r + 2; i++) xs.push([(i - (r + 2) / 2) * DROP.gap * 0.95, DROP.top - 0.08 - r * 0.15]);
    const pegs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 6), glowMat(0xffe7a0), xs.length);
    xs.forEach(([x, y], i) => pegs.setMatrixAt(i, m4.makeTranslation(x, y, 0.075)));
    g.add(pegs);
    // Bulbs round the marquee
    const bulbGeo = new THREE.SphereGeometry(0.02, 8, 6);
    const on = glowMat(0xb6ffa8), off = glowMat(0x2d5a28);
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      const b = new THREE.Mesh(bulbGeo, on);
      b.position.set(Math.cos(a) * 0.71, 2.64 + Math.sin(a) * 0.71, -0.02);
      b.userData = { on, off, i };
      bulbs.push(b);
      g.add(b);
    }
    dropDuck = new THREE.Mesh(duckGeometry(0.06), std(0xffffff, 0.35, 0, { vertexColors: true }));
    dropDuck.position.set(0, DROP.top, 0.085);
    g.add(dropDuck);
    return g;
  }
  // Where the duck is on its way down: falls row by row, bouncing a peg left or right
  const dropPath = [];
  { let x = 0; for (let r = 0; r <= DROP.rows; r++) { dropPath.push(x); x += ((r * 7 + 3) % 5 < 2 ? -1 : 1) * DROP.gap * 0.475; } }
  function dropAt(t) {
    const f = t % 1 * (DROP.rows + 1.5);
    const r = Math.min(DROP.rows, Math.floor(f)), u = Math.min(1, f - r);
    const x0 = dropPath[r], x1 = dropPath[Math.min(DROP.rows, r + 1)];
    dropDuck.position.x = x0 + (x1 - x0) * u;
    dropDuck.position.y = DROP.top - 0.05 - (r + u * u) * 0.15 + Math.sin(u * Math.PI) * 0.03;
    dropDuck.rotation.z = (x1 - x0) * 6 * u;
  }

  // Duck Rocket: a big upright arcade cabinet. Sitting down zooms you into its screen
  function rocketScreenTex() {
    const [cv, g] = canvas(1024, 768);   // drawn at double size: sitting down zooms right into it
    g.scale(2, 2);
    const sky = g.createLinearGradient(0, 0, 0, 384);
    sky.addColorStop(0, '#05021a');
    sky.addColorStop(1, '#2a0b4a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 384);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + ((i * 37) % 7) / 10})`; g.fillRect((i * 151) % 512, (i * 89) % 300, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    for (let y = 60; y < 384; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    // The climbing curve
    g.strokeStyle = '#ff8a3d';
    g.shadowColor = '#ff8a3d';
    g.shadowBlur = 16;
    g.lineWidth = 7;
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const t = i / 40; const x = 30 + t * 360, y = 350 - Math.pow(t, 2.2) * 250; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    g.shadowBlur = 0;
    g.font = `64px ${EMOJI}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(400, 92);
    g.rotate(0.5);
    g.fillText('🚀', 0, 0);
    g.restore();
    g.font = '900 72px Manrope, sans-serif';
    g.fillStyle = '#fff8e6';
    g.shadowColor = '#ffd23f';
    g.shadowBlur = 20;
    g.fillText('2.47×', 170, 70);
    return keep(tex(cv, renderer));
  }
  let rocketGlow = null;
  function buildRocket() {
    const g = new THREE.Group();
    const W = 0.86, D = 0.8;
    const black = std(0x15101c, 0.5), orange = std(0xff7a1f, 0.4, 0.1);
    // The classic side profile: tall back, a screen that leans back, a control panel that juts out
    const side = new THREE.Shape();
    side.moveTo(-D / 2, 0);
    side.lineTo(D / 2, 0);
    side.lineTo(D / 2, 0.92);
    side.lineTo(D / 2 + 0.08, 0.98);
    side.lineTo(D / 2 + 0.02, 1.08);
    side.lineTo(D / 2 - 0.12, 1.12);
    side.lineTo(D / 2 - 0.26, 1.78);
    side.lineTo(D / 2 - 0.16, 2.02);
    side.lineTo(D / 2 - 0.1, 2.3);
    side.lineTo(-D / 2, 2.3);
    side.closePath();
    const sideGeo = new THREE.ExtrudeGeometry(side, { depth: 0.04, bevelEnabled: false });
    for (const sx of [-1, 1]) {
      const panel = new THREE.Mesh(sideGeo, orange);
      panel.rotation.y = -Math.PI / 2;
      panel.position.x = sx * (W / 2) + (sx > 0 ? 0.04 : 0);
      g.add(panel);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, 2.28, D - 0.3), black);
    body.position.set(0, 1.14, -0.15);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(W, 0.92, 0.32), black);
    lower.position.set(0, 0.46, 0.24);
    const coin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.01), glowMat(0xff3d6e));
    coin.position.set(0, 0.6, 0.405);
    // Control panel with a stick and two buttons
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.3), black);
    deck.position.set(0, 1.0, 0.36);
    deck.rotation.x = 0.25;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), M.chrome);
    stick.position.set(-0.18, 1.08, 0.38);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), std(0xc8102e, 0.25));
    knob.position.set(-0.18, 1.15, 0.38);
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), glowMat(0x7cff6b));
    b1.position.set(0.1, 1.05, 0.38);
    b1.rotation.x = 0.25;
    const b2 = b1.clone();
    b2.material = glowMat(0xffd23f);
    b2.position.x = 0.22;
    // The screen, leaning back in its bezel
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.5), new THREE.MeshBasicMaterial({ map: rocketScreenTex(), toneMapped: false }));
    screen.position.set(0, 1.45, D / 2 - 0.2);
    screen.rotation.x = -0.2;
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, 0.68), std(0x050308, 0.3));
    bezel.position.set(0, 1.45, D / 2 - 0.205);
    bezel.rotation.x = -0.2;
    // Lit marquee on top
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, 0.24), new THREE.MeshBasicMaterial({ map: signTex('DUCK ROCKET', '#ff8a3d'), toneMapped: false }));
    marquee.position.set(0, 2.15, D / 2 - 0.12);
    marquee.rotation.x = 0.12;
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, 0.28, 0.2), black);
    box.position.set(0, 2.15, D / 2 - 0.23);
    rocketGlow = new THREE.PointLight(0xff8a3d, 0.6, 1.6, 2);
    rocketGlow.position.set(0, 1.45, D / 2 + 0.2);
    g.add(body, lower, coin, deck, stick, knob, b1, b2, bezel, screen, box, marquee, rocketGlow);
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
  const builders = { table: buildBlackjack, threecard: buildThreeCard, war: buildWar, reddog: buildRedDog, roulette: buildRoulette, baccarat: buildBaccarat, poker: buildVideoPoker, slots: buildSlots, plinko: buildPlinko, crash: buildRocket, cashier: buildCashier };
  // Where each sign hangs: [height, depth, width]
  const SIGN = { roulette: [2.05, -0.7, 1.8], baccarat: [2.05, -0.75, 1.8], poker: [2.15, -0.25, 1.5], slots: [2.65, -0.3, 1.6], plinko: [3.55, -0.2, 1.7], crash: [2.75, -0.2, 1.6], cashier: [2.55, 0.06, 1.8] };
  const groups = [];
  const DIRS = [];
  STATIONS.forEach((st, k) => {
    const g = shadowy(builders[st.id]());
    g.position.set(st.pos[0], 0, st.pos[1]);
    g.rotation.y = st.yaw;
    g.userData.k = k;
    const [sy, sz, sw] = SIGN[st.id] || [2.05, -0.3, 1.8];
    const s = sign(st.name.toUpperCase(), st.color, sw);
    s.position.set(0, sy, sz);
    s.castShadow = s.receiveShadow = false;
    g.add(s);
    scene.add(g);
    groups.push(g);
    DIRS.push(new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw)));
  });

  // Warm pools of light, one over each pair of stations (fewer lights keep phones fast)
  for (let k = 0; k < STATIONS.length; k += 2) {
    const a = STATIONS[k].pos, b = (STATIONS[k + 1] || STATIONS[k]).pos;
    const aim = new THREE.Object3D();
    aim.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    const spot = new THREE.SpotLight(0xffe2b0, 18, 8, 0.75, 0.7, 1.2);
    spot.position.set(aim.position.x, 4.4, aim.position.z + 0.8);
    spot.target = aim;
    scene.add(spot, aim);
  }

  // ---- The camera path ----
  // Each station has a stop in front of it, far enough back that the station fits the screen
  // (phones in portrait need more room). The path curves through the aisle between stops.
  const stops = [], targets = [], seats = [], seatLooks = [];
  let curve = null;
  function layoutPath(aspect) {
    const vf = THREE.MathUtils.degToRad(FOV) / 2;
    const hf = Math.atan(Math.tan(vf) * aspect);
    stops.length = targets.length = seats.length = seatLooks.length = 0;
    STATIONS.forEach((st, k) => {
      const dist = Math.max(st.w / 2 / Math.tan(hf), st.h / 2 / Math.tan(vf)) * 1.08 + 0.4;
      const p = new THREE.Vector3(st.pos[0], 0, st.pos[1]);
      const look = p.clone().setY(st.look);
      targets.push(look);
      stops.push(p.clone().addScaledVector(DIRS[k], dist).setY(st.look + dist * 0.38));
      seats.push(p.clone().addScaledVector(DIRS[k], st.seat[0]).setY(st.seat[1]));
      seatLooks.push(st.seatLook ?? st.look - 0.08);
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
      look.y += (THREE.MathUtils.lerp(seatLooks[k], seatLooks[k + 1], f) - look.y) * e;
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
  const MAP_W = 140, MAP_H = 92, PAD = 7;
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
    mg.strokeRect(ax, az, bx - ax, bz - az);
    mg.stroke();
    mg.fillStyle = 'rgba(255, 255, 255, .22)';
    for (const x of rowX) { const [mx, mz] = toMap(x, ROOM.z0 + 0.5); mg.fillRect(mx - 2.5, mz - 2, 5, 4); }
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
      if (st.id === 'roulette') mg.rect(-9.5, -4, 19, 8);
      else if (st.id === 'baccarat') mg.ellipse(0, 0, 10, 5.5, 0, 0, TAU);
      else if (st.id === 'cashier') mg.rect(-7, -2.5, 14, 5);
      else if (st.id === 'plinko') mg.rect(-5, -2.5, 10, 5);
      else if (st.id === 'slots' || st.id === 'poker' || st.id === 'crash') mg.rect(-3.5, -3.5, 7, 7);
      else { mg.arc(0, 0, 7.5, 0, Math.PI); mg.closePath(); }   // the half-moon card tables
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
    if (busy) return;
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

  // ---- Sitting down ----
  // The camera drops into the seat, then the casino opens that station's game screen
  let busy = false;
  function sit() {
    if (busy) return;
    busy = true;
    if (glide) { glide.kill(); glide = null; }
    const k = Math.round(THREE.MathUtils.clamp(cam.s, 0, LAST));
    buzz(10);
    tag.classList.add('off');
    map.classList.add('off');
    gsap.to(cam, { s: k, seat: 1, duration: calm ? 0.2 : 1.05, ease: 'power2.inOut', onComplete: () => { if (!dead) casino.sit(STATIONS[k].id); } });
  }
  // The casino's arrows: from one seat, up along the floor and down into the next
  function hopCasino(from, to) {
    busy = true;
    tag.classList.add('off');
    map.classList.add('off');
    cam.s = from;
    cam.seat = 1;
    const t = calm ? 0.3 : Math.min(2, 0.9 + Math.abs(to - from) * 0.35);
    gsap.timeline({ onUpdate: changed, onComplete: () => { if (!dead) casino.sit(STATIONS[to].id); } })
      .to(cam, { s: to, duration: t, ease: 'power2.inOut' }, 0)
      .to(cam, { seat: 0.45, duration: t / 2, ease: 'sine.out' }, 0)
      .to(cam, { seat: 1, duration: t / 2, ease: 'sine.in' }, t / 2);
  }
  // Coming back from a game: start in its seat and stand up
  function standUpFrom(k) {
    busy = true;
    cam.s = k;
    cam.seat = 1;
    tag.classList.add('off');
    map.classList.add('off');
    gsap.to(cam, { seat: 0, duration: calm ? 0.2 : 0.9, delay: 0.1, ease: 'power2.inOut', onComplete: () => {
      busy = false;
      tag.classList.remove('off');
      map.classList.remove('off');
    } });
  }

  // ---- Input: swipe, tap, wheel, keys ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const drag = { on: false, id: 0, x: 0, s0: 0, moved: false, vx: 0, lx: 0, lt: 0 };
  function onDown(e) {
    if (busy) return;
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
    if (busy) return;
    e.preventDefault();
    if (glide) { glide.kill(); glide = null; }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    cam.s = THREE.MathUtils.clamp(cam.s + d * 0.0025, -0.15, LAST + 0.15);
    changed();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => go(Math.round(cam.s)), 140);
  }
  function onKey(e) {
    if (busy) return;
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
  controls.textContent = '';
  controls.append(prevBtn, sitBtn, nextBtn);

  // ---- Loop ----
  const governor = frameGovernor(renderer, scene);
  let raf = 0, last = performance.now(), dead = false, aspect = 0;
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
    if (dead) return;
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
    if (dropDuck) dropAt(now * 0.45);
    if (rocketGlow) rocketGlow.intensity = 0.5 + Math.sin(now * 3) * 0.2;
    pose();
    renderer.render(scene, camera);
    drawMap();
  }
  const start = casino.start;
  const at = start ? STATIONS.findIndex(st => st.id === start.at) : -1;
  if (at >= 0) { cam.s = at; if (start.seated || start.hop) cam.seat = 1; }
  fit();
  changed();
  pose();
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (e) { /* draws anyway */ } }
  raf = requestAnimationFrame(frame);
  if (at >= 0) {
    const to = start.hop ? STATIONS.findIndex(st => st.id === start.hop) : -1;
    if (to >= 0) hopCasino(at, to);
    else if (start.seated) standUpFrom(at);
  }

  return {
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      gsap.killTweensOf(cam);
      canvasEl.removeEventListener('pointerdown', onDown);
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
      canvasEl.removeEventListener('wheel', onWheel);
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
