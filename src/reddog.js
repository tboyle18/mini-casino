// Red Dog: will the third card land between the first two? The build inlines this file into
// the page; it has no other dependencies, so the odds can be checked on their own.
//
// Cards use the same codes as blackjack: rank then suit, like 'AS', '10H', 'QD'. Aces are
// high and suits don't matter. Each hand is dealt from a freshly shuffled 8-deck shoe.
//
// Two cards are dealt face up. If they're next to each other (like 7 and 8) the hand is a
// push. If they're a pair, a third card is dealt: three of a kind pays 11 to 1, anything
// else pushes. Otherwise the spread is the number of ranks between them, and you may raise
// up to your bet before the third card. If it lands strictly between, the bet and raise win
// at the spread's odds; if not, you lose them.

export const RD_DECKS = 8;
export const RD_TRIPS = 11;
// Winnings for each 1 bet, by spread (4 or more pays 1 to 1)
export const RD_SPREAD_PAYS = { 1: 5, 2: 4, 3: 2 };
export const rdPays = spread => RD_SPREAD_PAYS[spread] || 1;
const RD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const rdVal = c => RD_RANKS.indexOf(c.slice(0, -1)) + 2;

function rdShoe(randInt, without = []) {
  const shoe = [];
  for (let d = 0; d < RD_DECKS; d++) for (const s of 'SHDC') for (const r of RD_RANKS) shoe.push(r + s);
  for (const c of without) {
    const i = shoe.indexOf(c);
    if (i >= 0) shoe.splice(i, 1);
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}
// The first two cards
export const rdDeal = randInt => rdShoe(randInt).slice(0, 2);
// The third card, drawn from the same shoe once it's needed
export const rdThird = (a, b, randInt) => rdShoe(randInt, [a, b])[0];

/* The first two cards: 'pair', 'next' (consecutive, a push) or 'spread' with the gap. */
export function rdSpread(a, b) {
  const x = rdVal(a), y = rdVal(b);
  if (x === y) return { kind: 'pair', spread: 0 };
  const spread = Math.abs(x - y) - 1;
  return spread === 0 ? { kind: 'next', spread: 0 } : { kind: 'spread', spread };
}

/* What a hand returns, bet and raise included. h: { bet, raise, cards: [a, b, c] } */
export function rdPayout(h) {
  const [a, b, c] = h.cards;
  const s = rdSpread(a, b);
  if (s.kind === 'next') return h.bet;
  if (s.kind === 'pair') return rdVal(c) === rdVal(a) ? h.bet * (1 + RD_TRIPS) : h.bet;
  const lo = Math.min(rdVal(a), rdVal(b)), hi = Math.max(rdVal(a), rdVal(b)), v = rdVal(c);
  const staked = h.bet + (h.raise || 0);
  return v > lo && v < hi ? staked * (1 + rdPays(s.spread)) : 0;
}
