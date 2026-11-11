# Mini Casino

A play-money casino for phones, running on Cloudflare at https://mini-casino.boyletb8.workers.dev. Game controls sit at the bottom of the screen within thumb reach, the game screens never scroll, extras open as bottom sheets, and roulette spins the wheel full screen. On a computer it shows the same layout in a phone-width column.

- **Blackjack**: rooms for up to 4 players with invite links, or a solo table. 6 decks, blackjack pays 3 to 2, dealer stands on all 17s, with splits, doubles and insurance. An optional hints toggle highlights the basic-strategy move. Tap chips to build an amount, then **Place bet** puts it on the table; your bet carries over to the next hand.
- **Roulette**: a single-zero wheel with straight-up and all outside bets, paid from your casino wallet. Tap chips for the amount, tap the spots you want, then **Place** puts that amount on each spot.
- **Video poker**: Jacks or Better with the full-pay 9/6 table (9 for a full house, 6 for a flush, 800× for a royal). Tap chips to set your bet, **Deal**, tap the cards to hold, **Draw**. Paid from your wallet; the hand in progress is kept in the browser.
- **Baccarat**: punto banco from a freshly shuffled 8-deck shoe each coup. Player pays 1 to 1, Banker 0.95 to 1 (5% commission), Tie 8 to 1, with the standard third-card rules. Same betting as roulette: chips, pick spots, **Place**, then **Deal**. A row of recent results runs along the top.
- **Casino War**: one card each from a freshly shuffled 6-deck shoe, aces high, higher card wins 1 to 1. On a tie you surrender (half your bet back) or go to war: add a raise equal to your bet, three cards are burned, and if your next card ties or beats the dealer's, the raise wins 1 to 1 and the bet comes back. An optional Tie bet pays 10 to 1. Same betting as baccarat; with no spot picked, **Place** puts the amount on War. A round waiting on war or surrender is kept if you leave.
- **The Bottomless Bank**: withdraw as much (fake) money as you want. Interest rate 0%, credit check skipped.
- **How to play**: rules, payouts and tips for every game, including the 3D lab's, from the home screen or the **?** button at the top of a game.
- **Your stats**: net winnings, rounds played, biggest win and best winning streak, plus blackjack (won, lost, pushed, blackjacks, win rate), roulette (spins, winning spins, luckiest and most common number), video poker (hands, winning hands, best hand), baccarat (rounds, winning rounds, who won) and Casino War (rounds, winning rounds, wars won, surrenders). Every hand and spin is recorded as it finishes, each blackjack round once even across reloads, and the stats sync with your account.

## Files

| File | What it is |
| --- | --- |
| `mini-casino.html` | The page: styles, markup and script, without a `<html>`/`<head>` wrapper (the build adds it). |
| `src/baccarat.js` | Baccarat: the shoe, the third-card rules and the payouts. The build inlines it into the page. |
| `src/war.js` | Casino War: the shoe, the deal, going to war and the payouts. The build inlines it into the page. |
| `src/poker.js` | Video poker: the pay table, the deal and draw, and hand ranking. The build inlines it into the page. |
| `src/rules.js` | The blackjack rules engine. The room server imports it, and the build inlines it into the page for the solo table, so both always play by the same rules. |
| `src/worker.js` | The Worker: a same-origin proxy to Neon Auth (`/api/auth/*`), `/api/me`, `/api/save` for cloud saves, and `/api/rooms` for multiplayer. Everything else is served from `dist/`. |
| `src/room.js` | One multiplayer room, as a Durable Object. |
| `wrangler.jsonc` | Cloudflare config: the Worker, the static assets in `dist/`, and the `ROOMS` Durable Object. |
| `scripts/build.mjs` | Builds `dist/`: wraps `mini-casino.html` in a full HTML document (doctype, viewport, PWA and iOS tags) as `index.html`, inlines `src/rules.js`, `src/poker.js`, `src/baccarat.js` and `src/war.js`, bundles the graphics lab with esbuild, copies `public/`, and stamps the service worker with a content hash. |
| `public/` | PWA files: `manifest.webmanifest`, `sw.js` (offline cache), `_headers` (no-cache for the service worker) and `icons/`. |
| `lab/` | The graphics lab, served at `/lab/`: test demos built with real graphics packages (see below). The **3D preview** card on the home screen opens it. `arcade.js` (the casino room, marquee sign, the duck, and a glow that only lights up bulbs, neon and flames) and `fx.js` (sounds and win effects) are shared by the arcade games. |
| `scripts/make-icons.mjs` | Draws the app icons into `public/icons/`. Run it after changing the icon design; the PNGs are committed. |

## Accounts and cloud saves (Neon)

Players can create an account from the button at the top right of the home screen (email and password, or Continue with Google), and their wallet, bank statement, stats, roulette history and solo blackjack table save to it, so they follow them to any device. Signed out, solo games still work and stay in the browser. The first time someone creates an account, this browser's progress moves into it. Rooms with friends need an account.

- **Database:** Neon project `mini-casino` (us-east-2), table `saves (user_id text primary key, data jsonb, version int, updated_at timestamptz)`. Saves use the version number so an old device can't overwrite newer progress; it gets the newer save instead.
- **Sign-in:** Neon Auth (Managed Better Auth) on the project's `main` branch. The browser only talks to this site; the Worker proxies sign-in to Neon so the session cookie belongs to this domain. Google sign-in uses Neon's shared test keys until you add your own Google OAuth client in the Neon Console (Settings → Auth → OAuth providers).
- **Config:** `NEON_AUTH_BASE_URL` is a plain var in `wrangler.jsonc`. `DATABASE_URL` is a secret: `npx wrangler secret put DATABASE_URL` for production, and a `DATABASE_URL=...` line in `.dev.vars` (gitignored) for `wrangler dev`.
- **Trusted domains:** Neon Auth only accepts sign-ins from domains on its allowlist. Localhost is allowed for development; add any new domain (for example a custom domain) in the Neon Console under Auth, or with the Neon MCP `add_auth_trusted_domain` tool.

## How multiplayer works

Each room is a Cloudflare Durable Object, named by its six-character code, and it is the only thing that changes its table. Players connect to `/api/rooms/{code}/ws` over a WebSocket (signed in, from this site only), send their moves, and every connected phone gets the whole table back after each change. The room runs the same rules engine as the solo table (`src/rules.js`), and its alarm handles the betting countdown, turn timers, and seats freed by players who left. A player who drops counts as present for 8 seconds, so a quick reconnect doesn't cost them their turn.

To play with friends, start a room and send the invite link (`/#table-{code}`). Friends sign in and pick a seat; anyone with the link can watch. Rooms you've played in are listed under **Your rooms** in the blackjack lobby.

Durable Objects with SQLite storage are included in Cloudflare's free plan.

### Testing rooms locally

`wrangler dev` runs rooms locally. To play as test players without real accounts, add `DEV_AUTH=1` to `.dev.vars`; then a `dev_user=alice` cookie on `localhost` signs you in as "Alice Tester" (set it in the browser console with `document.cookie = 'dev_user=alice; path=/'`). Test players can't use cloud saves, and this switch is ignored anywhere but localhost.

## Graphics lab

`/lab/` (https://mini-casino.boyletb8.workers.dev/lab/, or the **3D preview** card on the home screen) is a playground for trying real graphics packages before any of them go into the casino. Each tab loads only its own code, and a frame-rate meter shows how hard the phone is working.

- **Slots** (Three.js + GSAP + canvas-confetti, with glow): Lucky Duck 3000, a deliberately ridiculous slot machine. Drag the red knob down to pull the lever (a harder yank spins longer) or tap **Pull**. Three real reels, a light-bulb marquee, googly eyes that rattle, a rubber duck that hops and launches on a jackpot, coins that spray at the camera, and synthesized sounds. When the first two reels could still make a big win, the third reel slows to a crawl and the camera leans in. The duck is wild; payouts and odds live in `lab/slots-math.js` (about a 96% return, a win on roughly 1 spin in 4.4). **Bribe the duck** in Payouts rigs the next pull for a duck jackpot.
- **Plinko** (Three.js + GSAP + canvas-confetti, with glow): Duck Drop, where the balls are rubber ducks. They tumble down 12 rows of pegs; each peg lights up and plays a note when hit, so every drop plays a little tune. 13 buckets pay from 0.1× in the middle to 100× at the edges, depending on the risk level (Low, Medium, High). **×10** drops a storm of ten ducks. Where a duck lands comes from the bounce physics in `lab/plinko-physics.js`; the payouts are tuned to about a 97% return at every risk level, measured by simulating 100,000 drops (`simulate()` and `odds()` in that file).
- **3D Roulette** (Three.js + cannon-es): a real-scale wheel with lacquered wood, brass and chrome under studio lighting. While the ball is fast it circles the outer wall on a calculated path, then the physics engine takes over: it drops, hits the deflectors, bounces between the frets and settles in a pocket. Drag to orbit; **Ball cam** chases the ball.
- **Big Win** (GSAP + canvas-confetti): a light-ray sunburst, a gold title that bounces in letter by letter, the amount counting up, and confetti, coins, sparkles or card suits. Three flavours: big win, blackjack, jackpot.
- **3D Table** (Three.js + GSAP): a blackjack table from the player's seat with printed felt, a padded rail, the chip tray and a shoe. Cards fly out of the shoe and flip; chips drop onto the betting spot and stack.

- **Crash** (Three.js + GSAP, with glow): Duck Rocket. A rubber duck in goggles rides a rocket off a launch pad; the multiplier climbs with its altitude (past clouds, a plane, satellites, the moon and a UFO, while the sky turns to space). **Cash out** before it explodes: the duck ejects on a parachute and the rest of the flight fast-forwards to show where it would have blown. An optional auto cash-out (1.5× to 10×) fires on its own. The crash point is decided at launch in `lab/crash-math.js`, so any cash-out target returns about 97%.

The slots, plinko and crash share one balance of lab credits (starting at $1,000, topped up by the duck if you go broke), separate from the casino wallet.

The packages are dev dependencies; the build bundles and serves them from this site, so nothing loads from a CDN.

## Installing the app

Mini Casino is a Progressive Web App:

- **Android / Chrome / Edge:** use the browser's *Install app* option (or *Add to Home screen*).
- **iPhone / iPad:** in Safari, tap Share, then *Add to Home Screen*.

The installed app opens full screen, has shortcuts to Blackjack, Roulette, Video Poker, Baccarat, Casino War, the Bank and your stats, and solo games work offline. Pages load from the network when it's available, so a new deploy shows up on the next launch.

## Deploying to Cloudflare

`wrangler deploy` runs the build step first, then uploads the Worker, the room Durable Object and `dist/`.

```bash
npx wrangler dev      # preview locally
npx wrangler deploy   # deploy
```

With Workers Builds connected to this repo, every push to `main` deploys. Keep the dashboard's deploy command as `npx wrangler deploy` and leave the build command empty. The Worker's name in the dashboard must match `name` in `wrangler.jsonc` (`mini-casino`).
