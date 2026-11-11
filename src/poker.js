// Video poker: Jacks or Better with the full-pay "9/6" table (9 for a full house, 6 for a
// flush). The build inlines this file into the page; it has no other dependencies, so the
// hand ranking can be tested on its own.
//
// Cards use the same codes as blackjack: rank then suit, like 'AS', '10H', 'QD'.

// Pays are a multiple of the bet, and include the bet itself: Jacks or better gives it back.
export const POKER_PAYS = [
  { key: 'royal', name: 'Royal flush', pays: 800 },
  { key: 'sflush', name: 'Straight flush', pays: 50 },
  { key: 'quads', name: 'Four of a kind', pays: 25 },
  { key: 'full', name: 'Full house', pays: 9 },
  { key: 'flush', name: 'Flush', pays: 6 },
  { key: 'straight', name: 'Straight', pays: 4 },
  { key: 'trips', name: 'Three of a kind', pays: 3 },
  { key: 'twopair', name: 'Two pair', pays: 2 },
  { key: 'jacks', name: 'Jacks or better', pays: 1 },
];
export const POKER_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POKER_VAL = Object.fromEntries(POKER_RANKS.map((r, i) => [r, i + 2]));

export function pokerDeck() {
  const deck = [];
  for (const s of 'SHDC') for (const r of POKER_RANKS) deck.push(r + s);
  return deck;
}
// Fisher-Yates with the given random-integer function (randInt(n) gives 0..n-1)
export function pokerShuffle(cards, randInt) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function pokerDeal(randInt) {
  return pokerShuffle(pokerDeck(), randInt).slice(0, 5);
}
/* Replace the cards that aren't held. Replacements come from the 47 cards that weren't
   dealt, so a discarded card can't come back. */
export function pokerDraw(hand, held, randInt) {
  const dealt = new Set(hand);
  const rest = pokerShuffle(pokerDeck().filter(c => !dealt.has(c)), randInt);
  let k = 0;
  return hand.map((c, i) => (held[i] ? c : rest[k++]));
}

/* The best paying hand, as { key, name, pays, cards }, where cards are the positions that
   make it (all five for straights and flushes). null when nothing pays. */
export function pokerRank(hand) {
  const vals = hand.map(c => POKER_VAL[c.slice(0, -1)]);
  const suits = hand.map(c => c.slice(-1));
  const sorted = vals.slice().sort((a, b) => a - b);
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = suits.every(s => s === suits[0]);
  const wheel = sorted.join() === '2,3,4,5,14';
  const straight = counts.size === 5 && (sorted[4] - sorted[0] === 4 || wheel);
  const all = [0, 1, 2, 3, 4];
  const where = (...vs) => all.filter(i => vs.includes(vals[i]));
  let key = null, cards = [];
  if (straight && flush) { key = sorted[0] === 10 ? 'royal' : 'sflush'; cards = all; }
  else if (groups[0][1] === 4) { key = 'quads'; cards = where(groups[0][0]); }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { key = 'full'; cards = all; }
  else if (flush) { key = 'flush'; cards = all; }
  else if (straight) { key = 'straight'; cards = all; }
  else if (groups[0][1] === 3) { key = 'trips'; cards = where(groups[0][0]); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { key = 'twopair'; cards = where(groups[0][0], groups[1][0]); }
  else if (groups[0][1] === 2 && groups[0][0] >= 11) { key = 'jacks'; cards = where(groups[0][0]); }
  if (!key) return null;
  const row = POKER_PAYS.find(p => p.key === key);
  return { key, name: row.name, pays: row.pays, cards };
}

/* ---------- Deuces Wild ----------
   Every 2 is wild and stands in for any card. The lowest paying hand is three of a kind.
   This is the "Not So Ugly Ducks" pay table, which returns about 99.7% with perfect play. */
export const DEUCES_PAYS = [
  { key: 'dw-royal', name: 'Royal flush', pays: 800 },
  { key: 'dw-deuces', name: 'Four deuces', pays: 200 },
  { key: 'dw-wroyal', name: 'Wild royal', pays: 25 },
  { key: 'dw-five', name: 'Five of a kind', pays: 16 },
  { key: 'dw-sflush', name: 'Straight flush', pays: 10 },
  { key: 'dw-quads', name: 'Four of a kind', pays: 4 },
  { key: 'dw-full', name: 'Full house', pays: 4 },
  { key: 'dw-flush', name: 'Flush', pays: 3 },
  { key: 'dw-straight', name: 'Straight', pays: 2 },
  { key: 'dw-trips', name: 'Three of a kind', pays: 1 },
];

// Whether these distinct values, plus wild cards, can make five in a row (an ace is high or low)
function deucesStraight(vals) {
  if (new Set(vals).size !== vals.length) return false;
  for (let high = 5; high <= 14; high++) {
    if (vals.every(v => (v <= high && v > high - 5) || (v === 14 && high === 5))) return true;
  }
  return false;
}

/* The best paying hand with deuces wild, as { key, name, pays, cards }, or null. */
export function deucesRank(hand) {
  const all = [0, 1, 2, 3, 4];
  const wild = all.filter(i => hand[i].slice(0, -1) === '2');
  const rest = all.filter(i => !wild.includes(i));
  const w = wild.length;
  const vals = rest.map(i => POKER_VAL[hand[i].slice(0, -1)]);
  const suits = rest.map(i => hand[i].slice(-1));
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const top = groups.length ? groups[0][1] : 0;
  const flush = suits.every(s => s === suits[0]);
  const straight = deucesStraight(vals);
  const royal = straight && vals.every(v => v >= 10);
  const with_ = v => wild.concat(rest.filter((i, k) => vals[k] === v)).sort();
  let key = null, cards = all;
  if (w === 0 && flush && royal) key = 'dw-royal';
  else if (w === 4) { key = 'dw-deuces'; cards = wild; }
  else if (flush && royal) key = 'dw-wroyal';
  else if (top + w >= 5) key = 'dw-five';
  else if (flush && straight) key = 'dw-sflush';
  else if (top + w >= 4) { key = 'dw-quads'; cards = with_(groups[0][0]); }
  else if ((w === 0 && top === 3 && groups[1][1] === 2) || (w === 1 && top === 2 && groups[1][1] === 2)) key = 'dw-full';
  else if (flush) key = 'dw-flush';
  else if (straight) key = 'dw-straight';
  else if (top + w >= 3) { key = 'dw-trips'; cards = with_(groups[0][0]); }
  if (!key) return null;
  const row = DEUCES_PAYS.find(p => p.key === key);
  return { key, name: row.name, pays: row.pays, cards };
}
