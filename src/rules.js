// Mini Casino blackjack rules, shared by the page and the room server.
//
// A table is one JSON document, and every change goes through the reducer below.
// The page runs it for the solo table; the room's Durable Object runs it for
// multiplayer rooms. scripts/build.mjs inlines this file into the page (dropping
// the `export` keywords), and src/worker.js imports it.

export const SEATS = 4;
export const DECKS = 6;
export const SHOE = DECKS * 52;
export const CUT = 78;                 // reshuffle when a quarter of the shoe is left
export const MIN_BET = 5;
export const TABLE_VERSION = 2;      // tables from before chips came out of the wallet start over
export const MAX_HANDS = 4;            // per player, after splits
export const TURN_MS = 30000;          // time to act when other players are waiting
export const BET_MS = 15000;           // countdown once someone is ready
export const AWAY_MS = 8000;           // missing from the room this long counts as away
export const AWAY_SEAT_MS = 120000;    // away this long during betting frees the seat
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const MAX_CHIPS = 1e15;
export const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';


export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const shoeCache = new Map();
export function getShoe(seed, no) {
  const key = seed + ':' + no;
  let shoe = shoeCache.get(key);
  if (shoe) return shoe;
  const rnd = mulberry32(hash32(key));
  shoe = [];
  for (let d = 0; d < DECKS; d++) for (const s of 'SHDC') for (const r of RANKS) shoe.push(r + s);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  if (shoeCache.size > 8) shoeCache.clear();
  shoeCache.set(key, shoe);
  return shoe;
}

export const rankOf = c => c.slice(0, -1);
export const suitOf = c => c.slice(-1);
export function val(c) {
  const r = rankOf(c);
  if (r === 'A') return 1;
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  return Number(r);
}
export function score(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += val(c); if (rankOf(c) === 'A') aces++; }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}
export const isBJ = h => !h.split && h.cards.length === 2 && score(h.cards).total === 21;

export function newTable(code, name, seed, now) {
  return {
    v: TABLE_VERSION, code, name, seed, created: now, updated: now, rev: 0,
    shoeNo: 0, pos: 0, n: 0, turn: 0, readyAt: 0, turnAt: 0,
    seats: [null, null, null, null], players: {}, phase: 'betting', round: null, processed: {},
  };
}
/* A seat starts with no chips: players bring them from their wallet ('chips'), and cash
   them out again ('cashout', or by leaving). `cashed` counts everything cashed out so far,
   so the page can pay the difference into the wallet exactly once. */
export function newPlayer() {
  return { bank: 0, bet: 0, lastBet: 0, cashed: 0, status: 'betting', leaving: false, stats: { w: 0, l: 0, p: 0, bj: 0 } };
}
export function cashOut(P) {
  P.cashed = (P.cashed || 0) + P.bank;
  P.bank = 0;
  P.bet = 0;
}
/* Tables saved before chips came from the wallet: everyone's chips were free, so they go. */
export function migrateTable(T) {
  if (!T || (T.v || 1) >= TABLE_VERSION) return false;
  for (const P of Object.values(T.players || {})) { P.bank = 0; P.bet = 0; P.cashed = 0; P.status = 'betting'; P.leaving = false; }
  T.round = null;
  T.phase = 'betting';
  T.readyAt = 0;
  T.turnAt = 0;
  T.v = TABLE_VERSION;
  return true;
}
export function newHand(R, seat, uid, bet) {
  return { id: R.nextId++, seat, uid, bet, cards: [], done: false, doubled: false, split: false, splitAces: false, result: null };
}
export function draw(T) {
  if (T.pos >= SHOE) { T.shoeNo++; T.pos = 0; }
  return getShoe(T.seed, T.shoeNo)[T.pos++];
}
export const isPresent = (ctx, uid) => !ctx.present || ctx.present.has(uid);
export const roundLive = T => !!(T.round && !T.round.over);
export function activeHandOf(T) {
  const R = T.round;
  return R && !R.over && T.phase === 'player' ? R.hands[R.active] || null : null;
}
export function seatedPresent(T, ctx) {
  return T.seats.filter(u => u && T.players[u] && isPresent(ctx, u) && !T.players[u].leaving);
}
export const timersOn = (T, ctx) => seatedPresent(T, ctx).length >= 2;

export function canDouble(T, h) {
  const P = T.players[h.uid];
  return !!P && h.cards.length === 2 && !h.splitAces && P.bank >= h.bet;
}
export function canSplit(T, h) {
  const P = T.players[h.uid];
  return !!P && h.cards.length === 2 && val(h.cards[0]) === val(h.cards[1]) && !h.splitAces
    && T.round.hands.filter(x => x.uid === h.uid).length < MAX_HANDS && P.bank >= h.bet;
}

export function applyIntent(T, uid, m, ctx) {
  const P = T.players[uid];
  const seat = T.seats.indexOf(uid);
  switch (m.t) {
    case 'sit': {
      const k = Number(m.seat);
      if (seat >= 0 || !(k >= 0 && k < SEATS) || T.seats[k]) return;
      T.seats[k] = uid;
      const p = T.players[uid] || (T.players[uid] = newPlayer());
      p.leaving = false;
      p.status = 'betting';
      return;
    }
    case 'leave': {
      if (seat < 0) return;
      if (roundLive(T) && T.round.hands.some(h => h.uid === uid)) P.leaving = true;
      else { T.seats[seat] = null; P.status = 'betting'; P.leaving = false; cashOut(P); }
      return;
    }
    case 'cashout':
      if (seat >= 0 && T.phase === 'betting') { cashOut(P); P.status = 'betting'; }
      return;
    case 'chips': {
      const a = Math.floor(Number(m.a) || 0);
      if (seat < 0 || !(a > 0) || a > MAX_CHIPS) return;
      P.bank = Math.min(P.bank + a, MAX_CHIPS);
      return;
    }
    case 'bet': {
      if (seat < 0 || T.phase !== 'betting') return;
      let a = Math.floor((Number(m.a) || 0) / 5) * 5;
      a = Math.max(0, Math.min(a, Math.floor(P.bank / 5) * 5));
      P.bet = a;
      P.status = 'betting';
      return;
    }
    case 'ready':
      if (seat >= 0 && T.phase === 'betting' && P.bet >= MIN_BET && P.bet <= P.bank) P.status = 'ready';
      return;
    case 'unready':
      if (seat >= 0 && T.phase === 'betting') P.status = 'betting';
      return;
    case 'out':
      if (seat >= 0 && T.phase === 'betting') P.status = 'out';
      return;
    case 'ins': {
      if (T.phase !== 'insurance' || !P) return;
      for (const h of T.round.hands) {
        if (h.uid !== uid || T.round.ins[h.id] !== null) continue;
        if (m.y && P.bank >= h.bet / 2) { P.bank -= h.bet / 2; T.round.ins[h.id] = 'yes'; }
        else T.round.ins[h.id] = 'no';
      }
      return;
    }
    case 'hit': case 'stand': case 'double': case 'split': {
      const h = activeHandOf(T);
      if (!h || h.uid !== uid || m.k !== T.turn) return;
      play(T, h, m.t, ctx);
      return;
    }
  }
}

export function play(T, h, t, ctx) {
  const P = T.players[h.uid];
  const R = T.round;
  if (t === 'hit') {
    h.cards.push(draw(T));
    const total = score(h.cards).total;
    if (total > 21) { h.done = true; h.result = 'bust'; }
    else if (total === 21) h.done = true;
  } else if (t === 'stand') {
    h.done = true;
  } else if (t === 'double') {
    if (!canDouble(T, h)) return;
    P.bank -= h.bet; h.bet *= 2; h.doubled = true;
    h.cards.push(draw(T));
    h.done = true;
    if (score(h.cards).total > 21) h.result = 'bust';
  } else if (t === 'split') {
    if (!canSplit(T, h)) return;
    P.bank -= h.bet;
    const nh = newHand(R, h.seat, h.uid, h.bet);
    nh.cards.push(h.cards.pop());
    h.split = nh.split = true;
    if (rankOf(h.cards[0]) === 'A') h.splitAces = nh.splitAces = true;
    R.hands.splice(R.active + 1, 0, nh);
  }
  T.turn++;
  T.turnAt = ctx.now;
  advance(T, ctx);
}

/* Move to the next hand that needs a decision, or play the dealer. */
export function advance(T, ctx) {
  const R = T.round;
  let i = Math.max(0, R.active);
  while (i < R.hands.length) {
    const h = R.hands[i];
    if (!h.done) {
      if (h.cards.length === 1) {
        h.cards.push(draw(T));
        if (h.splitAces) { h.done = true; i++; continue; }
      }
      if (score(h.cards).total >= 21) { h.done = true; i++; continue; }
      if (R.active !== i) { R.active = i; T.turn++; T.turnAt = ctx.now; }
      return;
    }
    i++;
  }
  R.active = -1;
  dealerPlay(T, ctx);
}

export function deal(T, ctx) {
  if (T.pos > SHOE - CUT) { T.shoeNo++; T.pos = 0; }
  const R = {
    n: T.n + 1, nextId: 1, dealer: [], holeUp: false, hands: [], active: -1,
    ins: {}, over: false, start: {}, net: {}, how: '', shuffled: T.pos === 0,
  };
  for (let s = 0; s < SEATS; s++) {
    const uid = T.seats[s];
    if (!uid) continue;
    const P = T.players[uid];
    if (P.status === 'ready' && isPresent(ctx, uid) && !P.leaving && P.bet >= MIN_BET && P.bet <= P.bank) {
      R.start[uid] = P.bank;
      P.bank -= P.bet;
      P.lastBet = P.bet;
      R.hands.push(newHand(R, s, uid, P.bet));
    }
  }
  if (!R.hands.length) return false;
  T.n = R.n;
  T.round = R;
  T.turn++;
  T.readyAt = 0;
  for (const h of R.hands) h.cards.push(draw(T));
  R.dealer.push(draw(T));
  for (const h of R.hands) h.cards.push(draw(T));
  R.dealer.push(draw(T));
  if (rankOf(R.dealer[0]) === 'A') {
    T.phase = 'insurance';
    T.turnAt = ctx.now;
    for (const h of R.hands) R.ins[h.id] = T.players[h.uid].bank >= h.bet / 2 ? null : 'no';
  } else {
    peek(T, ctx);
  }
  return true;
}

export function peek(T, ctx) {
  const R = T.round;
  const up = R.dealer[0];
  R.peeked = rankOf(up) === 'A' || val(up) === 10;
  if (R.peeked && score(R.dealer).total === 21) {
    R.holeUp = true;
    for (const h of R.hands) {
      const P = T.players[h.uid];
      if (R.ins[h.id] === 'yes') P.bank += h.bet * 1.5;      // stake back plus 2 to 1
      if (isBJ(h)) { h.result = 'push'; P.bank += h.bet; } else h.result = 'lose';
      h.done = true;
    }
    finish(T, ctx, 'bj');
    return;
  }
  for (const h of R.hands) {
    if (isBJ(h)) { h.result = 'blackjack'; h.done = true; T.players[h.uid].bank += h.bet * 2.5; }
  }
  T.phase = 'player';
  R.active = -1;
  advance(T, ctx);
}

export function dealerPlay(T, ctx) {
  const R = T.round;
  R.holeUp = true;
  if (R.hands.some(h => !h.result)) {
    while (score(R.dealer).total < 17) R.dealer.push(draw(T));   // stands on all 17s
  }
  const d = score(R.dealer).total;
  for (const h of R.hands) {
    if (h.result) continue;
    const P = T.players[h.uid];
    const p = score(h.cards).total;
    if (d > 21 || p > d) { h.result = 'win'; P.bank += h.bet * 2; }
    else if (p === d) { h.result = 'push'; P.bank += h.bet; }
    else h.result = 'lose';
  }
  finish(T, ctx, d > 21 ? 'bust' : 'stand');
}

export function finish(T, ctx, how) {
  const R = T.round;
  R.over = true;
  R.how = how;
  R.active = -1;
  for (const h of R.hands) {
    const st = T.players[h.uid].stats;
    if (h.result === 'win' || h.result === 'blackjack') st.w++;
    else if (h.result === 'push') st.p++;
    else st.l++;
    if (h.result === 'blackjack') st.bj++;
  }
  for (const uid of Object.keys(R.start)) R.net[uid] = T.players[uid].bank - R.start[uid];
  T.phase = 'betting';
  T.turn++;
  T.readyAt = 0;
  T.turnAt = 0;
  for (let s = 0; s < SEATS; s++) {
    const uid = T.seats[s];
    if (!uid) continue;
    const P = T.players[uid];
    if (P.leaving) { T.seats[s] = null; P.leaving = false; P.status = 'betting'; cashOut(P); continue; }
    P.status = 'betting';
    if (uid in R.start) P.bet = 0;   // every round starts with no bet; Rebet brings back lastBet
    else P.bet = Math.min(P.bet, Math.floor(P.bank / 5) * 5);
  }
}

/* Changes that happen on their own: dealing once everyone is ready, timeouts, players who left. */
export function step(T, ctx) {
  if (T.phase === 'betting') {
    if (ctx.longAway && ctx.longAway.size) {
      for (let s = 0; s < SEATS; s++) {
        const u = T.seats[s];
        if (u && ctx.longAway.has(u)) { T.seats[s] = null; T.players[u].status = 'betting'; cashOut(T.players[u]); }
      }
    }
    const sp = seatedPresent(T, ctx);
    const ready = sp.filter(u => T.players[u].status === 'ready');
    if (!ready.length) { T.readyAt = 0; return; }
    const waiting = sp.filter(u => T.players[u].status === 'betting');
    if (!waiting.length || (T.readyAt && ctx.now >= T.readyAt + BET_MS)) { deal(T, ctx); return; }
    if (!T.readyAt) T.readyAt = ctx.now;
    return;
  }
  if (T.phase === 'insurance') {
    const R = T.round;
    const expired = timersOn(T, ctx) && ctx.now >= T.turnAt + TURN_MS;
    for (const h of R.hands) {
      if (R.ins[h.id] === null && (expired || !isPresent(ctx, h.uid) || T.players[h.uid].leaving)) R.ins[h.id] = 'no';
    }
    if (R.hands.every(h => R.ins[h.id] !== null)) { T.turn++; peek(T, ctx); }
    return;
  }
  if (T.phase === 'player') {
    const h = activeHandOf(T);
    if (!h) return;
    const P = T.players[h.uid];
    const expired = timersOn(T, ctx) && ctx.now >= T.turnAt + TURN_MS;
    if (!isPresent(ctx, h.uid) || !P || P.leaving || expired) {
      h.done = true;
      T.turn++;
      T.turnAt = ctx.now;
      advance(T, ctx);
    }
  }
}
export function autoAdvance(T, ctx) {
  for (let i = 0; i < 24; i++) {
    const before = T.turn + ':' + T.phase + ':' + T.n + ':' + T.readyAt + ':' + T.seats.join(',');
    step(T, ctx);
    if (before === T.turn + ':' + T.phase + ':' + T.n + ':' + T.readyAt + ':' + T.seats.join(',')) break;
  }
}

export function nextDeadline(T, ctx) {
  if (!T) return 0;
  if (T.phase === 'betting' && T.readyAt) return T.readyAt + BET_MS;
  if ((T.phase === 'insurance' || T.phase === 'player') && timersOn(T, ctx)) return T.turnAt + TURN_MS;
  return 0;
}

/* Basic strategy: 6 decks, dealer stands on soft 17, double after split allowed. */
export function recommend(T, h, up) {
  const d = rankOf(up) === 'A' ? 11 : val(up);
  const canD = canDouble(T, h);
  if (canSplit(T, h)) {
    const v = val(h.cards[0]);
    const p = v === 1 ? 11 : v;
    const split =
      p === 11 || p === 8 ? true :
      p === 9 ? [2, 3, 4, 5, 6, 8, 9].includes(d) :
      p === 7 || p === 3 || p === 2 ? d <= 7 :
      p === 6 ? d <= 6 :
      p === 4 ? d === 5 || d === 6 :
      false;
    if (split) return 'split';
  }
  const { total, soft } = score(h.cards);
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) {
      if (d >= 3 && d <= 6) return canD ? 'double' : 'stand';
      return d <= 8 ? 'stand' : 'hit';
    }
    if (total === 17) return d >= 3 && d <= 6 && canD ? 'double' : 'hit';
    if (total >= 15) return d >= 4 && d <= 6 && canD ? 'double' : 'hit';
    return d >= 5 && d <= 6 && canD ? 'double' : 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return d <= 10 && canD ? 'double' : 'hit';
  if (total === 10) return d <= 9 && canD ? 'double' : 'hit';
  if (total === 9) return d >= 3 && d <= 6 && canD ? 'double' : 'hit';
  return 'hit';
}

/* Apply one player's move the way the room server does: ignore anything already
   seen (moves carry an increasing number `s`), then let timers and dealing run. */
export function applyMove(T, uid, m, ctx) {
  T.processed = T.processed || {};
  if (!m || typeof m !== 'object' || !Number.isInteger(m.s) || m.s <= (T.processed[uid] || 0)) return false;
  try { applyIntent(T, uid, m, ctx); } catch (e) { /* ignore a malformed move */ }
  T.processed[uid] = m.s;
  autoAdvance(T, ctx);
  return true;
}

export function makeCode(rand = Math.random) {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return out;
}
