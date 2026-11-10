# Mini Casino

A play-money casino in a single HTML page, designed for phones first. Game controls sit at the bottom of the screen within thumb reach, extras open as bottom sheets, and roulette spins the wheel full screen. On a computer it shows the same layout in a phone-width column.

- **Blackjack**: rooms for up to 4 players with invite links, or solo practice. 6 decks, blackjack pays 3 to 2, dealer stands on all 17s, with splits, doubles and insurance. An optional hints toggle highlights the basic-strategy move.
- **Roulette**: a single-zero wheel with straight-up and all outside bets, paid from your casino wallet.
- **The Bottomless Bank**: withdraw as much (fake) money as you want. Interest rate 0%, credit check skipped.

## Files

| File | What it is |
| --- | --- |
| `mini-casino.html` | The full casino. It's written as a [Claude artifact](https://claude.ai/artifact/Jr9pJxUStQxXb7Un3cHvPZ), so the page body has no `<html>`/`<head>` wrapper of its own. |
| `blackjack.html` | The original stand-alone blackjack game. Works offline: open it in any browser. |
| `wrangler.jsonc` | Cloudflare Workers config: runs `src/worker.js` for `/api/*` and serves everything else from `dist/`. |
| `scripts/build.mjs` | Builds `dist/`: wraps `mini-casino.html` in a full HTML document (doctype, viewport, PWA and iOS tags) as `index.html`, copies `blackjack.html` and `public/`, and stamps the service worker with a content hash. |
| `public/` | PWA files: `manifest.webmanifest`, `sw.js` (offline cache), `_headers` (no-cache for the service worker) and `icons/`. |
| `src/worker.js` | The Worker's API: a same-origin proxy to Neon Auth (`/api/auth/*`), `/api/me`, and `/api/save` for cloud saves in Neon Postgres. Everything else is served from `dist/`. |
| `scripts/make-icons.mjs` | Draws the app icons into `public/icons/`. Run it after changing the icon design; the PNGs are committed. |

## Accounts and cloud saves (Neon)

On the Cloudflare site, players can create an account (email and password) and their wallet, bank statement, roulette history and solo blackjack table save to it, so they follow them to any device. Signed out, everything still works and stays in the browser. The first time someone creates an account, this browser's progress moves into it.

- **Database:** Neon project `mini-casino` (us-east-2), table `saves (user_id text primary key, data jsonb, version int, updated_at timestamptz)`. Saves use the version number so an old device can't overwrite newer progress; it gets the newer save instead.
- **Sign-in:** Neon Auth (Managed Better Auth) on the project's `main` branch. The browser only talks to this site; the Worker proxies sign-in to Neon so the session cookie belongs to this domain.
- **Config:** `NEON_AUTH_BASE_URL` is a plain var in `wrangler.jsonc`. `DATABASE_URL` is a secret: `npx wrangler secret put DATABASE_URL` for production, and a `DATABASE_URL=...` line in `.dev.vars` (gitignored) for `wrangler dev`.
- **Trusted domains:** Neon Auth only accepts sign-ins from domains on its allowlist. Localhost is allowed for development; add any new domain (for example a custom domain) in the Neon Console under Auth, or with the Neon MCP `add_auth_trusted_domain` tool.

The claude.ai version keeps using claude.ai's own storage and doesn't show sign-in.

## Installing the app

On the Cloudflare site, Mini Casino is a Progressive Web App:

- **Android / Chrome / Edge:** use the browser's *Install app* option (or *Add to Home screen*).
- **iPhone / iPad:** in Safari, tap Share, then *Add to Home Screen*.

The installed app opens full screen, has shortcuts to Blackjack, Roulette and the Bank, and works offline. Pages load from the network when it's available, so a new deploy shows up on the next launch.

## Deploying to Cloudflare

The site deploys as a Worker: `src/worker.js` answers `/api/*` and everything else is served from `dist/`. `wrangler deploy` runs the build step first, then uploads the Worker and `dist/`. Live at https://mini-casino.boyletb8.workers.dev.

```bash
npx wrangler dev      # preview locally
npx wrangler deploy   # deploy
```

With Workers Builds connected to this repo, keep the dashboard's deploy command as `npx wrangler deploy` and leave the build command empty. The Worker's name in the dashboard must match `name` in `wrangler.jsonc` (`mini-casino`).

On Cloudflare you get solo blackjack, roulette and the bank, saved in the browser or, when signed in, to the player's account. Multiplayer rooms need claude.ai's shared storage, so they only run on the claude.ai page.

## How multiplayer works

Rooms use the artifact's shared storage and live room features, so they only work on the published page on claude.ai. Opened as a plain file, `mini-casino.html` still runs solo blackjack, roulette and the bank, keeping your wallet in the browser.

Each room is one shared document. Players save their moves to their own queue, and one player's browser (the host) applies everyone's moves with a deterministic rules engine and saves the table. If the host leaves, the next player takes over. Because every browser computes the same result from the same moves, a hand plays out the same no matter who is hosting.

To let a friend play, share the artifact with them by email with edit access. People who open it through a public link can only watch.
