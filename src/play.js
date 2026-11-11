// The casino's server-side game engine: every bet a signed-in player makes is decided here,
// with the server's own random numbers, and paid into the wallet it holds. The page only
// shows what happened. src/worker.js loads a player's wallet row, calls play(), and saves
// the row back (see src/wallet.js).
//
// A wallet here is { balance, weekNet, log, rounds }: rounds holds a game that's waiting on
// the player (a video poker hand to draw, a war to fight, a rocket in the air, the solo
// blackjack table). play() changes the wallet in place and returns what the page may see.

import { POKER_PAYS, DEUCES_PAYS, pokerDeal, pokerDraw, pokerRank, deucesRank } from './poker.js';
import { bacShoe, bacCoup, bacPayout } from './baccarat.js';
import { warRank, warDeal, warBattle, warPayout } from './war.js';
import { tcDealCards, tcRank, tcPayout, TC_PAIR_PLUS } from './threecard.js';
import { rdDeal, rdSpread, rdThird, rdPayout, rdVal } from './reddog.js';
import { newTable, newPlayer, applyIntent, autoAdvance, migrateTable, mulberry32 } from './rules.js';
import { RISKS, pegLayout, makeBall, stepBall } from '../lab/plinko-physics.js';
import { crashPoint, multAt, timeTo } from '../lab/crash-math.js';

export class PlayError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const r2 = n => Math.round(n * 100) / 100;
const MAX_BET = 1e9;
const okAmount = a => Number.isInteger(a) && a >= 1 && a <= MAX_BET;
export const LOG_MAX = 12;

function take(w, amount) {
  if (!okAmount(amount)) throw new PlayError('bad_bet', 'That bet isn’t a whole number of dollars.');
  if (amount > w.balance + 1e-9) throw new PlayError('funds', 'Not enough in your wallet.');
  w.balance = r2(w.balance - amount);
}
// Pay out a finished round: the payout goes in, and its net counts toward this week
export function note(w, a, line, now) {
  w.log = [{ a: r2(a), w: String(line).slice(0, 60), at: now }, ...(w.log || [])].slice(0, LOG_MAX);
}
function settle(w, staked, payout, line, now, quiet) {
  w.balance = r2(w.balance + payout);
  const net = r2(payout - staked);
  w.weekNet = r2((w.weekNet || 0) + net);
  if (!quiet) note(w, net, line, now);
  return net;
}
// Bets on several spots: { spot: amount }, only known spots, whole dollars
function cleanBets(bets, spots) {
  const out = {};
  let total = 0;
  if (!bets || typeof bets !== 'object') throw new PlayError('bad_bet');
  for (const [k, v] of Object.entries(bets)) {
    if (!v) continue;
    if (!spots(k) || !okAmount(v)) throw new PlayError('bad_bet');
    out[k] = v;
    total += v;
  }
  if (!total) throw new PlayError('no_bet', 'Put a bet down first.');
  return { bets: out, total };
}

/* ---------- Roulette (single zero) ---------- */
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const OUTSIDE = {
  col1: n => n % 3 === 1, col2: n => n % 3 === 2, col3: n => n % 3 === 0,
  doz1: n => n >= 1 && n <= 12, doz2: n => n > 12 && n <= 24, doz3: n => n > 24,
  low: n => n >= 1 && n <= 18, high: n => n >= 19, even: n => n > 0 && n % 2 === 0, odd: n => n % 2 === 1,
  red: n => REDS.has(n), black: n => n > 0 && !REDS.has(n),
};
const rlSpot = k => /^n([0-9]|[12][0-9]|3[0-6])$/.test(k) || k in OUTSIDE;
const rlCovers = (k, n) => (k[0] === 'n' ? Number(k.slice(1)) === n : OUTSIDE[k](n));
const rlOdds = k => (k[0] === 'n' ? 35 : /^(col|doz)/.test(k) ? 2 : 1);
const COLOR = n => (n === 0 ? 'Green' : REDS.has(n) ? 'Red' : 'Black');

function roulette(w, action, args, ctx) {
  if (action !== 'spin') throw new PlayError('bad_action');
  const { bets, total } = cleanBets(args.bets, rlSpot);
  take(w, total);
  const result = ctx.randInt(37);
  let payout = 0;
  for (const [k, a] of Object.entries(bets)) if (rlCovers(k, result)) payout += a * (rlOdds(k) + 1);
  const net = settle(w, total, payout, `Roulette · ${result} ${COLOR(result)}`, ctx.now);
  return { result, total, payout, net };
}

/* ---------- Video poker ---------- */
const MACHINES = { jacks: { pays: POKER_PAYS, rank: pokerRank }, deuces: { pays: DEUCES_PAYS, rank: deucesRank } };
function poker(w, action, args, ctx) {
  const st = w.rounds.poker;
  if (action === 'deal') {
    if (st) return { resume: true, hand: st.hand, bet: st.bet, machine: st.machine };
    const machine = args.machine in MACHINES ? args.machine : 'jacks';
    take(w, args.bet);
    const hand = pokerDeal(ctx.randInt);
    w.rounds.poker = { hand, bet: args.bet, machine };
    return { hand, bet: args.bet, machine, balance: w.balance };
  }
  if (action === 'draw') {
    if (!st) throw new PlayError('no_round');
    const held = [0, 1, 2, 3, 4].map(i => !!(Array.isArray(args.held) && args.held[i]));
    const hand = pokerDraw(st.hand, held, ctx.randInt);
    const rank = MACHINES[st.machine].rank(hand);
    const payout = rank ? st.bet * rank.pays : 0;
    delete w.rounds.poker;
    const net = settle(w, st.bet, payout, `Video poker · ${rank ? rank.name : 'No win'}`, ctx.now);
    return { hand, rank, payout, net, stake: st.bet, machine: st.machine };
  }
  throw new PlayError('bad_action');
}

/* ---------- Baccarat ---------- */
function baccarat(w, action, args, ctx) {
  if (action !== 'deal') throw new PlayError('bad_action');
  const { bets, total } = cleanBets(args.bets, k => k === 'player' || k === 'banker' || k === 'tie');
  take(w, total);
  const coup = bacCoup(bacShoe(ctx.randInt));
  const payout = bacPayout(bets, coup.winner);
  const name = { player: 'Player won', banker: 'Banker won', tie: 'Tie' }[coup.winner];
  const net = settle(w, total, payout, `Baccarat · ${name}`, ctx.now);
  return { coup, bets, total, payout, net };
}

/* ---------- Casino War ---------- */
function warLine(r) {
  if (r.choice === 'surrender') return 'Surrendered';
  const p = r.choice === 'war' ? r.player2 : r.player, d = r.choice === 'war' ? r.dealer2 : r.dealer;
  const won = warRank(p) >= warRank(d);
  return r.choice === 'war' ? (won ? 'Won the war' : 'Lost the war') : won ? 'You won' : 'Dealer won';
}
function war(w, action, args, ctx) {
  const st = w.rounds.war;
  if (action === 'deal') {
    if (st) return { resume: true, round: st };
    const { bets, total } = cleanBets(args.bets, k => k === 'war' || k === 'tie');
    if (!bets.war) throw new PlayError('bad_bet', 'The Tie bet needs a War bet beside it.');
    take(w, total);
    const { player, dealer } = warDeal(ctx.randInt);
    const r = { bet: bets.war, tie: bets.tie || 0, total, player, dealer, choice: null };
    if (warRank(player) === warRank(dealer)) {
      w.rounds.war = r;
      return { round: r, phase: 'decide' };
    }
    r.payout = warPayout(r);
    r.net = settle(w, total, r.payout, `Casino War · ${warLine(r)}`, ctx.now);
    return { round: r, phase: 'done' };
  }
  if (action === 'war' || action === 'surrender') {
    if (!st) throw new PlayError('no_round');
    const r = { ...st, choice: action };
    if (action === 'war') {
      take(w, r.bet);
      r.total += r.bet;
      const b = warBattle(r.player, r.dealer, ctx.randInt);
      Object.assign(r, { player2: b.player, dealer2: b.dealer });
    }
    r.payout = warPayout(r);
    delete w.rounds.war;
    r.net = settle(w, r.total, r.payout, `Casino War · ${warLine(r)}`, ctx.now);
    return { round: r, phase: 'done' };
  }
  throw new PlayError('bad_action');
}

/* ---------- Three Card Poker ---------- */
function threecard(w, action, args, ctx) {
  const st = w.rounds.threecard;
  if (action === 'deal') {
    if (st) return { resume: true, round: { ante: st.ante, pair: st.pair, total: st.total, player: st.player } };
    const { bets, total } = cleanBets(args.bets, k => k === 'ante' || k === 'pair');
    take(w, total);
    const { player, dealer } = tcDealCards(ctx.randInt);
    const r = { ante: bets.ante || 0, pair: bets.pair || 0, total, player, dealer, choice: null };
    if (r.ante) {
      w.rounds.threecard = r;
      return { round: { ante: r.ante, pair: r.pair, total, player }, phase: 'decide' };   // the dealer's cards stay hidden
    }
    r.payout = tcPayout(r);
    r.net = settle(w, total, r.payout, `Three Card Poker · ${TC_PAIR_PLUS[tcRank(player).key] ? 'Pair Plus wins' : 'No Pair Plus'}`, ctx.now);
    return { round: r, phase: 'done' };
  }
  if (action === 'play' || action === 'fold') {
    if (!st) throw new PlayError('no_round');
    const r = { ...st, choice: action };
    if (action === 'play') { take(w, r.ante); r.total += r.ante; }
    r.payout = tcPayout(r);
    delete w.rounds.threecard;
    r.net = settle(w, r.total, r.payout, `Three Card Poker · ${action === 'fold' ? 'Folded' : r.payout > r.total ? 'Won' : r.payout === r.total ? 'Push' : 'Lost'}`, ctx.now);
    return { round: r, phase: 'done' };
  }
  throw new PlayError('bad_action');
}

/* ---------- Red Dog ---------- */
function rdLine(h) {
  const s = rdSpread(h.cards[0], h.cards[1]);
  if (s.kind === 'next') return 'Back to back: push';
  if (s.kind === 'pair') return rdVal(h.cards[2]) === rdVal(h.cards[0]) ? 'Three of a kind!' : 'Pair: push';
  return h.payout > 0 ? 'In between!' : 'Missed';
}
function reddog(w, action, args, ctx) {
  const st = w.rounds.reddog;
  if (action === 'deal') {
    if (st) return { resume: true, round: st };
    take(w, args.bet);
    const [a, b] = rdDeal(ctx.randInt);
    const s = rdSpread(a, b);
    const h = { bet: args.bet, raise: 0, total: args.bet, cards: [a, b] };
    if (s.kind === 'spread') { w.rounds.reddog = h; return { round: h, phase: 'decide' }; }
    if (s.kind === 'pair') h.cards.push(rdThird(a, b, ctx.randInt));
    h.payout = rdPayout({ bet: h.bet, cards: s.kind === 'pair' ? h.cards : [a, b, a] });
    h.net = settle(w, h.total, h.payout, `Red Dog · ${rdLine(h)}`, ctx.now);
    return { round: h, phase: 'done' };
  }
  if (action === 'third') {
    if (!st) throw new PlayError('no_round');
    const h = { ...st, cards: st.cards.slice() };
    if (args.raise) { take(w, h.bet); h.raise = h.bet; h.total += h.bet; }
    h.cards.push(rdThird(h.cards[0], h.cards[1], ctx.randInt));
    h.payout = rdPayout(h);
    delete w.rounds.reddog;
    h.net = settle(w, h.total, h.payout, `Red Dog · ${rdLine(h)}`, ctx.now);
    return { round: h, phase: 'done' };
  }
  throw new PlayError('bad_action');
}

/* ---------- Duck Drop (plinko) ----------
   Each duck gets a random seed; the bounces it makes with that seed decide its bucket here,
   and the page replays the same bounces on screen. Paid at once; the page shows the money
   as each duck lands. */
const ROWS = pegLayout();
export function plinkoBucket(seed) {
  const rng = mulberry32(seed);
  const ball = makeBall(rng);
  for (let s = 0; !ball.done && s < 240 * 30; s++) stepBall(ball, ROWS, rng);
  return ball.done ? ball.bucket : (RISKS.low.pays.length - 1) / 2;
}
function plinko(w, action, args, ctx) {
  if (action !== 'drop') throw new PlayError('bad_action');
  const n = Math.min(10, Math.max(1, Math.floor(Number(args.n) || 1)));
  const risk = RISKS[args.risk] ? args.risk : 'medium';
  if (!okAmount(args.bet)) throw new PlayError('bad_bet');
  const drops = [];
  for (let i = 0; i < n && w.balance >= args.bet; i++) {
    take(w, args.bet);
    const seed = ctx.randInt(4294967296);
    const bucket = plinkoBucket(seed);
    const mult = RISKS[risk].pays[bucket];
    const payout = Math.round(args.bet * mult);
    settle(w, args.bet, payout, `Duck Drop · ${mult}×`, ctx.now, payout < args.bet * 10);   // only big ones on the statement
    drops.push({ seed, bucket, mult, payout });
  }
  if (!drops.length) throw new PlayError('funds', 'Not enough in your wallet.');
  return { drops, bet: args.bet, risk };
}

/* ---------- Duck Rocket (crash) ----------
   The crash point is drawn at launch and never sent to the page until the rocket is down.
   The flight starts after the countdown; the multiplier is worked out from the server's
   own clock when the player cashes out. */
export const CRASH_COUNTDOWN_MS = 1600;
const AUTOS = new Set([0, 1.5, 2, 3, 5, 10]);
function crashSettle(w, st, now) {
  const elapsed = (now - st.t0) / 1000;
  const crashT = timeTo(st.crashAt);
  let m = 0;
  if (st.auto && st.auto <= st.crashAt && elapsed >= timeTo(st.auto)) m = st.auto;   // the auto cash-out fired
  const payout = m ? Math.round(st.stake * m) : 0;
  delete w.rounds.crash;
  const net = settle(w, st.stake, payout, `Duck Rocket · ${payout ? `${m}×` : 'Crashed'}`, now);
  return { crashed: elapsed >= crashT, at: st.crashAt, cashed: m, payout, net };
}
function crash(w, action, args, ctx) {
  const st = w.rounds.crash;
  const now = ctx.now;
  if (action === 'launch') {
    let prev = null;
    if (st) prev = crashResolve(w, st, now, true);
    take(w, args.bet);
    const auto = AUTOS.has(args.auto) ? args.auto : 0;
    w.rounds.crash = { stake: args.bet, auto, crashAt: crashPoint(ctx.rand), t0: now + CRASH_COUNTDOWN_MS };
    return { launched: true, t0: now + CRASH_COUNTDOWN_MS, countdown: CRASH_COUNTDOWN_MS, prev };
  }
  if (action === 'peek' || action === 'cashout') {
    if (!st) return { gone: true };
    return crashResolve(w, st, now, action === 'cashout');
  }
  throw new PlayError('bad_action');
}
// Where a flight stands now: still going, cashed out (by the player or the auto), or blown up
function crashResolve(w, st, now, cashOut) {
  const elapsed = (now - st.t0) / 1000;
  const crashT = timeTo(st.crashAt);
  if (st.auto && st.auto <= st.crashAt && elapsed >= timeTo(st.auto)) return crashSettle(w, st, now);
  if (elapsed >= crashT) return crashSettle(w, st, now);
  if (!cashOut) return { flying: elapsed > 0, m: elapsed > 0 ? Math.floor(multAt(elapsed) * 100) / 100 : 1 };
  if (elapsed <= 0) {   // still counting down: the bet comes back
    delete w.rounds.crash;
    w.balance = r2(w.balance + st.stake);
    return { refunded: true, payout: st.stake, net: 0 };
  }
  const m = Math.floor(multAt(elapsed) * 100) / 100;
  const payout = Math.round(st.stake * m);
  delete w.rounds.crash;
  const net = settle(w, st.stake, payout, `Duck Rocket · ${m}×`, now);
  return { cashed: m, at: st.crashAt, payout, net };
}

/* ---------- Solo blackjack ----------
   The solo table runs the same rules as the rooms (src/rules.js), on the server, with the
   wallet as the player's chips: before a move the player's chips are the wallet balance,
   and after it the wallet becomes whatever the chips are. The shoe's seed never leaves the
   server. */
const SOLO = 'solo';
export function soloView(T) {
  if (!T) return null;
  const { seed, ...rest } = T;
  return rest;
}
const BJ_MOVES = new Set(['bet', 'ready', 'unready', 'ins', 'hit', 'stand', 'double', 'split']);
function blackjack(w, action, args, ctx) {
  let T = w.rounds.bj;
  if (!T || migrateTable(T)) {
    T = newTable(SOLO, 'Solo table', ctx.seed(), ctx.now);
    T.sid = ctx.seed();
    T.seats[0] = SOLO;
    T.players[SOLO] = newPlayer();
  }
  if (action === 'state') { w.rounds.bj = T; return { T: soloView(T) }; }
  if (action !== 'move' || !args.m || !BJ_MOVES.has(args.m.t)) throw new PlayError('bad_action');
  const P = T.players[SOLO];
  const before = w.balance;
  P.bank = before;
  const n = T.n, wasOver = !!(T.round && T.round.over);
  const c = { now: ctx.now, present: new Set([SOLO]), longAway: null };
  applyIntent(T, SOLO, args.m, c);
  if (Number.isInteger(args.m.s) && args.m.s > (T.processed[SOLO] || 0)) T.processed[SOLO] = args.m.s;   // lets the page drop its guess
  autoAdvance(T, c);
  T.rev = (T.rev || 0) + 1;
  T.updated = ctx.now;
  w.balance = r2(P.bank);
  P.bank = 0;   // the wallet holds the money; the table only remembers the bet
  const R = T.round;
  if (R && R.over && (R.n !== n || !wasOver) && SOLO in R.net) {
    const net = r2(R.net[SOLO]);
    w.weekNet = r2((w.weekNet || 0) + net);
    note(w, net, `Blackjack · ${net > 0 ? 'Won' : net < 0 ? 'Lost' : 'Push'}`, ctx.now);
  }
  w.rounds.bj = T;
  return { T: soloView(T) };
}

const GAMES = { roulette, poker, baccarat, war, threecard, reddog, plinko, crash, blackjack };

export function play(w, game, action, args, ctx) {
  const fn = GAMES[game];
  if (!fn) throw new PlayError('bad_game');
  w.rounds = w.rounds && typeof w.rounds === 'object' ? w.rounds : {};
  return fn(w, action, args && typeof args === 'object' ? args : {}, ctx);
}

// What a page needs to pick up where it left off: every round that's waiting on the player,
// without anything it shouldn't see (the dealer's hidden cards, the crash point, the shoe)
export function roundsView(w, now) {
  const r = w.rounds || {};
  const out = {};
  if (r.poker) out.poker = { hand: r.poker.hand, bet: r.poker.bet, machine: r.poker.machine };
  if (r.war) out.war = r.war;
  if (r.threecard) out.threecard = { ante: r.threecard.ante, pair: r.threecard.pair, total: r.threecard.total, player: r.threecard.player };
  if (r.reddog) out.reddog = r.reddog;
  if (r.crash) out.crash = { stake: r.crash.stake, auto: r.crash.auto, t0: r.crash.t0, now };
  if (r.bj) out.bj = soloView(r.bj);
  return out;
}
