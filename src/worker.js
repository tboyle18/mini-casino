// Mini Casino API on Cloudflare Workers.
//
// Everything outside /api/* is the static site (served from ./dist).
//   /api/auth/*  same-origin proxy to Neon Auth (Managed Better Auth), so the
//                session cookie belongs to this site and Safari doesn't block it
//   /api/me      who is signed in
//   /api/save    the signed-in player's wallet, roulette and solo-blackjack save,
//                stored in Neon Postgres (table: saves)

import { neon } from '@neondatabase/serverless';

// /sign-in/social starts "Continue with Google". Neon sends the player back to this site with a
// one-time verifier; the page trades it for a session through /get-session, still via this proxy.
const AUTH_ROUTES = new Set(['/sign-up/email', '/sign-in/email', '/sign-in/social', '/sign-out', '/get-session']);
const MAX_SAVE_BYTES = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname.startsWith('/api/auth/')) return await proxyAuth(request, env, url);
      if (url.pathname === '/api/me') return await me(request, env, url);
      if (url.pathname === '/api/save') return await save(request, env, url);
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

async function currentUser(request, env, url) {
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
  return json({ user: user ? { id: user.id, name: user.name || '', email: user.email || '' } : null });
}

async function save(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405);
  if (request.method === 'PUT') {
    if (!sameOrigin(request, url)) return json({ error: 'bad_origin' }, 403);
    if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'json_required' }, 415);
  }
  const user = await currentUser(request, env, url);
  if (!user) return json({ error: 'signed_out' }, 401);
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
  for (const key of ['wallet', 'roulette', 'solo']) {
    if (d[key] && typeof d[key] === 'object' && !Array.isArray(d[key])) out[key] = d[key];
  }
  return out;
}

export async function readSave(sql, userId) {
  const rows = await sql`select data, version from saves where user_id = ${userId}`;
  return rows.length ? { data: rows[0].data, version: rows[0].version } : { data: null, version: 0 };
}

/* Write only if nobody saved since the version this device last saw (`base`).
   On a conflict, return the newer save so the device can load it. */
export async function writeSave(sql, userId, data, base) {
  const rows = await sql`
    insert into saves (user_id, data, version)
    values (${userId}, ${JSON.stringify(data)}::jsonb, 1)
    on conflict (user_id) do update
      set data = excluded.data, version = saves.version + 1, updated_at = now()
      where saves.version = ${base}
    returning version`;
  if (rows.length) return { ok: true, version: rows[0].version };
  return { ok: false, conflict: true, ...(await readSave(sql, userId)) };
}
