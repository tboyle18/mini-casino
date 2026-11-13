// Rewarded ads: "watch a short ad and get your last loss back".
//
// Off until an ad provider is set. In wrangler.jsonc "vars":
//   ADS_PROVIDER  "h5"   Google H5 Games Ads (AdSense for games, rewarded ad breaks)
//                 unset  no ads anywhere (the page never shows an offer)
//   ADS_CLIENT    the AdSense publisher id, "ca-pub-…" (public, not a secret)
//   ADS_TEST      "1" asks the provider for test ads (no real impressions)
// Locally (DEV_AUTH=1 on localhost) the provider defaults to "test": a stand-in ad on the page.
//
// The money only moves here, on the server, in three steps:
//   1. offer  the player's newest statement line is a game loss from the last few minutes, not
//             undone yet, and they have undos left today: the server opens a ticket for it
//   2. the page shows the ad
//   3. claim  the ticket is at least MIN_WATCH_MS old: the loss (up to UNDO_CAP) is paid back,
//             this week's net is put back too, and the statement line is marked undone
// A provider with server-side verification (a signed callback when the ad finishes) would set
// ticket.verified in a callback route and claim would require it; H5 Games Ads has none.

import { note } from './play.js';

export const UNDO_PER_DAY = 3;          // undos per player per (UTC) day
export const UNDO_CAP = 2500;           // the most one ad pays back
const OFFER_WINDOW_MS = 5 * 60000;      // a loss can be undone for this long
const TICKET_TTL_MS = 10 * 60000;       // a ticket expires if the ad never finishes
const MIN_WATCH_MS = 5000;              // an ad takes at least this long
const PROVIDERS = ['h5'];

const r2 = n => Math.round(n * 100) / 100;
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const local = (env, url) => env.DEV_AUTH === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);

// Which provider is on, and what the page needs to load it ('' when ads are off)
export function adsConfig(env, url) {
  let provider = PROVIDERS.includes(env.ADS_PROVIDER) ? env.ADS_PROVIDER : '';
  if (!provider && local(env, url)) provider = 'test';
  if (provider === 'h5' && !/^ca-pub-\d+$/.test(env.ADS_CLIENT || '')) provider = '';   // no publisher id, no ads
  return { provider, client: provider === 'h5' ? env.ADS_CLIENT : '', test: env.ADS_TEST === '1', perDay: UNDO_PER_DAY, cap: UNDO_CAP };
}

// Today's count, reset each UTC day
function state(w, now) {
  const day = utcDay(now);
  const a = w.rounds.ads && typeof w.rounds.ads === 'object' ? w.rounds.ads : {};
  if (a.day !== day) { a.day = day; a.n = 0; delete a.ticket; }
  w.rounds.ads = a;
  return a;
}
export function undosLeft(w, now) {
  return Math.max(0, UNDO_PER_DAY - state(w, now).n);
}

// The loss an ad could undo right now, or null
function undoable(w, now) {
  const e = w.log && w.log[0];
  if (!e || !(e.a < 0) || e.u || e.ad) return null;
  if (!(now - e.at >= 0 && now - e.at <= OFFER_WINDOW_MS)) return null;
  return e;
}

/* Step 1. Throws { code } when there's nothing to undo. */
export function adOffer(w, now) {
  const a = state(w, now);
  if (a.n >= UNDO_PER_DAY) throw Object.assign(new Error('limit'), { code: 'limit' });
  const e = undoable(w, now);
  if (!e) throw Object.assign(new Error('nothing'), { code: 'nothing' });
  const id = [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, '0')).join('');
  a.ticket = { id, at: now, logAt: e.at, amt: r2(Math.min(-e.a, UNDO_CAP)) };
  return { id, amount: a.ticket.amt, left: UNDO_PER_DAY - a.n };
}

/* Step 3. Pays the ticket. Throws { code } if it can't. */
export function adClaim(w, now, id) {
  const a = state(w, now);
  const t = a.ticket;
  if (!t || typeof id !== 'string' || t.id !== id) throw Object.assign(new Error('no_ticket'), { code: 'no_ticket' });
  if (now - t.at < MIN_WATCH_MS) throw Object.assign(new Error('too_soon'), { code: 'too_soon' });
  if (now - t.at > TICKET_TTL_MS) { delete a.ticket; throw Object.assign(new Error('expired'), { code: 'expired' }); }
  if (t.needsVerify && !t.verified) throw Object.assign(new Error('unverified'), { code: 'unverified' });
  const e = (w.log || []).find(x => x.at === t.logAt && x.a < 0);
  delete a.ticket;
  if (!e || e.u) throw Object.assign(new Error('nothing'), { code: 'nothing' });
  e.u = 1;   // undone: never twice
  w.balance = r2(w.balance + t.amt);
  w.weekNet = r2((w.weekNet || 0) + t.amt);
  a.n += 1;
  note(w, t.amt, 'Ad reward · last loss undone', now);
  w.log[0].ad = 1;
  return { granted: t.amt, left: UNDO_PER_DAY - a.n };
}
