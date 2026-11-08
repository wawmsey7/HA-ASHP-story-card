// Builds the one-file prototype page: the card, the stand-in hass and the recorded history inlined into
// harness/prototype.html. usage: node tools/prototype.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const parts = { FIXTURE: read('fixture/history.json').trim(), FAKE: read('harness/fake-hass.js'), CARD: read('dist/heat-pump-history-card.js') };
for (const [k, v] of Object.entries(parts)) if (/<\/script|<!--/i.test(v)) throw new Error(`${k} has text that would end the script tag`);
let html = read('harness/prototype.html');
for (const [k, v] of Object.entries(parts)) html = html.replace(`/*${k}*/`, () => v);
const out = process.argv[2] || path.join(root, 'dist', 'prototype.html');
fs.writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB`);
