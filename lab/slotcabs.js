// Slot machines for the casino floor: two cabinet shapes, a modern video slot and a classic
// lever machine, each dressed in one of several themes. The shapes follow real cabinets
// (plinth, belly glass, slanted button deck, framed screen, topper, LED trim, a chair) while
// the colours and artwork stay cartoonish.
//
// Every part's colour is written into its geometry, so all the paint, chrome and trim share a
// handful of materials, and each theme's artwork (topper, screen, reel strip, belly glass) is
// one canvas. bake() then merges a whole row of machines into a few meshes: one draw per
// material, however many machines there are.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EMOJI, canvas } from './arcade.js';

export const SLOT_THEMES = [
  { id: 'duck', name: 'LUCKY DUCK', tag: '3000', body: 0xc8102e, seat: 0x5a0c16, glow: '#ffd23f', bg: ['#3a0610', '#8a1424'], sym: ['🦆', '🍒', '🔔', '7'] },
  { id: 'cherry', name: 'CHERRY BOMB', tag: 'HOT REELS', body: 0xd8326a, seat: 0x4a0a22, glow: '#ff6bb5', bg: ['#3a0620', '#a0154a'], sym: ['🍒', '💣', '🍋', '⭐'] },
  { id: 'diamond', name: 'DIAMOND DAZZLE', tag: 'MEGA JACKPOT', body: 0x1d5fd1, seat: 0x0c1f4a, glow: '#6be7ff', bg: ['#06163a', '#1d3f8a'], sym: ['💎', '💍', '👑', '⭐'] },
  { id: 'gold', name: 'GOLD RUSH', tag: 'BONANZA', body: 0xd97a1a, seat: 0x4a2408, glow: '#ffb43d', bg: ['#2a1404', '#7a3e0a'], sym: ['💰', '⛏️', '🪙', '🌵'] },
  { id: 'sevens', name: 'LUCKY 7s', tag: 'TRIPLE PAY', body: 0x2a3aa8, seat: 0x10163a, glow: '#ff3d6e', bg: ['#080c2a', '#1a2a8a'], sym: ['7', '🍒', '🔔', '⭐'] },
  { id: 'dragon', name: 'DRAGON FORTUNE', tag: '88 WAYS', body: 0x0f7a45, seat: 0x06301a, glow: '#7cff6b', bg: ['#04200f', '#0f6a3a'], sym: ['🐉', '🏮', '🧧', '💎'] },
  { id: 'cosmic', name: 'COSMIC CASH', tag: 'TO THE MOON', body: 0x6a1a8a, seat: 0x2a0a3a, glow: '#c9a2ff', bg: ['#12042a', '#4a128a'], sym: ['🚀', '🪐', '👽', '⭐'] },
  { id: 'mermaid', name: 'MERMAID TREASURE', tag: 'DEEP SEA WINS', body: 0x0f8a8a, seat: 0x06343a, glow: '#5ee0e0', bg: ['#03202a', '#0a5a6a'], sym: ['🧜‍♀️', '🐚', '🐠', '💎'] },
  { id: 'fruit', name: 'FRUIT FRENZY', tag: 'CLASSIC', body: 0x3aa02a, seat: 0x123a0c, glow: '#d6ff3d', bg: ['#0c2a06', '#2a7a1a'], sym: ['🍉', '🍋', '🍇', '🍒'] },
  { id: 'buffalo', name: 'THUNDER BUFFALO', tag: 'STAMPEDE', body: 0x8a4a1a, seat: 0x3a1c08, glow: '#ff8a3d', bg: ['#1a0c04', '#5a2e10'], sym: ['🦬', '⚡', '🌵', '🦅'] },
];

// Where each piece of a theme's artwork sits on its 512 × 512 canvas: [x, y, w, h] in pixels
const ART = 512;
const CELL = { topper: [0, 0, 512, 128], screen: [0, 128, 384, 256], reels: [384, 128, 128, 384], belly: [0, 384, 384, 128] };

export function slotKit({ texture }) {
  // The finishes. Colours come from each part's vertices, so one material serves every theme.
  const FIN = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15 }),
    chrome: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 1 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }),
    leather: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),   // the trim strips: the floor cycles its colour
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false }),
  };
  const C = { chrome: 0xe8e8ee, dark: 0x16131c, black: 0x0a090d, white: 0xffffff, gold: 0xe9b949 };
  const artMats = new Map();

  // ---- Building blocks ----
  function part(geo, fin, color, x = 0, y = 0, z = 0) {
    const n = geo.attributes.position.count;
    const col = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.Mesh(geo, FIN[fin]);
    m.position.set(x, y, z);
    return m;
  }
  const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.99);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // Squeeze a geometry's uvs into one cell of the theme's canvas (swap: the reels run around the drum)
  function toCell(geo, cell, swap = false) {
    const [x, y, w, h] = CELL[cell];
    const u0 = x / ART, u1 = (x + w) / ART, vT = 1 - y / ART, vB = 1 - (y + h) / ART;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      let u = uv.getX(i), v = uv.getY(i);
      if (swap) [u, v] = [v, 1 - u];
      uv.setXY(i, u0 + u * (u1 - u0), vB + v * (vT - vB));
    }
    return geo;
  }
  function art(theme, geo, cell, x, y, z, swap) {
    toCell(geo, cell, swap);
    const m = new THREE.Mesh(geo, artMat(theme));
    m.position.set(x, y, z);
    return m;
  }

  // ---- Artwork: one canvas per theme ----
  function artMat(theme) {
    if (artMats.has(theme.id)) return artMats.get(theme.id);
    const [cv, g] = canvas(ART, ART);
    drawTopper(g, theme);
    drawScreen(g, theme);
    drawReels(g, theme);
    drawBelly(g, theme);
    const mat = new THREE.MeshBasicMaterial({ map: texture(cv), toneMapped: false });
    artMats.set(theme.id, mat);
    return mat;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }
  // A reel symbol: an emoji, or a fat red 7 like real reels have
  function sym(g, s, x, y, size) {
    g.fillStyle = '#000';   // colour emoji take their opacity from the fill
    if (s === '7') {
      g.font = `900 ${Math.floor(size * 1.1)}px Manrope, sans-serif`;
      g.lineWidth = size * 0.1;
      g.strokeStyle = '#7a0010';
      g.strokeText('7', x, y + size * 0.04);
      g.fillStyle = '#e8102e';
      g.fillText('7', x, y + size * 0.04);
      g.font = `${size}px ${EMOJI}`;
      return;
    }
    g.font = `${size}px ${EMOJI}`;
    g.fillText(s, x, y);
  }
  function fitFont(g, text, weight, size, maxW) {
    g.font = `${weight} ${size}px Manrope, sans-serif`;
    const k = Math.min(1, maxW / g.measureText(text).width);
    g.font = `${weight} ${Math.floor(size * k)}px Manrope, sans-serif`;
  }
  function bgGrad(g, theme, x, y, w, h) {
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, theme.bg[1]);
    grad.addColorStop(1, theme.bg[0]);
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }
  function drawTopper(g, theme) {
    const [x, y, w, h] = CELL.topper;
    bgGrad(g, theme, x, y, w, h);
    // sunburst rays behind the name
    g.save();
    g.translate(x + w / 2, y + h * 0.9);
    g.fillStyle = 'rgba(255, 255, 255, .07)';
    for (let i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(-30, -400); g.lineTo(30, -400); g.fill(); }
    g.restore();
    g.strokeStyle = theme.glow;
    g.lineWidth = 6;
    rr(g, x + 5, y + 5, w - 10, h - 10, 18);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    sym(g, theme.sym[0], x + 46, y + h / 2 + 2, 52);
    sym(g, theme.sym[0], x + w - 46, y + h / 2 + 2, 52);
    fitFont(g, theme.name, 900, 54, w - 180);
    g.lineJoin = 'round';
    g.lineWidth = 10;
    g.strokeStyle = '#1a0a04';
    g.strokeText(theme.name, x + w / 2, y + 52);
    g.shadowColor = theme.glow;
    g.shadowBlur = 16;
    g.fillStyle = '#fff6dc';
    g.fillText(theme.name, x + w / 2, y + 52);
    g.shadowBlur = 0;
    fitFont(g, theme.tag, 800, 26, w - 200);
    g.fillStyle = theme.glow;
    g.fillText(theme.tag, x + w / 2, y + 96);
  }
  function drawScreen(g, theme) {
    const [x, y, w, h] = CELL.screen;
    bgGrad(g, theme, x, y, w, h);
    // jackpot meter along the top
    g.fillStyle = 'rgba(0, 0, 0, .55)';
    rr(g, x + 40, y + 10, w - 80, 40, 10);
    g.fill();
    g.font = '900 26px Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f';
    g.shadowColor = '#ff8a1f';
    g.shadowBlur = 10;
    const pot = 10000 + ((theme.id.length * 7919) % 90000);
    g.fillText(`JACKPOT $${pot.toLocaleString('en-US')}.00`, x + w / 2, y + 31);
    g.shadowBlur = 0;
    // a 5 × 3 grid of reels
    const cols = 5, rows = 3, gx = x + 14, gy = y + 60, cw = (w - 28) / cols, ch = (h - 74) / rows;
    for (let c = 0; c < cols; c++) {
      g.fillStyle = 'rgba(255, 255, 255, .92)';
      rr(g, gx + c * cw + 3, gy, cw - 6, ch * rows, 10);
      g.fill();
      for (let r = 0; r < rows; r++) {
        sym(g, theme.sym[(c * 2 + r * 3 + theme.id.length) % theme.sym.length], gx + c * cw + cw / 2, gy + r * ch + ch / 2 + 3, Math.floor(ch * 0.62));
      }
    }
    // a winning line across the middle
    g.strokeStyle = theme.glow;
    g.lineWidth = 5;
    g.shadowColor = theme.glow;
    g.shadowBlur = 12;
    g.beginPath();
    g.moveTo(gx, gy + ch * 1.5);
    g.lineTo(gx + cw * cols, gy + ch * 1.5);
    g.stroke();
    g.shadowBlur = 0;
  }
  function drawReels(g, theme) {
    const [x, y, w, h] = CELL.reels;
    const n = 4, sh = h / n;
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#cfc8b8');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#cfc8b8');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      g.save();
      g.translate(x + w / 2, y + i * sh + sh / 2);
      g.rotate(Math.PI);   // the drum wraps the strip upside down, so it's drawn that way here
      sym(g, theme.sym[i % theme.sym.length], 0, 4, Math.floor(sh * 0.78));
      g.restore();
      g.fillStyle = 'rgba(0, 0, 0, .12)';
      g.fillRect(x, y + i * sh, w, 2);
    }
  }
  function drawBelly(g, theme) {
    const [x, y, w, h] = CELL.belly;
    bgGrad(g, theme, x, y, w, h);
    g.strokeStyle = theme.glow;
    g.lineWidth = 4;
    rr(g, x + 6, y + 6, w - 12, h - 12, 14);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, theme.name, 900, 40, w - 60);
    g.fillStyle = '#fff6dc';
    g.fillText(theme.name, x + w / 2, y + 50);
    g.font = '800 20px Manrope, sans-serif';
    g.fillStyle = theme.glow;
    g.fillText('PLAY MAX BET  ✦  WIN BIG', x + w / 2, y + 90);
  }

  // ---- Seats ----
  function slotChair(theme, z) {
    const g = new THREE.Group();
    const seat = part(rbox(0.44, 0.11, 0.42, 0.05), 'leather', theme.seat, 0, 0.62, 0);
    const back = part(rbox(0.42, 0.3, 0.09, 0.04), 'leather', theme.seat, 0, 0.84, 0.2);
    back.rotation.x = 0.12;
    const piping = part(box(0.36, 0.025, 0.005), 'glow', new THREE.Color(theme.glow).getHex(), 0, 0.95, 0.248);
    piping.rotation.x = 0.12;
    const pole = part(new THREE.CylinderGeometry(0.035, 0.035, 0.52, 10), 'chrome', C.chrome, 0, 0.31, 0);
    const foot = part(new THREE.CylinderGeometry(0.2, 0.24, 0.04, 24), 'chrome', C.chrome, 0, 0.02, 0);
    g.add(seat, back, piping, pole, foot);
    g.position.z = z;
    return g;
  }
  function stool(theme, z) {
    const g = new THREE.Group();
    g.add(
      part(new THREE.CylinderGeometry(0.17, 0.16, 0.08, 20), 'leather', theme.seat, 0, 0.68, 0),
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.64, 8), 'chrome', C.chrome, 0, 0.33, 0),
      part(new THREE.CylinderGeometry(0.19, 0.21, 0.03, 20), 'chrome', C.chrome, 0, 0.015, 0),
    );
    g.position.z = z;
    return g;
  }

  // ---- A modern video slot: plinth, belly panel, slanted deck, big screen, topper, LED edges ----
  function modern(theme, { topper = 'box', chair = true } = {}) {
    const g = new THREE.Group();
    const W = 0.68, glow = new THREE.Color(theme.glow).getHex();
    g.add(part(box(W - 0.06, 0.1, 0.5), 'dark', C.black, 0, 0.05, -0.02));            // toe kick
    g.add(part(rbox(W, 0.74, 0.58, 0.035), 'paint', theme.body, 0, 0.47, 0));         // lower cabinet
    g.add(art(theme, new THREE.PlaneGeometry(0.56, 0.187), 'belly', 0, 0.5, 0.292));   // belly glass
    g.add(part(box(0.58, 0.012, 0.01), 'glow', glow, 0, 0.62, 0.292));
    // the button deck, tilted toward the player
    const deck = new THREE.Group();
    deck.position.set(0, 0.875, 0.15);
    deck.rotation.x = 0.16;
    deck.add(part(rbox(W + 0.02, 0.06, 0.32, 0.025), 'dark', C.dark, 0, 0, 0));
    const btn = [0xffffff, glow, 0xffd23f, glow, 0xffffff];
    for (let i = 0; i < 5; i++) deck.add(part(box(0.065, 0.016, 0.04), 'glow', btn[i], -0.25 + i * 0.085, 0.034, 0.07));
    deck.add(part(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 18), 'glow', 0xff3d3d, 0.24, 0.036, 0.07));   // spin
    deck.add(part(box(0.12, 0.03, 0.07), 'dark', C.black, 0.2, 0.035, -0.08));       // bill slot
    deck.add(part(box(0.1, 0.006, 0.004), 'glow', 0x7cff6b, 0.2, 0.05, -0.044));
    g.add(deck);
    // the screen housing and its screen, leaning back a touch
    g.add(part(rbox(W, 0.74, 0.44, 0.035), 'paint', theme.body, 0, 1.27, -0.07));
    const scr = new THREE.Group();
    scr.position.set(0, 1.27, 0.152);
    scr.rotation.x = -0.08;
    scr.add(part(rbox(W - 0.05, 0.5, 0.03, 0.012), 'dark', C.black, 0, 0, 0));
    scr.add(art(theme, new THREE.PlaneGeometry(0.58, 0.387), 'screen', 0, 0, 0.017));
    g.add(scr);
    // speaker grilles under the screen
    for (const sx of [-0.2, 0.2]) g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16).rotateX(Math.PI / 2), 'dark', C.black, sx, 0.97, 0.152));
    // LED strips up both front edges
    for (const s of [-1, 1]) {
      g.add(part(box(0.022, 0.72, 0.022), 'led', C.white, s * (W / 2 + 0.004), 0.47, 0.285));
      g.add(part(box(0.022, 0.72, 0.022), 'led', C.white, s * (W / 2 + 0.004), 1.27, 0.145));
    }
    // the topper
    if (topper === 'arch') {
      const arch = part(new THREE.CylinderGeometry(W / 2, W / 2, 0.34, 32, 1, false, -Math.PI / 2, Math.PI), 'paint', theme.body, 0, 1.64, -0.07);
      arch.rotation.x = Math.PI / 2;
      arch.scale.set(1, 1, 0.7);
      g.add(arch);
      const ring = part(new THREE.TorusGeometry(W / 2, 0.012, 6, 32, Math.PI), 'glow', glow, 0, 1.64, 0.1);
      ring.scale.set(1, 0.7, 1);
      g.add(ring);
      g.add(art(theme, new THREE.PlaneGeometry(0.6, 0.15), 'topper', 0, 1.72, 0.105));
    } else {
      g.add(part(rbox(W, 0.36, 0.36, 0.04), 'paint', theme.body, 0, 1.82, -0.06));
      g.add(part(rbox(W - 0.04, 0.2, 0.02, 0.01), 'dark', C.black, 0, 1.82, 0.12));
      g.add(art(theme, new THREE.PlaneGeometry(0.62, 0.155), 'topper', 0, 1.82, 0.132));
      g.add(part(box(W + 0.01, 0.02, 0.37), 'chrome', C.chrome, 0, 2.0, -0.06));
    }
    if (chair) g.add(slotChair(theme, 0.78));
    return g;
  }

  // ---- A classic machine: arched head, three real reel drums behind glass, a pull lever ----
  function classic(theme, { chair = 'stool', bulbs = null } = {}) {
    const g = new THREE.Group();
    const W = 0.62, glow = new THREE.Color(theme.glow).getHex();
    g.add(part(rbox(W, 0.8, 0.5, 0.04), 'paint', theme.body, 0, 0.42, 0));
    g.add(part(box(W + 0.012, 0.06, 0.512), 'chrome', C.chrome, 0, 0.03, 0));       // kick plate
    g.add(art(theme, new THREE.PlaneGeometry(0.48, 0.16), 'belly', 0, 0.6, 0.252));
    // the coin tray
    g.add(part(rbox(0.42, 0.1, 0.13, 0.02), 'chrome', C.chrome, 0, 0.28, 0.29));
    g.add(part(box(0.36, 0.05, 0.1), 'dark', C.black, 0, 0.31, 0.3));
    // the ledge with three buttons
    g.add(part(rbox(W + 0.05, 0.05, 0.22, 0.02), 'chrome', C.chrome, 0, 0.845, 0.1));
    [0xffffff, glow, 0xff3d3d].forEach((c, i) => g.add(part(box(0.07, 0.016, 0.045), 'glow', c, -0.12 + i * 0.12, 0.876, 0.15)));
    // the head: a block with an arched top
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, 0);
    sh.lineTo(W / 2, 0);
    sh.lineTo(W / 2, 0.6);
    sh.absellipse(0, 0.6, W / 2, 0.2, 0, Math.PI, false);
    sh.lineTo(-W / 2, 0);
    const RY = 1.2, RW = 0.48, RH = 0.24, FZ = 0.205, HY = 0.87;
    const hole = new THREE.Path();   // the reel window, cut through the head
    hole.moveTo(-RW / 2, RY - HY - RH / 2);
    hole.lineTo(-RW / 2, RY - HY + RH / 2);
    hole.lineTo(RW / 2, RY - HY + RH / 2);
    hole.lineTo(RW / 2, RY - HY - RH / 2);
    hole.lineTo(-RW / 2, RY - HY - RH / 2);
    sh.holes.push(hole);
    const head = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 20 });
    head.translate(0, 0, -0.2);
    g.add(part(head, 'paint', theme.body, 0, HY, -0.01));
    // the reel window: three drums behind glass, in a chrome frame, dark behind them
    g.add(part(box(RW, RH, 0.02), 'dark', C.black, 0, RY, -0.06));
    for (let i = 0; i < 3; i++) {
      const drum = art(theme, new THREE.CylinderGeometry(0.12, 0.12, 0.135, 28, 1, true), 'reels', -0.155 + i * 0.155, RY, FZ - 0.115, true);
      drum.rotation.z = Math.PI / 2;
      drum.rotation.x = i * 1.9 + theme.id.length;   // each drum stopped on a different symbol
      g.add(drum);
    }
    const fw = 0.022;
    g.add(part(box(RW + fw * 2, fw, 0.03), 'chrome', C.chrome, 0, RY + RH / 2 + fw / 2, FZ));
    g.add(part(box(RW + fw * 2, fw, 0.03), 'chrome', C.chrome, 0, RY - RH / 2 - fw / 2, FZ));
    g.add(part(box(fw, RH, 0.03), 'chrome', C.chrome, -RW / 2 - fw / 2, RY, FZ));
    g.add(part(box(fw, RH, 0.03), 'chrome', C.chrome, RW / 2 + fw / 2, RY, FZ));
    g.add(part(box(0.012, RH, 0.03), 'chrome', C.chrome, -0.078, RY, FZ - 0.004));
    g.add(part(box(0.012, RH, 0.03), 'chrome', C.chrome, 0.078, RY, FZ - 0.004));
    g.add(part(box(RW, 0.008, 0.004), 'glow', 0xff2a3d, 0, RY, FZ + 0.012));          // the pay line
    g.add(part(new THREE.PlaneGeometry(RW, RH), 'glass', C.white, 0, RY, FZ + 0.016));
    // the marquee in the arch
    g.add(art(theme, new THREE.PlaneGeometry(0.5, 0.125), 'topper', 0, 1.5, 0.209));
    g.add(part(box(W - 0.04, 0.02, 0.02), 'chrome', C.chrome, 0, 1.42, 0.205));
    // the lever on the right
    g.add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 20).rotateZ(Math.PI / 2), 'chrome', C.chrome, W / 2 + 0.045, 1.0, 0.02));
    const rod = part(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 10), 'chrome', C.chrome, W / 2 + 0.085, 1.24, 0.02);
    rod.rotation.z = -0.06;
    g.add(rod);
    g.add(part(new THREE.SphereGeometry(0.05, 20, 14), 'paint', 0xe8102e, W / 2 + 0.1, 1.5, 0.02));
    // bulbs round the arch: lit ones are glow; the playable machine chases its own
    const geo = new THREE.SphereGeometry(0.016, 8, 6);
    const N = 13;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI;
      const pos = [Math.cos(a) * (W / 2 + 0.005), 1.47 + Math.sin(a) * 0.205, 0.2];
      if (bulbs) bulbs(geo, pos, i, g);
      else g.add(part(geo.clone(), 'glow', i % 2 ? 0xffe7a0 : glow, ...pos));
    }
    if (chair === 'stool') g.add(stool(theme, 0.62));
    else if (chair) g.add(slotChair(theme, 0.74));
    return g;
  }

  // ---- Merge a group of machines into one mesh per material ----
  function bake(root) {
    root.updateMatrixWorld(true);
    const byMat = new Map();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(o);
    });
    const out = new THREE.Group();
    for (const [mat, meshes] of byMat) {
      const geos = meshes.map(m => {
        const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(src.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) src.deleteAttribute(k);
        if (!mat.vertexColors) src.deleteAttribute('color');
        src.applyMatrix4(m.matrixWorld);
        return src;
      });
      const merged = mergeGeometries(geos);
      geos.forEach(x => x.dispose());
      meshes.forEach(m => m.geometry.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mat !== FIN.glass && mat !== FIN.glow && mat !== FIN.led;
      mesh.receiveShadow = true;
      out.add(mesh);
    }
    return out;
  }

  function dispose() {
    for (const m of Object.values(FIN)) m.dispose();
    for (const m of artMats.values()) { m.map && m.map.dispose(); m.dispose(); }
  }

  return { modern, classic, bake, dispose, led: FIN.led, themes: SLOT_THEMES, part, rbox, box };
}
