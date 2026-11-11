// 3D blackjack table: Three.js scene animated with GSAP.
//
// A felt table seen from the player's seat, with printed lettering, a padded rail,
// the dealer's chip tray and a shoe. Cards fly out of the shoe in an arc and flip
// as they land; chips drop onto the betting spot and stack. Sizes are real (meters).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import { button, buzz, makeRenderer, fitRenderer, disposeScene, fontReady } from './shared.js';

const FELT_Y = 0.03;
const CARD_W = 0.063, CARD_H = 0.088, CARD_T = 0.0006;
const CHIP_R = 0.0195, CHIP_T = 0.0034;
const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SYM = '"Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif';
const CHIPS = [{ v: 5, c: '#c8303c' }, { v: 25, c: '#2f6fd0' }, { v: 100, c: '#25272c' }, { v: 500, c: '#7a3fb8' }];
const BET_SPOT = new THREE.Vector3(0, FELT_Y, 0.3);
const SHOE_MOUTH = new THREE.Vector3(0.5, FELT_Y + 0.06, -0.24);
const DISCARD = new THREE.Vector3(-0.55, FELT_Y + 0.01, -0.3);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function tex(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Text bent along an arc, letters upright for the player (tops toward the dealer)
function arcText(g, text, cx, cy, r, font, color, spacing) {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map(ch => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = Math.PI / 2 + total / r / 2;
  for (let i = 0; i < text.length; i++) {
    const w = widths[i] / r;
    a -= w / 2;
    g.save();
    g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.rotate(a - Math.PI / 2);
    g.fillText(text[i], 0, 0);
    g.restore();
    a -= w / 2;
  }
  g.restore();
}

// Felt artwork. Canvas x spans the table's -1..1 m, y spans the dealer edge (top) to the player edge (bottom).
function feltTexture(renderer) {
  const W = 2048, H = 1024, k = 1024;   // pixels per meter
  const [c, g] = canvas(W, H);
  const grad = g.createRadialGradient(W / 2, H * 0.55, 50, W / 2, H * 0.55, W * 0.6);
  grad.addColorStop(0, '#157a4c');
  grad.addColorStop(0.55, '#0d5f3b');
  grad.addColorStop(1, '#073d26');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // felt nap: thousands of faint specks
  for (let i = 0; i < 60000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const cx = W / 2, cy = 0;   // the arcs share the dealer edge's center
  const gold = '#e9c46a';
  arcText(g, 'BLACKJACK PAYS 3 TO 2', cx, cy, 0.425 * k, '800 40px Manrope', gold, 7);
  g.strokeStyle = 'rgba(233,196,106,.7)';
  g.lineWidth = 3;
  for (const r of [0.315, 0.36]) { g.beginPath(); g.arc(cx, cy, r * k, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); }
  arcText(g, 'INSURANCE PAYS 2 TO 1', cx, cy, 0.3375 * k, '700 24px Manrope', 'rgba(245,240,227,.78)', 8);
  arcText(g, 'DEALER STANDS ON ALL 17s', cx, cy, 0.265 * k, '700 18px Manrope', 'rgba(245,240,227,.5)', 6);
  // the betting spot
  const bx = W / 2 + BET_SPOT.x * k, by = (0.45 + BET_SPOT.z) * k;
  g.strokeStyle = gold;
  g.lineWidth = 6;
  g.beginPath(); g.arc(bx, by, 0.052 * k, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(bx, by, 0.044 * k, 0, Math.PI * 2); g.stroke();
  const t = tex(c, renderer);
  t.repeat.set(0.5, 1);   // extrude UVs are in meters: x -1..1, y -0.55..0.45
  t.offset.set(0.5, 0.55);
  return t;
}

function faceTexture(rank, suit, renderer) {
  const W = 320, H = 448;
  const [c, g] = canvas(W, H);
  roundRect(g, 2, 2, W - 4, H - 4, 26);
  g.fillStyle = '#fbfaf5';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,.12)';
  g.stroke();
  const col = suit === 'H' || suit === 'D' ? '#c8202e' : '#15171c';
  const sym = SUITS[suit] + '︎';
  g.fillStyle = col;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const corner = () => {
    g.font = `800 ${rank === '10' ? 56 : 64}px Manrope, sans-serif`;
    g.fillText(rank, 48, 76);
    g.font = `48px ${SYM}`;
    g.fillText(sym, 48, 126);
  };
  corner();
  g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
  g.textBaseline = 'middle';
  if ('JQK'.includes(rank)) {
    roundRect(g, 78, 108, W - 156, H - 216, 14);
    g.lineWidth = 4;
    g.strokeStyle = col;
    g.stroke();
    g.fillStyle = col + '14';
    g.fill();
    g.fillStyle = col;
    g.font = '800 150px Manrope, sans-serif';
    g.fillText(rank, W / 2, H / 2 - 18);
    g.font = `70px ${SYM}`;
    g.fillText(sym, W / 2, H / 2 + 92);
  } else {
    g.font = `${rank === 'A' ? 210 : 150}px ${SYM}`;
    g.fillText(sym, W / 2, H / 2 + 6);
  }
  return tex(c, renderer);
}

function backTexture(renderer) {
  const W = 320, H = 448;
  const [c, g] = canvas(W, H);
  roundRect(g, 2, 2, W - 4, H - 4, 26);
  g.fillStyle = '#fbfaf5';
  g.fill();
  roundRect(g, 18, 18, W - 36, H - 36, 16);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#a3232f');
  grad.addColorStop(1, '#6d1019');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.lineWidth = 3;
  for (let i = -H; i < W + H; i += 22) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke();
    g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(233,196,106,.8)';
  g.lineWidth = 3;
  roundRect(g, 30, 30, W - 60, H - 60, 10);
  g.stroke();
  return tex(c, renderer);
}

function chipTextures(color, label, renderer) {
  const [s, gs] = canvas(512, 32);
  gs.fillStyle = color;
  gs.fillRect(0, 0, 512, 32);
  gs.fillStyle = '#f4efe2';
  for (let i = 0; i < 6; i++) gs.fillRect(i * 85 + 20, 0, 40, 32);
  const [t, g] = canvas(256, 256);
  g.translate(128, 128);
  g.fillStyle = color;
  g.beginPath(); g.arc(0, 0, 128, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f4efe2';
  g.lineWidth = 16;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(0, 0, 112, (i / 6) * Math.PI * 2 + 0.12, (i / 6) * Math.PI * 2 + 0.62); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.14)';
  g.beginPath(); g.arc(0, 0, 76, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)';
  g.lineWidth = 3;
  g.setLineDash([8, 7]);
  g.beginPath(); g.arc(0, 0, 76, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff';
  g.font = '800 70px Manrope, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 0, 4);
  return [tex(s, renderer), tex(t, renderer)];
}

const score = cards => {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = c.slice(0, -1);
    total += r === 'A' ? 1 : 'JQK'.includes(r) ? 10 : Number(r);
    if (r === 'A') aces++;
  }
  return aces && total + 10 <= 21 ? total + 10 : total;
};

export async function mount({ stage, controls, info }) {
  await fontReady();
  const { renderer, envTex } = makeRenderer(stage);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907);
  scene.environment = envTex;
  scene.environmentIntensity = 0.45;
  scene.fog = new THREE.Fog(0x0b0907, 2.2, 5);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 20);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.enablePan = false;
  orbit.minDistance = 0.4;
  orbit.maxDistance = 2.4;
  orbit.minPolarAngle = 0.3;
  orbit.maxPolarAngle = 1.3;
  orbit.minAzimuthAngle = -0.8;
  orbit.maxAzimuthAngle = 0.8;
  function seatView() {
    fitRenderer(renderer, camera, stage);
    const target = new THREE.Vector3(0, 0.03, 0.02);
    const dist = Math.max(0.8, 0.205 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.position.copy(target).add(new THREE.Vector3(0, 0.78, 0.68).normalize().multiplyScalar(dist));
    orbit.target.copy(target);
    orbit.update();
  }

  // ---- Light: a warm lamp over the table ----
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x140c06, 0.25));
  const lamp = new THREE.SpotLight(0xffe2b8, 4.6, 0, 0.72, 0.9, 2);
  lamp.position.set(0.1, 1.55, 0.25);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0002;
  lamp.shadow.normalBias = 0.003;
  lamp.shadow.radius = 5;
  scene.add(lamp, lamp.target);

  // ---- Table ----
  const textures = [];
  const keep = t => { textures.push(t); return t; };
  const shape = new THREE.Shape();
  shape.moveTo(-1, 0.45);
  shape.lineTo(1, 0.45);
  shape.absarc(0, 0.45, 1, 0, -Math.PI, true);
  const feltGeo = new THREE.ExtrudeGeometry(shape, { depth: FELT_Y, bevelEnabled: false, curveSegments: 96 });
  feltGeo.rotateX(-Math.PI / 2);
  const feltMat = new THREE.MeshStandardMaterial({ map: keep(feltTexture(renderer)), roughness: 0.95 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x2a170c, roughness: 0.6 });
  const felt = new THREE.Mesh(feltGeo, [feltMat, sideMat]);
  felt.receiveShadow = true;
  scene.add(felt);

  const leather = new THREE.MeshPhysicalMaterial({ color: 0x2b1810, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.045, 24, 180, Math.PI), leather);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(0, FELT_Y + 0.008, -0.45);
  rail.castShadow = rail.receiveShadow = true;
  scene.add(rail);
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x3b1f0e, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.05, 0.07), wood);
  edge.position.set(0, FELT_Y - 0.005, -0.485);
  scene.add(edge);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x120a06, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  scene.add(floor);

  // Chip tray along the dealer's edge: columns of chips lying in wooden slots
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.022, 0.075), wood);
  tray.position.set(0, FELT_Y + 0.006, -0.395);
  tray.receiveShadow = true;
  scene.add(tray);
  const chipMats = CHIPS.map(({ c, v }) => {
    const [side, top] = chipTextures(c, String(v), renderer);
    keep(side); keep(top);
    const sideMat2 = new THREE.MeshPhysicalMaterial({ map: side, roughness: 0.45, clearcoat: 0.4 });
    const topMat = new THREE.MeshPhysicalMaterial({ map: top, roughness: 0.45, clearcoat: 0.4 });
    return [sideMat2, topMat, topMat];
  });
  for (let i = 0; i < 8; i++) {
    const mats = chipMats[[3, 3, 2, 2, 1, 1, 0, 0][i]];
    const colGeo = new THREE.CylinderGeometry(CHIP_R * 0.92, CHIP_R * 0.92, 0.062, 40, 1);
    const sideTex = mats[0].map.clone();
    sideTex.wrapS = sideTex.wrapT = THREE.RepeatWrapping;
    sideTex.repeat.set(1, 18);   // eighteen chip edges along each column
    sideTex.needsUpdate = true;
    keep(sideTex);
    const column = new THREE.Mesh(colGeo, [new THREE.MeshPhysicalMaterial({ map: sideTex, roughness: 0.45, clearcoat: 0.4 }), mats[1], mats[2]]);
    column.rotation.x = Math.PI / 2;
    column.position.set(-0.19 + i * 0.054, FELT_Y + 0.02, -0.395);
    column.castShadow = true;
    scene.add(column);
  }

  // The shoe
  const shoe = new THREE.Group();
  const shoeBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.17), new THREE.MeshPhysicalMaterial({ color: 0x17171a, roughness: 0.3, clearcoat: 0.8 }));
  shoeBody.castShadow = true;
  shoe.add(shoeBody);
  shoe.position.set(0.56, FELT_Y + 0.038, -0.31);
  shoe.rotation.y = 0.45;
  scene.add(shoe);

  // ---- Cards and chips ----
  const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.6 });
  const backMat = new THREE.MeshPhysicalMaterial({ map: keep(backTexture(renderer)), roughness: 0.45, clearcoat: 0.3, alphaTest: 0.5 });
  shoeBody.material = [shoeBody.material, shoeBody.material, backMat, shoeBody.material, shoeBody.material, shoeBody.material];
  const faceMats = new Map();
  function cardMesh(code) {
    let face = faceMats.get(code);
    if (!face) {
      face = new THREE.MeshPhysicalMaterial({ map: keep(faceTexture(code.slice(0, -1), code.slice(-1), renderer)), roughness: 0.45, clearcoat: 0.3, alphaTest: 0.5 });
      faceMats.set(code, face);
    }
    const m = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, face, backMat, edgeMat, edgeMat]);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 48);

  let deck = [];
  const shuffle = () => {
    deck = [];
    for (const s of 'SHDC') for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) deck.push(r + s);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  };
  shuffle();
  const live = { player: [], dealer: [], chips: [], hole: null, revealed: false };
  const objects = [];

  function fly(mesh, to, { faceUp = true, yaw = 0, delay = 0, lift = 0.07 } = {}) {
    scene.add(mesh);
    objects.push(mesh);
    const tl = gsap.timeline({ delay });
    tl.to(mesh.position, { x: to.x, z: to.z, duration: 0.55, ease: 'power3.out' }, 0)
      .to(mesh.position, { y: to.y + lift, duration: 0.22, ease: 'sine.out' }, 0)
      .to(mesh.position, { y: to.y, duration: 0.33, ease: 'power2.in' }, 0.22)
      .to(mesh.rotation, { y: yaw, z: faceUp ? 0 : Math.PI, duration: 0.5, ease: 'power2.inOut' }, 0.02);
    return tl;
  }

  function deal(toDealer, faceUp, delay) {
    if (deck.length < 10) shuffle();
    const code = deck.pop();
    const m = cardMesh(code);
    m.position.copy(SHOE_MOUTH);
    m.rotation.set(0, 0.45, Math.PI);
    const list = toDealer ? live.dealer : live.player;
    const i = list.length;
    const to = toDealer
      ? new THREE.Vector3(-0.04 + i * 0.072, FELT_Y + CARD_T / 2, -0.285)
      : new THREE.Vector3(-0.02 + i * 0.026, FELT_Y + CARD_T / 2 + i * 0.0008, 0.15 - i * 0.012);
    list.push({ code, mesh: m });
    fly(m, to, { faceUp, yaw: gsap.utils.random(-0.06, 0.06), delay });
    setTimeout(() => buzz(5), delay * 1000 + 450);
    return list[i];
  }

  function bet() {
    const n = live.chips.length;
    if (n >= 14) return;
    const kind = CHIPS[Math.min(3, Math.floor(n / 4))];
    const m = new THREE.Mesh(chipGeo, chipMats[CHIPS.indexOf(kind)]);
    m.castShadow = m.receiveShadow = true;
    m.position.set(0.05, 0.32, 0.72);
    m.rotation.set(gsap.utils.random(-0.6, 0.6), gsap.utils.random(0, 6), gsap.utils.random(-0.6, 0.6));
    live.chips.push(m);
    const to = new THREE.Vector3(BET_SPOT.x + gsap.utils.random(-0.0015, 0.0015), FELT_Y + CHIP_T / 2 + n * CHIP_T, BET_SPOT.z + gsap.utils.random(-0.0015, 0.0015));
    scene.add(m);
    objects.push(m);
    gsap.timeline()
      .to(m.position, { x: to.x, z: to.z, duration: 0.42, ease: 'power2.out' }, 0)
      .to(m.position, { y: to.y + 0.05, duration: 0.18, ease: 'sine.out' }, 0)
      .to(m.position, { y: to.y, duration: 0.3, ease: 'bounce.out' }, 0.18)
      .to(m.rotation, { x: 0, z: 0, y: '+=' + gsap.utils.random(1, 3), duration: 0.42, ease: 'power2.out' }, 0);
    setTimeout(() => buzz(8), 420);
    status();
  }

  function dealHand() {
    if (live.player.length) return;
    if (!live.chips.length) bet();
    deal(false, true, 0.05);
    deal(true, true, 0.3);
    deal(false, true, 0.55);
    live.hole = deal(true, false, 0.8);
    live.revealed = false;
    setTimeout(status, 1300);
  }
  function hit() {
    if (!live.player.length || live.revealed || score(live.player.map(c => c.code)) >= 21) return;
    deal(false, true, 0);
    setTimeout(status, 600);
  }
  function reveal() {
    if (!live.hole || live.revealed) return;
    live.revealed = true;
    const m = live.hole.mesh;
    gsap.timeline()
      .to(m.position, { y: FELT_Y + 0.05, duration: 0.25, ease: 'power2.out' })
      .to(m.rotation, { z: 0, duration: 0.45, ease: 'power2.inOut' }, 0.05)
      .to(m.position, { y: FELT_Y + CARD_T / 2, duration: 0.3, ease: 'power2.in' }, 0.3);
    // the dealer draws to 17
    let delay = 0.9;
    const codes = () => live.dealer.map(c => c.code);
    const draw = () => {
      if (score(codes()) < 17 && score(live.player.map(c => c.code)) <= 21) {
        deal(true, true, 0);
        delay = 0.6;
        setTimeout(draw, delay * 1000);
      } else setTimeout(status, 500);
    };
    setTimeout(draw, delay * 1000);
  }
  function clearTable() {
    const all = [...live.player, ...live.dealer].map(c => c.mesh);
    all.forEach((m, i) => {
      gsap.to(m.position, { x: DISCARD.x, y: DISCARD.y + i * 0.001, z: DISCARD.z, duration: 0.5, delay: i * 0.05, ease: 'power2.inOut' });
      gsap.to(m.rotation, { y: 0.3, z: Math.PI, duration: 0.5, delay: i * 0.05, onComplete: () => scene.remove(m) });
    });
    live.chips.forEach((m, i) => {
      gsap.to(m.position, { x: 0, y: FELT_Y + 0.02, z: -0.39, duration: 0.5, delay: 0.2 + i * 0.03, ease: 'power2.in', onComplete: () => scene.remove(m) });
    });
    live.player = [];
    live.dealer = [];
    live.chips = [];
    live.hole = null;
    live.revealed = false;
    status();
  }

  function status() {
    const p = live.player.map(c => c.code);
    const shown = live.dealer.filter(c => c !== live.hole || live.revealed).map(c => c.code);
    const betAmt = live.chips.reduce((a, m) => a + CHIPS[chipMats.indexOf(m.material)].v, 0);
    if (!p.length) info.textContent = betAmt ? `Bet $${betAmt} · tap Deal` : 'Tap Bet to drop chips, then Deal';
    else {
      const ps = score(p), ds = score(shown);
      let line = `You ${ps > 21 ? 'bust ' + ps : ps}  ·  Dealer ${shown.length ? ds : '–'}`;
      if (live.revealed) line += ps > 21 ? ' · you lose' : ds > 21 || ps > ds ? ' · you win!' : ps === ds ? ' · push' : ' · dealer wins';
      info.textContent = line;
    }
    dealBtn.disabled = !!p.length;
    hitBtn.disabled = !p.length || live.revealed || score(p) >= 21;
    revealBtn.disabled = !p.length || live.revealed;
  }

  const betBtn = button('Bet', bet);
  const dealBtn = button('Deal', dealHand, 'primary');
  const hitBtn = button('Hit', hit);
  const revealBtn = button('Reveal', reveal);
  const clearBtn = button('Clear', clearTable);
  const viewBtn = button('View', seatView);
  controls.append(betBtn, dealBtn, hitBtn, revealBtn, clearBtn, viewBtn);
  status();

  // ---- Loop ----
  seatView();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (fitRenderer(renderer, camera, stage)) orbit.update();
    orbit.update();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      for (const o of objects) { gsap.killTweensOf(o.position); gsap.killTweensOf(o.rotation); }
      orbit.dispose();
      disposeScene(scene);
      for (const t of textures) t.dispose();
      cardGeo.dispose();
      chipGeo.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
