// The casino floor behind the home screen: a long, roomy hall of slot machines in banks of five,
// each bank angled toward the aisle under its own neon sign, reels spinning and topper
// lights chasing, while the camera glides down the aisle forever. Banks that pass behind
// the camera are moved to the far end, so the hall never runs out.
//
// It's a background, so it's built to be cheap: no shadows or bloom, one instanced mesh per
// kind of part (placed only when a bank moves), a low resolution, about 30 frames a second,
// and nothing at all while it's paused. Reduced motion gets one still frame.

import * as THREE from 'three';
import { canvas, carpetCanvas, EMOJI } from './arcade.js';

const BANK = 5;                          // machines in a bank
const MW = 0.62, MH = 1.96, MD = 0.62;    // machine width, height, depth
const GAP = 0.12;
const BANK_W = BANK * MW + (BANK - 1) * GAP;
const SPACING = 6;                       // between banks along the aisle
const ROWS = 6;                          // banks down each side
const AISLE = 1.7;                       // half the aisle's width
const TURN = THREE.MathUtils.degToRad(38);   // how far each bank turns toward the camera
const SPEED = 0.6;                       // metres a second
const PALETTES = [
  [0xc8102e, 0xff4060], [0x6a1fc4, 0xc27bff], [0x0b74b0, 0x45dcff],
  [0xb07a0a, 0xffd447], [0x0f8a4f, 0x4dffa0], [0xa01f7c, 0xff5fd2],
];
const SIGNS = ['JACKPOT', 'LUCKY 7s', 'DIAMONDS', 'WILD DUCK', 'MEGA WIN', 'CHERRIES', 'BIG BAR', 'GOLD RUSH'];
const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣', '🍉', '🦆'];

// A tall strip of reel symbols; each reel shows a window of it, scrolled
function reelCanvas() {
  const W = 128, H = 128 * SYMBOLS.length;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, W, H);
  g.font = `86px ${EMOJI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  SYMBOLS.forEach((s, i) => {
    g.fillStyle = '#222';
    g.fillText(s, W / 2, i * 128 + 68);
  });
  return c;
}
function signCanvas(text, color) {
  const [c, g] = canvas(512, 112);
  g.fillStyle = '#100418';
  g.fillRect(0, 0, 512, 112);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 100);
  g.font = '900 62px "Manrope", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText(text, 256, 60);
  g.shadowBlur = 0;
  g.globalAlpha = 0.9;
  g.fillStyle = '#fff';
  g.fillText(text, 256, 60);
  return c;
}
// The top box's screen: a jackpot panel, tinted per bank by the instance colour
function topScreenCanvas() {
  const [c, g] = canvas(256, 192);
  const gr = g.createLinearGradient(0, 0, 0, 192);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#8a8a8a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 192);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1a0a10';
  g.font = '900 34px "Manrope", Arial, sans-serif';
  g.fillText('JACKPOT', 128, 48);
  g.font = '900 78px "Manrope", Arial, sans-serif';
  g.fillStyle = '#fff6c0';
  g.strokeStyle = '#1a0a10';
  g.lineWidth = 8;
  g.strokeText('777', 128, 124);
  g.fillText('777', 128, 124);
  return c;
}
/* A slot cabinet's side profile (depth on x, height on y), extruded across the machine's
   width: a recessed toe kick, the base, a button deck that juts out toward the player, an
   upright reel face, a top box with its own screen, and a rounded cap. The front is +z. */
function cabinetGeometry() {
  const s = new THREE.Shape();
  const d = MD;
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2 - 0.05, 0);             // toe kick
  s.lineTo(d / 2 - 0.05, 0.08);
  s.lineTo(d / 2, 0.1);
  s.lineTo(d / 2, 0.66);                 // base front
  s.lineTo(d / 2 + 0.16, 0.74);          // button deck juts out
  s.lineTo(d / 2 + 0.15, 0.79);
  s.lineTo(d / 2 - 0.03, 0.84);          // deck slopes back to the screen
  s.lineTo(d / 2 - 0.03, 1.42);          // reel face
  s.lineTo(d / 2 - 0.01, 1.46);          // top box steps out a touch
  s.lineTo(d / 2 - 0.02, MH - 0.06);
  s.quadraticCurveTo(d / 2 - 0.03, MH, d / 2 - 0.12, MH);
  s.lineTo(-d / 2 + 0.08, MH);
  s.lineTo(-d / 2, MH - 0.1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: MW, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -MW / 2);
  g.rotateY(-Math.PI / 2);               // depth now runs along z (front = +z), width along x
  return g;
}

export function mountLobby(container, { still = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.3;
  container.appendChild(renderer.domElement);

  const textures = [];
  const keep = t => { t.colorSpace = THREE.SRGBColorSpace; textures.push(t); return t; };
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x241035);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 7, 34);
  scene.add(new THREE.HemisphereLight(0xffe6f6, 0x3a1450, 2.2));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.1);
  key.position.set(0, 4, 3);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 44);
  const LEN = ROWS * SPACING;

  // Floor, ceiling, ceiling lights and two neon strips running down the aisle
  const carpet = keep(new THREE.CanvasTexture(carpetCanvas()));
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(5, 40);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, LEN * 1.6), new THREE.MeshLambertMaterial({ map: carpet, color: 0xd8c8e8 }));
  floor.rotation.x = -Math.PI / 2;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(16, LEN * 1.6), new THREE.MeshBasicMaterial({ color: 0x0d0514 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.4;
  const strips = [0xff3fa4, 0x3fe0ff].map((c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.05, LEN * 1.6), new THREE.MeshBasicMaterial({ color: c }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(i ? AISLE * 0.7 : -AISLE * 0.7, 0.005, 0);
    return m;
  });
  scene.add(floor, ceiling, ...strips);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.03, 0.7), new THREE.MeshBasicMaterial({ color: 0xffe6a8 }), ROWS * 3);
  lamps.frustumCulled = false;
  scene.add(lamps);

  // The machines: one instanced mesh per part
  const n = ROWS * 2 * BANK;
  const cabMat = new THREE.MeshLambertMaterial();
  const cab = new THREE.InstancedMesh(cabinetGeometry(), cabMat, n);
  // The topper: an arched light standing on the cabinet's cap, flat side down
  const domeGeo = new THREE.CylinderGeometry(MW * 0.42, MW * 0.42, 0.1, 20, 1, false, -Math.PI / 2, Math.PI);
  domeGeo.rotateX(-Math.PI / 2);
  const dome = new THREE.InstancedMesh(domeGeo, new THREE.MeshBasicMaterial(), n);
  const bezel = new THREE.InstancedMesh(new THREE.PlaneGeometry(MW * 0.86, 0.5), new THREE.MeshBasicMaterial({ color: 0x0a0610 }), n);
  const trim = new THREE.InstancedMesh(new THREE.PlaneGeometry(MW * 0.86, 0.035), new THREE.MeshBasicMaterial(), n * 2);
  const topTex = keep(new THREE.CanvasTexture(topScreenCanvas()));
  const topScreen = new THREE.InstancedMesh(new THREE.PlaneGeometry(MW * 0.8, 0.36), new THREE.MeshBasicMaterial({ map: topTex }), n);
  // Light strips up both front edges, a lit button row on the deck, and a stool in front
  const edge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 1.08, 0.03), new THREE.MeshBasicMaterial(), n * 2);
  const buttons = new THREE.InstancedMesh(new THREE.BoxGeometry(MW * 0.7, 0.025, 0.07), new THREE.MeshBasicMaterial({ color: 0xffd86a }), n);
  const seat = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.15, 0.09, 14), new THREE.MeshLambertMaterial({ color: 0x5a1020 }), n);
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.58, 6), new THREE.MeshLambertMaterial({ color: 0x9a9aa8 }), n);
  const foot = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0x2a2a32 }), n);
  const reelTex = keep(new THREE.CanvasTexture(reelCanvas()));
  reelTex.wrapT = THREE.RepeatWrapping;
  reelTex.repeat.set(1, 1.4 / SYMBOLS.length);
  const reelMats = [0, 1, 2].map(() => {
    const t = reelTex.clone();
    t.needsUpdate = true;
    textures.push(t);
    return new THREE.MeshBasicMaterial({ map: t });
  });
  const reels = reelMats.map(m => new THREE.InstancedMesh(new THREE.PlaneGeometry(MW * 0.25, 0.4), m, n));
  const parts = [cab, dome, bezel, trim, topScreen, edge, buttons, seat, pole, foot, ...reels];
  for (const m of parts) { m.frustumCulled = false; scene.add(m); }

  // A neon sign over each bank
  const banks = [];
  for (let i = 0; i < ROWS * 2; i++) {
    const side = i % 2 ? 1 : -1;
    const pal = PALETTES[(i * 5) % PALETTES.length];
    const t = keep(new THREE.CanvasTexture(signCanvas(SIGNS[i % SIGNS.length], '#' + new THREE.Color(pal[1]).getHexString())));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(BANK_W * 0.82, BANK_W * 0.82 * 112 / 512), new THREE.MeshBasicMaterial({ map: t }));
    scene.add(sign);
    banks.push({ side, z: -Math.floor(i / 2) * SPACING - (side > 0 ? SPACING / 2 : 0), pal, sign, phase: i * 1.7, dirty: true });
  }

  const M = new THREE.Matrix4(), L = new THREE.Matrix4(), out = new THREE.Matrix4();
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const put = (mesh, i, x, y, z) => { L.makeTranslation(x, y, z); mesh.setMatrixAt(i, out.multiplyMatrices(M, L)); };
  // Lay a bank out: machines in a line, angled so their fronts face the aisle and the camera
  function placeBank(bi) {
    const b = banks[bi];
    const ang = b.side < 0 ? Math.PI / 2 - TURN : -(Math.PI / 2 - TURN);
    q.setFromAxisAngle(Y, ang);
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(q);     // the line the machines stand along
    const centre = new THREE.Vector3(b.side * (AISLE + 1.4), 0, b.z);
    for (let k = 0; k < BANK; k++) {
      const i = bi * BANK + k;
      pos.copy(centre).addScaledVector(along, (k - (BANK - 1) / 2) * (MW + GAP));
      M.compose(pos, q, one);
      cab.setMatrixAt(i, M);
      cab.setColorAt(i, col.setHex(b.pal[0]));
      put(dome, i, 0, MH - 0.005, MD / 2 - 0.16);
      const fz = MD / 2 - 0.025;
      put(bezel, i, 0, 1.13, fz);
      for (let r = 0; r < 3; r++) put(reels[r], i, (r - 1) * MW * 0.28, 1.13, fz + 0.004);
      put(trim, i * 2, 0, 0.865, fz + 0.004);
      put(trim, i * 2 + 1, 0, 1.43, fz + 0.012);
      trim.setColorAt(i * 2, col.setHex(b.pal[1]));
      trim.setColorAt(i * 2 + 1, col.setHex(b.pal[1]));
      put(topScreen, i, 0, 1.69, MD / 2 - 0.012);
      topScreen.setColorAt(i, col.setHex(b.pal[1]).lerp(new THREE.Color(0xffffff), 0.35));
      for (const e of [0, 1]) {
        put(edge, i * 2 + e, (e ? 1 : -1) * (MW / 2 - 0.015), 1.39, MD / 2 - 0.01);
        edge.setColorAt(i * 2 + e, col.setHex(b.pal[1]));
      }
      put(buttons, i, 0, 0.78, MD / 2 + 0.07);
      put(seat, i, 0, 0.64, MD / 2 + 0.48);
      put(pole, i, 0, 0.32, MD / 2 + 0.48);
      put(foot, i, 0, 0.015, MD / 2 + 0.48);
    }
    b.sign.position.copy(centre).add(new THREE.Vector3(0, MH + 0.62, -0.2));
    b.sign.quaternion.copy(q);
    b.dirty = false;
    for (const m of parts) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  // Topper lights chase along each bank
  function lights(t) {
    banks.forEach((b, bi) => {
      for (let k = 0; k < BANK; k++) {
        const lit = 0.45 + 0.55 * Math.max(0, Math.sin(t * 4 - k * 1.2 + b.phase));
        dome.setColorAt(bi * BANK + k, col.setHex(b.pal[1]).multiplyScalar(lit));
      }
    });
    dome.instanceColor.needsUpdate = true;
  }
  function placeLamps(camZ) {
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      const z = Math.floor(camZ / SPACING) * SPACING - r * SPACING;
      for (const x of [-3.1, 0, 3.1]) lamps.setMatrixAt(i++, M.compose(pos.set(x, 3.38, z), q.identity(), one));
    }
    lamps.instanceMatrix.needsUpdate = true;
  }

  // ---- Size and loop ----
  const view = { w: 0, h: 0 };
  function fit() {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    if (w === view.w && h === view.h) return;
    view.w = w; view.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  let camZ = 0, raf = 0, last = 0, running = false;
  const spin = [0, 0.37, 0.71];
  function draw(now) {
    const t = now / 1000;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    fit();
    if (!still) camZ -= SPEED * dt;
    banks.forEach((b, bi) => {
      if (b.z > camZ + 3) { b.z -= ROWS * SPACING; b.dirty = true; }   // gone behind: to the far end
      if (b.dirty) placeBank(bi);
    });
    lights(still ? 0 : t);
    placeLamps(camZ);
    const mid = camZ - LEN * 0.55;
    floor.position.z = ceiling.position.z = mid;
    for (const s of strips) s.position.z = mid;
    carpet.offset.y = camZ / (LEN * 1.6) * 40;
    // Reels spin in bursts, out of step with each other
    for (let r = 0; r < 3; r++) {
      const burst = Math.max(0, Math.sin(t * 0.6 + r * 0.8));
      if (!still) spin[r] += dt * (0.1 + burst * 2.2);
      reelMats[r].map.offset.y = spin[r];
    }
    // Looking down a little, so the far end of the aisle (signs and all) sits near the top of
    // the screen, above the home screen's tiles
    camera.position.set(Math.sin(t * 0.22) * 0.3, 1.7 + Math.sin(t * 0.37) * 0.04, camZ);
    camera.lookAt(Math.sin(t * 0.16) * 0.5, -0.3, camZ - 7);
    renderer.render(scene, camera);
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / 31) return;   // about 30 frames a second is plenty for a background
    draw(now);
  }
  function resume() {
    if (running) return;
    if (still) { last = 0; draw(performance.now()); return; }
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }
  resume();
  return {
    pause,
    resume,
    dispose() {
      pause();
      for (const t of textures) t.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
