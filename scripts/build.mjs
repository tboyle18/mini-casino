// Builds the static site Cloudflare serves from ./dist.
//
// mini-casino.html is the page body (styles, markup and script) without a
// document skeleton. This script adds the skeleton plus everything that makes
// the site an installable PWA (manifest, icons, iOS home screen tags, service
// worker), and inlines the blackjack rules from src/rules.js, which the room
// server (src/worker.js) imports too, plus video poker (src/poker.js), baccarat
// (src/baccarat.js) and Casino War (src/war.js).
// It also bundles the graphics lab (lab/, served at /lab/) with its packages
// (Three.js, cannon-es, GSAP, canvas-confetti).

import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { build as esbuild } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

const favicon =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
    "<circle cx='32' cy='32' r='30' fill='#0e6640' stroke='#e9c46a' stroke-width='4'/>" +
    "<text x='32' y='44' font-size='34' text-anchor='middle' fill='#e9c46a' font-family='Georgia,serif'>♠</text></svg>"
  );

const head = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="description" content="A play-money casino: blackjack, roulette, and a bank that hands out as much money as you want.">',
  '<meta name="theme-color" content="#063a24">',
  `<link rel="icon" href="${favicon}">`,
  '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Mini Casino">',
  '<title>Mini Casino</title>',
  '<link rel="preload" href="/fonts/manrope.woff2" as="font" type="font/woff2" crossorigin>',
  // No safe-area padding here: the page's own app bar and controls make room for the
  // notch and home bar. Padding the whole page as well pushes the controls off screen.
  '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
  "<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>",
  '</head>',
  '<body>',
].join('\n');

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(e => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])));
  return files.flat();
}

const page = await readFile(join(root, 'mini-casino.html'), 'utf8');
const rules = (await readFile(join(root, 'src', 'rules.js'), 'utf8')).replace(/^export /gm, '');
if (!page.includes('/* @@RULES@@ */')) throw new Error('mini-casino.html is missing its /* @@RULES@@ */ marker');
const poker = (await readFile(join(root, 'src', 'poker.js'), 'utf8')).replace(/^export /gm, '');
if (!page.includes('/* @@POKER@@ */')) throw new Error('mini-casino.html is missing its /* @@POKER@@ */ marker');
const baccarat = (await readFile(join(root, 'src', 'baccarat.js'), 'utf8')).replace(/^export /gm, '');
if (!page.includes('/* @@BACCARAT@@ */')) throw new Error('mini-casino.html is missing its /* @@BACCARAT@@ */ marker');
const war = (await readFile(join(root, 'src', 'war.js'), 'utf8')).replace(/^export /gm, '');
if (!page.includes('/* @@WAR@@ */')) throw new Error('mini-casino.html is missing its /* @@WAR@@ */ marker');
const body = page.replace('/* @@RULES@@ */', () => rules).replace('/* @@POKER@@ */', () => poker).replace('/* @@BACCARAT@@ */', () => baccarat).replace('/* @@WAR@@ */', () => war);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
await writeFile(join(out, 'index.html'), `${head}\n${body}\n</body>\n</html>\n`);

// Graphics lab: each demo is its own chunk, loaded when its tab opens
await esbuild({
  entryPoints: [join(root, 'lab', 'main.js')],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: ['es2020', 'safari15'],
  outdir: join(out, 'lab'),
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'none',
  logLevel: 'warning',
});
await copyFile(join(root, 'lab', 'index.html'), join(out, 'lab', 'index.html'));

// Version the service worker by the content of every file, its own code included
// (hashed before the version is filled in).
const hash = createHash('sha256');
for (const file of (await listFiles(out)).sort()) {
  hash.update(relative(out, file));
  hash.update(await readFile(file));
}
const version = hash.digest('hex').slice(0, 12);
const swPath = join(out, 'sw.js');
const sw = await readFile(swPath, 'utf8');
if (!sw.includes("'__BUILD_VERSION__'")) throw new Error('public/sw.js is missing its __BUILD_VERSION__ placeholder');
await writeFile(swPath, sw.replace("'__BUILD_VERSION__'", `'${version}'`));

console.log(`Built dist/ (service worker version ${version})`);
