// Joins src/ into one file for Home Assistant: dist/heat-pump-history-card.js
// The parts are wrapped in a function so nothing leaks into the page (other cards use names like MIN too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['00-head.js', '01-config.js', '02-format.js', '03-view.js', '04-model.js', '05-theme.js', '06-render.js',
  '12-icons.js', '08-style.js', '07-card.js', '99-define.js'];
const head = fs.readFileSync(path.join(root, 'src', ORDER[0]), 'utf8');
const doc = head.slice(0, head.indexOf('*/') + 2);
const body = ORDER.map(f => {
  const s = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  return f === ORDER[0] ? s.slice(s.indexOf('*/') + 2) : s;
}).join('\n');
const out = `${doc}\n(() => {\n'use strict';\n${body}\n})();\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'heat-pump-history-card.js'), out);
console.log(`dist/heat-pump-history-card.js  ${(out.length / 1024).toFixed(0)} KB`);
