// Loads the card's pure modules (config, format, view, model) into a sandbox for node tests,
// and decodes the fixture into the card's store shape.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = ['01-config.js', '02-format.js', '03-view.js', '04-model.js'];

export function loadModules() {
  const code = SRC.map(f => fs.readFileSync(path.join(here, '..', 'src', f), 'utf8')).join('\n');
  const names = [...code.matchAll(/^(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  // names declared after a comma on the same line (const MIN = …, HOUR = …)
  for (const m of code.matchAll(/^const .*$/gm)) for (const n of m[0].matchAll(/,\s*([A-Z_][A-Z0-9_]*)\s*=/g)) names.push(n[1]);
  const ctx = vm.createContext({ console, Intl, Date, Math, Number, String, Array, Object, Map, Set, JSON, parseFloat, isFinite });
  vm.runInContext(`${code}\n;globalThis.__exports = { ${[...new Set(names)].join(', ')} };`, ctx);
  return ctx.__exports;
}

// fixture → { store: { cardKey: [[t, stateString], ...] }, start, end }
export function loadFixture(M, shift = 0) {
  const f = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixture', 'history.json'), 'utf8'));
  const byId = {};
  for (const [id, [d, v]] of Object.entries(f.e)) {
    let t = f.start;
    byId[id] = d.map((dt, i) => { t += dt * 100; return [t + shift, String(v[i])]; });
  }
  const store = {};
  for (const [k, id] of Object.entries(M.DEFAULT_ENTITIES)) if (id && byId[id]) store[k] = byId[id];
  return { store, byId, start: f.start + shift, end: f.end + shift };
}
