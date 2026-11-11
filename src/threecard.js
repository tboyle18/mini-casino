// Three Card Poker: your three cards against the dealer's three. The build inlines this file
// into the page; it has no other dependencies, so the odds can be checked on their own.
//
// Cards use the same codes as blackjack: rank then suit, like 'AS', '10H', 'QD'. Each hand is
// dealt from a freshly shuffled single deck.
//
// You put down an Ante, see your cards, then Fold (losing the Ante) or Play (a second bet the
// size of the Ante). The dealer needs queen high or better to qualify. If the dealer doesn't
// qualify, the Ante wins and the Play bet comes back. If the dealer qualifies, the better hand
// wins both bets 1 to 1, and a tie pushes them. The Ante bonus and the Pair Plus side bet pay
// on your hand alone, whatever the dealer holds.

export const TC_HANDS = [
  { key: 'sflush', name: 'Straight flush' },
  { key: 'trips', name: 'Three of a kind' },
  { key: 'straight', name: 'Straight' },
  { key: 'flush', name: 'Flush' },
  { key: 'pair', name: 'Pair' },
  { key: 'high', name: 'High card' },
];
// Pay tables, as winnings for each 1 bet (the bet comes back too)
export const TC_PAIR_PLUS = { sflush: 40, trips: 30, straight: 6, flush: 4, pair: 1 };
export const TC_ANTE_BONUS = { sflush: 5, trips: 4, straight: 1 };
const TC_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const tcVal = c => TC_RANKS.indexOf(c.slice(0, -1)) + 2;

export function tcDealCards(randInt) {
  const deck = [];
  for (const s of 'SHDC') for (const r of TC_RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { player: deck.slice(0, 3), dealer: deck.slice(3, 6) };
}

/* A hand's category and a score that orders any two hands (higher is better). */
export function tcRank(hand) {
  const v = hand.map(tcVal).sort((a, b) => b - a);
  const flush = hand.every(c => c.slice(-1) === hand[0].slice(-1));
  const wheel = v[0] === 14 && v[1] === 3 && v[2] === 2;   // A-2-3 counts as a 3-high straight
  const run = (v[0] - v[1] === 1 && v[1] - v[2] === 1) || wheel;
  let cat, tie;
  if (run && flush) { cat = 5; tie = [wheel ? 3 : v[0]]; }
  else if (v[0] === v[2]) { cat = 4; tie = [v[0]]; }
  else if (run) { cat = 3; tie = [wheel ? 3 : v[0]]; }
  else if (flush) { cat = 2; tie = v; }
  else if (v[0] === v[1] || v[1] === v[2]) { cat = 1; const p = v[1]; tie = [p, v[0] === p ? v[2] : v[0]]; }
  else { cat = 0; tie = v; }
  const score = tie.reduce((a, x) => a * 15 + x, cat) * (tie.length === 1 ? 225 : tie.length === 2 ? 15 : 1);
  return { key: TC_HANDS[5 - cat].key, name: TC_HANDS[5 - cat].name, cat, score };
}
// The dealer plays with queen high or better
export const tcQualifies = r => r.cat > 0 || Math.floor(r.score / 225) % 15 >= 12;

/* What a hand returns, every bet included, rounded to the cent.
   h: { ante, pair, player, dealer, choice ('play' | 'fold') } */
export function tcPayout(h) {
  const me = tcRank(h.player);
  let total = h.pair && TC_PAIR_PLUS[me.key] ? h.pair * (1 + TC_PAIR_PLUS[me.key]) : 0;
  if (h.ante && h.choice === 'play') {
    const dl = tcRank(h.dealer);
    if (!tcQualifies(dl)) total += h.ante * 2 + h.ante;
    else if (me.score > dl.score) total += h.ante * 4;
    else if (me.score === dl.score) total += h.ante * 2;
    total += h.ante * (TC_ANTE_BONUS[me.key] || 0);
  }
  return Math.round(total * 100) / 100;
}
