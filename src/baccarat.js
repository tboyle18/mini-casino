// Baccarat (punto banco): the shoe, the drawing rules and the payouts. The build inlines
// this file into the page; it has no other dependencies, so the odds can be checked on
// their own.
//
// Cards use the same codes as blackjack: rank then suit, like 'AS', '10H', 'QD'. Each coup
// is dealt from a freshly shuffled 8-deck shoe.

export const BAC_DECKS = 8;
// Winnings for each 1 bet, on top of the bet coming back. The bank keeps 5% of Banker wins.
export const BAC_PAYS = { player: 1, banker: 0.95, tie: 8 };

// Aces are 1, 10s and picture cards are 0, everything else is its number
export function bacVal(c) {
  const r = c.slice(0, -1);
  return r === 'A' ? 1 : r === '10' || r === 'J' || r === 'Q' || r === 'K' ? 0 : Number(r);
}
// A hand's total is the last digit of its card values added up
export const bacTotal = cards => cards.reduce((a, c) => a + bacVal(c), 0) % 10;

export function bacShoe(randInt) {
  const shoe = [];
  for (let d = 0; d < BAC_DECKS; d++) for (const s of 'SHDC') for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) shoe.push(r + s);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

/* Whether the Banker takes a third card, given its total and the value of the Player's
   third card (null when the Player stood). */
export function bacBankerDraws(bt, p3) {
  if (p3 === null) return bt <= 5;
  if (bt <= 2) return true;
  if (bt === 3) return p3 !== 8;
  if (bt === 4) return p3 >= 2 && p3 <= 7;
  if (bt === 5) return p3 >= 4 && p3 <= 7;
  if (bt === 6) return p3 === 6 || p3 === 7;
  return false;
}

/* Deal one coup from the top of the shoe: Player, Banker, Player, Banker, then third cards
   by the rules. order lists every card in the order it's dealt, as [side, card]. */
export function bacCoup(shoe) {
  let i = 0;
  const next = () => shoe[i++];
  const player = [next()], banker = [next()];
  player.push(next());
  banker.push(next());
  const order = [['player', player[0]], ['banker', banker[0]], ['player', player[1]], ['banker', banker[1]]];
  const natural = bacTotal(player) >= 8 || bacTotal(banker) >= 8;
  if (!natural) {
    let p3 = null;
    if (bacTotal(player) <= 5) {
      p3 = next();
      player.push(p3);
      order.push(['player', p3]);
    }
    if (bacBankerDraws(bacTotal(banker), p3 === null ? null : bacVal(p3))) {
      const c = next();
      banker.push(c);
      order.push(['banker', c]);
    }
  }
  const pt = bacTotal(player), bt = bacTotal(banker);
  return { player, banker, order, pt, bt, natural, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}

/* What a set of bets returns, bet included. Player and Banker bets get their stake back
   on a tie. Rounded to the cent. */
export function bacPayout(bets, winner) {
  let total = 0;
  for (const [k, a] of Object.entries(bets)) {
    if (!a || !(k in BAC_PAYS)) continue;
    if (winner === 'tie') total += k === 'tie' ? a * (1 + BAC_PAYS.tie) : a;
    else if (k === winner) total += a * (1 + BAC_PAYS[k]);
  }
  return Math.round(total * 100) / 100;
}
