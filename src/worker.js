// Mini Casino API on Cloudflare Workers.
//
// Everything outside /api/* is the static site (served from ./dist).
//   /api/auth/*  same-origin proxy to Neon Auth (Managed Better Auth), so the
//                session cookie belongs to this site and Safari doesn't block it
//   /api/me      who is signed in
//   /api/save    the signed-in player's wallet, roulette and solo-blackjack save,
//                stored in Neon Postgres (table: saves)
//   /api/daily   claims the signed-in player's $1,000 daily bonus, once per calendar day
//   /api/rooms   multiplayer blackjack: POST creates a room, /api/rooms/{code} says
//                whether it exists, /api/rooms/{code}/ws connects to it. Each room
//                is a Durable Object (src/room.js).

import { neon } from '@neondatabase/serverless';
import { makeCode } from './rules.js';
import { TableRoom } from './room.js';

export { TableRoom };

// /sign-in/social starts "Continue with Google". Neon sends the player back to this site with a
// one-time verifier; the page trades it for a session through /get-session, still via this proxy.
const AUTH_ROUTES = new Set(['/sign-up/email', '/sign-in/email', '/sign-in/social', '/sign-out', '/get-session']);
const MAX_SAVE_BYTES = 256 * 1024;
const DAILY_BONUS = 1000;
const WALLET_VERSION = 2;          // wallets from before the daily bonus start over at $1,000
const START_BALANCE = 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname.startsWith('/api/auth/')) return await proxyAuth(request, env, url);
      if (url.pathname === '/api/me') return await me(request, env, url);
      if (url.pathname === '/api/save') return await save(request, env, url);
      if (url.pathname === '/api/daily') return await daily(request, env, url);
      if (url.pathname === '/api/rooms') return await createRoom(request, env, url);
      const room = url.pathname.match(/^\/api\/rooms\/([a-z0-9]{4,12})(\/ws)?$/);
      if (room) return await roomRoute(request, env, url, room[1], !!room[2]);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('api error', url.pathname, err && err.stack ? err.stack : err);
      return json({ error: 'server_error' }, 500);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const authBase = env => env.NEON_AUTH_BASE_URL.replace(/\/+$/, '');

/* ---------- Auth proxy ---------- */
async function proxyAuth(request, env, url) {
  const route = url.pathname.slice('/api/auth'.length);
  if (!AUTH_ROUTES.has(route)) return json({ error: 'not_found' }, 404);
  if (request.method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);

  const headers = new Headers({ origin: url.origin, accept: 'application/json' });
  for (const name of ['content-type', 'cookie', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(authBase(env) + route + url.search, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  const out = new Headers({ 'cache-control': 'no-store' });
  const type = upstream.headers.get('content-type');
  if (type) out.set('content-type', type);
  for (const cookie of upstream.headers.getSetCookie()) {
    // Keep the cookie on this site: drop any upstream Domain and use Lax, since
    // every request that needs it now comes from this origin.
    out.append('set-cookie', cookie.replace(/;\s*domain=[^;]*/gi, '').replace(/;\s*samesite=none/gi, '; SameSite=Lax'));
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

/* Local testing only: with DEV_AUTH=1 in .dev.vars, a `dev_user=alice` cookie on
   localhost signs you in as a fake player. Never active on the deployed site. */
function devUser(request, env, url) {
  if (env.DEV_AUTH !== '1' || !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
  const m = /(?:^|;\s*)dev_user=([a-z0-9]{1,20})/i.exec(request.headers.get('cookie') || '');
  if (!m) return null;
  const n = m[1].toLowerCase();
  return { id: 'dev-' + n, name: `${n[0].toUpperCase()}${n.slice(1)} Tester`, email: '', dev: true };
}

async function currentUser(request, env, url) {
  const dev = devUser(request, env, url);
  if (dev) return dev;
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  const res = await fetch(authBase(env) + '/get-session', {
    headers: { cookie, origin: url.origin, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && data.user && typeof data.user.id === 'string' ? data.user : null;
}

/* ---------- API ---------- */
async function me(request, env, url) {
  const user = await currentUser(request, env, url);
  return json({ user: user ? { id: user.id, name: user.name || '', email: user.email || '', ...(user.dev ? { dev: true } : {}) } : null });
}

async function save(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405);
  if (request.method === 'PUT') {
    if (!sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'json_required' }, 415);
  }
  const user = await currentUser(request, env, url);
  if (!user) return json({ error: 'signed_out' }, 401);
  if (user.dev) return json({ error: 'dev_user' }, 403);   // test players never touch the real database
  const sql = neon(env.DATABASE_URL);

  if (request.method === 'GET') return json(await readSave(sql, user.id));

  const text = await request.text();
  if (text.length > MAX_SAVE_BYTES) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const data = cleanSave(body && body.data);
  const base = body && Number.isInteger(body.base) && body.base >= 0 ? body.base : null;
  if (!data || base === null) return json({ error: 'bad_request' }, 400);
  const result = await writeSave(sql, user.id, data, base);
  return json(result, result.ok ? 200 : 409);
}

/* Only the parts the page saves; the page re-validates every field when it loads them. */
export function cleanSave(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out = {};
  for (const key of ['wallet', 'roulette', 'solo', 'stats']) {
    if (d[key] && typeof d[key] === 'object' && !Array.isArray(d[key])) out[key] = d[key];
  }
  return out;
}

export async function readSave(sql, userId) {
  const rows = await sql`select data, version from saves where user_id = ${userId}`;
  return rows.length ? { data: rows[0].data, version: rows[0].version } : { data: null, version: 0 };
}

/* Write only if nobody saved since the version this device last saw (`base`).
   On a conflict, return the newer save so the device can load it. The page never sends
   `daily` (the day the bonus was last claimed); the server keeps the stored one. */
export async function writeSave(sql, userId, data, base) {
  const rows = await sql`
    insert into saves (user_id, data, version)
    values (${userId}, ${JSON.stringify(data)}::jsonb, 1)
    on conflict (user_id) do update
      set data = case when saves.data ? 'daily'
                   then excluded.data || jsonb_build_object('daily', saves.data->'daily')
                   else excluded.data end,
          version = saves.version + 1, updated_at = now()
      where saves.version = ${base}
    returning version`;
  if (rows.length) return { ok: true, version: rows[0].version };
  return { ok: false, conflict: true, ...(await readSave(sql, userId)) };
}

/* ---------- Daily bonus ----------
   POST { day: 'YYYY-MM-DD' }, the player's own calendar date. It has to be a date that's
   current somewhere right now (time zones run from UTC-12 to UTC+14), and later than the
   last day claimed. The bonus goes straight into the stored wallet, and the reply carries the whole
   save so the page loads it. */
const DAY_MS = 86400000;
const dayNumber = day => Date.parse(day + 'T00:00:00Z') / DAY_MS;
export function validDay(day, now = Date.now()) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayNumber(day))) return false;
  const n = dayNumber(day);
  return n >= Math.floor((now - 12 * 3600000) / DAY_MS) && n <= Math.floor((now + 14 * 3600000) / DAY_MS);
}
// A wallet from before the daily bonus (or none at all) starts over
export function currentWallet(w, now = Date.now()) {
  if (w && typeof w === 'object' && w.v === WALLET_VERSION && Number.isFinite(w.balance) && w.balance >= 0) return w;
  return { v: WALLET_VERSION, balance: START_BALANCE, log: [{ a: START_BALANCE, w: 'Fresh start', at: now }] };
}
export function grantDaily(data, day, now = Date.now()) {
  const out = data && typeof data === 'object' ? { ...data } : {};
  const w = currentWallet(out.wallet, now);
  const log = Array.isArray(w.log) ? w.log : [];
  out.wallet = { ...w, balance: w.balance + DAILY_BONUS, log: [{ a: DAILY_BONUS, w: 'Daily bonus', at: now }, ...log].slice(0, 12) };
  out.daily = { day, at: now };
  return out;
}
const devClaims = new Map();   // local test players have no saved data, so their claims live here
async function daily(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);
  const user = await currentUser(request, env, url);
  if (!user) return json({ error: 'signed_out' }, 401);
  const body = await request.json().catch(() => null);
  const day = body && body.day;
  if (!validDay(day)) return json({ error: 'bad_day' }, 400);
  if (user.dev) {
    if ((devClaims.get(user.id) || '') >= day) return json({ ok: false, claimed: true, day: devClaims.get(user.id) });
    devClaims.set(user.id, day);
    return json({ ok: true, granted: DAILY_BONUS, day, local: true });
  }
  const sql = neon(env.DATABASE_URL);
  for (let tries = 0; tries < 4; tries++) {
    const saved = await readSave(sql, user.id);
    const last = saved.data && saved.data.daily && typeof saved.data.daily.day === 'string' ? saved.data.daily.day : '';
    if (last >= day) return json({ ok: false, claimed: true, day: last, data: saved.data, version: saved.version });
    const next = grantDaily(saved.data, day);
    const rows = saved.version
      ? await sql`update saves set data = ${JSON.stringify(next)}::jsonb, version = version + 1, updated_at = now()
                  where user_id = ${user.id} and version = ${saved.version} returning version`
      : await sql`insert into saves (user_id, data, version) values (${user.id}, ${JSON.stringify(next)}::jsonb, 1)
                  on conflict (user_id) do nothing returning version`;
    if (rows.length) return json({ ok: true, granted: DAILY_BONUS, day, data: next, version: rows[0].version });
  }
  return json({ error: 'busy' }, 503);
}

/* ---------- Multiplayer rooms ---------- */

// First name and last initial: shown to everyone at the table
function displayName(user) {
  const parts = String(user.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Player';
  const name = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  return name.slice(0, 24);
}

const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));
const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const randomSeed = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

async function createRoom(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);
  const user = await currentUser(request, env, url);
  if (!user) return json({ error: 'signed_out' }, 401);
  const body = await request.json().catch(() => ({}));
  const name = String((body && body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Blackjack table';
  for (let i = 0; i < 6; i++) {
    const code = makeCode(randomUnit);
    const res = await roomStub(env, code).fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code, name, seed: randomSeed(), uid: user.id, display: displayName(user) }),
    });
    if (res.status === 409) continue;   // that code is taken; try another
    return json(await res.json());
  }
  return json({ error: 'busy' }, 503);
}

async function roomRoute(request, env, url, code, isSocket) {
  const stub = roomStub(env, code);
  if (!isSocket) {
    const res = await stub.fetch('https://room/info');
    return json(await res.json(), res.status);
  }
  if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'websocket_required' }, 426);
  if (request.headers.get('origin') !== url.origin) return json({ error: 'bad_origin' }, 403);
  const user = await currentUser(request, env, url);
  if (!user) return json({ error: 'signed_out' }, 401);
  const headers = new Headers(request.headers);
  headers.set('x-user-id', user.id);
  headers.set('x-user-name', displayName(user));
  return stub.fetch(new Request('https://room/ws', { headers }));
}
