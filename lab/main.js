// Graphics lab: three experiments, each loaded only when its tab is opened.
// Every demo module exports mount({ stage, controls, info }) and returns { dispose() }.

const stage = document.getElementById('stage');
const controls = document.getElementById('controls');
const info = document.getElementById('info');
const fps = document.getElementById('fps');

const demos = {
  roulette: () => import('./roulette.js'),
  win: () => import('./celebrate.js'),
  table: () => import('./table.js'),
};

// Frame-rate meter, so you can see how hard the phone is working
let frames = 0;
let last = performance.now();
(function tick(now) {
  frames++;
  if (now - last >= 500) {
    fps.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(tick);
})(last);

let current = null;
let token = 0;
async function show(name) {
  const mine = ++token;
  if (current) { try { current.dispose(); } catch (e) { /* already gone */ } current = null; }
  for (const el of [...stage.children]) if (!el.classList.contains('hud')) el.remove();
  controls.textContent = '';
  info.textContent = 'Loading…';
  for (const b of document.querySelectorAll('[data-demo]')) b.setAttribute('aria-selected', String(b.dataset.demo === name));
  try { history.replaceState(null, '', '#' + name); } catch (e) { /* not allowed here */ }
  try {
    const mod = await demos[name]();
    if (mine !== token) return;
    current = await mod.mount({ stage, controls, info });
    if (mine !== token && current) { current.dispose(); current = null; }
  } catch (err) {
    console.error(err);
    if (mine === token) info.textContent = `This demo couldn’t start here: ${(err && err.message) || err}`;
  }
}

for (const b of document.querySelectorAll('[data-demo]')) b.addEventListener('click', () => show(b.dataset.demo));
const first = location.hash.slice(1);
show(demos[first] ? first : 'roulette');
