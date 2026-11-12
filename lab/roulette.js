// 3D roulette: a Three.js wheel with a cannon-es physics ball.
//
// Everything is in meters at real scale (the wheel is about 89 cm across). The bowl
// and ball track are a static triangle mesh, the rotor is a kinematic body that
// spins with 37 chrome frets, and the ball is a real rigid body: it rides the track,
// slows down, falls, bounces off the deflectors and frets, and settles in a pocket.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { makeRenderer, fitRenderer, disposeScene, fontReady, casinoQuality, frameGovernor } from './shared.js';

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const STEP = (Math.PI * 2) / 37;
const colorName = n => (n === 0 ? 'Green' : REDS.has(n) ? 'Red' : 'Black');
const colorHex = n => (n === 0 ? '#12804c' : REDS.has(n) ? '#b3202b' : '#141518');

const BALL_R = 0.0095;
// Profiles are [radius, height] pairs, spun around the vertical axis
const BOWL_OUTER = [[0.445, 0.0], [0.445, 0.07], [0.432, 0.083], [0.402, 0.08], [0.4, 0.046]];
const TRACK = [[0.4, 0.046], [0.315, 0.022], [0.306, 0.0205]];
const PHYS_BOWL = [[0.43, 0.11], [0.4, 0.11], [0.4, 0.046], [0.315, 0.022], [0.306, 0.0205]];
const ROTOR_RING = [[0.305, 0.0205], [0.255, 0.012], [0.255, 0.0], [0.19, 0.004], [0.19, 0.018]];   // pocket floors tip outward, like a real wheel
const CONE = [[0.19, 0.018], [0.13, 0.032], [0.06, 0.05], [0.0, 0.053]];
const TURRET = [[0.0, 0.05], [0.032, 0.05], [0.03, 0.058], [0.014, 0.068], [0.008, 0.105], [0.015, 0.115], [0.011, 0.126], [0.0, 0.128]];

const v2 = pts => pts.map(([r, y]) => new THREE.Vector2(r, y));

function latheTrimesh(profile, segments) {
  const verts = [];
  const idx = [];
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    for (const [r, y] of profile) verts.push(r * Math.cos(a), y, r * Math.sin(a));
  }
  const P = profile.length;
  for (let j = 0; j < segments; j++) {
    const j2 = (j + 1) % segments;
    for (let k = 0; k < P - 1; k++) {
      const a = j * P + k, b = j * P + k + 1, c = j2 * P + k, d = j2 * P + k + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return new CANNON.Trimesh(verts, idx);
}

// Top-down texture coordinates, so one painted image of the wheel lines up on any surface
function planarUV(geo, R) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (2 * R) + 0.5;
    uv[i * 2 + 1] = 0.5 - pos.getZ(i) / (2 * R);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function wheelTexture(renderer, S = 2048) {
  const R = 0.31, k = S / 2 / R;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  for (let i = 0; i < 37; i++) {
    const n = WHEEL[i];
    const a0 = i * STEP - STEP / 2, a1 = a0 + STEP;
    g.fillStyle = colorHex(n);
    g.beginPath(); g.arc(0, 0, 0.307 * k, a0, a1); g.arc(0, 0, 0.255 * k, a1, a0, true); g.closePath(); g.fill();
    g.fillStyle = n === 0 ? '#0c5c36' : REDS.has(n) ? '#8a1720' : '#0c0d10';
    g.beginPath(); g.arc(0, 0, 0.255 * k, a0, a1); g.arc(0, 0, 0.188 * k, a1, a0, true); g.closePath(); g.fill();
    g.save();
    g.rotate(i * STEP);
    g.translate(0.281 * k, 0);
    g.rotate(-Math.PI / 2);   // tops of the numbers face the center, so the near side reads upright
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(0.029 * k)}px Manrope, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 0, 0);
    g.restore();
  }
  g.strokeStyle = '#d8b25a';
  g.lineWidth = 5;
  for (let i = 0; i < 37; i++) {
    const a = i * STEP + STEP / 2;
    g.beginPath(); g.moveTo(Math.cos(a) * 0.255 * k, Math.sin(a) * 0.255 * k); g.lineTo(Math.cos(a) * 0.307 * k, Math.sin(a) * 0.307 * k); g.stroke();
  }
  for (const r of [0.255, 0.3045]) { g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Eight brass deflectors on the track, alternating along and across it
function deflectorLayout() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r = 0.356;
    const y = 0.022 + ((r - 0.315) / 0.085) * 0.024 + 0.004;
    const half = i % 2 === 0 ? { x: 0.005, y: 0.004, z: 0.014 } : { x: 0.013, y: 0.004, z: 0.005 };
    out.push({ a, r, y, half });
  }
  return out;
}

/* The physics, separate from the graphics so it can be tested without a screen.
   Returns the world, the bodies, where the deflectors sit, and helpers to launch the
   ball, advance time, and read which pocket it is in. */
export function createWheelPhysics(rand = Math.random) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.solver.iterations = 12;
  const mWood = new CANNON.Material('wood');
  const mMetal = new CANNON.Material('metal');
  const mBall = new CANNON.Material('ball');
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mWood, { friction: 0.012, restitution: 0.38 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mMetal, { friction: 0.02, restitution: 0.6 }));

  const bowlBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: mWood });
  bowlBody.addShape(latheTrimesh(PHYS_BOWL, 160));   // a smooth wall: coarse facets kick a fast ball into the air
  // Eight brass deflectors on the track, alternating along and across it
  const deflectors = deflectorLayout();
  for (const { a, r, y, half: h } of deflectors) {
    const half = new CANNON.Vec3(h.x, h.y, h.z);
    const shape = new CANNON.Box(half);
    shape.material = mMetal;
    bowlBody.addShape(shape, new CANNON.Vec3(r * Math.cos(a), y, r * Math.sin(a)), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a));
  }
  world.addBody(bowlBody);

  // Rotor: kinematic, so it spins and pushes the ball but nothing pushes it
  const rotorBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: mWood });
  rotorBody.addShape(latheTrimesh(ROTOR_RING, 74));
  rotorBody.addShape(latheTrimesh(CONE, 48));
  for (let i = 0; i < 37; i++) {
    const a = i * STEP + STEP / 2;
    const r = (0.19 + 0.255) / 2;
    const fret = new CANNON.Box(new CANNON.Vec3(0.033, 0.0065, 0.0015));
    fret.material = mMetal;
    rotorBody.addShape(fret, new CANNON.Vec3(r * Math.cos(a), 0.0065, r * Math.sin(a)), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a));
  }
  world.addBody(rotorBody);

  const ballBody = new CANNON.Body({ mass: 0.0055, shape: new CANNON.Sphere(BALL_R), material: mBall, linearDamping: 0.035, angularDamping: 0.2 });
  ballBody.allowSleep = false;
  let inWorld = false;
  const state = { omega: 1.1, spinning: false, still: 0, time: 0, phase: 'idle', theta: 0, v: 0 };
  const WALL_R = 0.3902;
  const WALL_Y = 0.0532;
  const TAU = 4.2;       // how quickly the ball loses speed while it circles the wall (seconds)
  const DROP_V = 1.35;   // below this speed (m/s) it leaves the wall and physics takes over

  // While the ball is fast it just circles the outer wall, so that part is calculated directly
  // (a faceted wall makes a physics engine kick a fast ball into the air). Once it slows,
  // the physics engine takes over for the fall, the deflectors, the frets and the settle.
  function placeOnWall() {
    const c = Math.cos(state.theta), s = Math.sin(state.theta);
    ballBody.position.set(WALL_R * c, WALL_Y, WALL_R * s);
    ballBody.velocity.set(-s * state.v, 0, c * state.v);
  }

  return {
    world, rotorBody, ballBody, deflectors, state,
    launch() {
      if (inWorld) { world.removeBody(ballBody); inWorld = false; }
      state.theta = rand() * Math.PI * 2;
      state.v = 4.6 + rand() * 1.1;
      state.omega = 1.0 + rand() * 0.3;
      state.phase = 'track';
      state.spinning = true;
      state.still = 0;
      state.time = 0;
      ballBody.angularVelocity.set(0, 0, 0);
      placeOnWall();
    },
    // Advance by dt seconds; returns 'idle', 'rolling', 'landed' or 'escaped'
    step(dt) {
      state.omega *= Math.exp(-dt / 45);
      rotorBody.angularVelocity.set(0, state.omega, 0);
      if (state.phase === 'track') {
        state.v *= Math.exp(-dt / TAU);
        state.theta += (state.v / WALL_R) * dt;    // against the rotor's spin
        placeOnWall();
        if (state.v < DROP_V) {
          state.phase = 'free';
          world.addBody(ballBody);
          inWorld = true;
        }
      }
      world.step(1 / 360, dt, 24);
      if (!state.spinning) return 'idle';
      state.time += dt;
      if (state.phase === 'track') return 'rolling';
      const p = ballBody.position, v = ballBody.velocity;
      const r = Math.hypot(p.x, p.z);
      if (p.y < -0.15 || r > 0.6) return 'escaped';
      const rel = Math.hypot(v.x - state.omega * p.z, v.y, v.z + state.omega * p.x);
      state.still = rel < 0.04 && r > 0.18 && r < 0.262 && p.y < 0.022 ? state.still + dt : 0;
      if (state.still > 0.9 || state.time > 35) { state.spinning = false; state.phase = 'rest'; return 'landed'; }
      return 'rolling';
    },
    pocket() {
      const p = ballBody.position;
      const q = rotorBody.quaternion;
      const yaw = 2 * Math.atan2(q.y, q.w);
      let local = Math.atan2(p.z, p.x) + yaw;
      local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return WHEEL[Math.round(local / STEP) % 37];
    },
  };
}

/* The wheel's scene: table, bowl, rotor, ball and lights, shared by the lab demo and the
   casino's spin screen. opts go to makeRenderer; shadow sets the shadow map's size. */
function buildWheel(stage, opts = {}) {
  const { renderer, envTex } = makeRenderer(stage, opts);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907);
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0x0b0907, 3.5, 7);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 20);
  // The whole wheel in view, from a seat at the table
  function homeView(elevDeg = 52, margin = 0.53) {
    fitRenderer(renderer, camera, stage);
    const fit = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1.15);
    const d = margin / fit;
    const elev = THREE.MathUtils.degToRad(elevDeg);
    camera.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d);
    camera.lookAt(0, 0.02, 0);
  }

  // ---- Lights ----
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a0f08, 0.5));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(0.55, 1.6, 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(opts.shadow || 2048, opts.shadow || 2048);
  Object.assign(key.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.5, far: 4 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.002;
  key.shadow.radius = 4;
  scene.add(key);

  // ---- Materials ----
  const wood = new THREE.MeshPhysicalMaterial({ color: 0x47210f, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
  const trackWood = new THREE.MeshPhysicalMaterial({ color: 0x7a4422, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
  const coneWood = new THREE.MeshPhysicalMaterial({ color: 0x5c2f14, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9b25e, metalness: 1, roughness: 0.22 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.12 });
  const ivory = new THREE.MeshPhysicalMaterial({ color: 0xfbf8f0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 });
  const ringMat = new THREE.MeshPhysicalMaterial({ map: wheelTexture(renderer, opts.texture), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, side: THREE.DoubleSide });

  // ---- Table and bowl (static) ----
  const felt = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0x0d5536, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = -0.001;
  felt.receiveShadow = true;
  scene.add(felt);

  const bowl = new THREE.Mesh(new THREE.LatheGeometry(v2(BOWL_OUTER), 160), wood);
  const track = new THREE.Mesh(new THREE.LatheGeometry(v2(TRACK), 160), trackWood);
  bowl.receiveShadow = track.receiveShadow = true;
  bowl.castShadow = true;
  scene.add(bowl, track);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.432, 0.0055, 16, 180), brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.083;
  scene.add(rim);

  // ---- Deflectors ----
  for (const { a, r, y, half } of deflectorLayout()) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), brass);
    gem.scale.set(half.x * 1.3, half.y * 1.6, half.z * 1.3);
    gem.position.set(r * Math.cos(a), y, r * Math.sin(a));
    gem.rotation.y = -a;
    gem.castShadow = true;
    scene.add(gem);
  }

  // ---- Rotor ----
  const rotor = new THREE.Group();
  const ringGeo = new THREE.LatheGeometry(v2(ROTOR_RING), 222);
  planarUV(ringGeo, 0.31);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.receiveShadow = true;
  const cone = new THREE.Mesh(new THREE.LatheGeometry(v2(CONE), 96), coneWood);
  cone.receiveShadow = true;
  const turret = new THREE.Mesh(new THREE.LatheGeometry(v2(TURRET), 48), brass);
  turret.castShadow = true;
  rotor.add(ring, cone, turret);
  // The turret's cross: two brass bars with a knob on each end
  for (let i = 0; i < 2; i++) {
    const bar = new THREE.Group();
    bar.rotation.y = (i * Math.PI) / 2;
    bar.position.y = 0.093;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 12), brass);
    arm.rotation.z = Math.PI / 2;
    const knobA = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), brass);
    const knobB = knobA.clone();
    knobA.position.x = 0.065;
    knobB.position.x = -0.065;
    for (const m of [arm, knobA, knobB]) m.castShadow = true;
    bar.add(arm, knobA, knobB);
    rotor.add(bar);
  }
  const fretGeo = new THREE.BoxGeometry(0.066, 0.013, 0.003);
  for (let i = 0; i < 37; i++) {
    const a = i * STEP + STEP / 2;
    const r = (0.19 + 0.255) / 2;
    const m = new THREE.Mesh(fretGeo, chrome);
    m.position.set(r * Math.cos(a), 0.0065, r * Math.sin(a));
    m.rotation.y = -a;
    m.castShadow = true;
    rotor.add(m);
  }
  const rotorRim = new THREE.Mesh(new THREE.TorusGeometry(0.3055, 0.0025, 10, 160), chrome);
  rotorRim.rotation.x = Math.PI / 2;
  rotorRim.position.y = 0.0205;
  rotor.add(rotorRim);
  scene.add(rotor);

  // ---- Ball ----
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), ivory);
  ball.castShadow = true;
  ball.visible = false;
  scene.add(ball);
  const glow = new THREE.PointLight(0xffd27a, 0, 0.25, 2);
  scene.add(glow);

  return { renderer, envTex, scene, camera, homeView, rotor, ball, glow, felt };
}

/* ================= The casino's spin screen =================
   The casino's server picks the number; the wheel has to land on it. Every pocket is the
   same shape, so a spin recorded with the physics can be made to land on any number by
   turning the whole rotor a whole number of pockets before playing it back: the ball rolls
   exactly as recorded and falls into the same slot, which now carries the right number.
   Recording takes a moment on a phone, so the next spin is recorded in the background
   while the player bets (a few milliseconds at a time), and is ready when they tap Spin. */

const REC_FPS = 60;
const FRAME = 8;   // per frame: rotor yaw, ball x y z, ball quaternion x y z w
// A recording in progress: call work(ms) until it returns true, then read rec
export function recordSpin(rand = Math.random) {
  let phys = null, buf = null, n = 0, drop = 0;
  const job = { rec: null };
  function start() {
    phys = createWheelPhysics(rand);
    phys.launch();
    buf = new Float32Array(FRAME * REC_FPS * 40);
    n = 0;
    drop = 0;
  }
  start();
  job.work = budget => {
    if (job.rec) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      const st = phys.step(1 / REC_FPS);
      const q = phys.rotorBody.quaternion, p = phys.ballBody.position, bq = phys.ballBody.quaternion;
      if (n * FRAME + FRAME > buf.length) { start(); continue; }   // never settled: start again
      buf.set([2 * Math.atan2(q.y, q.w), p.x, p.y, p.z, bq.x, bq.y, bq.z, bq.w], n * FRAME);
      n++;
      if (!drop && phys.state.phase === 'free') drop = n;
      if (st === 'escaped') { start(); continue; }    // jumped the wheel: record another
      if (st === 'landed') {
        job.rec = { frames: buf.subarray(0, n * FRAME), count: n, drop: drop || n, landed: WHEEL.indexOf(phys.pocket()) };
        return true;
      }
    }
    return false;
  };
  return job;
}

let nextSpin = null;   // the recording waiting for the next Spin, kept across mounts
function keepRecording() {
  if (!nextSpin) nextSpin = recordSpin();
  const job = nextSpin;
  if (job.rec || job.busy) return;
  job.busy = true;
  const tick = () => {
    if (job.rec) return;                       // finished (maybe by play)
    if (document.visibilityState === 'hidden') { setTimeout(tick, 500); return; }
    if (!job.work(6)) setTimeout(tick, 16);
  };
  setTimeout(tick, 0);
}

/* Mount the wheel in `container` (sized by the page). Returns { play(result, onLanded),
   skip(), dispose() }: play shows a spin that lands on `result` and calls onLanded once
   the ball settles; skip jumps to the end. Nothing is drawn while no spin is playing. */
export async function mountCasinoWheel(container) {
  await fontReady();
  const Q = casinoQuality();
  const W = buildWheel(container, { maxDpr: Q.maxDpr, alpha: true, shadow: Q.shadow, softShadows: Q.softShadows, texture: Q.texture });
  const { renderer, envTex, scene, camera, rotor, ball, glow } = W;
  scene.background = null;
  // No table top: the page's own background shows through, with the wheel's shadow on it
  W.felt.material.dispose();
  W.felt.material = new THREE.ShadowMaterial({ opacity: 0.45 });
  keepRecording();
  // Get the graphics chip ready for every material now, so the first spin doesn't stutter
  try {
    ball.visible = true;
    W.homeView(56, 0.5);
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* it compiles on the first frame instead */ }
  ball.visible = false;

  const Y = new THREE.Vector3(0, 1, 0);
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  let play = null, raf = 0, disposed = false;
  const TRACK_RATE = 1.6;   // the ball's laps on the wall play faster than life,
  const FREE_RATE = 1.15;   // and the drop and bounces a touch faster

  function poseAt(f) {
    const { rec, offset } = play;
    const i = Math.min(rec.count - 1, Math.floor(f)), j = Math.min(rec.count - 1, i + 1), t = f - Math.floor(f);
    const a = rec.frames, A = i * FRAME, B = j * FRAME;
    const lerp = k => a[A + k] + (a[B + k] - a[A + k]) * t;
    rotor.quaternion.setFromAxisAngle(Y, lerp(0) + offset);
    ball.position.set(lerp(1), lerp(2), lerp(3));
    q1.set(a[A + 4], a[A + 5], a[A + 6], a[A + 7]);
    q2.set(a[B + 4], a[B + 5], a[B + 6], a[B + 7]);
    ball.quaternion.slerpQuaternions(q1, q2, t);
    glow.position.set(ball.position.x, ball.position.y + 0.03, ball.position.z);
  }
  const secsOf = rec => (rec.count - rec.drop) / REC_FPS / FREE_RATE + rec.drop / REC_FPS / TRACK_RATE;
  // Frame index for a time since the spin started, with the faster laps at the start
  function frameAt(sec) {
    const { rec } = play;
    const lapSec = rec.drop / REC_FPS / TRACK_RATE;
    return sec < lapSec ? sec * TRACK_RATE * REC_FPS : rec.drop + (sec - lapSec) * FREE_RATE * REC_FPS;
  }
  const governor = frameGovernor(renderer, scene);
  function draw(now) {
    if (!play) return;
    if (governor.tick(now)) W.homeView.lastW = -1;
    if (W.homeView.lastW !== container.clientWidth || W.homeView.lastH !== container.clientHeight) {
      W.homeView(56, 0.5);
      W.homeView.lastW = container.clientWidth;
      W.homeView.lastH = container.clientHeight;
    }
    const f = play.skipped ? play.rec.count - 1 : frameAt((now - play.t0) / 1000);
    poseAt(f);
    renderer.render(scene, camera);
    if (f >= play.rec.count - 1) {
      glow.intensity = 0.6;
      renderer.render(scene, camera);
      const done = play.onLanded;
      play = null;
      governor.idle();
      keepRecording();               // record the next spin now the ball has stopped
      if (done) done();
      return;
    }
    raf = requestAnimationFrame(draw);
  }

  return {
    // Returns about how many seconds the spin will take
    play(result, onLanded) {
      cancelAnimationFrame(raf);
      if (!nextSpin) nextSpin = recordSpin();
      const job = nextSpin;
      nextSpin = null;
      const start = () => {
        if (disposed) return;
        const rec = job.rec;
        const k = (((WHEEL.indexOf(result) - rec.landed) % 37) + 37) % 37;
        play = { rec, offset: k * STEP, t0: performance.now(), onLanded, skipped: false };
        ball.visible = true;
        glow.intensity = 0;
        W.homeView.lastW = -1;
        raf = requestAnimationFrame(draw);
      };
      if (job.work(8)) { start(); return secsOf(job.rec); }
      // Not recorded yet (Spin came very quickly): finish it a little at a time, then play
      const more = () => { if (disposed) return; if (job.work(12)) start(); else setTimeout(more, 0); };
      setTimeout(more, 0);
      return 8.5;
    },
    skip() { if (play) play.skipped = true; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      play = null;
      disposeScene(scene);
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
