// Wallets in Neon Postgres: one row per signed-in player, holding their balance, this week's
// net winnings (for the leaderboard), a short statement and any round that's waiting on them.
// The worker (src/worker.js) and the blackjack rooms (src/room.js) both go through here.
//
//   create table wallets (
//     user_id text primary key,
//     name text not null default 'Player',          -- first name and last initial, for the leaderboard
//     balance numeric(18,2) not null default 1000,
//     version int not null default 1,               -- every write checks and bumps it
//     daily_day text not null default '',           -- the last day the daily bonus was claimed
//     week text not null default '',                -- the Monday (UTC) that week_net counts from
//     week_net numeric(18,2) not null default 0,
//     last_week text not null default '',
//     last_week_net numeric(18,2) not null default 0,
//     log jsonb not null default '[]',
//     rounds jsonb not null default '{}',
//     updated_at timestamptz not null default now()
//   );

export const START_BALANCE = 1000;
export const DAILY_BONUS = 1000;
const DAY_MS = 86400000;

// Weeks run Monday to Sunday, UTC, and are named by their Monday
export function weekKey(ms) {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}
export const prevWeekKey = ms => weekKey(ms - 7 * DAY_MS);

function fromRow(row) {
  return {
    version: row.version,
    name: row.name,
    balance: Number(row.balance),
    dailyDay: row.daily_day || '',
    week: row.week || '',
    weekNet: Number(row.week_net) || 0,
    lastWeek: row.last_week || '',
    lastWeekNet: Number(row.last_week_net) || 0,
    log: Array.isArray(row.log) ? row.log : [],
    rounds: row.rounds && typeof row.rounds === 'object' ? row.rounds : {},
  };
}
// A new week: last week's result is kept for the "last week" podium, and this week starts at 0
export function rollWeek(w, now) {
  const wk = weekKey(now);
  if (w.week === wk) return;
  if (w.week) { w.lastWeek = w.week; w.lastWeekNet = w.weekNet; }
  w.week = wk;
  w.weekNet = 0;
}

/* The player's wallet, made the first time: it starts from the balance their saved game had
   (wallets from before the daily bonus, without v: 2, start at $1,000) and remembers the day
   they last claimed the bonus there. */
export async function loadWallet(sql, userId, name) {
  let rows = await sql`select * from wallets where user_id = ${userId}`;
  if (!rows.length) {
    const saved = await sql`select data from saves where user_id = ${userId}`;
    const d = saved.length && saved[0].data ? saved[0].data : {};
    const old = d.wallet && d.wallet.v === 2 && Number.isFinite(d.wallet.balance) && d.wallet.balance >= 0 ? d.wallet.balance : START_BALANCE;
    const day = d.daily && typeof d.daily.day === 'string' ? d.daily.day : '';
    rows = await sql`
      insert into wallets (user_id, name, balance, daily_day, log)
      values (${userId}, ${name || 'Player'}, ${old}, ${day}, ${JSON.stringify([{ a: old, w: 'Wallet opened', at: Date.now() }])}::jsonb)
      on conflict (user_id) do update set user_id = excluded.user_id
      returning *`;
  }
  return fromRow(rows[0]);
}
async function saveWallet(sql, userId, w, name) {
  const rows = await sql`
    update wallets set
      name = ${name || w.name || 'Player'}, balance = ${w.balance}, daily_day = ${w.dailyDay},
      week = ${w.week}, week_net = ${w.weekNet}, last_week = ${w.lastWeek}, last_week_net = ${w.lastWeekNet},
      log = ${JSON.stringify(w.log.slice(0, 12))}::jsonb, rounds = ${JSON.stringify(w.rounds)}::jsonb,
      version = version + 1, updated_at = now()
    where user_id = ${userId} and version = ${w.version}
    returning version`;
  if (!rows.length) return false;
  w.version = rows[0].version;
  return true;
}
/* Load the wallet, let fn change it, and save it, retrying if something else wrote in
   between (another tab, a blackjack room). fn may throw to change nothing. */
export async function withWallet(sql, userId, name, fn) {
  for (let tries = 0; tries < 6; tries++) {
    const w = await loadWallet(sql, userId, name);
    const now = Date.now();
    rollWeek(w, now);
    const result = fn(w, now);
    if (await saveWallet(sql, userId, w, name)) return { w, result };
  }
  throw new Error('wallet_busy');
}

/* Blackjack rooms keep a player's chips at the table: these move money between the wallet
   and the table, in one statement each so they can't half happen. */
export async function walletDebit(sql, userId, name, amount) {
  await loadWallet(sql, userId, name);
  const rows = await sql`
    update wallets set balance = balance - ${amount}, version = version + 1, updated_at = now()
    where user_id = ${userId} and balance >= ${amount}
    returning balance`;
  return rows.length ? Number(rows[0].balance) : null;
}
export async function walletCredit(sql, userId, name, amount) {
  if (!(amount > 0)) return null;
  await loadWallet(sql, userId, name);
  const rows = await sql`
    update wallets set balance = balance + ${amount}, version = version + 1, updated_at = now()
    where user_id = ${userId}
    returning balance`;
  return rows.length ? Number(rows[0].balance) : null;
}

/* The leaderboard: this week's net winnings, or everyone's balance. Test players (dev-…)
   only show up when testing locally. */
export async function leaderboard(sql, board, userId, now, withTest) {
  const wk = weekKey(now), prev = prevWeekKey(now);
  const test = withTest ? 'zzz' : 'dev-';
  let rows, me = null, podium = [];
  if (board === 'balance') {
    rows = await sql`
      select user_id, name, balance as value from wallets
      where user_id not like ${test + '%'}
      order by balance desc, updated_at asc limit 50`;
    if (userId) {
      const r = await sql`
        select w.balance as value, (select count(*) from wallets o where o.balance > w.balance and o.user_id not like ${test + '%'}) + 1 as rank
        from wallets w where w.user_id = ${userId}`;
      if (r.length) me = { value: Number(r[0].value), rank: Number(r[0].rank) };
    }
  } else {
    rows = await sql`
      select user_id, name, week_net as value from wallets
      where week = ${wk} and user_id not like ${test + '%'}
      order by week_net desc, updated_at asc limit 50`;
    if (userId) {
      const r = await sql`
        select w.week_net as value, w.week, (select count(*) from wallets o where o.week = ${wk} and o.week_net > w.week_net and o.user_id not like ${test + '%'}) + 1 as rank
        from wallets w where w.user_id = ${userId}`;
      if (r.length) me = r[0].week === wk ? { value: Number(r[0].value), rank: Number(r[0].rank) } : { value: 0, rank: null };
    }
    // Last week's top three: players who've played this week keep it in last_week_*
    podium = await sql`
      select name, value from (
        select name, week_net as value from wallets where week = ${prev} and user_id not like ${test + '%'}
        union all
        select name, last_week_net as value from wallets where last_week = ${prev} and user_id not like ${test + '%'}
      ) t order by value desc limit 3`;
  }
  return {
    board: board === 'balance' ? 'balance' : 'week',
    week: wk,
    rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, value: Number(r.value), me: r.user_id === userId })),
    me,
    podium: podium.map(p => ({ name: p.name, value: Number(p.value) })),
  };
}
