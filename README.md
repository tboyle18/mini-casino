# Mini Casino

A play-money casino in a single HTML page.

- **Blackjack**: rooms for up to 4 players with invite links, or solo practice. 6 decks, blackjack pays 3 to 2, dealer stands on all 17s, with splits, doubles and insurance. An optional hints toggle highlights the basic-strategy move.
- **Roulette**: a single-zero wheel with straight-up and all outside bets, paid from your casino wallet.
- **The Bottomless Bank**: withdraw as much (fake) money as you want. Interest rate 0%, credit check skipped.

## Files

| File | What it is |
| --- | --- |
| `mini-casino.html` | The full casino. It's written as a [Claude artifact](https://claude.ai/artifact/Jr9pJxUStQxXb7Un3cHvPZ), so the page body has no `<html>`/`<head>` wrapper of its own. |
| `blackjack.html` | The original stand-alone blackjack game. Works offline: open it in any browser. |
| `wrangler.jsonc` | Cloudflare Workers config. Serves the site as static assets from `dist/`. |
| `scripts/build.mjs` | Builds `dist/`: wraps `mini-casino.html` in a full HTML document (doctype, viewport, PWA and iOS tags) as `index.html`, copies `blackjack.html` and `public/`, and stamps the service worker with a content hash. |
| `public/` | PWA files: `manifest.webmanifest`, `sw.js` (offline cache), `_headers` (no-cache for the service worker) and `icons/`. |
| `scripts/make-icons.mjs` | Draws the app icons into `public/icons/`. Run it after changing the icon design; the PNGs are committed. |

## Installing the app

On the Cloudflare site, Mini Casino is a Progressive Web App:

- **Android / Chrome / Edge:** use the browser's *Install app* option (or *Add to Home screen*).
- **iPhone / iPad:** in Safari, tap Share, then *Add to Home Screen*.

The installed app opens full screen, has shortcuts to Blackjack, Roulette and the Bank, and works offline. Pages load from the network when it's available, so a new deploy shows up on the next launch.

## Deploying to Cloudflare

The site deploys as a static-assets Worker with no server code. `wrangler deploy` runs the build step first, then uploads `dist/`.

```bash
npx wrangler dev      # preview locally
npx wrangler deploy   # deploy
```

With Workers Builds connected to this repo, keep the dashboard's deploy command as `npx wrangler deploy` and leave the build command empty. The Worker's name in the dashboard must match `name` in `wrangler.jsonc` (`mini-casino`).

On Cloudflare you get solo blackjack, roulette and the bank, with the wallet saved in each visitor's browser. Multiplayer rooms need claude.ai's shared storage, so they only run on the claude.ai page.

## How multiplayer works

Rooms use the artifact's shared storage and live room features, so they only work on the published page on claude.ai. Opened as a plain file, `mini-casino.html` still runs solo blackjack, roulette and the bank, keeping your wallet in the browser.

Each room is one shared document. Players save their moves to their own queue, and one player's browser (the host) applies everyone's moves with a deterministic rules engine and saves the table. If the host leaves, the next player takes over. Because every browser computes the same result from the same moves, a hand plays out the same no matter who is hosting.

To let a friend play, share the artifact with them by email with edit access. People who open it through a public link can only watch.
