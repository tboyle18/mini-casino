// 3D roulette: a Three.js wheel with a cannon-es physics ball.
//
// Everything is in meters at real scale (the wheel is about 89 cm across). The bowl
// and ball track are a static triangle mesh, the rotor is a kinematic body that
// spins with 37 chrome frets, and the ball is a real rigid body: it rides the track,
// slows down, falls, bounces off the deflectors and frets, and settles in a pocket.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { button, buzz, makeRenderer, fitRenderer, disposeScene, fontReady } from './shared.js';

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

function wheelTexture(renderer) {
  const S = 2048, R = 0.31, k = S / 2 / R;
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
  const deflectors = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r = 0.356;
    const y = 0.022 + ((r - 0.315) / 0.085) * 0.024 + 0.004;
    const along = i % 2 === 0;
    const half = along ? new CANNON.Vec3(0.005, 0.004, 0.014) : new CANNON.Vec3(0.013, 0.004, 0.005);
    const shape = new CANNON.Box(half);
    shape.material = mMetal;
    bowlBody.addShape(shape, new CANNON.Vec3(r * Math.cos(a), y, r * Math.sin(a)), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a));
    deflectors.push({ a, r, y, half });
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

export async function mount({ stage, controls, info }) {
  await fontReady();
  const { renderer, envTex } = makeRenderer(stage);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907);
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0x0b0907, 3.5, 7);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 20);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.enablePan = false;
  orbit.minDistance = 0.35;
  orbit.maxDistance = 4;
  orbit.minPolarAngle = 0.12;
  orbit.maxPolarAngle = 1.25;
  orbit.target.set(0, 0.02, 0);

  function homeView() {
    fitRenderer(renderer, camera, stage);
    const fit = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1.15);
    const d = 0.53 / fit;
    const elev = THREE.MathUtils.degToRad(52);
    camera.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d);
    orbit.target.set(0, 0.02, 0);
    orbit.update();
  }

  // ---- Lights ----
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a0f08, 0.5));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
  key.position.set(0.55, 1.6, 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
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
  const ringMat = new THREE.MeshPhysicalMaterial({ map: wheelTexture(renderer), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, side: THREE.DoubleSide });

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

  // ---- Physics ----
  const phys = createWheelPhysics();
  const { rotorBody, ballBody } = phys;
  for (const { a, r, y, half } of phys.deflectors) {
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

  // ---- Spin logic ----
  let follow = false;
  const result = document.createElement('div');
  result.style.cssText = 'position:absolute;left:50%;bottom:18px;transform:translateX(-50%) scale(.6);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.4),opacity .25s;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 10px;border-radius:16px;background:rgba(10,8,6,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 10px 30px rgba(0,0,0,.5);pointer-events:none;z-index:3;font-weight:800;font-size:20px;';
  stage.appendChild(result);

  function spin() {
    phys.launch();
    ball.visible = true;
    glow.intensity = 0;
    result.style.opacity = '0';
    result.style.transform = 'translateX(-50%) scale(.6)';
    info.textContent = 'No more bets… the ball is rolling';
    spinBtn.disabled = true;
    buzz(20);
  }

  function land() {
    const n = phys.pocket();
    info.textContent = `Landed on ${n} ${colorName(n)}`;
    result.innerHTML = `<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:${colorHex(n)};box-shadow:inset 0 0 0 2px rgba(255,255,255,.3)">${n}</span>${colorName(n)}`;
    result.style.opacity = '1';
    result.style.transform = 'translateX(-50%) scale(1)';
    glow.intensity = 0.6;
    spinBtn.disabled = false;
    buzz([15, 50, 25]);
  }

  // ---- Controls ----
  const spinBtn = button('Spin', spin, 'primary');
  const camBtn = button('Ball cam', () => {
    follow = !follow;
    camBtn.setAttribute('aria-pressed', String(follow));
    orbit.enabled = !follow;
    if (!follow) homeView();
  });
  camBtn.setAttribute('aria-pressed', 'false');
  const viewBtn = button('Reset view', () => { follow = false; camBtn.setAttribute('aria-pressed', 'false'); orbit.enabled = true; homeView(); });
  controls.append(spinBtn, camBtn, viewBtn);
  info.textContent = 'Tap Spin. Drag to look around.';

  // ---- Loop ----
  homeView();
  let raf = 0;
  let last = performance.now();
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (fitRenderer(renderer, camera, stage) && !follow) orbit.update();

    const status = phys.step(dt);
    rotor.quaternion.copy(rotorBody.quaternion);
    ball.position.copy(ballBody.position);
    ball.quaternion.copy(ballBody.quaternion);
    glow.position.set(ball.position.x, ball.position.y + 0.03, ball.position.z);
    if (status === 'landed') land();
    else if (status === 'escaped') { info.textContent = 'The ball jumped the wheel! Spinning again'; spin(); }

    if (follow && ball.visible) {
      const p = ball.position;
      const v = ballBody.velocity;
      const flat = Math.hypot(v.x, v.z);
      const dir = flat > 0.05 ? tmp.set(v.x / flat, 0, v.z / flat) : tmp.set(-p.z, 0, p.x).normalize();
      const out = new THREE.Vector3(p.x, 0, p.z).normalize();
      const want = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(dir, -0.16).addScaledVector(out, 0.1).add(new THREE.Vector3(0, 0.11, 0));
      camera.position.lerp(want, 1 - Math.pow(0.001, dt));
      look.lerp(new THREE.Vector3(p.x, p.y, p.z).addScaledVector(dir, 0.04), 1 - Math.pow(0.0005, dt));
      camera.lookAt(look);
    } else {
      look.copy(orbit.target);
      orbit.update();
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      orbit.dispose();
      result.remove();
      disposeScene(scene);
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
