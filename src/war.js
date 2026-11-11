// Casino War: one card each, high card wins. The build inlines this file into the page; it
// has no other dependencies, so the odds can be checked on their own.
//
// Cards use the same codes as blackjack: rank then suit, like 'AS', '10H', 'QD'. Aces are
// high. Each round is dealt from a freshly shuffled 6-deck shoe.
//
// On a tie you either surrender (half your bet back) or go to war: you add a raise equal to
// your bet, three cards are burned, and you each get one more card. If yours ties or beats
// the dealer's, the raise wins 1 to 1 and the bet comes back; if not, you lose both.

export const WAR_DECKS = 6;
// Winnings for each 1 bet, on top of the bet coming back. The Tie bet only counts the first cards.
export const WAR_PAYS = { war: 1, tie: 10 };
const WAR_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 2 is 2, up to 10; then Jack 11, Queen 12, King 13, Ace 14
export const warRank = c => WAR_RANKS.indexOf(c.slice(0, -1)) + 2;

/* A shuffled 6-deck shoe, without the cards already on the table (one copy of each). */
export function warShoe(randInt, without = []) {
  const shoe = [];
  for (let d = 0; d < WAR_DECKS; d++) for (const s of 'SHDC') for (const r of WAR_RANKS) shoe.push(r + s);
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

// The first two cards: yours, then the dealer's
export function warDeal(randInt) {
  const shoe = warShoe(randInt);
  return { player: shoe[0], dealer: shoe[1] };
}

// Going to war: burn three cards from the same shoe, then one more card each
export function warBattle(player, dealer, randInt) {
  const shoe = warShoe(randInt, [player, dealer]);
  return { burn: shoe.slice(0, 3), player: shoe[3], dealer: shoe[4] };
}

/* What a round returns, bets and raise included, rounded to the cent.
   r: { bet, tie, player, dealer, choice ('war' | 'surrender' | null), player2, dealer2 } */
export function warPayout(r) {
  const p = warRank(r.player), d = warRank(r.dealer);
  let total = 0;
  if (p > d) total = r.bet * (1 + WAR_PAYS.war);
  else if (p === d) {
    total = (r.tie || 0) * (1 + WAR_PAYS.tie);
    if (r.choice === 'surrender') total += r.bet / 2;
    else if (r.choice === 'war' && warRank(r.player2) >= warRank(r.dealer2)) total += r.bet + r.bet * (1 + WAR_PAYS.war);
  }
  return Math.round(total * 100) / 100;
}
