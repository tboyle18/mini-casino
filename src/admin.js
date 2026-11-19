// The admin dashboard's numbers (/admin.html reads them from /api/admin).
//
// Who's an admin: a signed-in account whose neon_auth "user".role is 'admin', or whose id is in
// the ADMIN_IDS var (comma-separated). Locally (DEV_AUTH=1 on localhost) the dev user "admin"
// (cookie dev_user=admin) is one too. Everyone else gets 403 and sees nothing.
//
// Everything is read-only. Play stats come from each wallet's statement (the last LOG_MAX lines
// per player), so a very busy player's older rounds drop out of the 7-day numbers.

const DAY = 86400000;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isGuest = id => id.startsWith('guest-') || id.startsWith('dev-guest-');

export async function isAdmin(sql, env, user) {
  if (!user || user.guest) return false;
  if (user.dev) return user.id === 'dev-admin';
  const ids = String(env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.includes(user.id)) return true;
  try {
    const rows = await sql`select role from neon_auth."user" where id::text = ${user.id}`;
    return !!rows[0] && String(rows[0].role || '').split(',').map(s => s.trim()).includes('admin');
  } catch (e) {
    return false;
  }
}

// a@b.com -> a•••@b.com: enough to recognise someone without the page showing whole addresses
function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return (u.slice(0, 2) || '') + '•••@' + d;
}

export async function adminStats(sql, now, withTest) {
  const test = withTest ? 'zzz' : 'dev-';   // test players are left out on the real site
  const today = new Date(now).toISOString().slice(0, 10);
  const day1 = new Date(now - DAY), day7 = new Date(now - 7 * DAY);

  const [wallets, users, recentUsers, top, lines] = await Promise.all([
    sql`select user_id, balance, daily_day, updated_at, rounds from wallets where user_id not like ${test + '%'}`,
    sql`select count(*)::int as n,
          count(*) filter (where "createdAt" > ${day1})::int as d1,
          count(*) filter (where "createdAt" > ${day7})::int as d7,
          count(*) filter (where "emailVerified")::int as verified
        from neon_auth."user"`.catch(() => [{ n: 0, d1: 0, d7: 0, verified: 0 }]),
    sql`select u.name, u.email, u."createdAt" as at, w.balance
        from neon_auth."user" u left join wallets w on w.user_id = u.id::text
        order by u."createdAt" desc limit 8`.catch(() => []),
    sql`select user_id, name, balance from wallets
        where user_id not like ${test + '%'} order by balance desc limit 10`,
    sql`select w.user_id, e->>'w' as what, (e->>'a')::numeric as a, (e->>'at')::bigint as at
        from wallets w, jsonb_array_elements(w.log) e
        where w.user_id not like ${test + '%'} and (e->>'at')::bigint > ${now - 7 * DAY}`,
  ]);

  // Players and money
  const acct = wallets.filter(w => !isGuest(w.user_id)), guests = wallets.filter(w => isGuest(w.user_id));
  const sum = list => r2(list.reduce((s, w) => s + Number(w.balance), 0));
  const active = (list, since) => list.filter(w => new Date(w.updated_at) > since).length;
  const adsToday = wallets.reduce((n, w) => n + (w.rounds && w.rounds.ads && w.rounds.ads.day === today ? Number(w.rounds.ads.n) || 0 : 0), 0);

  // Rounds by game, from the statements. Bonuses and wallet lines aren't rounds.
  const notRound = /^(Daily bonus|Wallet opened|Ad reward|Chips|Cashier|Bonus)/i;
  const games = new Map();
  let rounds1 = 0, rounds7 = 0, net1 = 0, net7 = 0, bonus7 = 0;
  const big = [];
  for (const l of lines) {
    const what = String(l.what || ''), a = Number(l.a) || 0, at = Number(l.at) || 0;
    if (/^Daily bonus/i.test(what)) { bonus7 += a; continue; }
    if (notRound.test(what)) continue;
    const game = what.split(' · ')[0] || 'Other';
    const g = games.get(game) || { game, rounds: 0, net: 0, players: new Set() };
    g.rounds++; g.net += a; g.players.add(l.user_id);
    games.set(game, g);
    rounds7++; net7 += a;
    if (at > now - DAY) { rounds1++; net1 += a; }
    if (a >= 100) big.push({ game, amount: r2(a), at, guest: isGuest(l.user_id) });
  }
  return {
    at: now,
    players: {
      accounts: users[0] ? users[0].n : acct.length,
      verified: users[0] ? users[0].verified : 0,
      newToday: users[0] ? users[0].d1 : 0,
      newWeek: users[0] ? users[0].d7 : 0,
      guests: guests.length,
      active24h: active(wallets, day1),
      active7d: active(wallets, day7),
    },
    money: {
      total: sum(wallets), accounts: sum(acct), guests: sum(guests),
      average: wallets.length ? r2(sum(wallets) / wallets.length) : 0,
      bonusesToday: wallets.filter(w => w.daily_day === today).length,
      bonusWeek: r2(bonus7),
      adUndosToday: adsToday,
    },
    play: {
      rounds24h: rounds1, rounds7d: rounds7,
      // the players' net: negative means the house is ahead
      net24h: r2(net1), net7d: r2(net7),
      games: [...games.values()].map(g => ({ game: g.game, rounds: g.rounds, net: r2(g.net), players: g.players.size }))
        .sort((x, y) => y.rounds - x.rounds),
      bigWins: big.sort((x, y) => y.at - x.at).slice(0, 8),
    },
    top: top.map(t => ({ name: t.name, balance: r2(t.balance), guest: isGuest(t.user_id) })),
    recent: recentUsers.map(u => ({ name: u.name || 'Player', email: maskEmail(u.email), at: new Date(u.at).getTime(), balance: u.balance == null ? null : r2(u.balance) })),
  };
}
