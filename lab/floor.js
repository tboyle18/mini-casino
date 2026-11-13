// Casino floor (beta): the games laid out on a casino floor. You don't walk around: the camera
// glides along a fixed path from one station to the next as you swipe, and tapping a station
// takes you down into its seat, where the casino opens that game's screen. A small 2D map in
// the corner shows where you are on the floor; tap it to jump to a station.
//
// The floor only draws stand-in models (they're cheap); the games themselves are the casino's.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gsap } from 'gsap';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';
import { EMOJI, canvas, tex, carpetCanvas, signCanvas, duckGeometry } from './arcade.js';
import { slotKit } from './slotcabs.js';

const TAU = Math.PI * 2;
const ROOM = { x0: -11.6, x1: 11.6, z0: -4.4, z1: 7 };   // the part of the floor the map shows
const MID = (ROOM.x0 + ROOM.x1) / 2, SPAN = ROOM.x1 - ROOM.x0;
const FOV = 55;

/* The stations, left to right along the path. pos is [x, z] on the floor; yaw turns the
   station toward the aisle; w and h are how much of it the overview must fit on screen;
   look is the height the camera aims at; seat is [distance, height] of the seated view. */
const CARD = { w: 2.1, h: 1.1, look: 0.72, seat: [1.25, 1.45] };   // the half-moon card tables
const STATIONS = [
  { id: 'table', name: 'Blackjack', blurb: 'Beat the dealer to 21', color: '#5ee08a', pos: [-9.9, -0.7], yaw: 0.35, ...CARD },
  { id: 'threecard', name: 'Three Card Poker', blurb: 'Your three cards against the dealer’s', color: '#6bb8ff', pos: [-7.1, -1.7], yaw: 0.2, ...CARD },
  { id: 'war', name: 'Casino War', blurb: 'One card each. High card wins', color: '#ff8a5c', pos: [-4.3, -0.6], yaw: 0.1, ...CARD },
  { id: 'reddog', name: 'Red Dog', blurb: 'Will the third card fall between?', color: '#ff6b9a', pos: [-1.5, -1.7], yaw: 0.05, ...CARD },
  { id: 'roulette', name: 'Roulette', blurb: 'Spin the real-physics wheel', color: '#ff5d6c', pos: [1.5, -1.9], yaw: 0, w: 2.5, h: 1.1, look: 0.78, seat: [1.15, 1.55] },
  { id: 'baccarat', name: 'Baccarat', blurb: 'Player or Banker, closest to 9', color: '#c9a2ff', pos: [4.7, -0.6], yaw: -0.1, w: 2.7, h: 1.1, look: 0.72, seat: [1.3, 1.5] },
  { id: 'poker', name: 'Video Poker', blurb: 'Hold, draw, and hope for a royal', color: '#5ee0e0', pos: [7.3, -1.7], yaw: -0.2, w: 1.3, h: 2.7, look: 1.15, seat: [1, 1.3] },
  { id: 'slots', name: 'Slot Machines', blurb: 'Pick a machine and pull the lever', color: '#ffd23f', pos: [9.15, -0.5], yaw: -0.3, w: 2.2, h: 2.8, look: 1.25, seat: [1.15, 1.35] },
  // Round the corner: the arcade machines along the right-hand wall…
  { id: 'plinko', name: 'Duck Drop', blurb: 'Drop ducks down the peg board. The edges pay big', color: '#7cff6b', pos: [11.15, 1.9], yaw: -1.35, w: 1.7, h: 4, look: 1.85, seat: [1.15, 1.6], seatLook: 1.55 },
  { id: 'crash', name: 'Duck Rocket', blurb: 'Cash out before the rocket blows', color: '#ff8a3d', pos: [11.2, 4.4], yaw: -1.8, w: 1.2, h: 3.2, look: 1.4, seat: [0.4, 1.45], seatLook: 1.45 },
  // …and the cashier on the front wall, on your way out
  { id: 'cashier', name: 'Cashier', blurb: 'Your balance and stats', color: '#e9c46a', pos: [8.8, 5.95], yaw: Math.PI + 0.45, w: 1.9, h: 2.3, look: 1.15, seat: [1.2, 1.5] },
];
const LAST = STATIONS.length - 1;

const CSS = `
.floor-map { position: absolute; right: 12px; bottom: 82px; width: 168px; height: 92px; z-index: 3; border-radius: 14px; touch-action: none; cursor: pointer;
  background: rgba(10, 8, 6, .72); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12), 0 6px 18px rgba(0, 0, 0, .4); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); transition: opacity .3s; }
canvas.floor-map { width: 168px !important; height: 92px !important; }   /* the lab and the casino stretch every stage canvas */
.floor-map.off { opacity: 0; pointer-events: none; }
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

  // A row of slot machines along the back wall: a mix of modern video slots and classic lever
  // machines in different themes, merged into a few meshes so the whole row is a few draws
  const kit = slotKit({ texture: cv => keep(tex(cv, renderer)) });
  const ROW = Math.floor((SPAN - 1.3) / 0.9) + 1;
  const KINDS = ['m', 'm', 'c', 'm', 'm', 'c', 'm', 'c'];   // modern and classic, mixed
  const rowThemes = kit.themes.slice(1);                     // every theme but Lucky Duck's (that one's playable)
  const rowGroup = new THREE.Group();
  const rowX = [];
  for (let i = 0; i < ROW; i++) {
    const x = ROOM.x0 + 0.65 + i * 0.9;
    rowX.push(x);
    const theme = rowThemes[(i * 3) % rowThemes.length];
    const m = KINDS[i % KINDS.length] === 'm' ? kit.modern(theme, { topper: i % 3 === 1 ? 'arch' : 'box' }) : kit.classic(theme, { chair: i % 2 ? 'stool' : 'chair' });
    m.position.set(x, 0, ROOM.z0 + 0.42);
    rowGroup.add(m);
  }
  scene.add(kit.bake(rowGroup));
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();

  // An LED ticker along the back wall, above the machines, scrolling everyone's recent big wins.
  // The text is drawn once into a strip that repeats; scrolling just slides the texture.
  const TICK = { len: SPAN + 0.6, h: 0.3, px: 96 };   // px: texture pixels per metre of board
  const tickMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
  const tickBoard = new THREE.Mesh(new THREE.PlaneGeometry(TICK.len, TICK.h), tickMat);
  tickBoard.position.set(MID, 2.3, ROOM.z0 + 0.04);
  const tickFrame = new THREE.Mesh(new THREE.BoxGeometry(TICK.len + 0.08, TICK.h + 0.08, 0.05), std(0x0a0806, 0.5, 0.3));
  tickFrame.position.set(MID, 2.3, ROOM.z0 + 0.01);
  scene.add(tickFrame, tickBoard);
  let tickTex = null;
  function setTicker(lines) {
    const H = 64;
    const [probe, pg] = canvas(8, 8);
    pg.font = `800 40px Manrope, sans-serif`;
    // As many wins as fit in one strip (phones cap textures at 8192 pixels wide)
    let text = '';
    for (const l of (lines && lines.length ? lines : ['Mini Casino'])) {
      const next = `${text}  ✦  ${l}`;
      if (text && pg.measureText(next + '  ').width > 8000) break;
      text = next;
    }
    text += '  ';
    const w = Math.min(8192, Math.max(512, Math.ceil(pg.measureText(text).width / 8) * 8));
    const [cv, g] = canvas(w, H);
    g.fillStyle = '#120a02';
    g.fillRect(0, 0, w, H);
    g.font = `800 40px Manrope, sans-serif`;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffb43d';
    g.shadowColor = '#ff8a1f';
    g.shadowBlur = 10;
    g.fillText(text, 0, H / 2 + 2);
    // LED dots: a dark grid over the lit text
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(18, 10, 2, .55)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, w, 1);
    probe.width = probe.height = 0;
    if (tickTex) tickTex.dispose();
    tickTex = tex(cv, renderer);
    tickTex.wrapS = THREE.RepeatWrapping;
    tickTex.repeat.x = (TICK.len * TICK.px) / w * (H / (TICK.h * TICK.px));   // keep letters their natural shape
    tickMat.map = tickTex;
    tickMat.needsUpdate = true;
  }
  setTicker(null);

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
  // A sign post's board: the station's name over its one-line pitch, edged in its colour
  // ---- Sign posts: a little marquee beside each station ----
  // A crest on top for the game's icon, chasing bulbs round the edge, the name in chunky
  // outlined letters and the pitch on a cream ribbon. The board is cut to shape by its alpha.
  const ICON = { table: '♠️', threecard: '♣️', war: '⚔️', reddog: '🐶', roulette: '🎡', baccarat: '💎', poker: '🃏', slots: '🎰', plinko: '🦆', crash: '🚀', cashier: '💰' };
  const PW = 640, PH = 480;                       // the board's canvas
  const BODY = { x: 10, y: 112, w: 620, h: 358, r: 40 }, CREST = { x: 320, y: 122, r: 104 };
  const shade = (hex, f) => {                     // mix a #rrggbb colour toward black (f < 1) or white (f > 1)
    const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
    return `rgb(${c.map(v => Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1))).join(',')})`;
  };
  function boardPath(g, inset = 0) {
    const { x, y, w, h, r } = BODY, i = inset;
    g.beginPath();
    g.moveTo(x + i + r, y + i);
    g.arcTo(x + w - i, y + i, x + w - i, y + h - i, r);
    g.arcTo(x + w - i, y + h - i, x + i, y + h - i, r);
    g.arcTo(x + i, y + h - i, x + i, y + i, r);
    g.arcTo(x + i, y + i, x + w - i, y + i, r);
    g.closePath();
    g.moveTo(CREST.x + CREST.r - i, CREST.y);
    g.arc(CREST.x, CREST.y, CREST.r - i, 0, TAU);
  }
  function postTex(st) {
    const RES = 1.6;   // drawn at 1.6× for sharper lettering up close
    const [cv, g] = canvas(PW * RES, PH * RES);
    g.scale(RES, RES);
    // Layered fills (no strokes, so the crest and body join without a seam): a dark rim,
    // a thin cream line, then the station's colour from bright to deep
    boardPath(g);
    g.fillStyle = '#1a0f08';
    g.fill('nonzero');
    boardPath(g, 9);
    g.fillStyle = 'rgba(246, 238, 220, .7)';
    g.fill('nonzero');
    boardPath(g, 13);
    const grad = g.createLinearGradient(0, 0, 0, PH);
    grad.addColorStop(0, shade(st.color, 0.62));
    grad.addColorStop(1, shade(st.color, 0.22));
    g.fillStyle = grad;
    g.fill('nonzero');
    // Candy stripes, faint
    g.save();
    boardPath(g, 13);
    g.clip('nonzero');
    g.strokeStyle = 'rgba(255, 255, 255, .07)';
    g.lineWidth = 22;
    for (let x = -PH; x < PW + PH; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + PH, PH); g.stroke(); }
    g.restore();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // The icon in the crest
    g.font = `92px ${EMOJI}`;
    g.fillText(ICON[st.id] || '★', CREST.x, CREST.y - 6);
    // The name: chunky letters with a dark outline, tipped a touch
    let size = 80;
    g.font = `900 ${size}px Manrope, sans-serif`;
    while (g.measureText(st.name).width > PW - 120 && size > 44) { size -= 2; g.font = `900 ${size}px Manrope, sans-serif`; }
    g.save();
    g.translate(PW / 2, 236);
    g.rotate(-0.035);
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = '#1a0f08';
    g.strokeText(st.name, 0, 0);
    g.fillStyle = '#fff8ea';
    g.shadowColor = st.color;
    g.shadowBlur = 18;
    g.fillText(st.name, 0, 0);
    g.restore();
    // The pitch on a cream ribbon with notched ends
    const rx = 46, ry = 290, rw = PW - 92, rh = 144, notch = 24;
    g.beginPath();
    g.moveTo(rx, ry); g.lineTo(rx + rw, ry); g.lineTo(rx + rw - notch, ry + rh / 2); g.lineTo(rx + rw, ry + rh);
    g.lineTo(rx, ry + rh); g.lineTo(rx + notch, ry + rh / 2); g.closePath();
    g.fillStyle = '#f6eedc';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#1a0f08';
    g.stroke();
    // As big as fits on two lines (three for the longest), heavy and dark so it reads at a distance
    g.fillStyle = '#21180f';
    const wrap = size => {
      g.font = `800 ${size}px Manrope, sans-serif`;
      const out = [];
      let line = '';
      for (const w of st.blurb.split(' ')) {
        const t = line ? line + ' ' + w : w;
        if (g.measureText(t).width > rw - notch * 2 - 20 && line) { out.push(line); line = w; } else line = t;
      }
      if (line) out.push(line);
      return out;
    };
    let px = 54, lines = wrap(px);
    while (lines.length > 2 && px > 40) lines = wrap(px -= 2);
    if (lines.length > 2) { px = 38; lines = wrap(px); }
    const gap = px * 1.04;
    lines.forEach((l, k) => g.fillText(l, PW / 2, ry + rh / 2 + 3 + (k - (lines.length - 1) / 2) * gap));
    const t = keep(tex(cv, renderer));
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  // Where the bulbs go, in board pixels: round the crest, then round the body
  const BULB_AT = (() => {
    const pts = [], inset = 26;
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI + (k / 8) * Math.PI * 0.94 + Math.PI * 0.03;
      pts.push([CREST.x + Math.cos(a) * (CREST.r - inset), CREST.y + Math.sin(a) * (CREST.r - inset)]);
    }
    const x0 = BODY.x + inset, x1 = BODY.x + BODY.w - inset, y0 = BODY.y + inset, y1 = BODY.y + BODY.h - inset;
    const step = 40;
    for (let x = x0; x <= x1; x += step) { if (Math.abs(x - CREST.x) > CREST.r - 10) pts.push([x, y0]); pts.push([x, y1]); }
    for (let y = y0 + step; y < y1; y += step) { pts.push([x0, y]); pts.push([x1, y]); }
    return pts;
  })();
  const POST_W = 1.02, POST_H = POST_W * PH / PW;
  const signBulbs = [];                            // [the post's board, its local position, its colour]
  // A sign post beside the station, its board turned toward the aisle
  function signPost(st) {
    const g = new THREE.Group();
    const top = st.w > 1.8 ? 1.62 : 1.74;   // the board's centre: tables, up over the felt (machines' posts are scaled down)
    const base = top - POST_H / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, base, 10), M.gold);
    pole.position.y = base / 2;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 20), M.gold);
    foot.position.y = 0.02;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.gold);
    ball.position.y = 0.06;
    const map = postTex(st);
    const geo = new THREE.PlaneGeometry(POST_W, POST_H);
    const board = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, toneMapped: false }));
    const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, color: 0x1a0f08, alphaTest: 0.5, side: THREE.BackSide }));
    board.position.y = back.position.y = top;
    g.add(pole, foot, ball, board, back);
    g.traverse(x => { if (x.isMesh) { x.castShadow = x === pole || x === foot; x.receiveShadow = false; } });
    const lit = new THREE.Color(st.color).lerp(new THREE.Color(0xffffff), 0.55);
    BULB_AT.forEach(([px, py], k) => signBulbs.push([board, new THREE.Vector3((px / PW - 0.5) * POST_W, (0.5 - py / PH) * POST_H, 0.014), k % 2 ? lit : new THREE.Color(0xfff1c4)]));
    return g;
  }
  const shadowy = o => { o.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };

  // ---- Stations (stand-in models: the seated view is the real game) ----
  /* A casino table chair: a chrome pedestal with a foot ring, an upholstered seat on a wood
     base, and a curved wood-framed back. Built from the slot kit's parts (colour in the
     vertices) and marked, so each station's chairs merge into a few meshes. It faces the
     station's centre unless told otherwise; its back is away from the table. */
  const UPHOLSTERY = 0x7a1020, LACQUER = 0x3b1f0e;
  function arcBand(r0, r1, span, h) {
    const sh = new THREE.Shape();
    const a0 = -Math.PI / 2 - span / 2, a1 = -Math.PI / 2 + span / 2;
    sh.absarc(0, 0, r1, a0, a1, false);
    sh.absarc(0, 0, r0, a1, a0, true);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 16 });
    geo.rotateX(-Math.PI / 2);   // stand it up, curving round the back of the seat
    return geo;
  }
  function stool(x, z, ry = Math.atan2(x, z)) {
    const { part, rbox } = kit;
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.2, 0.23, 0.035, 28), 'chrome', 0xe8e8ee, 0, 0.018, 0));
    g.add(part(new THREE.CylinderGeometry(0.034, 0.034, 0.52, 12), 'chrome', 0xe8e8ee, 0, 0.29, 0));
    g.add(part(new THREE.TorusGeometry(0.18, 0.012, 8, 28).rotateX(Math.PI / 2), 'chrome', 0xe8e8ee, 0, 0.3, 0));
    for (let i = 0; i < 3; i++) {
      const spoke = part(new THREE.BoxGeometry(0.17, 0.014, 0.014), 'chrome', 0xe8e8ee, 0, 0.3, 0);
      spoke.rotation.y = (i / 3) * TAU;
      spoke.translateX(0.09);
      g.add(spoke);
    }
    g.add(part(rbox(0.46, 0.05, 0.44, 0.02), 'paint', LACQUER, 0, 0.575, 0));
    g.add(part(rbox(0.46, 0.1, 0.44, 0.05), 'leather', UPHOLSTERY, 0, 0.645, -0.01));
    g.add(part(arcBand(0.2, 0.232, 1.9, 0.19), 'paint', LACQUER, 0, 0.63, 0.02));
    g.add(part(arcBand(0.168, 0.205, 1.6, 0.12), 'leather', UPHOLSTERY, 0, 0.69, 0.02));
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.userData.chair = true;
    return g;
  }
  // Merge a station's chairs into a few meshes (they're dozens of parts otherwise)
  function bakeChairs(g) {
    const chairs = g.children.filter(o => o.userData.chair);
    if (!chairs.length) return;
    const tmp = new THREE.Group();
    for (const c of chairs) { g.remove(c); tmp.add(c); }
    g.add(kit.bake(tmp));
  }
  // Printing on the felt: the table's name or its bets, in gold
  const cardBack = std(0x9a1628, 0.5);
  // A few real card faces, shared by every table
  const FACES = [['A', '♠'], ['K', '♥'], ['Q', '♦'], ['10', '♣'], ['7', '♥'], ['J', '♠']].map(([r, su]) => {
    const [cv, g] = canvas(140, 200);
    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, 140, 200);
    const red = su === '♥' || su === '♦';
    g.fillStyle = red ? '#c8102e' : '#16141a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 34px Manrope, sans-serif';
    g.fillText(r, 26, 28);
    g.font = '30px "Apple Symbols", "Segoe UI Symbol", sans-serif';
    g.fillText(su, 26, 60);
    g.font = '86px "Apple Symbols", "Segoe UI Symbol", sans-serif';
    g.fillText(su, 70, 112);
    return new THREE.MeshStandardMaterial({ map: keep(tex(cv, renderer)), roughness: 0.55 });
  });
  let faceN = 0;
  function card(x, y, z, turn, up = true) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), up ? FACES[faceN++ % FACES.length] : cardBack);
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
  // Curved printing on the felt, like the real table's: letters follow an arc round a centre
  function arcText(g, text, cx, cy, r, font, color, spacing) {
    g.save();
    g.font = font;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const widths = [...text].map(ch => g.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    let a = Math.PI / 2 + total / r / 2;
    [...text].forEach((ch, i) => {
      const w = widths[i] / r;
      a -= w / 2;
      g.save();
      g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
      g.rotate(a - Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
      a -= w / 2;
    });
    g.restore();
  }
  /* A half-moon table's felt: 512 pixels a metre, the dealer's straight edge along the top,
     the players' curve along the bottom. Printing in gold arcs, a betting spot at each seat. */
  function tableFelt(color, arcs, spot, extra) {
    const W = 1024, H = 512, k = 512, cx = W / 2;
    const [cv, g] = canvas(W, H);
    const base = new THREE.Color(color);
    const shade = f => `#${base.clone().multiplyScalar(f).getHexString()}`;
    const grad = g.createRadialGradient(cx, H * 0.45, 30, cx, H * 0.45, W * 0.62);
    grad.addColorStop(0, shade(1.35));
    grad.addColorStop(0.6, shade(1));
    grad.addColorStop(1, shade(0.62));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) {   // the nap of the felt
      g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
      g.fillRect((i * 97.3) % W, (i * 53.7) % H, 2, 2);
    }
    const gold = '#e9c46a', cream = 'rgba(245,240,227,.8)';
    g.strokeStyle = 'rgba(233,196,106,.7)';
    g.lineWidth = 2;
    for (const r of [0.31, 0.37]) { g.beginPath(); g.arc(cx, 0, r * k, Math.PI * 0.18, Math.PI * 0.82); g.stroke(); }
    for (const [text, r, size, main] of arcs) arcText(g, text, cx, 0, r * k, `800 ${size}px Manrope`, main ? gold : cream, size * 0.18);
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.45;
      const at = d => [cx + Math.sin(a) * d * k, Math.cos(a) * d * k];
      g.save();
      g.strokeStyle = gold;
      g.fillStyle = cream;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (spot === 'three') {
        for (const [d, label] of [[0.6, 'PLAY'], [0.72, 'ANTE'], [0.86, 'PAIR+']]) {
          const [x, y] = at(d);
          g.lineWidth = 2.5;
          g.beginPath(); g.arc(x, y, 24, 0, TAU); g.stroke();
          g.font = '800 10px Manrope';
          g.fillText(label, x, y);
        }
      } else {
        const [x, y] = at(0.82);
        g.lineWidth = 4;
        g.beginPath(); g.arc(x, y, 30, 0, TAU); g.stroke();
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 24, 0, TAU); g.stroke();
        if (spot === 'war') {
          const [wx, wy] = at(0.62);
          g.translate(wx, wy);
          g.rotate(-a);
          g.lineWidth = 2.5;
          g.strokeRect(-26, -14, 52, 28);
          g.font = '800 14px Manrope';
          g.fillText('WAR', 0, 1);
        }
      }
      g.restore();
    }
    if (extra) extra(g, cx, k);
    const t = keep(tex(cv, renderer));
    t.repeat.set(0.5, 1);   // the felt's uvs are its shape in metres: x -1…1, front at -1, dealer at 0
    t.offset.set(0.5, 1);
    return t;
  }
  const RAIL = new THREE.MeshPhysicalMaterial({ color: 0x2b1810, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const GLOSS = new THREE.MeshPhysicalMaterial({ color: 0x3b1f0e, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const BRASS = std(0xd9a93c, 0.3, 0.9);
  /* The half-moon card tables, after the game's own 3D table: printed felt, a padded leather
     rail, a lacquered wood edge and apron on a two-pedestal base, a chip tray, the shoe.
     per is how many cards sit at each of the five spots, dealer how many face-down in front
     of the dealer, middle cards dealt in a row across the middle (Red Dog's spread) */
  function buildCardTable({ felt, arcs, spot, extra, per = 2, dealer = 0, middle = 0 }) {
    const g = new THREE.Group();
    const top = 0.78;
    const shape = new THREE.Shape();
    shape.moveTo(-1, 0);
    shape.lineTo(1, 0);
    shape.absarc(0, 0, 1, 0, -Math.PI, true);
    const feltGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 72 });
    feltGeo.rotateX(-Math.PI / 2);
    const feltMesh = new THREE.Mesh(feltGeo, [new THREE.MeshStandardMaterial({ map: tableFelt(felt, arcs, spot, extra), roughness: 0.95 }), GLOSS]);
    feltMesh.position.y = top - 0.04;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.055, 16, 96, Math.PI), RAIL);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = top + 0.008;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.06, 0.08), GLOSS);
    edge.position.set(0, top - 0.012, -0.035);
    // the apron under the top, a brass line round it, and two pedestals on wide feet
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.16, 64, 1, true, -Math.PI / 2, Math.PI), GLOSS);
    apron.position.y = top - 0.12;
    const apronBack = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.16, 0.03), GLOSS);
    apronBack.position.set(0, top - 0.12, 0);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.975, 0.008, 6, 64, Math.PI), BRASS);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = top - 0.18;
    g.add(feltMesh, rail, edge, apron, apronBack, trim);
    for (const x of [-0.5, 0.5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.56, 20), GLOSS);
      leg.position.set(x, 0.33, 0.38);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.01, 6, 20).rotateX(Math.PI / 2), BRASS);
      ring.position.set(x, 0.5, 0.38);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.05, 0.26, 2, 0.02), GLOSS);
      foot.position.set(x, 0.025, 0.38);
      g.add(leg, ring, foot);
    }
    // the chip tray: columns of chips lying in a wood tray along the dealer's edge
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.09), GLOSS);
    tray.position.set(0, top + 0.012, 0.08);
    g.add(tray);
    const chipGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.075, 18);
    [3, 3, 2, 2, 1, 1, 0, 0].forEach((c, i) => {
      const col = new THREE.Mesh(chipGeo, std(CHIP_COLS[c], 0.4));
      col.rotation.x = Math.PI / 2;
      col.position.set(-0.19 + i * 0.054, top + 0.03, 0.08);
      g.add(col);
    });
    // the shoe, cards waiting in its mouth
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.08, 0.2, 2, 0.015), new THREE.MeshPhysicalMaterial({ color: 0x17171a, roughness: 0.3, clearcoat: 0.8 }));
    shoe.position.set(0.62, top + 0.04, 0.17);
    shoe.rotation.y = 0.45;
    const shoeCard = card(0, 0, 0, 0, false);
    shoeCard.rotation.set(-1.1, 0, 0);
    shoeCard.position.set(0, 0.0, 0.105);
    shoe.add(shoeCard);
    g.add(shoe);
    for (let i = 0; i < dealer; i++) g.add(card((i - (dealer - 1) / 2) * 0.08, top + 0.002, 0.26, 0, false));
    for (let i = 0; i < middle; i++) g.add(card((i - (middle - 1) / 2) * 0.09, top + 0.002, 0.32, 0, i !== 1));
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.45;
      for (let j = 0; j < per; j++) {
        const off = (j - (per - 1) / 2) * 0.03;
        g.add(card(Math.sin(a) * 0.68 + off * Math.cos(a), top + 0.002 + j * 0.001, Math.cos(a) * 0.68 - off * Math.sin(a), -a));
      }
      g.add(chipStack(CHIP_COLS[(i + 2) % 4], Math.sin(a) * 0.82, top, Math.cos(a) * 0.82, 0.03));
      g.add(stool(Math.sin(a) * 1.35, Math.cos(a) * 1.35));
    }
    return g;
  }
  const buildBlackjack = () => buildCardTable({ felt: 0x0d6b3a, spot: 'circle', per: 2, dealer: 2,
    arcs: [['BLACKJACK PAYS 3 TO 2', 0.43, 22, true], ['INSURANCE PAYS 2 TO 1', 0.34, 13], ['DEALER STANDS ON ALL 17s', 0.265, 10]] });
  const buildThreeCard = () => buildCardTable({ felt: 0x123f78, spot: 'three', per: 3, dealer: 3,
    arcs: [['THREE CARD POKER', 0.43, 22, true], ['PAIR PLUS PAYS UP TO 40 TO 1', 0.34, 12], ['DEALER QUALIFIES WITH QUEEN HIGH', 0.265, 9]] });
  const buildWar = () => buildCardTable({ felt: 0x7a1f1a, spot: 'war', per: 1, dealer: 1,
    arcs: [['CASINO WAR', 0.43, 24, true], ['TIES GO TO WAR', 0.34, 13], ['HIGH CARD WINS', 0.265, 10]] });
  const buildRedDog = () => buildCardTable({ felt: 0x4b1f6e, spot: 'circle', per: 0, middle: 3,
    arcs: [['RED DOG', 0.45, 24, true], ['THE SPREAD PAYS', 0.36, 13]],
    extra: (g, cx, k) => {
      g.font = '800 11px Manrope';
      g.fillStyle = 'rgba(245,240,227,.75)';
      g.textAlign = 'center';
      g.fillText('1 · 5 TO 1     2 · 4 TO 1     3 · 2 TO 1     4–11 · EVEN', cx, 0.5 * k);
    } });


  /* Baccarat: an oval table on the same lacquered base as the card tables. The felt is printed
     like the real thing: a numbered box for each seat with its Player, Banker and Tie bets,
     the Player and Banker card boxes in the middle, the payouts, and the dealer's commission
     boxes along the back. */
  function baccaratFelt(SX, SZ) {
    const W = 1024, H = Math.round(W * SZ / SX), kx = W / (2 * SX);
    const [cv, g] = canvas(W, H);
    const P = (x, y) => [W / 2 + x * kx, H / 2 - y * kx];   // shape metres → pixels (y up is the dealer's side)
    const grad = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.6);
    grad.addColorStop(0, '#16884f');
    grad.addColorStop(0.6, '#0d6a3d');
    grad.addColorStop(1, '#07462a');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'; g.fillRect((i * 97.3) % W, (i * 53.7) % H, 2, 2); }
    const gold = '#e9c46a', cream = 'rgba(245,240,227,.85)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // the card boxes
    for (const [x, label, tint] of [[-0.205, 'PLAYER', 'rgba(60,120,255,.18)'], [0.205, 'BANKER', 'rgba(255,60,80,.18)']]) {
      const [px, py] = P(x, 0.05);
      g.fillStyle = tint;
      g.strokeStyle = gold;
      g.lineWidth = 3;
      g.beginPath(); g.roundRect(px - 64, py - 44, 128, 88, 12); g.fill(); g.stroke();
      g.font = '800 21px Manrope';
      g.fillStyle = gold;
      g.fillText(label, px, py + 64);
    }
    const [cx, cy] = P(0, 0.29);
    g.font = '800 15px Manrope';
    g.fillStyle = cream;
    g.fillText('TIE PAYS 8 TO 1', cx, cy - 14);
    g.fillText('BANKER PAYS 19 TO 20', cx, cy + 14);
    // commission boxes along the dealer's edge
    for (let i = 0; i < 7; i++) {
      const [px, py] = P(-0.42 + i * 0.14, 0.52);
      g.strokeStyle = 'rgba(233,196,106,.6)';
      g.lineWidth = 2;
      g.strokeRect(px - 16, py - 13, 32, 26);
      g.font = '700 13px Manrope';
      g.fillStyle = cream;
      g.fillText(String(i + 1), px, py + 1);
    }
    // a box at each seat, its three bets running in toward the middle
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.42;
      const [px, py] = P(Math.sin(a) * SX * 0.74, -Math.cos(a) * SZ * 0.72);
      g.save();
      g.translate(px, py);
      g.rotate(a);
      g.strokeStyle = gold;
      g.lineWidth = 2.5;
      const rows = [['PLAYER', 0], ['BANKER', -34], ['TIE', -64]];
      for (const [label, dy] of rows) {
        const w = label === 'TIE' ? 56 : 92;
        g.beginPath(); g.roundRect(-w / 2, dy - 14, w, 28, 8); g.stroke();
        g.font = '800 12px Manrope';
        g.fillStyle = label === 'BANKER' ? '#ff9aa6' : label === 'PLAYER' ? '#9ec3ff' : cream;
        g.fillText(label, 0, dy + 1);
      }
      g.beginPath(); g.arc(0, 36, 15, 0, TAU); g.stroke();
      g.font = '800 15px Manrope';
      g.fillStyle = gold;
      g.fillText(String(i + 3), 0, 37);
      g.restore();
    }
    const t = keep(tex(cv, renderer));
    t.repeat.set(1 / (2 * SX), 1 / (2 * SZ));
    t.offset.set(0.5, 0.5);
    return t;
  }
  function buildBaccarat() {
    const g = new THREE.Group();
    const top = 0.78, SX = 1.35, SZ = 0.72;
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, SX, SZ, 0, TAU, false);
    const feltGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 72 });
    feltGeo.rotateX(-Math.PI / 2);
    const felt = new THREE.Mesh(feltGeo, [new THREE.MeshStandardMaterial({ map: baccaratFelt(SX, SZ), roughness: 0.95 }), GLOSS]);
    felt.position.y = top - 0.04;
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 16, 112), RAIL);
    rail.geometry.scale(SX + 0.02, SZ + 0.02, 1);   // an oval, with a round cross-section
    rail.rotation.x = Math.PI / 2;
    rail.position.y = top + 0.008;
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 72, 1, true), GLOSS);
    apron.scale.set(SX - 0.04, 1, SZ - 0.04);
    apron.position.y = top - 0.12;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 6, 96), BRASS);
    trim.geometry.scale(SX - 0.035, SZ - 0.035, 1);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = top - 0.18;
    g.add(felt, rail, apron, trim);
    for (const x of [-0.65, 0.65]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.56, 20), GLOSS);
      leg.position.set(x, 0.33, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 20).rotateX(Math.PI / 2), BRASS);
      ring.position.set(x, 0.5, 0);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.05, 0.5, 2, 0.02), GLOSS);
      foot.position.set(x, 0.025, 0);
      g.add(leg, ring, foot);
    }
    // the hands, dealt into their boxes
    for (const x of [-0.205, 0.205]) for (const d of [-0.04, 0.04]) g.add(card(x + d, top + 0.002, -0.05, 0));
    // the chip tray, the shoe and the discard holder along the dealer's side
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.025, 0.09), GLOSS);
    tray.position.set(0, top + 0.012, -0.5);
    g.add(tray);
    const chipGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.075, 18);
    [3, 3, 2, 2, 1, 1, 0, 0, 2].forEach((c, i) => {
      const col = new THREE.Mesh(chipGeo, std(CHIP_COLS[c], 0.4));
      col.rotation.x = Math.PI / 2;
      col.position.set(-0.22 + i * 0.054, top + 0.03, -0.5);
      g.add(col);
    });
    const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.08, 0.2, 2, 0.015), new THREE.MeshPhysicalMaterial({ color: 0x17171a, roughness: 0.3, clearcoat: 0.8 }));
    shoe.position.set(0.72, top + 0.04, -0.38);
    shoe.rotation.y = 0.35;
    const discard = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.14, 2, 0.01), new THREE.MeshPhysicalMaterial({ color: 0xe8e2d4, roughness: 0.2, transmission: 0, clearcoat: 0.8 }));
    discard.position.set(-0.72, top + 0.035, -0.38);
    discard.rotation.y = -0.35;
    g.add(shoe, discard);
    // a few bets out on the seats
    [[-2, 0x7a2bb5], [0, 0xc8102e], [1, 0x1f5fbf]].forEach(([i, c]) => {
      const a = i * 0.42;
      g.add(chipStack(c, Math.sin(a) * SX * 0.74, top, Math.cos(a) * SZ * 0.72, 0.025));
    });
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.42;
      g.add(stool(Math.sin(a) * SX * 1.18, Math.cos(a) * SZ * 1.18 + 0.3));
    }
    return g;
  }


  /* Video poker, after the real uprights: a dark cabinet with a wide 4:3 screen showing the pay
     table over a dealt hand, a button deck (bet one, max bet, five holds, deal/draw), a belly
     glass, a lit topper, LED trim and a casino chair. */
  function vpScreenTex() {
    const [cv, g] = canvas(1024, 768);
    g.fillStyle = '#0a1a9e';
    g.fillRect(0, 0, 1024, 768);
    g.textBaseline = 'middle';
    // the pay table: hands down the left, five columns of coins, the max-bet column lit
    const rows = [['ROYAL FLUSH', 250, 4000], ['STRAIGHT FLUSH', 50], ['4 OF A KIND', 25], ['FULL HOUSE', 9], ['FLUSH', 6], ['STRAIGHT', 4], ['3 OF A KIND', 3], ['TWO PAIR', 2], ['JACKS OR BETTER', 1]];
    const tx = 18, ty = 16, rh = 34, colW = 118, nameW = 300;
    g.fillStyle = '#c9101e';
    g.fillRect(tx + nameW + colW * 4, ty, colW, rh * rows.length + 6);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 3;
    g.strokeRect(tx, ty, nameW + colW * 5, rh * rows.length + 6);
    rows.forEach(([name, k, top], r) => {
      const y = ty + 6 + r * rh + rh / 2;
      g.font = '900 25px Manrope, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#ffd23f';
      g.fillText(name, tx + 12, y);
      g.textAlign = 'right';
      for (let c = 0; c < 5; c++) {
        g.fillStyle = c === 4 ? '#fff6c8' : '#ffd23f';
        g.fillText(String(c === 4 && top ? top : k * (c + 1)), tx + nameW + colW * (c + 1) - 14, y);
      }
    });
    // the dealt hand, two of them held
    const hand = [['K', '♠'], ['K', '♥'], ['7', '♦'], ['3', '♣'], ['J', '♠']];
    const cw = 172, chh = 240, cy = 372, gap = (1024 - cw * 5) / 6;
    hand.forEach(([rank, su], i) => {
      const x = gap + i * (cw + gap);
      const red = su === '♥' || su === '♦';
      if (i < 2) { g.font = '900 30px Manrope, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff6c8'; g.fillText('HELD', x + cw / 2, cy - 22); }
      g.fillStyle = '#fbf8f1';
      g.beginPath(); g.roundRect(x, cy, cw, chh, 14); g.fill();
      g.fillStyle = red ? '#c8102e' : '#16141a';
      g.textAlign = 'left';
      g.font = '900 52px Manrope, sans-serif';
      g.fillText(rank, x + 12, cy + 38);
      g.font = '44px "Apple Symbols", "Segoe UI Symbol", sans-serif';
      g.fillText(su, x + 14, cy + 86);
      g.textAlign = 'center';
      g.font = '120px "Apple Symbols", "Segoe UI Symbol", sans-serif';
      g.fillText(su, x + cw / 2 + 14, cy + 160);
    });
    // the meters along the bottom
    g.font = '900 34px Manrope, sans-serif';
    g.fillStyle = '#ffd23f';
    g.textAlign = 'left';
    g.fillText('WIN 0', 24, 690);
    g.textAlign = 'center';
    g.fillText('BET 5', 512, 690);
    g.textAlign = 'right';
    g.fillText('CREDIT 1,000', 1000, 690);
    g.font = '900 30px Manrope, sans-serif';
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.fillText('JACKS OR BETTER', 512, 738);
    return keep(tex(cv, renderer));
  }
  function vpPanelTex(lines, bg, fg, w, h) {
    const [cv, g] = canvas(w, h);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, bg[0]);
    grad.addColorStop(1, bg[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach(([t, size, col], i) => {
      g.font = `900 ${size}px Manrope, sans-serif`;
      const k = Math.min(1, (w - 40) / g.measureText(t).width);
      g.font = `900 ${Math.floor(size * k)}px Manrope, sans-serif`;
      g.fillStyle = col || fg;
      g.fillText(t, w / 2, h * (lines.length === 1 ? 0.5 : 0.36 + i * 0.36));
    });
    return keep(tex(cv, renderer));
  }
  function buildVideoPoker() {
    const g = new THREE.Group();
    const { part, rbox, box } = kit;
    const W = 0.7, body = 0x1b1d2a, trim = 0x5ee0e0;
    const flat = (map, w, h, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
      m.position.set(x, y, z);
      m.rotation.x = rx;
      return m;
    };
    g.add(part(box(W - 0.06, 0.1, 0.52), 'dark', 0x0a090d, 0, 0.05, -0.02));          // toe kick
    g.add(part(rbox(W, 0.76, 0.6, 0.035), 'paint', body, 0, 0.48, 0));                // lower cabinet
    g.add(part(box(W + 0.01, 0.03, 0.61), 'chrome', 0xe8e8ee, 0, 0.11, 0));
    g.add(flat(vpPanelTex([['VIDEO POKER', 64, '#fff6dc'], ['DOUBLE UP  ·  PLAY 5 COINS', 30, '#5ee0e0']], ['#0f2a8a', '#06103a'], '#fff', 512, 192), 0.56, 0.21, 0, 0.5, 0.302));
    g.add(part(box(0.58, 0.012, 0.01), 'glow', trim, 0, 0.63, 0.302));
    // the button deck: bet one, max bet, five holds, deal/draw
    const deck = new THREE.Group();
    deck.position.set(0, 0.885, 0.16);
    deck.rotation.x = 0.18;
    deck.add(part(rbox(W + 0.03, 0.06, 0.34, 0.025), 'dark', 0x22242e, 0, 0, 0));
    deck.add(part(box(W - 0.04, 0.004, 0.06), 'chrome', 0xe8e8ee, 0, 0.031, -0.12));
    for (let i = 0; i < 5; i++) deck.add(part(rbox(0.07, 0.022, 0.05, 0.008), 'glow', i < 2 ? 0xffffff : 0xfff1a8, -0.2 + i * 0.1, 0.036, 0.06));
    deck.add(part(rbox(0.07, 0.022, 0.045, 0.008), 'glow', 0x6be7ff, -0.27, 0.036, -0.03));   // bet one
    deck.add(part(rbox(0.07, 0.022, 0.045, 0.008), 'glow', 0xffd23f, -0.18, 0.036, -0.03));   // max bet
    deck.add(part(rbox(0.1, 0.024, 0.05, 0.01), 'glow', 0x7cff6b, 0.25, 0.036, -0.03));      // deal / draw
    deck.add(part(box(0.12, 0.03, 0.07), 'dark', 0x0a090d, 0.12, 0.035, -0.09));             // bill slot
    deck.add(part(box(0.1, 0.006, 0.004), 'glow', 0x7cff6b, 0.12, 0.05, -0.054));
    g.add(deck);
    // the screen housing, the screen leaning back, speakers under it
    g.add(part(rbox(W, 0.66, 0.44, 0.035), 'paint', body, 0, 1.25, -0.08));
    const scr = new THREE.Group();
    scr.position.set(0, 1.26, 0.142);
    scr.rotation.x = -0.1;
    scr.add(part(rbox(W - 0.04, 0.5, 0.03, 0.012), 'dark', 0x0a090d, 0, 0, 0));
    scr.add(part(rbox(W - 0.06, 0.48, 0.006, 0.006), 'chrome', 0xc8c8d0, 0, 0, 0.012));
    scr.add(flat(vpScreenTex(), 0.6, 0.45, 0, 0, 0.017));
    g.add(scr);
    for (const sx of [-0.22, 0.22]) g.add(part(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 16).rotateX(Math.PI / 2), 'dark', 0x0a090d, sx, 0.955, 0.14));
    // the topper: a lit sign box with a chrome cap
    g.add(part(rbox(W, 0.3, 0.34, 0.035), 'paint', body, 0, 1.74, -0.08));
    g.add(flat(vpPanelTex([['JACKS OR BETTER', 70, '#ffd23f'], ['ROYAL PAYS 4000', 34, '#ffffff']], ['#c9101e', '#5a0610'], '#fff', 512, 160), 0.62, 0.2, 0, 1.74, 0.092));
    g.add(part(box(W + 0.01, 0.02, 0.35), 'chrome', 0xe8e8ee, 0, 1.9, -0.08));
    // LED strips up the front edges, and a candle light on top
    for (const sx of [-1, 1]) {
      g.add(part(box(0.022, 0.74, 0.022), 'led', 0xffffff, sx * (W / 2 + 0.004), 0.48, 0.295));
      g.add(part(box(0.022, 0.64, 0.022), 'led', 0xffffff, sx * (W / 2 + 0.004), 1.25, 0.135));
    }
    g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 16), 'glow', trim, 0, 1.96, -0.08));
    g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), 'glow', 0xff3d3d, 0, 2.035, -0.08));
    g.add(stool(0, 0.8));
    return g;
  }
  /* Roulette, after the game's own wheel: a lacquered bowl and ball track turned on a lathe,
     the pocket ring with its numbers, a cone and a brass turret with its cross, chrome frets,
     brass deflectors; beside it a printed layout on a padded-rail table. */
  let rotor = null, ballPivot = null;
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const STEP = TAU / 37;
  const lathe = pts => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 96);
  function pocketTex() {
    const S = 1024, k = S / 2 / 0.31;
    const [cv, g] = canvas(S, S);
    g.translate(S / 2, S / 2);
    for (let i = 0; i < 37; i++) {
      const n = WHEEL_ORDER[i], a0 = i * STEP - STEP / 2, a1 = a0 + STEP;
      g.fillStyle = n === 0 ? '#12804c' : REDS.has(n) ? '#b3202b' : '#141518';
      g.beginPath(); g.arc(0, 0, 0.307 * k, a0, a1); g.arc(0, 0, 0.255 * k, a1, a0, true); g.closePath(); g.fill();
      g.fillStyle = n === 0 ? '#0c5c36' : REDS.has(n) ? '#8a1720' : '#0c0d10';
      g.beginPath(); g.arc(0, 0, 0.255 * k, a0, a1); g.arc(0, 0, 0.188 * k, a1, a0, true); g.closePath(); g.fill();
      g.save();
      g.rotate(i * STEP);
      g.translate(0.281 * k, 0);
      g.rotate(-Math.PI / 2);
      g.fillStyle = '#fff';
      g.font = `800 ${Math.round(0.029 * k)}px Manrope, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0);
      g.restore();
    }
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 3;
    for (let i = 0; i < 37; i++) {
      const a = i * STEP + STEP / 2;
      g.beginPath(); g.moveTo(Math.cos(a) * 0.255 * k, Math.sin(a) * 0.255 * k); g.lineTo(Math.cos(a) * 0.307 * k, Math.sin(a) * 0.307 * k); g.stroke();
    }
    for (const r of [0.255, 0.3045]) { g.beginPath(); g.arc(0, 0, r * k, 0, TAU); g.stroke(); }
    return keep(tex(cv, renderer));
  }
  // The betting layout: zero, the 36 numbers in three rows, the columns, dozens and even-money bets
  function layoutTex(LW, LD) {
    const W = 1024, H = Math.round(W * LD / LW);
    const [cv, g] = canvas(W, H);
    const grad = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.6);
    grad.addColorStop(0, '#11784a');
    grad.addColorStop(1, '#0f6e40');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)'; g.fillRect((i * 97.3) % W, (i * 53.7) % H, 2, 2); }
    const x0 = 22, y0 = 14, zw = 70, cw = 70, ch = 76, colW = 78;   // zero, number cell, row height, the "2 to 1" column
    g.strokeStyle = 'rgba(245,240,227,.85)';
    g.lineWidth = 3;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // zero
    g.beginPath();
    g.moveTo(x0 + zw, y0); g.lineTo(x0 + 18, y0); g.lineTo(x0, y0 + ch * 1.5); g.lineTo(x0 + 18, y0 + ch * 3); g.lineTo(x0 + zw, y0 + ch * 3);
    g.fillStyle = '#12804c'; g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '800 30px Manrope'; g.fillText('0', x0 + zw / 2 + 6, y0 + ch * 1.5);
    for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
      const n = col * 3 + (3 - row), x = x0 + zw + col * cw, y = y0 + row * ch;
      g.strokeRect(x, y, cw, ch);
      g.fillStyle = REDS.has(n) ? '#c0212e' : '#16161a';
      g.beginPath(); g.ellipse(x + cw / 2, y + ch / 2, 21, 25, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff'; g.font = '800 24px Manrope';
      g.fillText(String(n), x + cw / 2, y + ch / 2 + 1);
    }
    const xr = x0 + zw + 12 * cw;
    for (let row = 0; row < 3; row++) { g.strokeRect(xr, y0 + row * ch, colW, ch); g.fillStyle = '#f5f0e3'; g.font = '800 15px Manrope'; g.fillText('2 TO 1', xr + colW / 2, y0 + row * ch + ch / 2); }
    const yd = y0 + 3 * ch, dh = 58;
    ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => { g.strokeRect(x0 + zw + i * 4 * cw, yd, 4 * cw, dh); g.fillStyle = '#f5f0e3'; g.font = '800 22px Manrope'; g.fillText(t, x0 + zw + i * 4 * cw + 2 * cw, yd + dh / 2); });
    const ye = yd + dh;
    ['1–18', 'EVEN', 'red', 'black', 'ODD', '19–36'].forEach((t, i) => {
      const x = x0 + zw + i * 2 * cw;
      g.strokeRect(x, ye, 2 * cw, dh);
      if (t === 'red' || t === 'black') {
        g.fillStyle = t === 'red' ? '#c0212e' : '#16161a';
        g.beginPath(); g.moveTo(x + cw, ye + 8); g.lineTo(x + cw + 34, ye + dh / 2); g.lineTo(x + cw, ye + dh - 8); g.lineTo(x + cw - 34, ye + dh / 2); g.closePath(); g.fill();
      } else { g.fillStyle = '#f5f0e3'; g.font = '800 20px Manrope'; g.fillText(t, x + cw, ye + dh / 2); }
    });
    return keep(tex(cv, renderer));
  }
  function buildRoulette() {
    const g = new THREE.Group();
    const top = 0.8;
    // the cabinet: a lacquered body on a dark toe kick, a brass line, a wood top frame
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.24, 0.62, 0.96, 2, 0.04), GLOSS);
    body.position.set(0.38, 0.43, 0);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.12, 0.86), std(0x0a0806, 0.6));
    kick.position.set(0.38, 0.06, 0);
    const line = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.012, 0.98), BRASS);
    line.position.set(0.38, 0.66, 0);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(2.46, 0.07, 1.16, 2, 0.03), GLOSS);
    frame.position.set(0.38, top - 0.035, 0);
    g.add(body, kick, line, frame);
    // the layout, and a padded rail along the players' side and the far end
    const LW = 1.3, LD = 0.53;
    const layout = new THREE.Mesh(new THREE.PlaneGeometry(LW, LD), new THREE.MeshStandardMaterial({ map: layoutTex(LW, LD), roughness: 0.95 }));
    layout.rotation.x = -Math.PI / 2;
    layout.position.set(0.87, top + 0.001, -0.08);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.04), new THREE.MeshStandardMaterial({ color: 0x0f6e40, roughness: 0.95 }));   // plain felt round the wheel
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0.38, top + 0.0005, -0.04);
    const railFront = new THREE.Mesh(new RoundedBoxGeometry(2.44, 0.09, 0.11, 3, 0.045), RAIL);
    railFront.position.set(0.38, top + 0.02, 0.53);
    const railEnd = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.09, 1.06, 3, 0.045), RAIL);
    railEnd.position.set(1.56, top + 0.02, -0.03);
    g.add(layout, pad, railFront, railEnd);
    // chips out on the layout
    [[0.54, -0.08, 0xc8102e], [0.94, -0.22, 0x1f5fbf], [1.26, 0.06, 0x7a2bb5], [0.69, 0.09, 0x222222]].forEach(([x, z, c]) => g.add(chipStack(c, x, top, z, 0.03)));
    // the dealer's chip tray and the win marker
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.09), GLOSS);
    tray.position.set(0.94, top + 0.012, -0.48);
    g.add(tray);
    const chipGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.075, 18);
    [3, 3, 2, 2, 1, 1, 0, 0].forEach((c, i) => {
      const col = new THREE.Mesh(chipGeo, std(CHIP_COLS[c], 0.4));
      col.rotation.x = Math.PI / 2;
      col.position.set(0.75 + i * 0.054, top + 0.03, -0.48);
      g.add(col);
    });
    // the wheel
    const wheel = new THREE.Group();
    wheel.position.set(-0.32, top, -0.04);
    const wood = new THREE.MeshPhysicalMaterial({ color: 0x47210f, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
    const trackWood = new THREE.MeshPhysicalMaterial({ color: 0x7a4422, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.455, 0.47, 0.03, 64), wood);
    plinth.position.y = 0.0;
    wheel.add(plinth);
    wheel.add(new THREE.Mesh(lathe([[0.445, 0.0], [0.445, 0.07], [0.432, 0.083], [0.402, 0.08], [0.4, 0.046]]), wood));
    wheel.add(new THREE.Mesh(lathe([[0.4, 0.046], [0.315, 0.022], [0.306, 0.0205]]), trackWood));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.432, 0.0055, 10, 96), BRASS);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.083;
    wheel.add(rim);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8, r = 0.356, wide = i % 2 === 0;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), BRASS);
      gem.scale.set(wide ? 0.0065 : 0.017, 0.0065, wide ? 0.018 : 0.0065);
      gem.position.set(r * Math.cos(a), 0.022 + ((r - 0.315) / 0.085) * 0.024 + 0.004, r * Math.sin(a));
      gem.rotation.y = -a;
      wheel.add(gem);
    }
    rotor = new THREE.Group();
    const ringGeo = lathe([[0.305, 0.0205], [0.255, 0.012], [0.255, 0.0], [0.19, 0.004], [0.19, 0.018]]);
    const pos = ringGeo.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 0.62 + 0.5; uv[i * 2 + 1] = 0.5 - pos.getZ(i) / 0.62; }
    ringGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    rotor.add(new THREE.Mesh(ringGeo, new THREE.MeshPhysicalMaterial({ map: pocketTex(), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, side: THREE.DoubleSide })));
    rotor.add(new THREE.Mesh(lathe([[0.19, 0.018], [0.13, 0.032], [0.06, 0.05], [0.0, 0.053]]), new THREE.MeshPhysicalMaterial({ color: 0x5c2f14, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide })));
    rotor.add(new THREE.Mesh(lathe([[0.0, 0.05], [0.032, 0.05], [0.03, 0.058], [0.014, 0.068], [0.008, 0.105], [0.015, 0.115], [0.011, 0.126], [0.0, 0.128]]), BRASS));
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 10), BRASS);
      arm.rotation.set(0, (i * Math.PI) / 2, Math.PI / 2);
      arm.position.y = 0.093;
      rotor.add(arm);
      for (const sgn of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 10), BRASS);
        knob.position.set(i ? 0 : sgn * 0.065, 0.093, i ? sgn * 0.065 : 0);
        rotor.add(knob);
      }
    }
    // the frets, merged into one mesh
    const frets = [];
    for (let i = 0; i < 37; i++) {
      const a = i * STEP + STEP / 2, r = (0.19 + 0.255) / 2;
      const f = new THREE.BoxGeometry(0.066, 0.013, 0.003);
      f.rotateY(-a);
      f.translate(r * Math.cos(a), 0.0065, r * Math.sin(a));
      frets.push(f);
    }
    rotor.add(new THREE.Mesh(mergeGeometries(frets), M.chrome));
    frets.forEach(f => f.dispose());
    const rotorRim = new THREE.Mesh(new THREE.TorusGeometry(0.3055, 0.0025, 8, 96), M.chrome);
    rotorRim.rotation.x = Math.PI / 2;
    rotorRim.position.y = 0.0205;
    rotor.add(rotorRim);
    ballPivot = new THREE.Group();
    ballPivot.position.y = 0.045;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xfbf8f0, roughness: 0.18, clearcoat: 1 }));
    ball.position.x = 0.37;
    ballPivot.add(ball);
    wheel.add(rotor, ballPivot);
    g.add(wheel);
    for (let i = 0; i < 4; i++) g.add(stool(-0.2 + i * 0.5, 0.98, 0));
    return g;
  }
  const bulbs = [];
  let duck = null;
  const DUCK_Y = 1.84;   // the duck bobbing on top of Lucky Duck's arch
  function buildSlots() {
    const on = glowMat(0xffe7a0), off = glowMat(0x6a4a20);
    const g = kit.classic(kit.themes[0], {
      bulbs: (geo, pos, i, grp) => {
        const b = new THREE.Mesh(geo, on);
        b.position.set(...pos);
        b.userData = { on, off, i };
        bulbs.push(b);
        grp.add(b);
      },
    });
    duck = new THREE.Mesh(duckGeometry(0.11), std(0xffffff, 0.35, 0, { vertexColors: true }));
    duck.position.set(0, DUCK_Y, 0);
    g.add(duck);
    // The rest of the machines you can pick, round a carousel behind Lucky Duck: eight
    // machines facing out from a mirrored column, a lit SLOT MACHINES drum on top
    const R = 0.95, ids = ['duck', 'cherry', 'diamond', 'gold', 'dragon', 'cosmic', 'mermaid', 'buffalo'];
    const ring = new THREE.Group();
    ids.forEach((id, i) => {
      if (!i) return;   // Lucky Duck is the one in front, already built
      const a = (i / ids.length) * TAU;
      const m = kit.classic(kit.themes.find(t => t.id === id) || kit.themes[i], { chair: 'stool' });
      m.position.set(Math.sin(a) * R, 0, -R + Math.cos(a) * R);
      m.rotation.y = a;
      ring.add(m);
    });
    const { part } = kit;
    ring.add(part(new THREE.CylinderGeometry(0.6, 0.66, 1.9, 40), 'chrome', 0x9a8a6a, 0, 0.95, -R));
    ring.add(part(new THREE.CylinderGeometry(0.98, 1.0, 0.06, 48), 'dark', 0x1a1218, 0, 0.03, -R));
    ring.add(part(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 48), 'chrome', 0xe9b949, 0, 1.94, -R));
    ring.add(part(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 48), 'chrome', 0xe9b949, 0, 2.36, -R));
    g.add(kit.bake(ring));
    // the drum's lettering, all the way round
    const [cv, cg] = canvas(2048, 192);
    cg.fillStyle = '#1a0610';
    cg.fillRect(0, 0, 2048, 192);
    cg.font = '900 96px Manrope, sans-serif';
    cg.textAlign = 'center';
    cg.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) {
      cg.shadowColor = '#ff3d6e';
      cg.shadowBlur = 24;
      cg.fillStyle = '#fff1d6';
      cg.fillText('SLOT MACHINES', 512 + k * 1024 - 60, 100);
      cg.fillStyle = '#ffd23f';
      cg.fillText('★', 512 + k * 1024 + 420, 100);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.38, 48, 1, true), new THREE.MeshBasicMaterial({ map: keep(tex(cv, renderer)), toneMapped: false }));
    drum.position.set(0, 2.15, -R);
    drum.rotation.y = -Math.PI / 2;   // the lettering faces the aisle
    g.add(drum);
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
  /* Duck Drop, built like an arcade prize cabinet: a white peg board behind glass with chrome
     pegs, chrome dividers over the prize slots, a chrome frame with LED edges, a lit arch
     marquee with chasing bulbs, side art panels, and a control deck with the big drop button
     and a coin door. */
  function buildPlinko() {
    const g = new THREE.Group();
    const { part, rbox, box } = kit;
    const W = 1.4, purple = 0x3a1260, deep = 0x1c0832;
    const BY = (DROP.top + DROP.bottom) / 2 + 0.05, BH = DROP.top - DROP.bottom + 0.3;
    // the base: cabinet, chrome kick, coin door, a control deck with the button
    g.add(part(box(W, 0.1, 0.62), 'dark', 0x0a090d, 0, 0.05, 0));
    g.add(part(rbox(W + 0.1, 0.72, 0.7, 0.04), 'paint', purple, 0, 0.44, 0));
    g.add(part(box(W + 0.11, 0.03, 0.71), 'chrome', 0xe8e8ee, 0, 0.12, 0));
    g.add(part(rbox(0.3, 0.34, 0.02, 0.015), 'chrome', 0xc8c8d0, -0.34, 0.45, 0.355));   // coin door
    g.add(part(box(0.05, 0.08, 0.01), 'glow', 0xff3d3d, -0.34, 0.5, 0.367));
    g.add(part(box(0.2, 0.02, 0.01), 'dark', 0x0a090d, -0.34, 0.36, 0.367));
    g.add(part(rbox(0.3, 0.34, 0.02, 0.015), 'chrome', 0xc8c8d0, 0.34, 0.45, 0.355));
    g.add(part(box(0.05, 0.08, 0.01), 'glow', 0x7cff6b, 0.34, 0.5, 0.367));
    g.add(part(box(0.2, 0.02, 0.01), 'dark', 0x0a090d, 0.34, 0.36, 0.367));
    const deck = new THREE.Group();
    deck.position.set(0, 0.83, 0.2);
    deck.rotation.x = 0.16;
    deck.add(part(rbox(W + 0.14, 0.06, 0.34, 0.025), 'dark', 0x22242e, 0, 0, 0));
    deck.add(part(new THREE.CylinderGeometry(0.1, 0.11, 0.03, 32), 'chrome', 0xe8e8ee, 0, 0.035, 0.04));
    deck.add(part(new THREE.SphereGeometry(0.085, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 'glow', 0x7cff6b, 0, 0.05, 0.04));
    for (const sx of [-0.42, 0.42]) deck.add(part(rbox(0.12, 0.022, 0.06, 0.008), 'glow', sx < 0 ? 0x6be7ff : 0xffd23f, sx, 0.036, 0.04));
    g.add(deck);
    // the cabinet body round the board, side art panels, the chrome frame
    g.add(part(rbox(W + 0.1, BH + 0.2, 0.36, 0.04), 'paint', purple, 0, BY, -0.14));
    for (const sx of [-1, 1]) {
      g.add(part(box(0.02, BH + 0.1, 0.3), 'paint', deep, sx * (W / 2 + 0.056), BY, -0.14));
      g.add(part(box(0.024, BH + 0.16, 0.024), 'led', 0xffffff, sx * (W / 2 + 0.02), BY, 0.05));
      for (let i = 0; i < 6; i++) g.add(part(new THREE.SphereGeometry(0.018, 8, 6), 'glow', i % 2 ? 0xffd23f : 0x7cff6b, sx * (W / 2 + 0.057), BY - BH / 2 + 0.15 + i * (BH - 0.3) / 5, 0.0));
    }
    g.add(part(box(W + 0.02, 0.035, 0.05), 'chrome', 0xe8e8ee, 0, BY + BH / 2 + 0.02, 0.05));
    g.add(part(box(W + 0.02, 0.035, 0.05), 'chrome', 0xe8e8ee, 0, DROP.bottom - 0.14, 0.05));
    // the board: bright white with a soft violet glow at its edges, chrome pegs standing out of it
    const [bcv, bg] = canvas(256, 512);
    const grad = bg.createRadialGradient(128, 230, 20, 128, 256, 300);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#f1e8ff');
    grad.addColorStop(1, '#bfa3ee');
    bg.fillStyle = grad;
    bg.fillRect(0, 0, 256, 512);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, BH - 0.04), new THREE.MeshStandardMaterial({ map: keep(tex(bcv, renderer)), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: keep(tex(bcv, renderer)) }));
    board.position.set(0, BY, 0.04);
    g.add(board);
    const xs = [];
    for (let r = 0; r < DROP.rows; r++) for (let i = 0; i <= r + 2; i++) xs.push([(i - (r + 2) / 2) * DROP.gap * 0.95, DROP.top - 0.08 - r * 0.15]);
    const pegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 10).rotateX(Math.PI / 2), std(0xe2e6ee, 0.22, 0.55), xs.length);
    xs.forEach(([x, y], i) => pegs.setMatrixAt(i, m4.makeTranslation(x, y, 0.065)));
    pegs.castShadow = true;
    g.add(pegs);
    // the prize slots along the bottom, with chrome dividers between them
    const bins = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.16, 0.16), new THREE.MeshBasicMaterial({ map: dropBinsTex(), toneMapped: false }));
    bins.position.set(0, DROP.bottom - 0.04, 0.045);
    g.add(bins);
    const slotW = (W - 0.16) / 9;
    for (let i = 0; i <= 9; i++) g.add(part(box(0.008, 0.2, 0.05), 'chrome', 0xe8e8ee, -(W - 0.16) / 2 + i * slotW, DROP.bottom - 0.02, 0.065));
    // the glass over it all
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, BH + 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.04, metalness: 0.1, depthWrite: false }));
    glass.position.set(0, BY, 0.1);
    g.add(glass);
    // the arch marquee, its bulbs chasing
    const top = BY + BH / 2 + 0.06;
    const marquee = new THREE.Mesh(new THREE.CircleGeometry(0.66, 40, 0, Math.PI), new THREE.MeshBasicMaterial({ map: keep(tex(signCanvas('DUCK DROP', 'UP TO 10×'), renderer)), toneMapped: false }));
    marquee.position.set(0, top, 0.02);
    const arch = part(new THREE.CylinderGeometry(0.73, 0.73, 0.34, 40, 1, false, -Math.PI / 2, Math.PI), 'paint', purple, 0, top, -0.15);
    arch.rotation.x = Math.PI / 2;
    const ring = part(new THREE.TorusGeometry(0.735, 0.018, 8, 40, Math.PI), 'chrome', 0xe8e8ee, 0, top, 0.02);
    g.add(marquee, arch, ring);
    const bulbGeo = new THREE.SphereGeometry(0.022, 8, 6);
    const on = glowMat(0xb6ffa8), off = glowMat(0x2d5a28);
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      const b = new THREE.Mesh(bulbGeo, on);
      b.position.set(Math.cos(a) * 0.7, top + Math.sin(a) * 0.7, 0.03);
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

  /* The cashier's cage, after a real casino cage: a lacquered wood front with raised panels
     and a brass kick, a marble counter, three teller windows behind brass grilles with arched
     tops and glass, each with a money slot and a window number, a warm-lit back office with
     chip racks on the shelves, and a lit CASHIER sign across the top. Today's bonus coin
     spins in the middle window. */
  let bonusCoin = null, wasLocked = null;
  function marbleTex() {
    const [cv, g] = canvas(512, 256);
    g.fillStyle = '#efe7da';
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 26; i++) {   // soft grey veins
      g.strokeStyle = `rgba(${120 + (i * 13) % 50}, ${110 + (i * 7) % 40}, ${100 + (i * 11) % 40}, ${0.12 + (i % 4) * 0.05})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      let x = (i * 97) % 512, y = (i * 53) % 256;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += 30 + ((i + k) * 17) % 40; y += ((i * 5 + k * 23) % 50) - 25; g.lineTo(x, y); }
      g.stroke();
    }
    return keep(tex(cv, renderer));
  }
  function windowNumTex(n) {
    const [cv, g] = canvas(128, 64);
    g.fillStyle = '#1a0f06';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#e9b949';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 120, 56);
    g.font = '900 30px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd98a';
    g.fillText(String(n), 64, 34);
    return keep(tex(cv, renderer));
  }
  function buildCashier() {
    const g = new THREE.Group();
    const W = 1.8, H = 2.3, D = 0.9, CT = 1.08;   // CT: the counter top
    const { part, rbox, box } = kit;
    const WOOD = 0x3b1f0e, LIGHT = 0x5a3216, GOLDC = 0xe9b949;
    // the booth behind, and its warm-lit back office
    const booth = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), GLOSS);
    booth.position.set(0, H / 2, -D / 2 - 0.02);
    g.add(booth);
    const [ocv, og] = canvas(512, 256);
    const og2 = og.createLinearGradient(0, 0, 0, 256);
    og2.addColorStop(0, '#8a5a24');
    og2.addColorStop(1, '#3a2410');
    og.fillStyle = og2;
    og.fillRect(0, 0, 512, 256);
    for (const y of [86, 170]) { og.fillStyle = '#2a1608'; og.fillRect(0, y, 512, 10); }   // shelves
    const chipCols = ['#7a2bb5', '#222', '#1f5fbf', '#c8102e', '#2a8a4a', '#e9b949'];
    for (let r = 0; r < 2; r++) for (let i = 0; i < 26; i++) { og.fillStyle = chipCols[(i + r * 3) % 6]; og.fillRect(8 + i * 19, (r ? 170 : 86) - 30 - (i % 3) * 6, 14, 30 + (i % 3) * 6); }
    const office = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 1.0), new THREE.MeshStandardMaterial({ map: keep(tex(ocv, renderer)), emissive: 0xffffff, emissiveMap: keep(tex(ocv, renderer)), emissiveIntensity: 0.55, roughness: 0.8 }));
    office.position.set(0, CT + 0.5, -0.012);
    g.add(office);
    // the lower front: lacquered wood with raised panels, a brass kick and a brass rail
    g.add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, CT - 0.04, 0.12), GLOSS).translateY((CT - 0.04) / 2).translateZ(0.02));
    for (let i = 0; i < 4; i++) {
      const x = -W / 2 + 0.24 + i * ((W - 0.48) / 3);
      g.add(part(rbox(0.34, 0.62, 0.03, 0.015), 'paint', LIGHT, x, 0.56, 0.085));
      g.add(part(box(0.3, 0.008, 0.008), 'chrome', GOLDC, x, 0.88, 0.1));
      g.add(part(box(0.3, 0.008, 0.008), 'chrome', GOLDC, x, 0.24, 0.1));
    }
    g.add(part(box(W + 0.06, 0.1, 0.14), 'chrome', 0xc99a3c, 0, 0.05, 0.03));
    g.add(part(new THREE.CylinderGeometry(0.018, 0.018, W - 0.1, 12).rotateZ(Math.PI / 2), 'chrome', GOLDC, 0, 0.72, 0.15));
    for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) g.add(part(box(0.03, 0.03, 0.08), 'chrome', GOLDC, x, 0.72, 0.12));
    // the marble counter with a brass edge
    const counter = new THREE.Mesh(new RoundedBoxGeometry(W + 0.14, 0.06, 0.4, 2, 0.02), new THREE.MeshPhysicalMaterial({ map: marbleTex(), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }));
    counter.position.set(0, CT, 0.1);
    g.add(counter, part(box(W + 0.15, 0.014, 0.012), 'chrome', GOLDC, 0, CT - 0.03, 0.3));
    // the upper front: three windows between wood pilasters, a header, a crown moulding
    const WIN = [-0.58, 0, 0.58], ww = 0.42, wy0 = CT + 0.06, wh = 0.86;
    for (const x of [-0.87, -0.29, 0.29, 0.87]) {
      g.add(part(box(0.1, wh + 0.08, 0.1), 'paint', WOOD, x, wy0 + wh / 2, 0.0));
      g.add(part(box(0.11, 0.03, 0.11), 'chrome', GOLDC, x, wy0 + 0.02, 0.0));
      g.add(part(box(0.11, 0.03, 0.11), 'chrome', GOLDC, x, wy0 + wh - 0.02, 0.0));
    }
    WIN.forEach((x, n) => {
      // brass grille: bars, a cross rail, an arch at the top
      for (let i = 0; i < 9; i++) {
        const bx = x - ww / 2 + 0.03 + i * ((ww - 0.06) / 8);
        if (Math.abs(bx - x) < 0.09) {   // the opening where money passes
          g.add(part(new THREE.CylinderGeometry(0.007, 0.007, wh - 0.36, 8), 'chrome', GOLDC, bx, wy0 + 0.36 + (wh - 0.36) / 2, 0.02));
          continue;
        }
        g.add(part(new THREE.CylinderGeometry(0.007, 0.007, wh, 8), 'chrome', GOLDC, bx, wy0 + wh / 2, 0.02));
      }
      g.add(part(box(ww, 0.016, 0.016), 'chrome', GOLDC, x, wy0 + 0.36, 0.02));
      g.add(part(box(ww, 0.016, 0.016), 'chrome', GOLDC, x, wy0 + wh - 0.14, 0.02));
      const arc = part(new THREE.TorusGeometry(ww / 2 - 0.02, 0.009, 6, 24, Math.PI), 'chrome', GOLDC, x, wy0 + wh - 0.14, 0.02);
      g.add(arc);
      // the money slot in the counter, and the window's number on a little brass-edged plate
      g.add(part(rbox(0.22, 0.02, 0.14, 0.008), 'dark', 0x0a090d, x, CT + 0.03, 0.02));
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: windowNumTex(n + 1), toneMapped: false }));
      plate.position.set(x, wy0 + wh + 0.07, 0.083);
      g.add(plate);
    });
    // glass in each window, kept separate so it can stay see-through
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.04, depthWrite: false });
    for (const x of WIN) { const gl = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh - 0.38), glassMat); gl.position.set(x, wy0 + 0.38 + (wh - 0.38) / 2, 0.0); g.add(gl); }
    // the header with the lit sign, and a crown on top
    const headY = wy0 + wh + 0.2;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.42, 0.14), GLOSS).translateY(headY + 0.08).translateZ(0.01));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.275), new THREE.MeshBasicMaterial({ map: signTex('CASHIER', '#e9b949'), transparent: true, toneMapped: false }));
    sign.position.set(0, headY + 0.12, 0.085);
    g.add(sign);
    g.add(part(box(W + 0.12, 0.05, 0.2), 'chrome', GOLDC, 0, headY + 0.31, 0.01));
    g.add(part(box(W + 0.18, 0.04, 0.24), 'paint', WOOD, 0, headY + 0.355, 0.01));
    // brass lamps either side of the sign
    for (const x of [-0.72, 0.72]) {
      g.add(part(box(0.02, 0.08, 0.06), 'chrome', GOLDC, x, headY + 0.1, 0.1));
      g.add(part(new THREE.CylinderGeometry(0.03, 0.06, 0.08, 16, 1, true), 'chrome', GOLDC, x, headY + 0.14, 0.15));
      g.add(part(new THREE.SphereGeometry(0.03, 12, 8), 'glow', 0xffe2a0, x, headY + 0.12, 0.15));
    }
    // a few things on the counter: chip racks, a bell, a stack of bills
    [[-0.78, 0.18], [0.42, 0.2]].forEach(([x, z]) => {
      g.add(part(box(0.22, 0.03, 0.09), 'paint', 0x1c1c22, x, CT + 0.045, z));
      [0x7a2bb5, 0x222222, 0x1f5fbf, 0xc8102e, 0x2a8a4a].forEach((col, i) => g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.17, 14).rotateZ(Math.PI / 2), 'paint', col, x, CT + 0.07, z - 0.032 + (i % 3) * 0.032).translateX(i < 3 ? -0.0 : 0)));
    });
    g.add(part(new THREE.CylinderGeometry(0.035, 0.045, 0.02, 20), 'chrome', GOLDC, -0.3, CT + 0.04, 0.2));
    g.add(part(new THREE.SphereGeometry(0.035, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'chrome', GOLDC, -0.3, CT + 0.05, 0.2));
    g.add(part(box(0.15, 0.03, 0.07), 'paint', 0x6aa86a, 0.78, CT + 0.045, 0.2));
    bonusCoin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 32), [M.gold, glowMat(0xffd84a), glowMat(0xffd84a)]);
    bonusCoin.rotation.order = 'YXZ';   // stood on its edge, then spun about the vertical
    bonusCoin.rotation.x = Math.PI / 2;
    bonusCoin.position.set(0, 1.5, 0.3);   // in the middle window, being handed over
    bonusCoin.visible = false;
    g.add(bonusCoin);
    return g;
  }
  // ---- Casino dressing: the things that make it a room, not just games ----
  // Columns and palms in the gaps behind the tables, cocktail tables with drinks, giant dice
  // and a chip tower by the left wall, rope lanes at the cashier, neon along the back wall.
  // Built from the slot kit's parts and merged into a few meshes, like the slot row.
  {
    const { part, rbox, box } = kit;
    const GOLD = 0xe9b949, CREAM = 0xf3e7d0, PLUM = 0x3a1430, GREEN = 0x2f8a3a, LEAF = 0x46b04a;
    const decor = new THREE.Group();
    const cyl = (rt, rb, h, n = 24) => new THREE.CylinderGeometry(rt, rb, h, n);
    const at = (o, x, z, ry = 0) => { o.position.set(x, 0, z); o.rotation.y = ry; decor.add(o); return o; };

    // A column: plinth, a cream marble shaft, gold rings and a gold capital, up past the camera
    function column() {
      const g = new THREE.Group();
      g.add(part(rbox(0.56, 0.3, 0.56, 0.03), 'paint', PLUM, 0, 0.15, 0));
      g.add(part(cyl(0.25, 0.27, 0.06, 32), 'chrome', GOLD, 0, 0.33, 0));
      g.add(part(cyl(0.2, 0.22, 3.6, 32), 'paint', CREAM, 0, 2.16, 0));
      for (const y of [0.9, 1.9, 2.9]) g.add(part(new THREE.TorusGeometry(0.212, 0.018, 8, 32).rotateX(Math.PI / 2), 'chrome', GOLD, 0, y, 0));
      g.add(part(cyl(0.3, 0.21, 0.24, 32), 'chrome', GOLD, 0, 4.0, 0));
      return g;
    }
    // A potted palm: a gold-banded pot, a ringed trunk, and fronds fanning out
    function palm(seed) {
      const g = new THREE.Group();
      g.add(part(cyl(0.26, 0.19, 0.5, 24), 'paint', PLUM, 0, 0.25, 0));
      g.add(part(new THREE.TorusGeometry(0.255, 0.02, 8, 24).rotateX(Math.PI / 2), 'chrome', GOLD, 0, 0.46, 0));
      g.add(part(cyl(0.24, 0.24, 0.02, 24), 'dark', 0x2a1a10, 0, 0.49, 0));
      for (let i = 0; i < 6; i++) g.add(part(cyl(0.05 - i * 0.004, 0.058 - i * 0.004, 0.22, 10), 'paint', i % 2 ? 0x7a5230 : 0x8f6238, Math.sin(i * 0.9 + seed) * 0.02, 0.6 + i * 0.2, 0));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + seed;
        const frond = new THREE.Group();
        frond.position.set(0, 1.78, 0);
        frond.rotation.y = a;
        const leaf = part(new THREE.SphereGeometry(0.5, 12, 6).scale(1, 0.05, 0.16), 'leather', i % 2 ? LEAF : GREEN, 0.42, 0, 0);
        leaf.rotation.z = -0.35 - (i % 3) * 0.12;
        frond.add(leaf);
        g.add(frond);
      }
      return g;
    }
    // A high-top cocktail table with a martini, a short drink and a stack of chips
    function cocktail() {
      const g = new THREE.Group();
      g.add(part(cyl(0.22, 0.26, 0.03, 24), 'chrome', GOLD, 0, 0.015, 0));
      g.add(part(cyl(0.03, 0.03, 1.02, 10), 'chrome', GOLD, 0, 0.53, 0));
      g.add(part(cyl(0.32, 0.32, 0.04, 32), 'paint', 0x14101a, 0, 1.06, 0));
      g.add(part(new THREE.TorusGeometry(0.32, 0.012, 6, 32).rotateX(Math.PI / 2), 'chrome', GOLD, 0, 1.06, 0));
      // martini: stem, cone, olive
      g.add(part(cyl(0.035, 0.035, 0.005, 16), 'glass', 0xffffff, -0.1, 1.083, 0.04));
      g.add(part(cyl(0.004, 0.004, 0.09, 6), 'chrome', 0xdddddd, -0.1, 1.13, 0.04));
      g.add(part(new THREE.ConeGeometry(0.055, 0.07, 18, 1, true).rotateX(Math.PI), 'glow', 0x9ff0ff, -0.1, 1.2, 0.04));
      g.add(part(new THREE.SphereGeometry(0.012, 8, 6), 'paint', 0x7a9a20, -0.1, 1.2, 0.04));
      // a short glass with something amber
      g.add(part(cyl(0.035, 0.03, 0.08, 16), 'glow', 0xffa63d, 0.08, 1.12, -0.06));
      // chips
      const cc = [0xd8202e, 0x1d5fd1, 0x111111, 0x7a2ab0, 0x0f9a50];
      for (let i = 0; i < 6; i++) g.add(part(cyl(0.032, 0.032, 0.012, 16), 'paint', cc[i % cc.length], 0.12, 1.087 + i * 0.013, 0.12));
      for (let i = 0; i < 4; i++) g.add(part(cyl(0.032, 0.032, 0.012, 16), 'paint', cc[(i + 2) % cc.length], 0.05, 1.087 + i * 0.013, 0.17));
      return g;
    }
    // Giant dice on a round pedestal: white with dark pips, one tipped on its edge
    function dice() {
      const g = new THREE.Group();
      g.add(part(cyl(0.5, 0.55, 0.36, 40), 'paint', PLUM, 0, 0.18, 0));
      g.add(part(new THREE.TorusGeometry(0.5, 0.025, 8, 40).rotateX(Math.PI / 2), 'chrome', GOLD, 0, 0.36, 0));
      const S = 0.38;
      const pips = {   // face → pip spots, in units of S/4
        px: [[0, 0]], nx: [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, 0]], py: [[-1, -1], [1, 1]],
        ny: [[-1, -1], [1, 1], [-1, 1], [1, -1]], pz: [[-1, -1], [0, 0], [1, 1]], nz: [[-1, -1], [1, 1], [-1, 1], [1, -1], [-1, 0], [1, 0]],
      };
      function die() {
        const d = new THREE.Group();
        d.add(part(rbox(S, S, S, 0.06), 'paint', 0xf6f2ea, 0, 0, 0));
        const o = S / 2 + 0.001, k = S / 4;
        for (const [face, spots] of Object.entries(pips)) for (const [a, b] of spots) {
          const pip = part(cyl(0.032, 0.032, 0.01, 14), 'dark', face === 'px' ? 0xc8102e : 0x1a1418, 0, 0, 0);
          if (face === 'px' || face === 'nx') { pip.rotation.z = Math.PI / 2; pip.position.set(face === 'px' ? o : -o, a * k, b * k); }
          else if (face === 'py' || face === 'ny') pip.position.set(a * k, face === 'py' ? o : -o, b * k);
          else { pip.rotation.x = Math.PI / 2; pip.position.set(a * k, b * k, face === 'pz' ? o : -o); }
          d.add(pip);
        }
        return d;
      }
      const a = die();
      a.position.set(-0.18, 0.36 + S / 2, 0.05);
      a.rotation.y = 0.5;
      const b = die();
      b.position.set(0.22, 0.36 + S * 0.62, -0.05);
      b.rotation.set(0.6, -0.4, Math.PI / 4);
      g.add(a, b);
      return g;
    }
    // A tower of giant chips, a little off-true, on a pedestal
    function chipTower() {
      const g = new THREE.Group();
      g.add(part(cyl(0.42, 0.46, 0.3, 40), 'paint', PLUM, 0, 0.15, 0));
      g.add(part(new THREE.TorusGeometry(0.42, 0.022, 8, 40).rotateX(Math.PI / 2), 'chrome', GOLD, 0, 0.3, 0));
      const cols = [0xd8202e, 0x1d5fd1, 0x111111, 0x7a2ab0, 0x0f9a50, 0xff8a1f];
      for (let i = 0; i < 14; i++) {
        const y = 0.34 + i * 0.075;
        const ox = Math.sin(i * 1.3) * 0.015, oz = Math.cos(i * 1.7) * 0.015;
        g.add(part(cyl(0.3, 0.3, 0.07, 36), 'paint', cols[i % cols.length], ox, y, oz));
        g.add(part(new THREE.TorusGeometry(0.3, 0.012, 6, 36).rotateX(Math.PI / 2), 'paint', 0xffffff, ox, y, oz));   // the edge stripe
      }
      return g;
    }
    // A chrome stanchion, and a red velvet rope sagging between two of them
    function post(x, z) {
      at(part(cyl(0.13, 0.15, 0.03, 20), 'chrome', GOLD, 0, 0.015, 0), x, z);
      decor.add(part(cyl(0.022, 0.022, 0.9, 10), 'chrome', GOLD, x, 0.47, z));
      decor.add(part(new THREE.SphereGeometry(0.04, 14, 10), 'chrome', GOLD, x, 0.94, z));
    }
    function rope(a, b) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 0.88 - Math.sin(t * Math.PI) * 0.16, a[1] + (b[1] - a[1]) * t));
      }
      decor.add(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 8), 'leather', 0x8a0a1e));
    }
    // Where a station's local spot lands on the floor
    const local = (id, lx, lz) => {
      const st = STATIONS.find(s => s.id === id);
      const c = Math.cos(st.yaw), sn = Math.sin(st.yaw);
      return [st.pos[0] + lx * c + lz * sn, st.pos[1] - lx * sn + lz * c];
    };

    // The gaps behind and between the tables
    at(palm(0.3), -8.5, -2.65);
    at(column(), -5.7, -2.7);
    at(cocktail(), -2.9, -2.55);
    at(column(), -0.1, -2.75);
    at(palm(1.4), 3.05, -2.75);
    at(cocktail(), 6.3, -2.6);
    // The left wall: dice, chips, palms
    at(dice(), -11.05, -2.55, 0.4);
    at(chipTower(), -11.25, 0.2);
    at(palm(2.2), -11.35, 1.6);
    // Rope lanes leading up to the cashier
    const lanes = [[-1.05, 0.55], [-1.05, 1.45], [1.05, 0.55], [1.05, 1.45]].map(([x, z]) => local('cashier', x, z));
    for (const p of lanes) post(...p);
    rope(lanes[0], lanes[1]);
    rope(lanes[2], lanes[3]);
    scene.add(kit.bake(decor));

    // Neon along the top of the back wall, over the ticker
    function neonSign(text, color, w) {
      const [cv, g] = canvas(1024, 256);
      g.font = '900 150px Manrope, sans-serif';
      const fit = Math.min(1, 960 / g.measureText(text).width);
      g.font = `900 ${Math.floor(150 * fit)}px Manrope, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.shadowColor = color;
      g.shadowBlur = 40;
      g.lineWidth = 14;
      g.strokeStyle = color;
      g.strokeText(text, 512, 134);
      g.shadowBlur = 12;
      g.lineWidth = 4;
      g.strokeStyle = '#ffffff';
      g.strokeText(text, 512, 134);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: keep(tex(cv, renderer)), transparent: true, depthWrite: false, toneMapped: false }));
      return m;
    }
    const NEON = [['♠ ♥ ♦ ♣', '#ff3d6e', 1.7], ['JACKPOT', '#ffd23f', 2.0], ['777', '#ff3d3d', 1.3], ['WIN BIG', '#6be7ff', 1.9], ['HIGH LIMIT', '#c9a2ff', 2.1]];
    NEON.forEach(([text, color, w], i) => {
      const sign = neonSign(text, color, w);
      sign.position.set(ROOM.x0 + 2.2 + i * ((SPAN - 4.4) / (NEON.length - 1)), 2.82, ROOM.z0 + 0.05);
      scene.add(sign);
    });
  }

  const builders = { table: buildBlackjack, threecard: buildThreeCard, war: buildWar, reddog: buildRedDog, roulette: buildRoulette, baccarat: buildBaccarat, poker: buildVideoPoker, slots: buildSlots, plinko: buildPlinko, crash: buildRocket, cashier: buildCashier };
  // Where each sign post stands, beside the station and toward the aisle: [x, z] in the
  // station's own frame (it faces +z), and how far the board turns back toward the camera
  // (portrait phones only frame the station itself, so the posts stand inside that frame)
  const POST = {
    roulette: [0.95, -0.55, -0.2], baccarat: [-1.0, -0.5, 0.2],   // baccarat's on its far side, clear of video poker
    // the machines: a small post at the cabinet's front-left corner, away from the mini map, [x, z, turn, scale]
    poker: [-0.46, 0.42, 0.3, 0.55], slots: [-0.3, 0.95, 0.15, 0.46], plinko: [-0.66, 0.45, 0.3, 0.6], crash: [-0.5, 0.8, 0.15, 0.55], cashier: [-0.78, 0.5, 0.3, 0.6],
  };
  const posts = [];
  const groups = [];
  const DIRS = [];
  STATIONS.forEach((st, k) => {
    const g = builders[st.id]();
    bakeChairs(g);
    shadowy(g);
    g.position.set(st.pos[0], 0, st.pos[1]);
    g.rotation.y = st.yaw;
    g.userData.k = k;
    const [px, pz, turn, size = 1] = POST[st.id] || [st.w / 2 - 0.45, -0.45, -0.2];   // card tables: the back corner, beside the dealer
    const post = signPost(st);
    post.position.set(px, 0, pz);
    post.scale.setScalar(size);
    post.rotation.y = turn;
    g.add(post);
    posts.push(post);
    scene.add(g);
    groups.push(g);
    DIRS.push(new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw)));
  });

  // Every sign's bulbs in one draw: placed from the boards' final positions
  scene.updateMatrixWorld(true);
  const signLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.017, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), signBulbs.length);
  const bulbOn = signBulbs.map(b => b[2]), bulbDim = signBulbs.map(b => b[2].clone().multiplyScalar(0.28));
  signBulbs.forEach(([board, at], k) => {
    const wpos = at.clone().applyMatrix4(board.matrixWorld);
    const scl = new THREE.Vector3().setFromMatrixScale(board.matrixWorld);
    signLights.setMatrixAt(k, new THREE.Matrix4().compose(wpos, new THREE.Quaternion(), scl));
    signLights.setColorAt(k, bulbOn[k]);
  });
  signLights.frustumCulled = false;
  scene.add(signLights);
  let bulbStep = -1;

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
  const map = document.createElement('canvas');
  map.className = 'floor-map';
  map.setAttribute('role', 'img');
  map.setAttribute('aria-label', 'Map of the casino floor');
  stage.appendChild(map);
  const MAP_W = 168, MAP_H = 92, PAD = 7;
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
    prevBtn.disabled = k === 0;
    nextBtn.disabled = k === LAST;
    sitBtn.textContent = locked() ? 'Sign in to play' : st.id === 'cashier' && bonusCoin && bonusCoin.visible ? 'Collect $1,000' : st.id === 'slots' ? 'Pick a machine' : `Sit at ${st.name}`;
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
  // Signed out: the floor is open to look around, but sitting down asks you to sign in
  const locked = () => !!(casino.locked && casino.locked());
  function sit() {
    if (busy) return;
    if (locked()) { casino.ask(); return; }
    const k = Math.round(THREE.MathUtils.clamp(cam.s, 0, LAST));
    if (STATIONS[k].id === 'slots' && casino.pickSlot) { casino.pickSlot(); return; }   // pick a machine first
    busy = true;
    if (glide) { glide.kill(); glide = null; }
    buzz(10);
    map.classList.add('off');
    gsap.to(cam, { s: k, seat: 1, duration: calm ? 0.2 : 1.05, ease: 'power2.inOut', onComplete: () => { if (!dead) casino.sit(STATIONS[k].id); } });
  }
  // Straight to a station's seat from wherever you're standing (the casino's Tables list):
  // along the floor and down into the seat in one movement
  function jumpTo(id) {
    const k = STATIONS.findIndex(st => st.id === id);
    if (k < 0 || busy) return;
    if (locked()) { go(k); casino.ask(); return; }   // take them there to look, and ask them to sign in
    busy = true;
    if (glide) { glide.kill(); glide = null; }
    buzz(8);
    map.classList.add('off');
    const t = calm ? 0.2 : Math.min(2, 0.55 + Math.abs(k - cam.s) * 0.3);
    const down = calm ? 0.2 : 1.05;
    gsap.timeline({ onUpdate: changed, onComplete: () => { if (!dead) casino.sit(id); } })
      .to(cam, { s: k, duration: t, ease: 'power2.inOut' }, 0)
      .to(cam, { seat: 1, duration: down, ease: 'power2.inOut' }, Math.max(0, t - down * 0.5));
  }
  // The casino's arrows: from one seat, up along the floor and down into the next
  function hopCasino(from, to) {
    busy = true;
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
    map.classList.add('off');
    gsap.to(cam, { seat: 0, duration: calm ? 0.2 : 0.9, delay: 0.1, ease: 'power2.inOut', onComplete: () => {
      busy = false;
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
  // Bold chevrons (the ‹ › characters were thin and hard to see over the room)
  const chevron = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const prevBtn = button('', () => go(Math.round(cam.s) - 1), 'fl-arrow');
  const nextBtn = button('', () => go(Math.round(cam.s) + 1), 'fl-arrow');
  prevBtn.innerHTML = chevron('M15 5l-7 7 7 7');
  nextBtn.innerHTML = chevron('M9 5l7 7-7 7');
  prevBtn.setAttribute('aria-label', 'Previous station');
  nextBtn.setAttribute('aria-label', 'Next station');
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
    if (duck) duck.position.y = DUCK_Y + Math.sin(now * 2.2) * 0.01;
    kit.led.color.setHSL((now * 0.06) % 1, 0.85, 0.62);   // the slot machines' LED trim drifts through the colours
    if (dropDuck) dropAt(now * 0.45);
    if (rocketGlow) rocketGlow.intensity = 0.5 + Math.sin(now * 3) * 0.2;
    if (tickTex) tickTex.offset.x = (tickTex.offset.x + dt * 0.35 * tickTex.repeat.x / (TICK.len)) % 1;
    // Today's bonus waiting at the cashier: a gold coin spinning in the window
    const owed = !!(casino.bonusReady && casino.bonusReady());
    if (bonusCoin.visible !== owed) { bonusCoin.visible = owed; here = -1; changed(); }
    const lockNow = locked();
    if (lockNow !== wasLocked) { wasLocked = lockNow; here = -1; changed(); }   // signed in or out
    if (owed) { bonusCoin.rotation.y = now * 2.4; bonusCoin.position.y = 1.5 + Math.sin(now * 2) * 0.03; }
    const standing = cam.seat < 0.5;
    if (posts[0].visible !== standing) { for (const p of posts) p.visible = standing; signLights.visible = standing; }
    const step = Math.floor(now * 6) % 3;   // the bulbs chase: every third one dims in turn
    if (standing && step !== bulbStep) {
      bulbStep = step;
      for (let k = 0; k < signBulbs.length; k++) signLights.setColorAt(k, (k + step) % 3 === 0 ? bulbDim[k] : bulbOn[k]);
      signLights.instanceColor.needsUpdate = true;
    }
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
    jumpTo,
    setTicker,
    // The station you're standing at, by id
    at: () => STATIONS[Math.round(THREE.MathUtils.clamp(cam.s, 0, LAST))].id,
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      if (tickTex) tickTex.dispose();
      clearTimeout(wheelTimer);
      gsap.killTweensOf(cam);
      canvasEl.removeEventListener('pointerdown', onDown);
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
      canvasEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      map.remove();
      style.remove();
      disposeScene(scene);
      kit.dispose();
      for (const t of textures) t.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvasEl.remove();
    },
  };
}
