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
