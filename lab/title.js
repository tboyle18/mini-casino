// The title screen: a long shot of the casino at night, out in the desert. A parking lot with a
// few cars, a tall roadside sign, MINI CASINO in neon over the front doors, and a Play button
// (the page's) in the middle. play() swings the doors open and glides the camera in through
// them, then resolves so the page can open the floor.
//
// mount({ stage }) returns { play(), dispose() }.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from 'gsap';
import { reducedMotion, makeRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';
import { canvas, tex } from './arcade.js';

const FONT = 'Manrope, system-ui, sans-serif';
const PINK = '#ff3fb4', CYAN = '#3ff0ff', GOLD = '#ffd36a';

// Neon lettering: a soft coloured glow with a hot, nearly white core
function neonText(lines, { w = 1024, h = 256, color = PINK } = {}) {
  const [c, g] = canvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const { text, size, y, col = color, track = 0 } of lines) {
    g.font = `800 ${size}px ${FONT}`;
    if ('letterSpacing' in g) g.letterSpacing = `${track}px`;
    g.lineJoin = 'round';
    g.shadowColor = col;
    for (const [blur, width, alpha] of [[size * 0.45, size * 0.1, 0.55], [size * 0.18, size * 0.07, 0.9]]) {
      g.shadowBlur = blur;
      g.globalAlpha = alpha;
      g.strokeStyle = col;
      g.lineWidth = width;
      g.strokeText(text, w / 2, y);
    }
    g.globalAlpha = 1;
    g.shadowBlur = size * 0.12;
    g.fillStyle = '#fff6fb';
    g.fillText(text, w / 2, y);
  }
  return c;
}

// The roadside sign's face: a dark panel ringed with bulbs, MINI in pink over CASINO in gold
function pylonFace() {
  const W = 1024, H = 640;
  const [c, g] = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3a0a24');
  bg.addColorStop(1, '#14040e');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = GOLD;
  g.lineWidth = 14;
  g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = '#ffe9b0';
  g.shadowColor = '#ffc04a';
  g.shadowBlur = 14;
  const bulb = (x, y) => { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); };
  for (let x = 20; x <= W - 20; x += 44) { bulb(x, 18); bulb(x, H - 18); }
  for (let y = 62; y <= H - 62; y += 44) { bulb(18, y); bulb(W - 18, y); }
  g.shadowBlur = 0;
  const glow = neonText([
    { text: 'MINI', size: 130, y: 190, col: PINK, track: 18 },
    { text: 'CASINO', size: 200, y: 370, col: GOLD, track: 6 },
    { text: 'OPEN ALL NIGHT', size: 56, y: 520, col: CYAN, track: 10 },
  ], { w: W, h: H });
  g.drawImage(glow, 0, 0);
  return c;
}

// The night sky: deep blue overhead, a last purple-orange glow along the horizon
function skyCanvas() {
  const [c, g] = canvas(16, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#05040f');
  grad.addColorStop(0.42, '#120b2e');
  grad.addColorStop(0.5, '#3a1a4a');
  grad.addColorStop(0.53, '#7a3a4a');
  grad.addColorStop(0.56, '#1a1020');
  grad.addColorStop(1, '#0d0a10');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  return c;
}

export async function mount({ stage }) {
  await fontReady();
  const calm = reducedMotion();
  const q = casinoQuality();
  const { renderer, envTex } = makeRenderer(stage, { maxDpr: q.maxDpr, softShadows: false });
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvasEl = renderer.domElement;
  const keep = [];
  const T = cv => { const t = tex(cv, renderer); keep.push(t); return t; };

  const scene = new THREE.Scene();
  scene.environment = envTex;
  scene.environmentIntensity = 0.12;
  scene.fog = new THREE.Fog(0x140c22, 45, 150);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const glow = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const box = (w, h, d, mat, x, y, z, r = 0) => {
    const m = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  // ---- Sky, stars, desert, mountains ----
  const skyTex = T(skyCanvas());
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false }));
  scene.add(sky);
  {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.06 + Math.pow(Math.random(), 0.7) * 1.4;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * 280;
      pos[i * 3 + 1] = Math.sin(e) * 280;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 280;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  }
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std(0x3b2a26, 1));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.02;
  scene.add(sand);
  const ridge = std(0x1c1426, 1);
  for (const [x, z, r, h] of [[-90, -150, 60, 22], [-20, -170, 45, 16], [50, -160, 70, 26], [130, -140, 50, 18], [-160, -120, 50, 14]]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), ridge);
    m.position.set(x, h / 2 - 1, z);
    m.rotation.y = x;
    scene.add(m);
  }
  // A few saguaro-ish cacti out in the sand
  const cactusMat = std(0x2c3a26, 0.9);
  for (const [x, z, s] of [[-16, 6, 1], [15, 2, 0.8], [-22, -6, 1.2], [21, 12, 0.9], [-13, 22, 0.7]]) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 2.6, 4, 8), cactusMat);
    trunk.position.y = 1.5;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.8, 4, 8), cactusMat);
    arm.position.set(0.45, 1.9, 0);
    const elbow = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 8), cactusMat);
    elbow.position.set(0.28, 1.45, 0);
    elbow.rotation.z = Math.PI / 2;
    g.add(trunk, arm, elbow);
    g.scale.setScalar(s);
    g.position.set(x, 0, z);
    g.rotation.y = x * 1.7;
    scene.add(g);
  }

  // ---- Road and parking lot ----
  const asphalt = std(0x1d1c22, 0.95);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), asphalt);
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(-1, 0, 7.5);
  scene.add(lot);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(600, 6), std(0x17161b, 0.95));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.005, 19);
  scene.add(road);
  const paint = new THREE.MeshBasicMaterial({ color: 0x9a968c });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xa88a3a });
  for (let x = -60; x <= 60; x += 4) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.14), yellow);
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.01, 19);
    scene.add(d);
  }
  // Two rows of bays either side of the walk up to the doors
  for (const zRow of [5.6, 11.4]) {
    for (let x = -15; x <= 12; x += 2.8) {
      if (Math.abs(x + 0.4) < 2.6) continue;   // the walkway
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 4.2), paint);
      l.rotation.x = -Math.PI / 2;
      l.position.set(x, 0.01, zRow);
      scene.add(l);
    }
  }
  // Cars: a body and a cabin, parked nose-in
  const carCols = [0x6a1c24, 0x22324a, 0x8a8a86, 0x2a2a2e, 0x3d4a3a, 0x7a5a2a];
  const glass = std(0x0d1018, 0.15, 0.6);
  const tyre = std(0x0b0b0c, 0.9);
  const tail = glow(0x5a0a0a);
  [[-5.8, 5.6, 0], [-11.4, 5.6, 1], [7.0, 5.6, 2], [-8.6, 11.4, 3], [9.8, 11.4, 4], [-14.2, 11.4, 5]].forEach(([x, z, k]) => {
    const col = std(carCols[k], 0.4, 0.5);
    box(1.8, 0.6, 4.1, col, x, 0.55, z, 0.18);
    box(1.55, 0.5, 2.1, glass, x, 1.08, z + 0.2, 0.18);
    for (const sx of [-0.82, 0.82]) for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14), tyre);
      w.rotation.z = Math.PI / 2;
      w.position.set(x + sx, 0.34, z + sz);
      scene.add(w);
    }
    for (const sx of [-0.6, 0.6]) box(0.4, 0.1, 0.04, tail, x + sx, 0.72, z + 2.06);
  });
  // Lamp posts with warm pools of light
  const pole = std(0x2a2a30, 0.5, 0.6);
  for (const [x, z] of [[-8.2, 13.6], [9.4, 13.2], [-14.5, 8.5]]) {
    box(0.16, 6, 0.16, pole, x, 3, z);
    box(1.1, 0.12, 0.16, pole, x + 0.5, 6, z);
    box(0.7, 0.12, 0.4, glow(0xffd9a0), x + 0.9, 5.92, z);
    const l = new THREE.PointLight(0xffc98a, 45, 15, 1.6);
    l.position.set(x + 0.9, 5.6, z);
    scene.add(l);
  }

  // ---- The building ----
  const stucco = std(0xa58a72, 0.9);
  const maroon = std(0x4a1426, 0.8);
  const trim = std(0xc89a3c, 0.35, 0.8);
  box(26, 4.4, 9, stucco, -1, 2.2, -4.5);                 // the long low block
  box(26.2, 0.3, 9.2, trim, -1, 4.45, -4.5);              // its cornice
  box(8, 7.2, 9.4, maroon, -0.4, 3.6, -4.5);              // the entrance tower
  box(8.2, 0.3, 9.6, trim, -0.4, 7.25, -4.5);
  // Warm slit windows along the block
  const amber = glow(0x8a5a2a);
  for (const x of [-12.5, -10, -7.5, 5.5, 8, 10.5]) box(0.5, 1.8, 0.05, amber, x, 2.4, 0.01);
  // Pilasters between the windows, a maroon band and a base along the block
  const light = std(0xc4a888, 0.85);
  for (const x of [-13.75, -11.25, -8.75, -6.25, 4.25, 6.75, 9.25, 11.75]) box(0.45, 4.4, 0.22, light, x, 2.2, 0.08);
  box(26, 0.28, 0.16, maroon, -1, 3.85, 0.06);
  box(26, 0.45, 0.14, std(0x6a5a4c, 0.9), -1, 0.22, 0.05);
  // Small neon signs on the wings
  const wingSign = (text, col, x) => {
    const t = T(neonText([{ text, size: 150, y: 128, col, track: 14 }]));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }));
    m.position.set(x, 3.42, 0.2);
    scene.add(m);
  };
  wingSign('SLOTS', CYAN, -10);
  wingSign('POKER', CYAN, 8);
  // Units and a water tank on the roof
  const metal = std(0x55565c, 0.6, 0.5);
  for (const [x, z] of [[-10, -5], [-6.5, -2.5], [7.5, -4]]) box(1.6, 0.8, 1.2, metal, x, 5.0, z);
  {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 16), metal);
    tank.position.set(10, 5.6, -6);
    scene.add(tank);
    for (const dx of [-0.6, 0.6]) box(0.1, 1, 0.1, metal, 10 + dx, 4.9, -6);
  }
  // The canopy over the doors, with a row of bulbs along its edge
  box(7, 0.4, 3.4, maroon, -0.4, 3.35, 1.7);
  box(7.1, 0.12, 3.5, trim, -0.4, 3.12, 1.7);
  for (const x of [-3.4, 2.6]) box(0.22, 3.1, 0.22, trim, x, 1.55, 3.2);
  const bulbs = [];
  const bulbOn = glow(0xfff0c0), bulbOff = glow(0x6a5030);
  for (let i = 0; i < 18; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), bulbOn);
    b.position.set(-3.75 + i * (6.7 / 17), 3.02, 3.42);
    scene.add(b);
    bulbs.push(b);
  }
  const under = new THREE.PointLight(0xffd08a, 26, 9, 1.6);
  under.position.set(-0.4, 2.7, 2.2);
  scene.add(under);
  // The front doors: two glass panels in gold frames, lit from inside
  const inside = box(3.0, 2.8, 0.02, glow(0xffc070), -0.4, 1.4, 0.22);
  inside.material.color.multiplyScalar(0.55);
  for (const [w, h, x, y] of [[0.2, 3.1, -2.1, 1.55], [0.2, 3.1, 1.3, 1.55], [3.6, 0.2, -0.4, 3.0]]) box(w, h, 0.12, trim, x, y, 0.26);
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.1, metalness: 0.3, emissive: 0xff9a3a, emissiveIntensity: 0.35, transparent: true, opacity: 0.88 });
  const doors = [-1, 1].map(s => {
    const d = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.75, 0.06), doorMat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.8, 0.04), trim);
    frame.position.z = -0.02;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), trim);
    handle.position.set(-s * 0.58, 0.05, 0.06);
    d.add(frame, pane, handle);
    d.position.set(-0.4 + s * 0.74, 1.4, 0.3);
    scene.add(d);
    return d;
  });
  // A light that spills out of the doorway once they open
  const spill = new THREE.PointLight(0xffb060, 0, 10, 1.5);
  spill.position.set(-0.4, 1.4, 0.9);
  scene.add(spill);

  // Cyan neon up the tower's corners, and the four suits in a row above the name
  for (const x of [-4.36, 3.56]) box(0.07, 6.6, 0.07, glow(0x3ff0ff), x, 3.7, 0.27);
  {
    const [c, g] = canvas(1024, 256);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 150px ${FONT}`;
    ['♠', '♥', '♦', '♣'].forEach((ch, i) => {
      const col = i % 3 ? '#ff4a6a' : CYAN;
      g.shadowColor = col;
      g.shadowBlur = 40;
      g.fillStyle = col;
      g.fillText(ch + '\uFE0E', 200 + i * 208, 128);
      g.shadowBlur = 10;
      g.fillStyle = '#fff4f6';
      g.globalAlpha = 0.5;
      g.fillText(ch + '\uFE0E', 200 + i * 208, 128);
      g.globalAlpha = 1;
    });
    const suits = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: T(c), transparent: true, toneMapped: false, depthWrite: false }));
    suits.position.set(-0.4, 6.62, 0.24);
    scene.add(suits);
  }
  // A red carpet out to the lot, between gold posts and red ropes
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), std(0x7a0f1e, 0.95));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(-0.4, 0.015, 2.6);
  scene.add(carpet);
  const rope = std(0x9a1022, 0.6);
  for (const sx of [-1.45, 0.65]) {
    for (const z of [1.2, 2.6, 4.0]) {
      box(0.08, 0.9, 0.08, trim, sx, 0.45, z);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), trim);
      ball.position.set(sx, 0.94, z);
      scene.add(ball);
    }
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.8, 6), rope);
    r.rotation.x = Math.PI / 2;
    r.position.set(sx, 0.78, 2.6);
    scene.add(r);
  }
  // Palm trees either side of the entrance
  const bark = std(0x5a4030, 0.9), frond = std(0x2f5a2c, 0.8, 0, { side: THREE.DoubleSide });
  for (const [x, z, lean] of [[-5.6, 2.2, 0.08], [4.8, 2.4, -0.1], [-12, 1.6, 0.05]]) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 6, 8), bark);
    trunk.position.y = 3;
    palm.add(trunk);
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 2.4), frond);
      f.geometry.translate(0, 1.2, 0);
      f.position.y = 6;
      f.rotation.set(0, (i / 7) * Math.PI * 2, 1.15);
      f.rotation.order = 'YXZ';
      f.rotation.x = -1.1;
      palm.add(f);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.5, 12), maroon);
    pot.position.y = 0.25;
    palm.add(pot);
    palm.position.set(x, 0, z);
    palm.rotation.z = lean;
    scene.add(palm);
  }
  // Potted palms either side of the doors, like the ones just inside: a plum pot with a gold
  // band, a ringed trunk and a fan of fronds
  const plum = std(0x3a1430, 0.6), leafA = std(0x2f8a3a, 0.55), leafB = std(0x46b04a, 0.55);
  const potPalm = (x, z, seed) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.19, 0.5, 20), plum);
    pot.position.y = 0.25;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.02, 8, 24).rotateX(Math.PI / 2), trim);
    band.position.y = 0.46;
    g.add(pot, band);
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.05 - i * 0.004, 0.058 - i * 0.004, 0.22, 8), std(i % 2 ? 0x7a5230 : 0x8f6238, 0.8));
      seg.position.set(Math.sin(i * 0.9 + seed) * 0.02, 0.6 + i * 0.2, 0);
      g.add(seg);
    }
    for (let i = 0; i < 9; i++) {
      const frond = new THREE.Group();
      frond.position.y = 1.78;
      frond.rotation.y = (i / 9) * Math.PI * 2 + seed;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6).scale(1, 0.05, 0.16), i % 2 ? leafB : leafA);
      leaf.position.x = 0.42;
      leaf.rotation.z = -0.35 - (i % 3) * 0.12;
      frond.add(leaf);
      g.add(frond);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  };
  potPalm(-2.75, 0.75, 0.3);
  potPalm(1.95, 0.75, 1.4);
  // MINI CASINO in neon on the tower, over the canopy
  const signTex = T(neonText([{ text: 'MINI CASINO', size: 132, y: 128, col: PINK, track: 6 }]));
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.85), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false, depthWrite: false }));
  facade.position.set(-0.4, 5.3, 0.24);
  scene.add(facade);
  const facadeLight = new THREE.PointLight(0xff3fb4, 14, 7, 1.6);
  facadeLight.position.set(-0.4, 5.3, 1.6);
  scene.add(facadeLight);
  // A neon line along the roof, pink on the tower and cyan on the block
  box(8.2, 0.06, 0.06, glow(0xff3fb4), -0.4, 7.05, 0.26);
  box(26.2, 0.05, 0.05, glow(0x3ff0ff), -1, 4.25, 0.05);

  // The roadside sign out front, on a gravel island by the highway
  const island = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.18, 24), std(0x4a3a30, 1));
  island.position.set(4.7, 0.09, 15.6);
  scene.add(island);
  for (const dx of [-1.2, 1.3]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0), std(0x5a4a3c, 1));
    rock.position.set(4.7 + dx, 0.25, 16.5);
    scene.add(rock);
  }
  const pylon = new THREE.Group();
  pylon.position.set(4.7, 0, 15.6);   // at the roadside, past the end of the lot
  pylon.rotation.y = -0.22;
  scene.add(pylon);
  const steel = std(0x3a3a42, 0.45, 0.7);
  for (const x of [-1.1, 1.1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.32, 7, 0.32), steel);
    p.position.set(x, 3.5, 0);
    pylon.add(p);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.2, 0.3), std(0x1a0710, 0.6));
  panel.position.y = 8.4;
  pylon.add(panel);
  const faceMat = new THREE.MeshBasicMaterial({ map: T(pylonFace()), toneMapped: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 3.06), faceMat);
  face.position.set(0, 8.4, 0.16);
  pylon.add(face);
  // a gold star on top
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.28 : 0.68;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r); else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.12, bevelEnabled: false }), glow(0xffcf5a));
  starMesh.position.set(0, 10.75, -0.06);
  pylon.add(starMesh);
  const pylonLight = new THREE.PointLight(0xff6fb0, 18, 10, 1.6);
  pylonLight.position.set(0, 8.4, 2);
  pylon.add(pylonLight);

  // ---- Camera ----
  // A long shot from across the road, pulled back far enough that the sign and the doors both
  // fit, whatever the screen's shape
  const target = new THREE.Vector3(0.8, 4.6, 3);
  const shot = { pos: new THREE.Vector3(), look: target.clone(), t: 0 };
  let aspect = 0;
  function frameShot() {
    const tall = aspect < 0.75;
    const vfov = tall ? 62 : 46;
    camera.fov = vfov;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov) / 2) * aspect);
    const want = tall ? 21 : 30;   // metres of the building front across the screen
    const d = THREE.MathUtils.clamp((want / 2) / Math.tan(hfov / 2), 22, 50);
    shot.pos.set(target.x + 0.4, 4.2, target.z + d);
    camera.updateProjectionMatrix();
  }
  const view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), going: false };
  function fit() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    const px = renderer.getPixelRatio();
    if (canvasEl.width !== Math.round(w * px) || canvasEl.height !== Math.round(h * px) || aspect !== w / h) {
      renderer.setSize(w, h, false);
      aspect = w / h;
      camera.aspect = aspect;
      frameShot();
    }
  }

  // ---- Loop ----
  const governor = frameGovernor(renderer, scene);
  let raf = 0, dead = false, last = performance.now();
  function frame(nowMs) {
    raf = 0;
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    if (governor.tick(nowMs)) aspect = 0;
    fit();
    // The canopy bulbs chase slowly; the neon hums with the odd flicker
    const step = Math.floor(now * 4) % 3;
    for (let i = 0; i < bulbs.length; i++) bulbs[i].material = (i + step) % 3 ? bulbOn : bulbOff;
    const flick = Math.sin(now * 0.7) > 0.985 && Math.sin(now * 37) > 0;
    facade.material.opacity = flick ? 0.55 : 1;
    if (!view.going) {
      // a slow drift, so the shot breathes
      const sway = calm ? 0 : Math.sin(now * 0.25);
      view.pos.copy(shot.pos).add(new THREE.Vector3(sway * 0.8, Math.sin(now * 0.31) * 0.15, 0));
      view.look.copy(shot.look);
    }
    camera.position.copy(view.pos);
    camera.lookAt(view.look);
    renderer.render(scene, camera);
    void dt;
  }
  fit();
  view.pos.copy(shot.pos);
  view.look.copy(shot.look);
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (e) { /* draws anyway */ } }
  raf = requestAnimationFrame(frame);
  canvasEl.style.opacity = '0';
  gsap.to(canvasEl, { opacity: 1, duration: calm ? 0.1 : 0.6, ease: 'power1.out' });

  // Play: the doors swing apart, the camera glides across the lot and in through them
  let playing = null;
  function play() {
    if (playing) return playing;
    playing = new Promise(resolve => {
      view.going = true;
      const doorPos = new THREE.Vector3(-0.4, 1.45, -1.5);
      const t = calm ? 0.35 : 1.7;
      const tl = gsap.timeline({ onComplete: resolve });
      tl.to(doors[0].position, { x: -0.4 - 2.2, duration: t * 0.45, ease: 'power2.inOut' }, t * 0.15)
        .to(doors[1].position, { x: -0.4 + 2.2, duration: t * 0.45, ease: 'power2.inOut' }, t * 0.15)
        .to(spill, { intensity: 40, duration: t * 0.5 }, t * 0.15)
        .to(view.look, { x: doorPos.x, y: doorPos.y + 0.2, z: doorPos.z, duration: t * 0.55, ease: 'power2.inOut' }, 0)
        .to(view.pos, { x: doorPos.x, y: 1.6, z: 0.6, duration: t, ease: 'power3.in' }, 0)
        .to(canvasEl, { opacity: 0, duration: t * 0.25, ease: 'power1.in' }, t * 0.78);
    });
    return playing;
  }

  return {
    play,
    dispose() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      gsap.killTweensOf([canvasEl, view.pos, view.look, spill, ...doors.map(d => d.position)]);
      disposeScene(scene);
      for (const t of keep) t.dispose();
      envTex.dispose();
      renderer.dispose();
      canvasEl.remove();
    },
  };
}
