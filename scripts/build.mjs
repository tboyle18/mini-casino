// Builds the static site Cloudflare serves from ./dist.
//
// mini-casino.html is written as a claude.ai artifact: claude.ai wraps it in a
// document skeleton at publish time, so the file itself has no doctype, <head>
// or viewport tag. This script adds the same skeleton so the page renders
// correctly (standards mode, mobile viewport) when served on its own.

import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  `<link rel="icon" href="${favicon}">`,
  // Same small reset claude.ai applies to artifacts.
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
    'body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    'img{max-width:100%}[hidden]{display:none!important}</style>',
  '</head>',
  '<body>',
].join('\n');

const body = await readFile(join(root, 'mini-casino.html'), 'utf8');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(join(out, 'index.html'), `${head}\n${body}\n</body>\n</html>\n`);
await copyFile(join(root, 'blackjack.html'), join(out, 'blackjack.html'));

console.log('Built dist/index.html and dist/blackjack.html');
