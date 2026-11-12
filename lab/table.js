// 3D blackjack table: Three.js scene animated with GSAP.
//
// A felt table seen from the player's seat, with printed lettering, a padded rail,
// the dealer's chip tray and a shoe. Cards fly out of the shoe in an arc and flip
// as they land; chips drop onto the betting spot and stack. Sizes are real (meters).

import * as THREE from 'three';
import { gsap } from 'gsap';
import { buzz, makeRenderer, fitRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';

const FELT_Y = 0.03;
const CARD_W = 0.063, CARD_H = 0.088, CARD_T = 0.0006;
const CHIP_R = 0.0195, CHIP_T = 0.0034;
const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SYM = '"Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif';
const CHIPS = [{ v: 5, c: '#c8303c' }, { v: 25, c: '#2f6fd0' }, { v: 100, c: '#25272c' }, { v: 500, c: '#7a3fb8' }, { v: 1000, c: '#d9822b' }];
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
  // felt nap: faint specks, drawn once on a small tile and repeated across the felt
  const [nc, ng] = canvas(256, 256);
  for (let i = 0; i < 2000; i++) {
    ng.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
    ng.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = g.createPattern(nc, 'repeat');
  g.fillRect(0, 0, W, H);
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

/* The table's scene: felt, rail, tray, shoe, lamp, and makers for cards and chips, shared by
   the lab demo and the casino's solo table. opts go to makeRenderer; shadow is the shadow
   map's size. */
function buildTable(stage, opts = {}) {
  const { renderer, envTex } = makeRenderer(stage, opts);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907);
  scene.environment = envTex;
  scene.environmentIntensity = 0.45;
  scene.fog = new THREE.Fog(0x0b0907, 2.2, 5);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 20);
  /* From the player's seat: halfW is how much of the table's width (each side of the middle)
     must fit, and halfD how much of its depth; target is the point in the middle of the view. */
  function seatView({ halfW = 0.205, halfD = 0, target = new THREE.Vector3(0, 0.03, 0.02), dir = new THREE.Vector3(0, 0.78, 0.68), min = 0.8 } = {}) {
    fitRenderer(renderer, camera, stage);
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(min, halfW / (t * camera.aspect), halfD / t);
    camera.position.copy(target).add(dir.clone().normalize().multiplyScalar(dist));
    camera.lookAt(target);
    return target;
  }

  // ---- Light: a warm lamp over the table ----
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x140c06, 0.25));
  const lamp = new THREE.SpotLight(0xffe2b8, 4.6, 0, 0.72, 0.9, 2);
  lamp.position.set(0.1, 1.55, 0.25);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(opts.shadow || 2048, opts.shadow || 2048);
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
  // A card's face; one the player can't know yet (not a real code, like '??') is all back
  function faceFor(code) {
    if (!/^(10|[2-9AJQK])[SHDC]$/.test(code || '')) return backMat;
    let face = faceMats.get(code);
    if (!face) {
      face = new THREE.MeshPhysicalMaterial({ map: keep(faceTexture(code.slice(0, -1), code.slice(-1), renderer)), roughness: 0.45, clearcoat: 0.3, alphaTest: 0.5 });
      faceMats.set(code, face);
    }
    return face;
  }
  function cardMesh(code) {
    const m = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, faceFor(code), backMat, edgeMat, edgeMat]);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 48);
  return { renderer, envTex, scene, camera, seatView, textures, keep, floor, chipMats, cardMesh, faceFor, backMat, cardGeo, chipGeo };
}

/* ================= The casino's solo table =================
   mountCasinoTable(container) draws the table and returns { update(view), dispose() }. The
   page calls update with what the server's table looks like now, and the scene animates
   whatever changed: new cards fly out of the shoe, the dealer's hole card turns over, chips
   drop on the betting spot, split cards slide apart, wins are paid from the tray and losses
   swept into it. The page keeps all the rules and money; this only draws.

   view: {
     n,                       // the round number (null before the first deal)
     over,                    // the round is finished
     dealer: [{ code, up }],  // a code the player can't know yet may be '??'
     dealerLabel: { text, cls },
     hands: [{ id, cards, bet, doubled, result, active, total: { text, cls }, tag: { text, cls } }],
     bet,                     // chips on the spot for the next hand, while betting
   } */
const DENOMS = [1000, 500, 100, 25, 5];
const HAND_GAP = 0.165;          // between split hands
const HAND_Z = 0.13;             // the first card of each hand
const STACK_Z = 0.285;           // chips, on the printed betting spot
const DEALER_Z = -0.27;
const TO_PLAYER = new THREE.Vector3(0, 0.25, 0.85);   // chips coming back to you leave this way
const TRAY = new THREE.Vector3(0, FELT_Y + 0.03, -0.39);

function chipsFor(amount) {
  const out = [];
  let a = Math.floor(amount + 1e-6);
  for (const d of DENOMS) while (a >= d && out.length < 20) { out.push(d); a -= d; }
  if (!out.length && amount > 0) out.push(5);
  return out;   // biggest first, so they sit at the bottom
}

export async function mountCasinoTable(container) {
  await fontReady();
  const Q = casinoQuality();
  const B = buildTable(container, { maxDpr: Q.maxDpr, alpha: true, shadow: Q.shadow, softShadows: Q.softShadows });
  const { renderer, envTex, scene, camera, chipMats, cardMesh, faceFor, cardGeo, chipGeo, textures } = B;
  scene.background = null;
  scene.fog = null;
  B.floor.visible = false;
  renderer.domElement.classList.add('t3-canvas');
  const layer = document.createElement('div');
  layer.className = 't3-labels';
  container.appendChild(layer);

  const cards = new Map();      // key -> { mesh, code, up, target, sideways }
  const hands = new Map();      // hand id -> { chips: [mesh], won: [mesh], settled, label }
  let betStack = [];            // [{ mesh, v }] on the spot before the deal
  let round = null;
  const anchor = new THREE.Vector3();
  let renderUntil = 0, raf = 0, disposed = false;

  // ---- Drawing on demand: only while something moves ----
  function kick(ms = 1600) {
    renderUntil = Math.max(renderUntil, performance.now() + ms);
    if (!raf) raf = requestAnimationFrame(frame);
  }
  let viewKey = '';
  const governor = frameGovernor(renderer, scene);
  function frame(now) {
    raf = 0;
    if (disposed) return;
    governor.tick(now);
    const key = container.clientWidth + 'x' + container.clientHeight + ':' + spread + ':' + renderer.getPixelRatio();
    if (key !== viewKey) { viewKey = key; frameCamera(); }
    renderer.render(scene, camera);
    placeLabels();
    // Keep drawing while anything is still moving (tweens can run late if frames were missed)
    if (now < renderUntil || gsap.globalTimeline.getChildren(true, true, true).some(t => t.isActive())) raf = requestAnimationFrame(frame);
    else governor.idle();
  }
  let spread = 1;   // how many hands across the view must fit
  function frameCamera() {
    const wide = spread > 2 ? 0.36 : spread > 1 ? 0.27 : 0.2;
    B.seatView({ halfW: wide, halfD: 0.35, target: new THREE.Vector3(0, 0.03, 0), dir: new THREE.Vector3(0, 0.92, 0.58), min: 0.5 });
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => kick(200)) : null;
  if (ro) ro.observe(container);

  // ---- Labels: the page's own badges, pinned to points on the table ----
  function label() {
    const el = document.createElement('div');
    el.className = 't3-label';
    el.innerHTML = '<span></span><span></span>';
    layer.appendChild(el);
    return { el, at: new THREE.Vector3(), below: false };
  }
  function setLabel(L, parts, at, below, extra) {
    const [a, b] = L.el.children;
    a.textContent = (parts[0] && parts[0].text) || '';
    a.className = (parts[0] && parts[0].cls) || '';
    a.hidden = !a.textContent;
    b.textContent = (parts[1] && parts[1].text) || '';
    b.className = (parts[1] && parts[1].cls) || '';
    b.hidden = !b.textContent;
    L.el.className = 't3-label' + (below ? ' below' : '') + (extra ? ' ' + extra : '');
    L.el.hidden = a.hidden && b.hidden;
    L.at.copy(at);
  }
  function placeLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    for (const L of allLabels()) {
      anchor.copy(L.at).project(camera);
      L.el.style.transform = `translate(${((anchor.x + 1) / 2) * w}px, ${((1 - anchor.y) / 2) * h}px) translate(-50%, ${L.el.classList.contains('below') ? '0' : '-100%'})`;
    }
  }
  const dealerLabel = label();
  function allLabels() { return [dealerLabel, ...[...hands.values()].map(H => H.label)]; }

  // ---- Cards ----
  function cardTarget(i, n, dealer, handIndex, handCount, sideways) {
    if (dealer) return new THREE.Vector3((i - (n - 1) / 2) * 0.07, FELT_Y + CARD_T / 2 + i * 0.0002, DEALER_Z);
    const cx = (handIndex - (handCount - 1) / 2) * HAND_GAP;
    return new THREE.Vector3(cx - 0.012 + i * 0.024, FELT_Y + CARD_T / 2 + i * 0.0009, HAND_Z - i * 0.013 - (sideways ? 0.01 : 0));
  }
  function dealCard(code, up, to, yaw, delay) {
    const m = cardMesh(code);
    m.position.copy(SHOE_MOUTH);
    m.rotation.set(0, 0.45, Math.PI);
    scene.add(m);
    const tl = gsap.timeline({ delay });
    tl.to(m.position, { x: to.x, z: to.z, duration: 0.5, ease: 'power3.out' }, 0)
      .to(m.position, { y: to.y + 0.06, duration: 0.2, ease: 'sine.out' }, 0)
      .to(m.position, { y: to.y, duration: 0.3, ease: 'power2.in' }, 0.2)
      .to(m.rotation, { y: yaw, z: up ? 0 : Math.PI, duration: 0.45, ease: 'power2.inOut' }, 0.02);
    setTimeout(() => buzz(5), delay * 1000 + 420);
    return m;
  }
  // Move a card that's already out to a new place; whatever it was doing before stops
  function slide(m, to, yaw, delay = 0, up = true) {
    gsap.killTweensOf(m.position);
    gsap.killTweensOf(m.rotation);
    gsap.to(m.position, { x: to.x, y: to.y, z: to.z, duration: 0.4, delay, ease: 'power2.inOut' });
    gsap.to(m.rotation, { x: 0, y: yaw == null ? m.rotation.y : yaw, z: up ? 0 : Math.PI, duration: 0.4, delay, ease: 'power2.inOut' });
  }
  function flip(m, up, delay = 0) {
    const y = m.position.y;
    gsap.timeline({ delay })
      .to(m.position, { y: y + 0.045, duration: 0.22, ease: 'power2.out' })
      .to(m.rotation, { z: up ? 0 : Math.PI, duration: 0.42, ease: 'power2.inOut' }, 0.04)
      .to(m.position, { y, duration: 0.28, ease: 'power2.in' }, 0.28);
  }
  function remove(m, delay = 0, dur = 0.5) {
    gsap.delayedCall(delay + dur + 0.05, () => { gsap.killTweensOf(m.position); gsap.killTweensOf(m.rotation); scene.remove(m); });
  }
  // Everything from the last round goes to the discard pile
  function clearCards() {
    let i = 0;
    for (const C of cards.values()) {
      const m = C.mesh;
      gsap.killTweensOf(m.position);
      gsap.killTweensOf(m.rotation);
      gsap.to(m.position, { x: DISCARD.x, y: DISCARD.y + i * 0.0008, z: DISCARD.z, duration: 0.45, delay: i * 0.04, ease: 'power2.inOut' });
      gsap.to(m.rotation, { y: 0.3, z: Math.PI, duration: 0.45, delay: i * 0.04 });
      remove(m, i * 0.04, 0.45);
      i++;
    }
    cards.clear();
    for (const H of hands.values()) { for (const m of [...H.chips, ...H.won]) sweepTo(m, TO_PLAYER, 0); H.label.el.remove(); }
    hands.clear();
    return i ? 0.35 : 0;
  }

  // ---- Chips ----
  function chipMesh(v) {
    const m = new THREE.Mesh(chipGeo, chipMats[CHIPS.findIndex(c => c.v === v)] || chipMats[0]);
    m.castShadow = m.receiveShadow = true;
    m.userData.v = v;
    return m;
  }
  // Drop chip number k of a stack at base (from your side of the table, or from the tray)
  function dropChip(m, base, k, delay, from = 'player') {
    const to = new THREE.Vector3(base.x + gsap.utils.random(-0.0012, 0.0012), FELT_Y + CHIP_T / 2 + k * CHIP_T, base.z + gsap.utils.random(-0.0012, 0.0012));
    if (from === 'tray') m.position.copy(TRAY);
    else m.position.set(base.x + 0.04, 0.3, 0.75);
    m.rotation.set(gsap.utils.random(-0.6, 0.6), gsap.utils.random(0, 6), gsap.utils.random(-0.6, 0.6));
    scene.add(m);
    gsap.timeline({ delay })
      .to(m.position, { x: to.x, z: to.z, duration: 0.4, ease: 'power2.out' }, 0)
      .to(m.position, { y: to.y + 0.04, duration: 0.17, ease: 'sine.out' }, 0)
      .to(m.position, { y: to.y, duration: 0.28, ease: 'bounce.out' }, 0.17)
      .to(m.rotation, { x: 0, z: 0, y: '+=' + gsap.utils.random(1, 3), duration: 0.4, ease: 'power2.out' }, 0);
    setTimeout(() => buzz(6), delay * 1000 + 400);
  }
  function sweepTo(m, to, delay) {
    gsap.killTweensOf(m.position);
    gsap.to(m.position, { x: to.x + gsap.utils.random(-0.02, 0.02), y: to.y, z: to.z, duration: 0.5, delay, ease: 'power2.in' });
    remove(m, delay, 0.5);
  }
  // Make a stack show `amount`, adding or taking away chips from the top
  function setStack(stack, amount, base, from = 'player', delay = 0) {
    const want = chipsFor(amount);
    let keep = 0;
    while (keep < stack.length && keep < want.length && stack[keep].userData.v === want[keep]) keep++;
    const gone = stack.splice(keep);
    gone.forEach((m, i) => sweepTo(m, TO_PLAYER, i * 0.03));
    for (let k = keep; k < want.length; k++) {
      const m = chipMesh(want[k]);
      dropChip(m, base, k, delay + (k - keep) * 0.07, from);
      stack.push(m);
    }
    return stack;
  }
  // Slide a stack (already on the table) to a new spot
  function moveStack(stack, base) {
    stack.forEach((m, k) => slide(m, new THREE.Vector3(base.x, FELT_Y + CHIP_T / 2 + k * CHIP_T, base.z)));
  }

  // ---- The update ----
  function update(v) {
    if (disposed || !v) return;
    let delay = 0;
    const n = v.n == null ? null : v.n;
    // A new round: last round's cards go, and the bet on the spot becomes the first hand's
    if (n !== round) {
      if (round != null) delay = clearCards();
      round = n;
    }
    const hs = v.hands || [];
    spread = Math.max(1, hs.length);
    const count = hs.length;

    // Dealer
    const dn = v.dealer.length;
    v.dealer.forEach((d, i) => {
      const key = `d:${i}`;
      const to = cardTarget(i, dn, true);
      let C = cards.get(key);
      if (!C) {
        C = { mesh: dealCard(d.code, d.up, to, gsap.utils.random(-0.04, 0.04), delay), code: d.code, up: d.up, target: to };
        cards.set(key, C);
        delay += 0.22;
        return;
      }
      if (C.code !== d.code) { C.mesh.material[2] = faceFor(d.code); C.code = d.code; }
      if (C.up !== d.up) { flip(C.mesh, d.up, delay); C.up = d.up; delay += 0.5; }
      if (!C.target.equals(to)) { slide(C.mesh, to, null, delay, C.up); C.target = to; }
    });
    setLabel(dealerLabel, [v.dealerLabel], new THREE.Vector3(0, FELT_Y, DEALER_Z + CARD_H / 2 + 0.012), true);

    // Player hands. Cards that left one hand for another (a split) slide across.
    const seen = new Set();
    const orphans = [];
    const live = new Set();
    hs.forEach(h => h.cards.forEach((c, i) => live.add(`h:${h.id}:${i}:${c}`)));
    for (const [k, C] of cards) if (k.startsWith('h:') && !live.has(k)) { orphans.push(C); cards.delete(k); }
    hs.forEach((h, hi) => {
      const cx = (hi - (count - 1) / 2) * HAND_GAP;
      let H = hands.get(h.id);
      if (!H) {
        H = { chips: [], won: [], settled: false, label: label(), base: new THREE.Vector3(cx, 0, STACK_Z) };
        if (betStack.length) { H.chips = betStack; betStack = []; }   // the bet you placed is this hand's
        hands.set(h.id, H);
      }
      const base = new THREE.Vector3(cx - (H.won.length ? 0.026 : 0), 0, STACK_Z);
      if (!H.base.equals(base)) { moveStack(H.chips, base); H.base = base; }
      if (!H.settled) setStack(H.chips, h.bet, base, 'player', delay);

      h.cards.forEach((c, i) => {
        const key = `h:${h.id}:${i}:${c}`;
        seen.add(key);
        const sideways = h.doubled && i === 2;
        const to = cardTarget(i, h.cards.length, false, hi, count, sideways);
        const yaw = sideways ? Math.PI / 2 : 0;
        let C = cards.get(key);
        if (!C) {
          const o = orphans.findIndex(x => x.code === c);
          if (o >= 0) {
            C = orphans.splice(o, 1)[0];
            slide(C.mesh, to, yaw, delay);
            delay += 0.25;
          } else {
            C = { mesh: dealCard(c, true, to, sideways ? yaw : gsap.utils.random(-0.05, 0.05), delay), code: c, up: true };
            delay += 0.25;
          }
          C.target = to;
          cards.set(key, C);
        } else if (!C.target.equals(to)) { slide(C.mesh, to, sideways ? yaw : null, delay); C.target = to; }
      });

      // The hand is decided: pay it, sweep it, or give it back
      if (h.result && !H.settled && (v.over || h.result === 'bust')) {
        H.settled = true;
        const at = delay + (v.over ? 0.5 : 0.35);
        if (h.result === 'win' || h.result === 'blackjack') {
          const winBase = new THREE.Vector3(cx + 0.026, 0, STACK_Z);
          moveStack(H.chips, new THREE.Vector3(cx - 0.026, 0, STACK_Z));
          setStack(H.won, h.bet * (h.result === 'blackjack' ? 1.5 : 1), winBase, 'tray', at);
          const back = at + 0.6 + H.won.length * 0.07 + 0.9;
          [...H.chips, ...H.won].forEach((m, i) => sweepTo(m, TO_PLAYER, back + i * 0.02));
          H.chips = []; H.won = [];
          kick((back + 1) * 1000);
        } else if (h.result === 'push') {
          H.chips.forEach((m, i) => sweepTo(m, TO_PLAYER, at + 0.9 + i * 0.02));
          H.chips = [];
          kick((at + 2) * 1000);
        } else {
          H.chips.forEach((m, i) => sweepTo(m, TRAY, at + i * 0.03));
          H.chips = [];
          kick((at + 1.2) * 1000);
        }
      }
      const top = HAND_Z - (h.cards.length - 1) * 0.013 - CARD_H / 2 - 0.01;
      setLabel(H.label, [h.total, h.tag], new THREE.Vector3(cx, FELT_Y, top), false, h.active ? 'active' : '');
    });
    for (const C of orphans) remove(C.mesh, 0, 0);
    for (const [id, H] of hands) if (!hs.some(h => h.id === id)) { H.label.el.remove(); hands.delete(id); }

    // Chips for the next hand
    if (!hs.length || v.over) {
      if (v.bet > 0 || betStack.length) setStack(betStack, v.bet || 0, new THREE.Vector3(0, 0, STACK_Z), 'player', 0);
    }
    kick(delay * 1000 + 1500);
  }

  // Get the graphics chip ready for every material now, so the first deal doesn't stutter
  try {
    const probe = [cardMesh('AS'), chipMesh(25)];
    scene.add(...probe);
    frameCamera();
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    scene.remove(...probe);
  } catch (e) { /* it compiles on the first frame instead */ }

  kick(300);
  return {
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      scene.traverse(o => { gsap.killTweensOf(o.position); gsap.killTweensOf(o.rotation); });
      layer.remove();
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
