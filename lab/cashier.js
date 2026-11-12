// The cashier's window on the casino floor (lab/floor.js): your balance and stats.
// Lab credits are the lab's own; the stats are the casino's, as saved on this device by the
// casino app (mini-casino.stats). Nothing here changes the casino's stats.

import { button, buzz, loadCredits, saveCredits, LAB_START } from './shared.js';

const GAMES = [
  ['bj', 'Blackjack'], ['rl', 'Roulette'], ['sl', 'Lucky Duck 3000'], ['vp', 'Video Poker'], ['bc', 'Baccarat'],
  ['tc', 'Three Card Poker'], ['wr', 'Casino War'], ['rd', 'Red Dog'], ['pk', 'Duck Drop'], ['cr', 'Duck Rocket'],
];
const CSS = `
.cash { position: absolute; inset: 0; overflow-y: auto; padding: 84px 16px 20px; display: flex; justify-content: center;
  background: repeating-linear-gradient(90deg, rgba(217, 169, 60, .16) 0 4px, transparent 4px 34px), radial-gradient(120% 80% at 50% 0%, #2b1a0c, #0b0907 70%); }
.cash-slip { width: min(440px, 100%); align-self: flex-start; border-radius: 16px; padding: 18px 18px 14px; background: #f6efdc; color: #2a1d05;
  box-shadow: 0 18px 40px rgba(0, 0, 0, .55), inset 0 0 0 1px rgba(42, 29, 5, .15); }
.cash-slip h3 { margin: 0; font-size: 13px; letter-spacing: .22em; text-transform: uppercase; color: #8a6522; }
.cash-big { font-size: 38px; font-weight: 900; margin: 2px 0; font-variant-numeric: tabular-nums; }
.cash-sub { font-size: 13px; color: rgba(42, 29, 5, .6); margin: 0 0 12px; }
.cash-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px dashed rgba(42, 29, 5, .2); font-size: 15px; font-variant-numeric: tabular-nums; }
.cash-row span:first-child { color: rgba(42, 29, 5, .7); }
.cash-row b.up { color: #13744a; }
.cash-row b.down { color: #a3162e; }
.cash-sec { margin-top: 16px; }
.cash-note { font-size: 12px; color: rgba(42, 29, 5, .55); margin: 12px 0 0; }
`;
const money = n => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = n => (n > 0 ? '+' : '') + money(n);

export function mount({ stage, controls, info }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'cash';
  stage.appendChild(wrap);
  let stats = null;
  try { stats = JSON.parse(localStorage.getItem('mini-casino.stats') || 'null'); } catch (e) { /* storage unavailable */ }

  // Built with DOM nodes and textContent throughout (no HTML strings from stored data)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const row = (label, value, tone = 0) => {
    const r = el('div', 'cash-row');
    r.append(el('span', '', label), el('b', tone > 0 ? 'up' : tone < 0 ? 'down' : '', value));
    return r;
  };
  function paint() {
    const credits = loadCredits();
    const slip = el('div', 'cash-slip');
    slip.append(el('h3', '', 'Lab credits'), el('div', 'cash-big', money(credits)), el('p', 'cash-sub', 'Play money for the lab games, separate from your casino wallet.'));
    const games = stats ? GAMES.map(([k, name]) => {
      const g = stats[k] || {};
      return { name, n: Number(g.hands || g.spins || g.rounds) || 0, net: Number(g.net) || 0, biggest: Number(g.biggest) || 0 };
    }).filter(g => g.n > 0) : [];
    const sec = el('div', 'cash-sec');
    sec.append(el('h3', '', 'Casino stats'));
    if (games.length) {
      const net = games.reduce((a, g) => a + g.net, 0);
      const rounds = games.reduce((a, g) => a + g.n, 0);
      sec.append(
        row('Won or lost', signed(net), net),
        row('Rounds played', rounds.toLocaleString('en-US')),
        row('Biggest win', money(Math.max(0, ...games.map(g => g.biggest)))),
        row('Best win streak', String(Number(stats.best) || 0)),
      );
      const by = el('div', 'cash-sec');
      by.append(el('h3', '', 'By game'));
      for (const g of games.sort((a, b) => b.n - a.n)) by.append(row(`${g.name} · ${g.n.toLocaleString('en-US')}`, signed(g.net), g.net));
      slip.append(sec, by, el('p', 'cash-note', 'From the casino, as saved on this device.'));
    } else {
      sec.append(el('p', 'cash-sub', 'Nothing played in the casino on this device yet.'));
      slip.append(sec);
    }
    wrap.replaceChildren(slip);
    topUp.disabled = credits >= LAB_START;
  }
  const topUp = button(`Top up to ${money(LAB_START)}`, () => { saveCredits(LAB_START); buzz(10); paint(); }, 'primary');
  const full = button('Full stats', () => { location.href = '/#stats'; });
  controls.append(topUp, full);
  info.textContent = '';
  paint();
  return { dispose() { wrap.remove(); style.remove(); } };
}
