// Duck Rocket: a 3D crash game.
//
// A rubber duck in goggles rides a rocket off a launch pad. The multiplier climbs as it
// gains altitude: past the clouds, a passing plane, satellites, the moon and a UFO, while
// the sky turns from day to sunset to space. Cash out before it blows up and the duck ejects
// on a parachute; wait too long and it's feathers everywhere. The crash point is decided at
// launch (crash-math.js); cashing out at any multiplier returns about 97% over time.
// It plays with the shared lab credits.

import * as THREE from 'three';
import { gsap } from 'gsap';
import { button, buzz, reducedMotion, makeRenderer, disposeScene, fontReady, loadCredits, saveCredits, LAB_START } from './shared.js';
import { makeSound, createWinFx } from './fx.js';
import { bloomComposer, glow, duckGeometry, canvas, tex } from './arcade.js';
import { crashPoint, multAt } from './crash-math.js';

const TAU = Math.PI * 2;
const BETS = [5, 25, 100, 500];
const AUTOS = [0, 1.5, 2, 3, 5, 10];        // auto cash-out targets; 0 is off
const STORE = 'mini-casino.lab-crash';
const PAD_TOP = 0.3;
const CLIMB = 24;                           // meters of altitude for every doubling of the multiplier
const DUCK_SIZE = 0.26;
const DUCK_ON_ROCKET = new THREE.Vector3(0.02, 2.34, 0.05);
// Sky colors by altitude: day, sunset, dusk, night, space
const SKY = [[0, '#8fd0ff'], [30, '#ffb07a'], [55, '#7a4ba8'], [80, '#1a1245'], [125, '#03020c']];
const MILESTONES = [
  [2, 'PASSING THE CLOUDS'], [4, 'HELLO, AIRPLANE'], [10, 'LEAVING THE ATMOSPHERE'],
  [25, 'WAVE AT THE MOON'], [100, 'UFO SIGHTING. IT WAVED BACK.'], [500, 'THE DUCK HAS LEFT THE GALAXY'],
];

const CSS = `
.cr-hud { position: absolute; left: 0; right: 0; top: 38px; z-index: 3; display: grid; justify-items: center; gap: 6px; pointer-events: none; text-align: center; padding: 0 12px; }
.cr-hist { display: flex; gap: 4px; justify-content: center; flex-wrap: nowrap; overflow: hidden; max-width: 100%; min-height: 22px; }
.cr-hist span { flex: none; padding: 3px 7px; border-radius: 6px; font: 800 12px/1.3 Manrope, sans-serif; color: #fff; background: rgba(200, 48, 60, .85); font-variant-numeric: tabular-nums; }
.cr-hist span.good { background: rgba(31, 138, 82, .9); }
.cr-mult { margin-top: 10px; font: 800 64px/1 Manrope, sans-serif; letter-spacing: -.03em; color: #fff; font-variant-numeric: tabular-nums;
  text-shadow: 0 3px 0 rgba(0, 0, 0, .35), 0 0 24px rgba(0, 0, 0, .35); transition: color .2s; }
.cr-mult.crashed { color: #ff5d6c; }
.cr-mult.cashed { color: #7cff6b; }
.cr-line { min-height: 22px; font: 700 16px/1.3 Manrope, sans-serif; color: #fff; text-shadow: 0 2px 8px rgba(0, 0, 0, .6); }
.cr-toast { position: absolute; left: 50%; top: 46%; z-index: 3; transform: translateX(-50%); pointer-events: none; white-space: nowrap; opacity: 0;
  font: 800 15px/1 Manrope, sans-serif; letter-spacing: .16em; color: #ffe27a; text-shadow: 0 2px 10px rgba(0, 0, 0, .7); }
`;

const money = n => '$' + Math.round(n).toLocaleString('en-US');
const fmt = m => `${m.toFixed(2)}×`;
function rand() {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  catch (e) { return Math.random(); }
}
const altitude = m => CLIMB * Math.log2(Math.max(1, m));
const skyCol = new THREE.Color(), skyA = new THREE.Color(), skyB = new THREE.Color();
function skyAt(y) {
  for (let i = 1; i < SKY.length; i++) {
    if (y <= SKY[i][0]) {
      const t = (y - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]);
      return skyCol.copy(skyA.set(SKY[i - 1][1])).lerp(skyB.set(SKY[i][1]), Math.max(0, t));
    }
  }
  return skyCol.set(SKY[SKY.length - 1][1]);
}

function moonCanvas() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#c9c6bd';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512, y = Math.random() * 256, r = 3 + Math.random() * 22;
    g.fillStyle = `rgba(90, 86, 80, ${0.15 + Math.random() * 0.3})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, .18)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x - 1, y - 1, r, Math.PI * 1.1, Math.PI * 1.8); g.stroke();
  }
  return c;
}
function stripeCanvas(a, b, n) {
  const [c, g] = canvas(256, 16);
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * 256) / n, 0, 256 / n + 1, 16); }
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
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  const textures = [];
  const keep = t => { textures.push(t); return t; };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY[0][1]);
  scene.environment = envTex;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
  const composer = bloomComposer(renderer, scene, camera);
  const view = { w: 0, h: 0 };
  function fit() {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---- Light and ground ----
  const hemi = new THREE.HemisphereLight(0xdff2ff, 0x5d7a3a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 8, bottom: -3, near: 1, far: 40 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0x8fb35a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f9a48, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + Math.random() * 0.3, r = 60 + Math.random() * 70;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 18, 10 + Math.random() * 16, 7), hillMat);
    hill.position.set(Math.cos(a) * r, 4, Math.sin(a) * r - 30);
    scene.add(hill);
  }

  // ---- Launch pad and tower ----
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, PAD_TOP, 40), concrete);
  pad.position.y = PAD_TOP / 2;
  pad.receiveShadow = pad.castShadow = true;
  scene.add(pad);
  const hazard = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 8, 64),
    new THREE.MeshStandardMaterial({ map: keep(tex(stripeCanvas('#f2c230', '#222222', 24), renderer)), roughness: 0.6 }));
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.y = PAD_TOP + 0.01;
  scene.add(hazard);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd2452b, metalness: 0.4, roughness: 0.5 });
  const tower = new THREE.Group();
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.6, 0.07), steel);
    post.position.set(x, 1.8, z);
    post.castShadow = true;
    tower.add(post);
  }
  for (let k = 0; k < 7; k++) {
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.05), steel);
      bar.position.set(0, 0.3 + k * 0.5, 0);
      bar.rotation.y = rot;
      tower.add(bar);
    }
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), steel);
  arm.position.set(0.6, 2.9, 0);
  tower.add(arm);
  tower.position.set(-1.7, PAD_TOP, -0.2);
  scene.add(tower);

  // ---- The rocket ----
  const rocket = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.35, metalness: 0.1 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8243a, roughness: 0.35, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
  const part = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; rocket.add(m); return m; };
  part(new THREE.CylinderGeometry(0.24, 0.24, 1.3, 32), white, 0.95);
  part(new THREE.CylinderGeometry(0.245, 0.245, 0.12, 32), red, 0.55);
  part(new THREE.CylinderGeometry(0.245, 0.245, 0.12, 32), red, 1.35);
  part(new THREE.ConeGeometry(0.24, 0.55, 32), red, 1.875);
  part(new THREE.CylinderGeometry(0.13, 0.19, 0.2, 24), dark, 0.2);
  const porthole = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), new THREE.MeshStandardMaterial({ color: 0x7fd3ff, roughness: 0.1, metalness: 0.3 }));
  porthole.position.set(0, 1.05, 0.242);
  rocket.add(porthole);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.32), red);
    const a = (i / 3) * TAU + 0.5;
    fin.position.set(Math.sin(a) * 0.3, 0.45, Math.cos(a) * 0.3);
    fin.rotation.y = a;
    fin.castShadow = true;
    rocket.add(fin);
  }
  // Flame: two cones, bright enough to glow
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.1, 0.2), transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  outer.rotation.x = Math.PI;
  outer.position.y = -0.5;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.6, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.2) }));
  inner.rotation.x = Math.PI;
  inner.position.y = -0.3;
  flame.add(outer, inner);
  flame.position.y = 0.1;
  flame.visible = false;
  glow(outer, inner);
  rocket.add(flame);
  rocket.position.y = PAD_TOP;
  scene.add(rocket);

  // The duck, in goggles, riding the nose
  const duck = new THREE.Group();
  const duckBody = new THREE.Mesh(duckGeometry(DUCK_SIZE), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }));
  duckBody.castShadow = true;
  duck.add(duckBody);
  const goggleMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.4, metalness: 0.6 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x8fe3ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7 });
  const head = new THREE.Vector3(0.397, 0.7, 0.409).multiplyScalar(DUCK_SIZE);
  for (const eye of [[0.333, 0.95, 0.946], [0.935, 0.95, 0.36]]) {
    const p = new THREE.Vector3(...eye).multiplyScalar(DUCK_SIZE);
    const out = p.clone().sub(head).normalize();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(DUCK_SIZE * 0.2, DUCK_SIZE * 0.05, 8, 20), goggleMat);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(DUCK_SIZE * 0.2, 20), lensMat);
    for (const m of [ring, lens]) {
      m.position.copy(p).addScaledVector(out, DUCK_SIZE * 0.06);
      m.lookAt(m.position.clone().add(out));
      duck.add(m);
    }
  }
  // A parachute that opens when you cash out
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 8, 0, TAU, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: keep(tex(stripeCanvas('#ff4757', '#ffffff', 12), renderer)), side: THREE.DoubleSide, roughness: 0.8 }));
  canopy.scale.y = 0.6;
  canopy.position.y = 1.1;
  chute.add(canopy);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.55, 1.1, 0), new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.55, 1.1, 0), new THREE.Vector3(0, 0.25, 0),
    new THREE.Vector3(0, 1.1, -0.55), new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, 1.1, 0.55), new THREE.Vector3(0, 0.25, 0),
  ]), new THREE.LineBasicMaterial({ color: 0x333333 }));
  chute.add(lines);
  chute.visible = false;
  duck.add(chute);
  function seatDuck() {
    rocket.add(duck);
    duck.position.copy(DUCK_ON_ROCKET);
    duck.rotation.set(0, 0, 0);
    chute.visible = false;
    chute.scale.setScalar(1);
  }
  seatDuck();

  // ---- Sky things ----
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const puff = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(puff, cloudMat);
      p.position.set((k - n / 2) * 1.3 + Math.random(), Math.random() * 0.6, Math.random() * 0.8);
      p.scale.set(1.2 + Math.random(), 0.7 + Math.random() * 0.4, 1 + Math.random() * 0.5);
      cloud.add(p);
    }
    const side = i % 2 ? 1 : -1;
    cloud.position.set(side * (3 + Math.random() * 14), 9 + i * 2.1 + Math.random() * 2, -6 - Math.random() * 22);
    scene.add(cloud);
  }
  // A plane crossing at about 4×
  const plane = new THREE.Group();
  const planeMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.4 });
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 3, 6, 12), planeMat);
  fuselage.rotation.z = Math.PI / 2;
  plane.add(fuselage);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 4.2), planeMat);
  plane.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.08), new THREE.MeshStandardMaterial({ color: 0x2f6fd0 }));
  tail.position.set(-1.6, 0.5, 0);
  plane.add(tail);
  plane.position.set(-30, altitude(4), -10);
  scene.add(plane);
  // A satellite at about 15×
  const sat = new THREE.Group();
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xd9b25e, metalness: 1, roughness: 0.3 })));
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.8), new THREE.MeshStandardMaterial({ color: 0x23408f, metalness: 0.6, roughness: 0.25 }));
    panel.position.x = s * 1.6;
    sat.add(panel);
  }
  sat.position.set(5, altitude(15), -6);
  scene.add(sat);
  // The moon, far away
  const moon = new THREE.Mesh(new THREE.SphereGeometry(22, 48, 32), new THREE.MeshStandardMaterial({ map: keep(tex(moonCanvas(), renderer)), roughness: 1, emissive: 0x2a2a28 }));
  moon.position.set(-55, altitude(40), -170);
  scene.add(moon);
  // A UFO at about 120×
  const ufo = new THREE.Group();
  ufo.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 12).scale(1, 0.28, 1), new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.9, roughness: 0.25 })));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 12, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.6, roughness: 0.1 }));
  dome.position.y = 0.3;
  ufo.add(dome);
  const ufoLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 10);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    ufoLights.setMatrixAt(k, new THREE.Matrix4().makeTranslation(Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45));
    ufoLights.setColorAt(k, new THREE.Color().setHSL(k / 10, 1, 0.6).multiplyScalar(2.5));
  }
  glow(ufoLights);
  ufo.add(ufoLights);
  ufo.position.set(7, altitude(120), -12);
  scene.add(ufo);
  // Stars: a shell that follows the camera, fading in with altitude
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(300);
    starPos.set([v.x, Math.abs(v.y) * 0.9 + 10, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ---- Particles: smoke, debris and feathers (each one instanced mesh) ----
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), eul = new THREE.Euler(), col = new THREE.Color();
  function pool(geo, mat, max) {
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return { mesh, list: [], max };
  }
  const smoke = pool(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 220);
  const debris = pool(new THREE.BoxGeometry(0.16, 0.08, 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), 40);
  const feathers = pool(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), 70);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.8), transparent: true, opacity: 0 }));
  flash.visible = false;
  glow(flash);
  scene.add(flash);
  function puffAt(p, n, spread, up, big, dark = false) {
    for (let i = 0; i < n; i++) {
      if (smoke.list.length >= smoke.max) smoke.list.shift();
      smoke.list.push({
        p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)),
        v: new THREE.Vector3((Math.random() - 0.5) * 2.4 * spread, up * (0.4 + Math.random() * 0.6), (Math.random() - 0.5) * 2.4 * spread),
        age: 0, life: 1.6 + Math.random() * 1.6, s0: 0.15 * big, s1: (0.6 + Math.random() * 0.6) * big, shade: dark ? 0.25 + Math.random() * 0.2 : 0.75 + Math.random() * 0.25,
      });
    }
  }
  function stepParticles(dt) {
    smoke.list = smoke.list.filter(s => (s.age += dt) < s.life);
    smoke.list.forEach((s, i) => {
      s.p.addScaledVector(s.v, dt);
      s.v.multiplyScalar(Math.pow(0.25, dt));
      const k = s.age / s.life;
      const size = (s.s0 + (s.s1 - s.s0) * Math.min(1, k * 2)) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      smoke.mesh.setMatrixAt(i, m4.compose(s.p, q.identity(), sc.setScalar(Math.max(0.001, size))));
      smoke.mesh.setColorAt(i, col.setScalar(s.shade));
    });
    smoke.mesh.count = smoke.list.length;
    debris.list = debris.list.filter(d => (d.age += dt) < 3.5);
    debris.list.forEach((d, i) => {
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      debris.mesh.setMatrixAt(i, m4.compose(d.p, q.setFromEuler(d.r), sc.setScalar(1)));
      debris.mesh.setColorAt(i, d.c);
    });
    debris.mesh.count = debris.list.length;
    feathers.list = feathers.list.filter(f => (f.age += dt) < 6);
    feathers.list.forEach((f, i) => {
      f.v.multiplyScalar(Math.pow(0.15, dt));
      f.p.addScaledVector(f.v, dt);
      f.p.y -= 0.55 * dt;
      f.p.x += Math.sin(f.phase + f.age * 3) * 0.6 * dt;
      eul.set(Math.sin(f.age * 4 + f.phase) * 0.9, f.phase + f.age, Math.cos(f.age * 3 + f.phase) * 0.6);
      feathers.mesh.setMatrixAt(i, m4.compose(f.p, q.setFromEuler(eul), sc.setScalar(1)));
      feathers.mesh.setColorAt(i, f.c);
    });
    feathers.mesh.count = feathers.list.length;
    for (const pl of [smoke, debris, feathers]) {
      pl.mesh.instanceMatrix.needsUpdate = true;
      if (pl.mesh.instanceColor) pl.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---- HUD and overlays ----
  const winFx = createWinFx(stage);
  const hudEl = document.createElement('div');
  hudEl.className = 'cr-hud';
  hudEl.innerHTML = '<div class="cr-hist"></div><div class="cr-mult">1.00×</div><div class="cr-line"></div>';
  const histEl = hudEl.querySelector('.cr-hist');
  const multEl = hudEl.querySelector('.cr-mult');
  const lineEl = hudEl.querySelector('.cr-line');
  const toastEl = document.createElement('div');
  toastEl.className = 'cr-toast';
  stage.append(hudEl, toastEl);
  function toast(text) {
    toastEl.textContent = text;
    gsap.killTweensOf(toastEl);
    gsap.timeline().fromTo(toastEl, { y: 16, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' })
      .to(toastEl, { y: -16, opacity: 0, duration: 0.4 }, '+=1.4');
  }

  // ---- State ----
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { /* storage unavailable */ }
  let credits = Math.round(loadCredits());
  let bet = BETS.includes(saved.bet) ? saved.bet : 25;
  let auto = AUTOS.includes(saved.auto) ? saved.auto : 2;
  let history = Array.isArray(saved.history) ? saved.history.filter(Number.isFinite).slice(0, 12) : [];
  const sound = makeSound();
  sound.on = saved.sound !== false;
  const persist = () => {
    saveCredits(credits);
    try { localStorage.setItem(STORE, JSON.stringify({ bet, auto, history, sound: sound.on })); } catch (e) { /* storage unavailable */ }
  };
  // idle: on the pad · countdown · flying · over: blown up
  const st = { state: 'idle', crashAt: 1, stake: 0, cashed: 0, t0: 0, flightT: 0, count: 0, milestone: 0, engine: null, overAt: 0 };
  const shake = { amp: 0 };
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function hud() {
    info.textContent = `Credits ${money(credits)} · Bet ${money(bet)}`;
    betBtn.textContent = `Bet ${money(bet)}`;
    autoBtn.textContent = auto ? `Auto ${auto}×` : 'Auto off';
    autoBtn.setAttribute('aria-pressed', String(!!auto));
    const flying = st.state === 'flying';
    goBtn.textContent = flying && !st.cashed ? 'Cash out' : st.state === 'countdown' ? 'Launching…' : 'Launch';
    goBtn.disabled = st.state === 'countdown' || (flying && !!st.cashed);
    betBtn.disabled = autoBtn.disabled = st.state === 'countdown' || flying;
  }
  function paintHistory() {
    histEl.textContent = '';
    for (const m of history) {
      const s = document.createElement('span');
      s.textContent = fmt(m);
      if (m >= 2) s.className = 'good';
      histEl.appendChild(s);
    }
  }
  function currentMult() {
    if (st.state !== 'flying') return st.state === 'over' ? st.crashAt : 1;
    return Math.min(st.crashAt, multAt(st.flightT));
  }

  // ---- A round ----
  function launch() {
    if (st.state === 'countdown' || st.state === 'flying') return;
    sound.unlock();
    if (credits < BETS[0]) {
      credits += LAB_START;
      persist();
      hud();
      lineEl.textContent = 'Out of credits. The duck lent you $1,000.';
      sound.quack();
      return;
    }
    if (credits < bet) {
      bet = [...BETS].reverse().find(b => b <= credits);
      persist();
      hud();
      lineEl.textContent = `Bet lowered to ${money(bet)}.`;
      return;
    }
    credits -= bet;
    st.stake = bet;
    st.crashAt = crashPoint(rand);
    st.cashed = 0;
    st.milestone = 0;
    st.flightT = 0;
    persist();
    winFx.hideTitle();
    // Back on the pad, all in one piece
    rocket.visible = true;
    rocket.position.set(0, PAD_TOP, 0);
    rocket.rotation.set(0, 0, 0);
    seatDuck();
    flame.visible = false;
    debris.list = [];
    feathers.list = [];
    multEl.className = 'cr-mult';
    multEl.textContent = '1.00×';
    st.state = 'countdown';
    st.count = calm ? 0 : 3;
    buzz(10);
    countdown();
    hud();
  }
  function countdown() {
    if (st.state !== 'countdown') return;
    if (st.count > 0) {
      lineEl.textContent = String(st.count);
      gsap.fromTo(lineEl, { scale: 1.8 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' });
      sound.note(660, 0.12, { type: 'square', vol: 0.08 });
      puffAt(new THREE.Vector3(0, PAD_TOP + 0.1, 0), 4, 1.2, 0.8, 1);
      shake.amp = Math.max(shake.amp, 0.02);
      st.count--;
      later(countdown, 520);
      return;
    }
    lineEl.textContent = 'QUACK-OFF!';
    sound.note(990, 0.3, { type: 'square', vol: 0.08 });
    sound.quack(0.05);
    st.state = 'flying';
    st.t0 = performance.now() / 1000;
    st.engine = sound.engine();
    flame.visible = true;
    puffAt(new THREE.Vector3(0, PAD_TOP + 0.1, 0), 16, 1.8, 1.2, 1.2);
    shake.amp = 0.08;
    buzz([20, 30, 20]);
    hud();
  }
  function cashOut(at) {
    if (st.state !== 'flying' || st.cashed) return;
    const m = at || currentMult();
    if (m > st.crashAt || (!at && m >= st.crashAt)) return;
    st.cashed = m;
    const win = Math.round(st.stake * m);
    credits += win;
    persist();
    multEl.className = 'cr-mult cashed';
    lineEl.textContent = `Cashed out at ${fmt(m)} · +${money(win - st.stake)}`;
    // The duck ejects and floats down under its parachute
    const wp = duck.getWorldPosition(new THREE.Vector3());
    scene.add(duck);
    duck.position.copy(wp);
    chute.visible = true;
    gsap.fromTo(chute.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' });
    duck.userData.vy = 4;
    sound.win(m >= 5 ? 3 : 2);
    sound.quack(0.2);
    buzz([15, 50, 25]);
    winFx.float(`+${money(win)}`, view.w / 2, view.h * 0.42, { color: '#7cff6b' });
    if (m >= 10) { winFx.showTitle('HUGE CASH OUT', win, { jackpot: m >= 50 }); if (!calm) winFx.cannons(m >= 50 ? 2 : 1); }
    hud();
  }
  function explode() {
    st.state = 'over';
    st.overAt = performance.now() / 1000;
    if (st.engine) { st.engine.stop(); st.engine = null; }
    flame.visible = false;
    rocket.visible = false;
    const at = rocket.position.clone().add(new THREE.Vector3(0, 1, 0));
    flash.visible = true;
    flash.position.copy(at);
    gsap.fromTo(flash.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 4, y: 4, z: 4, duration: 0.5, ease: 'power2.out' });
    gsap.fromTo(flash.material, { opacity: 1 }, { opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: () => { flash.visible = false; } });
    for (let i = 0; i < debris.max; i++) {
      debris.list.push({
        p: at.clone(), v: new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 5).add(new THREE.Vector3(0, 3, 0)),
        r: new THREE.Euler(Math.random() * TAU, Math.random() * TAU, 0), w: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
        age: 0, c: new THREE.Color(i % 3 ? 0xf4f2ec : 0xd8243a),
      });
    }
    for (let i = 0; i < feathers.max; i++) {
      feathers.list.push({
        p: at.clone(), v: new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 4),
        phase: Math.random() * TAU, age: 0, c: new THREE.Color(i % 4 ? 0xfff6dc : 0xffcf1a),
      });
    }
    puffAt(at, 16, 1.2, 0.5, 1, true);
    shake.amp = 0.3;
    sound.boom();
    if (!st.cashed) {
      // The duck is fine. Singed, but fine.
      const wp = duck.getWorldPosition(new THREE.Vector3());
      scene.add(duck);
      duck.position.copy(wp);
      duck.userData.vy = 6;
      duck.userData.spin = 9;
      later(() => { if (st.state === 'over') { chute.visible = true; gsap.fromTo(chute.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' }); } }, 900);
      sound.quack(0.6);
      sound.sad();
      buzz([60, 40, 120]);
      lineEl.textContent = `Crashed. You lost ${money(st.stake)}.`;
    } else {
      lineEl.textContent = `You cashed out at ${fmt(st.cashed)}. It went to ${fmt(st.crashAt)}.`;
    }
    multEl.className = 'cr-mult crashed';
    multEl.textContent = st.crashAt <= 1 ? 'BOOM @ 1.00×' : `${fmt(st.crashAt)}`;
    history.unshift(st.crashAt);
    history = history.slice(0, 12);
    persist();
    paintHistory();
    hud();
  }

  // ---- Controls ----
  const betBtn = button('', () => {
    if (st.state === 'countdown' || st.state === 'flying') return;
    bet = BETS[(BETS.indexOf(bet) + 1) % BETS.length];
    persist();
    hud();
    buzz(5);
  });
  const autoBtn = button('', () => {
    if (st.state === 'countdown' || st.state === 'flying') return;
    auto = AUTOS[(AUTOS.indexOf(auto) + 1) % AUTOS.length];
    persist();
    hud();
    buzz(5);
  });
  const goBtn = button('Launch', () => (st.state === 'flying' ? cashOut() : launch()), 'primary');
  const soundBtn = button('', () => {
    sound.on = !sound.on;
    if (sound.on) { sound.unlock(); sound.quack(); }
    else if (st.engine) { st.engine.stop(); st.engine = null; }
    persist();
    soundLabel();
  });
  const soundLabel = () => {
    soundBtn.textContent = sound.on ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
    soundBtn.setAttribute('aria-pressed', String(sound.on));
  };
  soundLabel();
  controls.append(betBtn, autoBtn, goBtn, soundBtn);
  function onKey(e) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (st.state === 'flying') cashOut(); else launch();
  }
  window.addEventListener('keydown', onKey);
  paintHistory();
  lineEl.textContent = 'Set a bet and an auto cash-out, then Launch';
  hud();

  // ---- Loop ----
  const look = new THREE.Vector3(0, 1.6, 0);
  const camPos = new THREE.Vector3(2.8, 2.3, 7);
  let raf = 0;
  let last = performance.now();
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    const gap = (nowMs - last) / 1000;          // real time since the last frame
    const dt = Math.min(0.05, gap);             // capped, for animation
    last = nowMs;
    const now = nowMs / 1000;
    fit();

    if (st.state === 'flying') {
      // The flight runs on the real clock (a stutter or a hidden tab doesn't slow it). After you
      // cash out it fast-forwards, so you see how far it would have gone.
      st.flightT += gap * (st.cashed && !calm ? 3 : 1);
      let m = multAt(st.flightT);
      if (auto && !st.cashed && auto <= st.crashAt && m >= auto) cashOut(auto);
      if (m >= st.crashAt) {
        m = st.crashAt;
        rocket.position.y = PAD_TOP + altitude(m);
        explode();
      } else {
        rocket.position.y = PAD_TOP + altitude(m);
        rocket.rotation.z = Math.sin(now * 3) * 0.03;
        multEl.textContent = fmt(m);
        if (!st.cashed) multEl.style.color = m >= 10 ? '#ff5d6c' : m >= 5 ? '#ffb340' : m >= 2 ? '#ffe27a' : '';
        else multEl.style.color = '';
        if (st.engine) st.engine.set(m);
        if (Math.random() < 0.9) puffAt(rocket.position.clone().add(new THREE.Vector3(0, -0.2, 0)), 1, 0.3, -1.5, 0.8 + Math.min(1, altitude(m) / 60));
        shake.amp = Math.max(shake.amp, 0.01 + 0.006 * Math.log2(m));
        while (st.milestone < MILESTONES.length && m >= MILESTONES[st.milestone][0]) toast(MILESTONES[st.milestone++][1]);
        if (Math.floor(now * 4) !== Math.floor((now - dt) * 4)) {
          hud();
          if (!st.cashed) lineEl.textContent = `Cash out now for ${money(st.stake * m)}`;
        }
      }
      outer.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      inner.scale.set(1, 0.8 + Math.random() * 0.4, 1);
    } else if (st.state === 'countdown') {
      if (Math.random() < 0.35) puffAt(new THREE.Vector3(0, PAD_TOP + 0.1, 0), 1, 1.4, 0.6, 0.9);
    } else {
      multEl.style.color = '';
    }

    // The duck, once it's left the rocket: up a little, then down under its parachute
    if (duck.parent === scene) {
      const vy = (duck.userData.vy || 0) - 9.8 * dt;
      duck.userData.vy = chute.visible ? Math.max(vy, -1.4) : vy;
      duck.position.y = Math.max(PAD_TOP, duck.position.y + duck.userData.vy * dt);
      duck.position.x += 0.4 * dt;
      duck.rotation.z = chute.visible ? Math.sin(now * 2) * 0.25 : duck.rotation.z + (duck.userData.spin || 0) * dt;
    }

    // Plane crosses, satellite turns, UFO wobbles
    plane.position.x = -40 + ((now * 6) % 80);
    sat.rotation.y += dt * 0.4;
    ufo.rotation.y += dt * 1.5;
    ufo.position.x = 7 + Math.sin(now * 0.8) * 3;
    stepParticles(dt);

    // Camera: follows the rocket up, or the duck on its way down once the rocket is gone
    const subject = st.state === 'over' && duck.parent === scene && now - st.overAt > 1.4 ? duck.position : rocket.position;
    const flyingUp = st.state === 'flying' || st.state === 'over';
    const targetY = subject.y + (flyingUp ? 1.6 : 1.4);
    look.lerp(new THREE.Vector3(subject.x * 0.5, targetY, 0), 1 - Math.pow(0.02, dt));
    const wantPos = new THREE.Vector3(subject.x * 0.5 + 2.8, targetY + 0.7, flyingUp ? 8 : 7);
    camPos.lerp(wantPos, 1 - Math.pow(0.03, dt));
    shake.amp *= Math.pow(0.05, dt);
    camera.position.copy(camPos).add(new THREE.Vector3((Math.random() - 0.5) * shake.amp, (Math.random() - 0.5) * shake.amp, 0));
    camera.lookAt(look);

    // Sky by altitude, stars in space
    const y = camera.position.y;
    scene.background.copy(skyAt(y));
    hemi.intensity = 1.1 - Math.min(0.8, y / 140);
    starMat.opacity = Math.min(1, Math.max(0, (y - 55) / 50));
    stars.position.set(camera.position.x, camera.position.y - 10, camera.position.z);

    composer.render(dt);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      // Leaving mid-flight cashes out at the current multiplier; leaving during the countdown refunds
      if (st.state === 'flying' && !st.cashed) {
        const m = multAt(st.flightT);
        if (m < st.crashAt) credits += Math.round(st.stake * m);
      } else if (st.state === 'countdown') credits += st.stake;
      saveCredits(credits);
      if (st.engine) st.engine.stop();
      gsap.killTweensOf([toastEl, lineEl, flash.scale, flash.material, chute.scale]);
      window.removeEventListener('keydown', onKey);
      winFx.dispose();
      sound.close();
      hudEl.remove();
      toastEl.remove();
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
