// Lucky Duck 3000: the slot machine's odds and payouts, with no graphics, so they can be
// checked on their own (odds() at the bottom gives the exact return and hit rate).
//
// Three reels, one payline (the middle row). Each reel picks a symbol by weight (a
// "virtual reel" of 64 stops, like a real machine), then lands on a stop showing it.
// The duck is wild: it stands in for any symbol, and three ducks is the jackpot.

export const SYMBOLS = ['cherry', 'lemon', 'bell', 'clover', 'diamond', 'seven', 'duck'];
export const GLYPH = { cherry: '🍒', lemon: '🍋', bell: '🔔', clover: '🍀', diamond: '💎', seven: '7', duck: '🦆' };
export const NAME = { cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', clover: 'Clover', diamond: 'Diamond', seven: 'Lucky 7', duck: 'Duck' };

// Out of 64 on every reel
export const WEIGHTS = { cherry: 16, lemon: 14, bell: 12, clover: 10, diamond: 6, seven: 4, duck: 2 };
// Three of a kind on the payline, as a multiple of the bet (the bet comes back inside it)
export const PAYS = { cherry: 4, lemon: 7, bell: 12, clover: 18, diamond: 40, seven: 100, duck: 777 };
// Any two cherries (ducks count as cherries)
export const TWO_CHERRIES = 2;

// What each reel's twelve stops show, top to bottom. Every symbol appears at least once.
export const STRIPS = [
  ['cherry', 'lemon', 'bell', 'seven', 'cherry', 'clover', 'lemon', 'diamond', 'cherry', 'bell', 'duck', 'lemon'],
  ['lemon', 'cherry', 'clover', 'bell', 'duck', 'lemon', 'cherry', 'diamond', 'bell', 'seven', 'clover', 'cherry'],
  ['bell', 'cherry', 'lemon', 'diamond', 'clover', 'cherry', 'seven', 'lemon', 'duck', 'bell', 'cherry', 'clover'],
];

/* The payline's result: { mult, kind, sym, wild }. kind is 'lose', 'small' (two cherries),
   'win', 'big' (40x and up) or 'jackpot' (sevens or ducks). */
export function evaluate(line) {
  const ducks = line.filter(s => s === 'duck').length;
  if (ducks === 3) return { mult: PAYS.duck, kind: 'jackpot', sym: 'duck', wild: false };
  const rest = line.filter(s => s !== 'duck');
  if (rest.every(s => s === rest[0])) {
    const mult = PAYS[rest[0]];
    return { mult, kind: mult >= 100 ? 'jackpot' : mult >= 40 ? 'big' : 'win', sym: rest[0], wild: ducks > 0 };
  }
  if (line.filter(s => s === 'cherry' || s === 'duck').length >= 2) return { mult: TWO_CHERRIES, kind: 'small', sym: 'cherry', wild: ducks > 0 };
  return { mult: 0, kind: 'lose', sym: null, wild: false };
}

// The most the third reel could still pay, given the first two (used to decide when to tease)
export function bestPossible(a, b) {
  let best = 0;
  for (const c of SYMBOLS) best = Math.max(best, evaluate([a, b, c]).mult);
  return best;
}

export function randomSymbol(rand) {
  let r = rand() * 64;
  for (const s of SYMBOLS) { r -= WEIGHTS[s]; if (r < 0) return s; }
  return SYMBOLS[0];
}

// A stop on this reel that shows the symbol (there may be several; pick one)
export function stopFor(reel, sym, rand) {
  const options = [];
  STRIPS[reel].forEach((s, i) => { if (s === sym) options.push(i); });
  return options[Math.floor(rand() * options.length)];
}

// Exact return to player and hit rate, by summing over every weighted outcome
export function odds() {
  let rtp = 0, hit = 0;
  for (const a of SYMBOLS) for (const b of SYMBOLS) for (const c of SYMBOLS) {
    const p = (WEIGHTS[a] * WEIGHTS[b] * WEIGHTS[c]) / 64 ** 3;
    const { mult } = evaluate([a, b, c]);
    rtp += p * mult;
    if (mult) hit += p;
  }
  return { rtp, hit };
}
