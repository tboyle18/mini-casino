// Builds the static site Cloudflare serves from ./dist.
//
// mini-casino.html is written as a claude.ai artifact: claude.ai wraps it in a
// document skeleton at publish time, so the file itself has no doctype, <head>
// or viewport tag. This script adds that skeleton plus everything that makes the
// Cloudflare site an installable PWA: the web app manifest, app icons, iOS home
// screen tags and the service worker.

import { cp, mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
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
  // Same small reset claude.ai applies to artifacts.
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
    'body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    'img{max-width:100%}[hidden]{display:none!important}</style>',
  "<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>",
  '</head>',
  '<body>',
].join('\n');

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(e => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])));
  return files.flat();
}

const body = await readFile(join(root, 'mini-casino.html'), 'utf8');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
await writeFile(join(out, 'index.html'), `${head}\n${body}\n</body>\n</html>\n`);
await copyFile(join(root, 'blackjack.html'), join(out, 'blackjack.html'));

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
