// One multiplayer blackjack room, as a Durable Object.
//
// The room holds the table and is the only thing that changes it. Players connect
// over a WebSocket, send moves ({ t: 'hit', k, s } and so on), and every connected
// browser gets the whole table back after each change. Turn timers, the betting
// countdown and seats freed by players who left run on the object's alarm.
// The rules themselves are the same code the page uses for the solo table.

import { DurableObject } from 'cloudflare:workers';
import { newTable, newPlayer, migrateTable, applyMove, autoAdvance, nextDeadline, AWAY_MS, AWAY_SEAT_MS } from './rules.js';

const MAX_MESSAGE = 2048;
const MOVES = new Set(['sit', 'leave', 'cashout', 'chips', 'bet', 'ready', 'unready', 'out', 'ins', 'hit', 'stand', 'double', 'split']);
const OPEN = 1;

export class TableRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.T = null;
    this.away = {};    // uid -> when their last connection closed
    this.names = {};   // uid -> name shown at the table
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get(['T', 'away', 'names']);
      this.T = got.get('T') || null;
      if (migrateTable(this.T)) await ctx.storage.put('T', this.T);
      this.away = got.get('away') || {};
      this.names = got.get('names') || {};
    });
    // Keep-alive pings are answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.T) return Response.json({ error: 'taken' }, { status: 409 });
      const { code, name, seed, uid, display } = await request.json();
      const now = Date.now();
      const T = newTable(code, name, seed, now);
      T.seats[0] = uid;                 // the creator sits down straight away
      T.players[uid] = newPlayer();
      this.T = T;
      this.names[uid] = display;
      this.away[uid] = now;             // seated, not connected yet
      await this.save();
      return Response.json({ code, name });
    }

    if (!this.T) return Response.json({ error: 'not_found' }, { status: 404 });

    if (url.pathname === '/info') {
      return Response.json({ code: this.T.code, name: this.T.name, seated: this.T.seats.filter(Boolean).length });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const uid = request.headers.get('x-user-id');
      if (!uid) return new Response('Signed out', { status: 401 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ uid });
      this.names[uid] = request.headers.get('x-user-name') || 'Player';
      delete this.away[uid];
      await this.update();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws, message) {
    if (!this.T || typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    let m;
    try { m = JSON.parse(message); } catch (e) { return; }
    const { uid } = ws.deserializeAttachment() || {};
    if (!uid || !m || typeof m !== 'object') return;
    if (m.t === 'hello') { ws.send(this.snapshot(this.presence())); return; }
    if (!MOVES.has(m.t)) return;
    const ctx = this.presence();
    if (!applyMove(this.T, uid, m, ctx)) return;
    await this.update(ctx);
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) { /* already closed */ }
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async alarm() {
    if (this.T) await this.update();
  }

  /* ---------- helpers ---------- */

  async gone(ws) {
    const { uid } = ws.deserializeAttachment() || {};
    if (!uid || !this.T) return;
    const stillHere = this.ctx.getWebSockets().some(w => w !== ws && w.readyState === OPEN && (w.deserializeAttachment() || {}).uid === uid);
    if (!stillHere) this.away[uid] = Date.now();
    await this.update();
  }

  // Who counts as at the table: anyone connected, plus anyone who dropped in the last few seconds
  presence(now = Date.now()) {
    const present = new Set();
    const longAway = new Set();
    for (const w of this.ctx.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.uid && w.readyState === OPEN) present.add(a.uid);
    }
    for (const [u, t] of Object.entries(this.away)) {
      if (present.has(u)) delete this.away[u];
      else if (now - t < AWAY_MS) present.add(u);
      else if (!this.T.seats.includes(u) && now - t > AWAY_SEAT_MS) delete this.away[u];   // tidy up old watchers
    }
    for (const u of this.T.seats) {
      if (!u || present.has(u)) continue;
      if (!(u in this.away)) this.away[u] = now;
      if (now - this.away[u] >= AWAY_SEAT_MS) longAway.add(u);
    }
    return { now, present, longAway };
  }

  async update(ctx = this.presence()) {
    autoAdvance(this.T, ctx);
    this.T.rev = (this.T.rev || 0) + 1;
    this.T.updated = ctx.now;
    await this.save();
    const msg = this.snapshot(ctx);
    for (const w of this.ctx.getWebSockets()) {
      try { w.send(msg); } catch (e) { /* closing */ }
    }
    await this.schedule(ctx);
  }

  snapshot(ctx) {
    return JSON.stringify({ type: 'state', T: this.T, present: [...ctx.present], names: this.names, now: ctx.now });
  }

  // Wake up for the next timer: a turn or betting deadline, or someone who dropped crossing an "away" limit
  async schedule(ctx) {
    const now = ctx.now;
    let next = nextDeadline(this.T, ctx) || Infinity;
    for (const [u, t] of Object.entries(this.away)) {
      if (now - t < AWAY_MS) next = Math.min(next, t + AWAY_MS);
      else if (this.T.seats.includes(u) && now - t < AWAY_SEAT_MS) next = Math.min(next, t + AWAY_SEAT_MS);
    }
    if (next === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next > now ? next + 50 : now + 1000);
  }

  async save() {
    await this.ctx.storage.put({ T: this.T, away: this.away, names: this.names });
  }
}
