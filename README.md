# Mini Casino

A play-money casino for phones, running on Cloudflare at https://mini-casino.boyletb8.workers.dev. Game controls sit at the bottom of the screen within thumb reach, the game screens never scroll, extras open as bottom sheets, and roulette spins the wheel full screen. On a computer it shows the same layout in a phone-width column.

**Layout:** no banner across the top. A tab bar at the bottom switches between **Casino** (your balance, the daily bonus and the table games), **Arcade** (the 3D games), **Stats** (stats and wallet statement) and **Profile** (account, daily bonus, How to play, settings and the graphics lab). Games hide the tab bar and use the whole screen, with just a back arrow, your balance and **?** across the top.

**Money:** everyone starts with $1,000, and signed-in players get another $1,000 the first time they open the casino each day (midnight in their own time zone). There's no other free money: run out and you wait for tomorrow. **Betting** works the same in every game: tap a chip and it's bet. In games with more than one bet (roulette, baccarat, the Tie and Pair Plus side bets), the highlighted spot is where chips go, and tapping another spot moves the highlight. **Undo** takes back the last chip and **Clear** takes back everything. Every round starts with nothing down, and the main button then offers the last bets again with the amount on it ("Deal again · $50"). Bets come straight from the wallet and winnings go straight back, so nothing stays in a game when you leave; in the Arcade the chip is the size of each drop or launch.

- **Blackjack**: rooms for up to 4 players with invite links, or a solo table. 6 decks, blackjack pays 3 to 2, dealer stands on all 17s, with splits, doubles and insurance. An optional hints toggle highlights the basic-strategy move. Bets come straight from your wallet: the page brings exactly the chips each bet, double, split or insurance needs to the table, and sends whatever is left back to the wallet as soon as a hand ends (and when you leave the table between hands).
- **Roulette**: a single-zero wheel with straight-up and all outside bets, paid from your casino wallet.
- **Video poker**: two machines, switched from the dock between hands. Jacks or Better with the full-pay 9/6 table (9 for a full house, 6 for a flush, 800× for a royal), and Deuces Wild, where every 2 is wild, with the "Not So Ugly Ducks" table (about 99.7% with perfect play). Tap **Bet**, **Deal**, tap the cards to hold, **Draw**. Paid from your wallet; the hand in progress is kept in the browser.
- **Baccarat**: punto banco from a freshly shuffled 8-deck shoe each coup. Player pays 1 to 1, Banker 0.95 to 1 (5% commission), Tie 8 to 1, with the standard third-card rules. A row of recent results runs along the top.
- **Three Card Poker**: Ante and Play against the dealer's three cards from a fresh single deck; the dealer qualifies with queen high. The Ante bonus pays 5/4/1 for a straight flush, trips or a straight, and the Pair Plus side bet pays 40/30/6/4/1. After the deal, **Fold** or **Play**.
- **Casino War**: one card each from a freshly shuffled 6-deck shoe, aces high, higher card wins 1 to 1. On a tie you surrender (half your bet back) or go to war: add a raise equal to your bet, three cards are burned, and if your next card ties or beats the dealer's, the raise wins 1 to 1 and the bet comes back. An optional Tie bet pays 10 to 1. A round waiting on war or surrender is kept if you leave.
- **Red Dog**: two cards from a fresh 8-deck shoe; bet that the third lands between them. Spreads of 1, 2 and 3 pay 5, 4 and 2 to 1, wider ones 1 to 1, a pair that becomes three of a kind 11 to 1, and back-to-back cards push. You can raise by your bet before the third card.
- **How to play**: rules, payouts and tips for every game, from Profile or the **?** button in a game.
- **Your stats**: net winnings, rounds played, biggest win and best winning streak, plus blackjack (won, lost, pushed, blackjacks, win rate), roulette (spins, winning spins, luckiest and most common number), video poker (hands, winning hands, best hand), baccarat (rounds, winning rounds, who won), Three Card Poker (hands, folds, Pair Plus hits), Casino War (rounds, wars won, surrenders) Red Dog (hands, raises, three of a kinds), Duck Drop (drops, best bucket) and Duck Rocket (flights, best cash-out). Every hand and spin is recorded as it finishes, each blackjack round once even across reloads, and the stats sync with your account. The stats page also shows your recent wallet statement.

## Files

| File | What it is |
| --- | --- |
| `mini-casino.html` | The page: styles, markup and script, without a `<html>`/`<head>` wrapper (the build adds it). |
| `src/baccarat.js` | Baccarat: the shoe, the third-card rules and the payouts. The build inlines it into the page. |
| `src/threecard.js` | Three Card Poker: the deal, hand ranking, the dealer's qualifier and the payouts. The build inlines it into the page. |
| `src/reddog.js` | Red Dog: the shoe, the spread and the payouts. The build inlines it into the page. |
| `src/war.js` | Casino War: the shoe, the deal, going to war and the payouts. The build inlines it into the page. |
| `src/poker.js` | Video poker: the Jacks or Better and Deuces Wild pay tables, the deal and draw, and hand ranking. The build inlines it into the page. |
| `src/rules.js` | The blackjack rules engine. The room server imports it, and the build inlines it into the page for the solo table, so both always play by the same rules. |
| `src/worker.js` | The Worker: a same-origin proxy to Neon Auth (`/api/auth/*`), `/api/me`, `/api/save` for cloud saves, and `/api/rooms` for multiplayer. Everything else is served from `dist/`. |
| `src/room.js` | One multiplayer room, as a Durable Object. |
| `wrangler.jsonc` | Cloudflare config: the Worker, the static assets in `dist/`, and the `ROOMS` Durable Object. |
| `scripts/build.mjs` | Builds `dist/`: wraps `mini-casino.html` in a full HTML document (doctype, viewport, PWA and iOS tags) as `index.html`, inlines `src/rules.js` and the game files (`src/poker.js`, `src/baccarat.js`, `src/war.js`, `src/threecard.js`, `src/reddog.js`), bundles the graphics lab with esbuild, copies `public/`, and stamps the service worker with a content hash. |
| `public/` | PWA files: `manifest.webmanifest`, `sw.js` (offline cache), `_headers` (no-cache for the service worker) and `icons/`. |
| `lab/` | The graphics lab, served at `/lab/`: test demos built with real graphics packages (see below). **Graphics lab** under Profile opens it; `embed.js` is how the Arcade loads the graduated games. `arcade.js` (the casino room, marquee sign, the duck, and a glow that only lights up bulbs, neon and flames) and `fx.js` (sounds and win effects) are shared by the arcade games. |
| `scripts/make-icons.mjs` | Draws the app icons into `public/icons/`. Run it after changing the icon design; the PNGs are committed. |

## Accounts and cloud saves (Neon)

Players can create an account from the Profile tab (email and password, or Continue with Google), and their wallet and statement, stats, roulette history and solo blackjack table save to it, so they follow them to any device. Signed out, solo games still work and stay in the browser. The first time someone creates an account, this browser's progress moves into it. Rooms with friends need an account.

- **Database:** Neon project `mini-casino` (us-east-2), table `saves (user_id text primary key, data jsonb, version int, updated_at timestamptz)`. Saves use the version number so an old device can't overwrite newer progress; it gets the newer save instead.
- **Daily bonus:** `POST /api/daily` with the player's local date. The Worker accepts a date within a day of its own, checks it against `data.daily.day` in the save, and adds $1,000 to the stored wallet in the same versioned write; the page then loads the save it sends back. The page never writes `daily` itself, and a save from the page keeps the stored one. Wallets saved before the daily bonus (no `"v": 2`) start over at $1,000, on the page and on the server. The balance itself is still saved by the page, so it guards the bonus rather than every bet.
- **Sign-in:** Neon Auth (Managed Better Auth) on the project's `main` branch. The browser only talks to this site; the Worker proxies sign-in to Neon so the session cookie belongs to this domain. Google sign-in uses Neon's shared test keys until you add your own Google OAuth client in the Neon Console (Settings → Auth → OAuth providers).
- **Config:** `NEON_AUTH_BASE_URL` is a plain var in `wrangler.jsonc`. `DATABASE_URL` is a secret: `npx wrangler secret put DATABASE_URL` for production, and a `DATABASE_URL=...` line in `.dev.vars` (gitignored) for `wrangler dev`.
- **Trusted domains:** Neon Auth only accepts sign-ins from domains on its allowlist. Localhost is allowed for development; add any new domain (for example a custom domain) in the Neon Console under Auth, or with the Neon MCP `add_auth_trusted_domain` tool.

## How multiplayer works

Each room is a Cloudflare Durable Object, named by its six-character code, and it is the only thing that changes its table. Players connect to `/api/rooms/{code}/ws` over a WebSocket (signed in, from this site only), send their moves, and every connected phone gets the whole table back after each change. The room runs the same rules engine as the solo table (`src/rules.js`), and its alarm handles the betting countdown, turn timers, and seats freed by players who left. A player who drops counts as present for 8 seconds, so a quick reconnect doesn't cost them their turn.

To play with friends, start a room and send the invite link (`/#table-{code}`). Friends sign in and pick a seat; anyone with the link can watch. Rooms you've played in are listed under **Your rooms** in the blackjack lobby.

Durable Objects with SQLite storage are included in Cloudflare's free plan.

### Testing rooms locally

`wrangler dev` runs rooms locally. To play as test players without real accounts, add `DEV_AUTH=1` to `.dev.vars`; then a `dev_user=alice` cookie on `localhost` signs you in as "Alice Tester" (set it in the browser console with `document.cookie = 'dev_user=alice; path=/'`). Test players can't use cloud saves, and this switch is ignored anywhere but localhost.

## Arcade

The Arcade tab runs 3D games that graduated from the lab, on the real wallet with their own stats. Their code stays in `lab/` (the casino loads them through `lab/embed.js`, and the 3D engine downloads only when one opens); the page hands each game a `bank` backed by the wallet, and the lab hands it lab credits. The picked chip is the bet for each drop or launch. Every bet's result is known when it's made, so it's saved as pending until it's paid: leaving mid-drop pays what the ducks were going to land on, leaving mid-flight cashes out at that moment, and anything pending when the app closed is paid the next time it opens (a rocket pays its auto cash-out if it got that far).

- **Duck Drop** (plinko; Three.js + GSAP + canvas-confetti, with glow): the balls are rubber ducks. They tumble down 12 rows of pegs; each peg lights up and plays a note when hit, so every drop plays a little tune. 13 buckets pay from 0.1× in the middle to 100× at the edges, depending on the risk level (Low, Medium, High). **×10** drops a storm of ten ducks. Where a duck lands comes from the bounce physics in `lab/plinko-physics.js`; the payouts are tuned to about a 97% return at every risk level, measured by simulating 100,000 drops (`simulate()` and `odds()` in that file). Each duck gets its own seeded random numbers, so where it lands is worked out at the drop and the fall on screen replays it exactly.
- **Duck Rocket** (crash; Three.js + GSAP, with glow): a rubber duck in goggles rides a rocket off a launch pad; the multiplier climbs with its altitude (past clouds, a plane, satellites, the moon and a UFO, while the sky turns to space). **Cash out** before it explodes: the duck ejects on a parachute and the rest of the flight fast-forwards to show where it would have blown. An optional auto cash-out (1.5× to 10×) fires on its own. The crash point is decided at launch in `lab/crash-math.js`, so any cash-out target returns about 97%.

## Graphics lab

`/lab/` (https://mini-casino.boyletb8.workers.dev/lab/, or **Graphics lab** under Profile) is a playground for trying real graphics packages before any of them go into the casino. Each tab loads only its own code, and a frame-rate meter shows how hard the phone is working.

- **Slots** (Three.js + GSAP + canvas-confetti, with glow): Lucky Duck 3000, a deliberately ridiculous slot machine. Drag the red knob down to pull the lever (a harder yank spins longer) or tap **Pull**. Three real reels, a light-bulb marquee, googly eyes that rattle, a rubber duck that hops and launches on a jackpot, coins that spray at the camera, and synthesized sounds. When the first two reels could still make a big win, the third reel slows to a crawl and the camera leans in. The duck is wild; payouts and odds live in `lab/slots-math.js` (about a 96% return, a win on roughly 1 spin in 4.4). **Bribe the duck** in Payouts rigs the next pull for a duck jackpot.
- **3D Roulette** (Three.js + cannon-es): a real-scale wheel with lacquered wood, brass and chrome under studio lighting. While the ball is fast it circles the outer wall on a calculated path, then the physics engine takes over: it drops, hits the deflectors, bounces between the frets and settles in a pocket. Drag to orbit; **Ball cam** chases the ball.
- **Big Win** (GSAP + canvas-confetti): a light-ray sunburst, a gold title that bounces in letter by letter, the amount counting up, and confetti, coins, sparkles or card suits. Three flavours: big win, blackjack, jackpot.
- **3D Table** (Three.js + GSAP): a blackjack table from the player's seat with printed felt, a padded rail, the chip tray and a shoe. Cards fly out of the shoe and flip; chips drop onto the betting spot and stack.

Lucky Duck slots plays with lab credits (starting at $1,000, topped up by the duck if you go broke), separate from the casino wallet.

The packages are dev dependencies; the build bundles and serves them from this site, so nothing loads from a CDN.

## Installing the app

Mini Casino is a Progressive Web App:

- **Android / Chrome / Edge:** use the browser's *Install app* option (or *Add to Home screen*).
- **iPhone / iPad:** in Safari, tap Share, then *Add to Home Screen*.

The installed app opens full screen, has shortcuts to Blackjack, Roulette, Video Poker, Baccarat, Three Card Poker, Casino War, Red Dog and your stats, and solo games work offline. Pages load from the network when it's available, so a new deploy shows up on the next launch.

## Deploying to Cloudflare

`wrangler deploy` runs the build step first, then uploads the Worker, the room Durable Object and `dist/`.

```bash
npx wrangler dev      # preview locally
npx wrangler deploy   # deploy
```

With Workers Builds connected to this repo, every push to `main` deploys. Keep the dashboard's deploy command as `npx wrangler deploy` and leave the build command empty. The Worker's name in the dashboard must match `name` in `wrangler.jsonc` (`mini-casino`).
