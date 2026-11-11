// Shared pieces for the arcade-style lab games (slots and plinko): canvas helpers, the
// marquee sign, and the casino room they stand in (carpet, neon, lights and bloom).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const TAU = Math.PI * 2;
export const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/* ---------- Canvas artwork ---------- */
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
export function tex(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// A rounded rectangle centered on (cx, cy), as a THREE.Shape or Path
export function rrect(path, cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

export function arcText(g, text, cx, cy, r, font, fill, stroke) {
  g.save();
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map(ch => g.measureText(ch).width + 6);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -Math.PI / 2 - total / r / 2;
  for (let i = 0; i < text.length; i++) {
    const w = widths[i] / r;
    a += w / 2;
    g.save();
    g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.rotate(a + Math.PI / 2);
    g.lineJoin = 'round';
    g.lineWidth = 18;
    g.strokeStyle = stroke;
    g.strokeText(text[i], 0, 0);
    g.fillStyle = fill(g);
    g.fillText(text[i], 0, 0);
    g.restore();
    a += w / 2;
  }
  g.restore();
}
// The marquee: a half-disc sign in the top half of a square canvas (CircleGeometry's UVs)
export function signCanvas(title, sub) {
  const S = 1024, cx = S / 2, cy = S / 2, R = S / 2;
  const [c, g] = canvas(S, S);
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, Math.PI, 0);
  g.closePath();
  g.clip();
  const bg = g.createRadialGradient(cx, cy, 20, cx, cy, R);
  bg.addColorStop(0, '#6a0c1d');
  bg.addColorStop(1, '#16030b');
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 24; i++) {
    const a0 = Math.PI + (i * Math.PI) / 24;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0, a0 + Math.PI / 48);
    g.closePath();
    g.fillStyle = 'rgba(255, 80, 110, .13)';
    g.fill();
  }
  g.restore();
  g.strokeStyle = '#f2c14e';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(cx, cy, R - 34, Math.PI, 0);
  g.stroke();
  const goldFill = gg => {
    const grad = gg.createLinearGradient(0, -50, 0, 50);
    grad.addColorStop(0, '#fff3c4');
    grad.addColorStop(0.5, '#ffcf4a');
    grad.addColorStop(1, '#e09a1f');
    return grad;
  };
  arcText(g, title, cx, cy, R * 0.68, '900 112px Manrope, sans-serif', goldFill, '#3a0610');
  g.save();
  g.translate(cx, cy - 110);
  g.font = '900 150px Manrope, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 20;
  g.strokeStyle = '#3a0610';
  g.strokeText(sub, 0, 0);
  g.fillStyle = '#ffffff';
  g.fillText(sub, 0, 0);
  g.restore();
  g.font = `64px ${EMOJI}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('🦆', cx - 300, cy - 70);
  g.fillText('🦆', cx + 300, cy - 70);
  return c;
}
// A loud casino carpet
export function carpetCanvas() {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#1c0a2a';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(233, 196, 106, .2)';
  g.lineWidth = 6;
  for (let i = -S; i <= S * 2; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
  }
  const cols = ['#ff3fa4', '#3fe0ff', '#ffd23f', '#7cff6b'];
  g.globalAlpha = 0.32;
  for (let i = 0; i < 70; i++) {
    g.fillStyle = cols[i % 4];
    g.beginPath();
    g.arc(14 + Math.random() * (S - 28), 14 + Math.random() * (S - 28), 3 + Math.random() * 7, 0, TAU);
    g.fill();
  }
  return c;
}


/* The room: a dark purple casino with a loud carpet, neon tubes on the back wall, a warm
   key light that casts shadows, and magenta and cyan rim lights. keep() collects textures
   to dispose of later. */
export function casinoScene(renderer, envTex, keep) {
  renderer.toneMappingExposure = 0.92;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12071c);
  scene.environment = envTex;
  scene.environmentIntensity = 0.42;
  scene.fog = new THREE.Fog(0x12071c, 4.5, 11);

  scene.add(new THREE.HemisphereLight(0xffe9f2, 0x1a0820, 0.3));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
  key.position.set(-1.2, 2.6, 2.4);
  key.target.position.set(0, 0.7, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 2.2, bottom: -0.6, near: 0.5, far: 7 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const rimL = new THREE.PointLight(0xff2bd6, 1.6, 4, 2);
  rimL.position.set(-1.1, 1.3, -0.5);
  const rimR = new THREE.PointLight(0x2be7ff, 1.6, 4, 2);
  rimR.position.set(1.2, 1.1, -0.4);
  scene.add(rimL, rimR);

  const carpet = keep(tex(carpetCanvas(), renderer));
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(14, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  for (const [x, color] of [[-1.5, new THREE.Color(1.6, 0.2, 1.2)], [1.6, new THREE.Color(0.2, 1.2, 1.6)], [-0.9, new THREE.Color(1.5, 1.1, 0.25)], [1.0, new THREE.Color(1.6, 0.2, 1.2)]]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 12), new THREE.MeshBasicMaterial({ color }));
    tube.position.set(x, 1.1, -2.2 - Math.abs(x) * 0.2);
    scene.add(tube);
  }
  return scene;
}

/* Rendering through bloom, so anything brighter than white (bulbs, neon, signs) glows. */
export function bloomComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    render: dt => composer.render(dt),
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    dispose() {
      bloom.dispose();
      composer.dispose();
    },
  };
}
