
// ---------- 6. drawing: SVG and HTML as strings (no DOM, so it can be tested in node) ----------
const HEAD_H = 18;

// top to bottom: sun bar, hour ticks, then each graph (a heading row and its box), the heat pump lane, the marks
function makeLayout(graphs, lane, marks) {
  const sun = { top: 0, h: 20 };
  const ticks = { top: 22, h: 16 };
  let y = ticks.top + ticks.h;
  const blocks = [];
  for (const g of graphs) {
    const head = { top: y, h: HEAD_H }, top = y + HEAD_H, h = GRAPHS[g].h;
    blocks.push({ key: g, kind: 'graph', head, top, bottom: top + h, h });
    y = top + h + 8;
  }
  const lh = lane === 'power' ? 32 : 18;
  const lane_ = { key: 'activity', kind: 'lane', head: { top: y, h: HEAD_H }, top: y + HEAD_H, bottom: y + HEAD_H + lh, h: lh };
  blocks.push(lane_);
  y = lane_.bottom;
  const mk = marks ? { y: y + 11 } : null;
  y += marks ? 22 : 6;
  return { sun, ticks, blocks, marks: mk, height: y, plotTop: ticks.top + ticks.h, lane: lane_, graphs: blocks.filter(b => b.kind === 'graph') };
}

const minMax = vals => { let a = Infinity, b = -Infinity; for (const v of vals) { if (v < a) a = v; if (v > b) b = v; } return [a, b]; };

// a scale for a box: low and high (padded, at least `minSpan` apart) and a gridline step about 26 px apart
function scaleFor(vals, box, { minSpan = 2, pad = 0.3, round = 0, zero = false } = {}) {
  let [lo, hi] = vals.length ? minMax(vals) : [15, 25];
  if (zero) lo = Math.min(0, lo);
  lo -= zero && lo === 0 ? 0 : pad; hi += pad;
  if (round) { lo = Math.floor(lo / round) * round; hi = Math.ceil(hi / round) * round; }
  if (hi - lo < minSpan) { const c = (lo + hi) / 2; lo = zero ? 0 : c - minSpan / 2; hi = zero ? minSpan : c + minSpan / 2; }
  const H = box.h - 6;
  const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find(s => (s * H) / (hi - lo) >= 26) || 100;
  return { lo, hi, step, y: v => box.bottom - 3 - ((v - lo) / (hi - lo)) * H };
}

// a line through readings, thinned to the first, lowest, highest and last point in each pixel column.
// `step` holds each value until the next reading (for targets and settings); other lines hold a value until
// shortly before the next reading, as Home Assistant only records changes.
function linePath(points, m, yf, tA, tB, step) {
  const x = m.x, pts = [];
  const v0 = valueAt(points, tA);
  pts.push([tA, v0]);
  let prev = v0, prevT = tA;
  for (let i = indexAt(points, tA) + 1; i < points.length; i++) {
    const [t, v] = points[i];
    if (t > tB) break;
    if (prev != null && v != null) {
      if (step) pts.push([t, prev]);
      else if (t - prevT > 90000) pts.push([t - 60000, prev]);
    }
    pts.push([t, v]);
    prev = v; prevT = t;
  }
  if (prev != null) pts.push([tB, prev]);
  let d = '', run = [];
  const flush = () => {
    if (!run.length) return;
    const cols = new Map();
    for (const p of run) {
      const c = Math.round(p[0]), q = cols.get(c);
      if (!q) cols.set(c, { first: p, last: p, min: p, max: p });
      else { q.last = p; if (p[1] < q.min[1]) q.min = p; if (p[1] > q.max[1]) q.max = p; }
    }
    let first = true;
    for (const q of cols.values()) {
      const seq = [q.first, q.min, q.max, q.last].filter((p, i, a) => a.indexOf(p) === i).sort((p, r) => p[2] - r[2]);
      for (const p of seq) { d += `${first ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; first = false; }
    }
    run = [];
  };
  pts.forEach(([t, v], i) => { if (v == null || typeof v !== 'number') { flush(); return; } run.push([x(t), yf(v), i]); });
  flush();
  return d;
}

// the same line closed down to the bottom of its box, for a soft fill underneath
function areaPath(line, bottom) {
  return line.split('M').filter(Boolean).map(seg => {
    const c = seg.trim().split('L').map(q => q.trim().split(' '));
    return `M${seg} L${c[c.length - 1][0]} ${bottom} L${c[0][0]} ${bottom} Z`;
  }).join(' ');
}

// a step line in several colours: each step, and the jump into it, takes the colour at its start
// (sticky: a colour that also takes the jump out of it, so a hot water block is framed on both sides)
function stepSegs(points, m, yf, tA, tB, keyAt, cuts = [], sticky = null) {
  const x = m.x, pts = [[tA, valueAt(points, tA)]];
  for (let i = indexAt(points, tA) + 1; i < points.length; i++) { const [t, v] = points[i]; if (t > tB) break; pts.push([t, v]); }
  const segs = [];
  let cur = null, prevV = null;
  for (let i = 0; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (v == null) { prevV = null; cur = null; continue; }
    const tNext = i + 1 < pts.length ? pts[i + 1][0] : tB, Yv = yf(v).toFixed(1);
    const bounds = [t, ...cuts.filter(c => c > t && c < tNext), tNext];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const key = keyAt(bounds[k]), X = x(bounds[k]).toFixed(1), XN = x(bounds[k + 1]).toFixed(1);
      if (k === 0) {
        if (cur && cur.key === key) cur.d += ` L${X} ${Yv} L${XN} ${Yv}`;
        else if (cur && sticky && cur.key === sticky) { cur.d += ` L${X} ${Yv}`; cur = { key, d: `M${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
        else { cur = { key, d: `M${X} ${(prevV != null ? yf(prevV) : yf(v)).toFixed(1)} L${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
      } else if (cur.key === key) cur.d += ` L${XN} ${Yv}`;
      else { cur = { key, d: `M${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
    }
    prevV = v;
  }
  return segs;
}

// hour ticks: a gridline every 40 px or so, a label on every one that has room
function tickPlan(m) {
  const hourPx = m.W / ((m.tEnd - m.t0) / HOUR);
  const labelW = m.fmt.h12 ? 40 : 24;
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48];
  const stepH = steps.find(h => h * hourPx >= 38) || 48;
  const every = Math.max(1, Math.ceil((labelW + 10) / (stepH * hourPx)));
  const out = [];
  if (stepH >= 24) {
    const nd = stepH / 24;
    for (let t = startOfDay(m.t0), i = 0; t < m.tEnd; t = addDays(t, 1), i++) {
      const X = m.x(t);
      if (t > m.t0 && X > 8 && X < m.W - 8 && Math.round((t - startOfDay(0)) / DAY) % nd === 0) out.push([t, true, true]);
    }
    return out;
  }
  const unit = stepH * HOUR;
  for (let t = floorTo(m.t0, unit < HOUR ? unit : HOUR), n = 0; t < m.tEnd && n < 2000; t = stepOf(t, unit < HOUR ? unit : HOUR), n++) {
    const d = new Date(t), mins = d.getHours() * 60 + d.getMinutes();
    if (unit >= HOUR && mins % (stepH * 60) !== 0) continue;
    const X = m.x(t);
    if (t <= m.t0 || X < 8 || X > m.W - 8) continue;
    const idx = Math.round(mins / (stepH * 60));
    out.push([t, mins === 0, idx % every === 0]);
  }
  return out;
}

// the sun bar: night track with the daylight in yellow, sunrise and sunset written in when there's room
function renderSun(m) {
  const L = m.L, top = L.sun.top, h = L.sun.h;
  let svg = `<rect x="0" y="${top}" width="${m.W}" height="${h}" rx="${h / 2}" class="sun-night"/>`, html = '';
  if (m.lat == null || m.lon == null) return { svg, html };
  const nights = [];
  let lastSet = m.t0;
  for (let d0 = startOfDay(m.t0); d0 < m.tEnd; d0 = addDays(d0, 1)) {
    const s = m.sun(d0);
    if (!s.rise || !s.set) continue;
    const a = Math.max(s.rise, m.t0), b = Math.min(s.set, m.tEnd);
    if (s.rise > lastSet) nights.push([lastSet, Math.min(s.rise, m.tEnd)]);
    lastSet = s.set;
    if (b <= a) continue;
    const xa = m.x(a), xb = m.x(b), w = xb - xa;
    svg += `<rect x="${xa.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${h}" rx="${Math.min(h / 2, w / 2).toFixed(1)}" class="sun-day"/>`;
    const showRise = s.rise >= m.t0, showSet = s.set <= m.tEnd;
    if (w >= 118 && showRise && showSet) {
      html += `<span class="sunl" style="left:${(xa + 8).toFixed(1)}px;top:${top}px">↑ ${m.fmt.hm(s.rise)}</span>`;
      html += `<span class="sunl r" style="left:${(xb - 8).toFixed(1)}px;top:${top}px">↓ ${m.fmt.hm(s.set)}</span>`;
    } else if (w >= 58 && (showRise || showSet)) {
      html += showRise ? `<span class="sunl" style="left:${(xa + 6).toFixed(1)}px;top:${top}px">↑ ${m.fmt.hm(s.rise)}</span>`
        : `<span class="sunl r" style="left:${(xb - 6).toFixed(1)}px;top:${top}px">↓ ${m.fmt.hm(s.set)}</span>`;
    }
  }
  if (lastSet < m.tEnd) nights.push([lastSet, m.tEnd]);
  for (const [a, b] of nights) {
    const xa = m.x(Math.max(a, m.t0)), xb = m.x(Math.min(b, m.tEnd));
    if (xb - xa >= 30) html += `<span class="moon" style="left:${((xa + xb) / 2).toFixed(1)}px;top:${top + 2}px">${icon('wNight', 16)}</span>`;
  }
  return { svg, html };
}

// behind the graphs: the future greyed, midnight lines with the day's name, alternate days tinted on longer
// stretches, hour gridlines, and any part not loaded yet or before the oldest history
function renderBackdrop(m) {
  const L = m.L, boxes = [...L.graphs, L.lane];
  let svg = '', html = '';
  const span = m.tEnd - m.t0;
  if (span >= 36 * HOUR) {
    let i = 0;
    for (let d0 = startOfDay(m.t0); d0 < m.tEnd; d0 = addDays(d0, 1), i++) {
      if (Math.round((d0 - startOfDay(0)) / DAY) % 2) continue;
      const xa = m.x(Math.max(d0, m.t0)), xb = m.x(Math.min(addDays(d0, 1), m.tEnd));
      for (const b of L.graphs) svg += `<rect x="${xa.toFixed(1)}" y="${b.top}" width="${(xb - xa).toFixed(1)}" height="${b.h}" class="altday"/>`;
    }
  }
  if (m.now < m.tEnd) {
    const xn = m.x(m.now);
    for (const b of boxes) svg += `<rect x="${xn.toFixed(1)}" y="${b.top}" width="${(m.W - xn).toFixed(1)}" height="${b.h}" class="future"/>`;
    svg += `<line x1="${xn.toFixed(1)}" x2="${xn.toFixed(1)}" y1="${L.plotTop}" y2="${L.lane.bottom}" class="nowline"/>`;
  }
  for (const [t] of m.ticks) {
    const X = m.x(t).toFixed(1);
    for (const b of L.graphs) svg += `<line x1="${X}" x2="${X}" y1="${b.top}" y2="${b.bottom}" class="grid"/>`;
  }
  for (let d0 = addDays(startOfDay(m.t0), 1); d0 < m.tEnd; d0 = addDays(d0, 1)) {
    const X = m.x(d0);
    if (X < 2 || X > m.W - 2) continue;
    for (const b of L.graphs) svg += `<line x1="${X.toFixed(1)}" x2="${X.toFixed(1)}" y1="${b.top}" y2="${b.bottom}" class="dayline"/>`;
    const g0 = L.graphs[0];
    if (g0 && X < m.W - 30) html += `<span class="dayl" style="left:${(X + 4).toFixed(1)}px;top:${g0.top + 2}px">${m.fmt.wdd(d0)}</span>`;
  }
  // not loaded yet / no history
  const veil = (a, b, cls, text) => {
    if (b <= m.t0 || a >= m.tEnd) return;
    const xa = m.x(Math.max(a, m.t0)), xb = m.x(Math.min(b, m.tEnd));
    if (xb - xa < 1) return;
    const fill = cls === 'hatch' ? ` fill="url(#hatch-${m.uid})"` : '';
    for (const bx of boxes) svg += `<rect x="${xa.toFixed(1)}" y="${bx.top}" width="${(xb - xa).toFixed(1)}" height="${bx.h}" class="${cls}"${fill}/>`;
    const g0 = L.graphs[0];
    if (g0 && xb - xa > 70) html += `<span class="veil" style="left:${((xa + xb) / 2).toFixed(1)}px;top:${g0.top + g0.h / 2}px">${text}</span>`;
  };
  if (m.oldest != null) veil(-Infinity, m.oldest, 'nohist', `No history before ${m.fmt.when(m.oldest, m.now)}`);
  if (m.from != null && (m.oldest == null || m.from > m.oldest)) veil(m.oldest ?? -Infinity, m.from, 'hatch', 'Loading…');
  else if (m.from == null) veil(m.t0, m.now, 'hatch', 'Loading…');
  return { svg, html };
}

// y labels: just above their gridline on the left, like the plan card
function gridLines(m, b, sc, unit = '°', dp = 0) {
  let svg = '', html = '';
  for (let v = Math.ceil(sc.lo / sc.step - 1e-9) * sc.step; v <= sc.hi + 1e-9; v += sc.step) {
    const Y = sc.y(v);
    if (Y < b.top + 1 || Y > b.bottom - 1) continue;
    svg += `<line x1="0" x2="${m.W}" y1="${Y.toFixed(1)}" y2="${Y.toFixed(1)}" class="grid"/>`;
    if (Y - 12 > b.top - 1) html += `<span class="yl" style="top:${(Y - 13).toFixed(1)}px">${trimNum(v)}${unit}</span>`;
  }
  return { svg, html };
}

// the hot water runs, joined across a defrost or oil return in the middle
function hotWaterRuns(m) {
  const out = [];
  let open = null;
  for (const [a, b, v] of m.acts) {
    if (v === 'Hot water') { if (open) open[1] = b; else { open = [a, b]; out.push(open); } }
    else if (v !== 'Defrost' && v !== 'Oil return') open = null;
  }
  return out;
}

function renderWater(m, b) {
  const { S } = m, sc = m.sc.water, y = sc.y;
  const g = gridLines(m, b, sc);
  let svg = '', html = g.html, defs = `<clipPath id="wc-${m.uid}"><rect x="0" y="${b.top}" width="${m.W}" height="${b.h}"/></clipPath>`;
  for (const [a, e] of m.hw) {
    const xa = m.x(a), xb = m.x(e), w = xb - xa;
    svg += `<rect x="${xa.toFixed(1)}" y="${b.top}" width="${Math.max(1, w).toFixed(1)}" height="${b.h}" class="hwband"/>`;
    let peak = null;
    for (let i = Math.max(0, indexAt(S.flow, a)); i < S.flow.length && S.flow[i][0] <= e; i++) if (typeof S.flow[i][1] === 'number') peak = Math.max(peak ?? -Infinity, S.flow[i][1]);
    const clipped = peak != null && peak > sc.hi;
    const label = w >= 132 ? `Hot water ${m.fmt.hm(a)}–${m.fmt.hm(e)}` : w >= 66 ? 'Hot water' : '';
    if (label) html += `<span class="bandl" style="left:${(xa + 4).toFixed(1)}px;top:${b.top + 2}px">${label}</span>`;
    if (clipped && w >= 26) html += `<span class="peak" style="left:${((xa + xb) / 2).toFixed(1)}px;top:${b.top + (label ? 18 : 3)}px">↑ ${peak.toFixed(0)}°</span>`;
  }
  svg += g.svg;
  for (const [a, e] of m.flowGaps) {
    const xa = m.x(a), xb = m.x(e);
    svg += `<rect x="${xa.toFixed(1)}" y="${b.top}" width="${Math.max(1, xb - xa).toFixed(1)}" height="${b.h}" class="hatch" fill="url(#hatch-${m.uid})"/>`;
    if (xb - xa > 54) html += `<span class="veil" style="left:${((xa + xb) / 2).toFixed(1)}px;top:${b.top + b.h / 2}px">No data</span>`;
  }
  let lines = '';
  if (m.prefs.ret) { const r = linePath(S.return, m, y, m.t0, m.tData, false); if (r) lines += `<path d="${r}" class="ln ret"/>`; }
  for (const s of stepSegs(S.target, m, y, m.t0, m.tData, m.keyAt, m.cuts, 'hw')) lines += `<path d="${s.d}" class="ln tgt ${s.key}" stroke="${COL.tgt[s.key]}"/>`;
  const f = linePath(S.flow, m, y, m.t0, m.tData, false);
  if (f) lines += `<path d="${f}" class="ln flow"/>`;
  svg += `<g clip-path="url(#wc-${m.uid})">${lines}</g>`;
  if (m.now >= m.t0 && m.now <= m.tEnd) {
    const tv = valueAt(S.target, m.now), fv = valueAt(S.flow, m.now), X = m.x(m.now).toFixed(1);
    if (tv != null && y(tv) >= b.top && y(tv) <= b.bottom) svg += `<circle cx="${X}" cy="${y(tv).toFixed(1)}" r="3" fill="${COL.tgt[m.keyAt(m.now - 1000)]}" class="dot"/>`;
    if (fv != null && y(fv) >= b.top && y(fv) <= b.bottom) svg += `<circle cx="${X}" cy="${y(fv).toFixed(1)}" r="3.5" fill="${COL.flow}" class="dot"/>`;
  }
  return { svg, html, defs };
}

// the lowest and highest point of a small graph, each with its value beside it. Labels go where they don't
// cover another label (`avoid`: boxes already taken, as [x0, y0, x1, y1]); one that fits nowhere is left out.
const textW = (str, px = 10.5) => str.length * px * 0.56 + 2;
const overlaps = (r, list) => list.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
function extremesMarks(m, b, sc, ext, colorOf, avoid = []) {
  let svg = '', html = '';
  const pts = [['max', ext.max], ['min', ext.min]].filter(p => p[1]);
  if (ext.max && ext.min && ext.max[1] === ext.min[1]) pts.pop();
  const taken = avoid.slice();
  for (const [k, p] of pts) {
    const X = Math.max(3, Math.min(m.W - 3, m.x(p[0]))), Y = sc.y(p[1]), text = deg(p[1]), w = textW(text);
    svg += `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="2.75" style="fill:${colorOf(p[1])}" class="dot"/>`;
    const ys = k === 'max' ? [Y - 15, Y + 2] : [Y + 2, Y - 15];
    const tries = [];
    for (const top of ys) for (const right of [true, false]) tries.push({ top, right, r: right ? [X + 5, top, X + 5 + w, top + 13] : [X - 5 - w, top, X - 5, top + 13] });
    const fit = tries.find(c => c.r[0] >= 0 && c.r[2] <= m.W && c.r[1] >= b.top - 3 && c.r[3] <= b.bottom + 3 && !overlaps(c.r, taken));
    if (!fit) continue;
    taken.push(fit.r);
    html += `<span class="ml${fit.right ? '' : ' r'}" style="left:${(fit.right ? X + 5 : X - 5).toFixed(1)}px;top:${fit.top.toFixed(1)}px">${text}</span>`;
  }
  return { svg, html };
}

function renderRoom(m, b) {
  const { S } = m, sc = m.sc.room, y = sc.y;
  const g = gridLines(m, b, sc);
  let svg = g.svg, html = g.html;
  const taken = [];
  // satisfied: a green edge along the top (the hub has lowered the water), named once
  let named = false;
  for (const [a, e, v] of runs(S.satisfied, m.t0, m.tData, m.now)) {
    if (v !== 'on') continue;
    const xa = m.x(a), w = m.x(e) - xa;
    svg += `<rect x="${xa.toFixed(1)}" y="${b.top}" width="${Math.max(1, w).toFixed(1)}" height="3" rx="1.5" class="satbar"/>`;
    const lx = Math.max(xa + 3, 30);   // clear of the y labels
    if (!named && xa + w - lx >= 60) {
      named = true;
      html += `<span class="satl" style="left:${lx.toFixed(1)}px;top:${b.top + 3}px">Satisfied</span>`;
      taken.push([lx, b.top + 3, lx + textW('Satisfied', 10), b.top + 15]);
    }
  }
  // the room's set temps: the plan's when there is one, else the day and night temps as dashed references
  const planHas = S.plan.some(p => p[0] <= m.tEnd && p[0] >= m.t0 - 2 * DAY);
  if (planHas) {
    const pl = linePath(S.plan.map(p => [p[0], typeof p[1] === 'number' ? p[1] : null]), m, y, m.t0, m.tEnd, true);
    if (pl) svg += `<path d="${areaPath(pl, b.bottom)}" class="planarea"/><path d="${pl}" class="ln plan"/>`;
  } else {
    const refs = [['day_temp', 'day'], ['night_temp', 'night']].map(([k, name]) => ({ k, name, v: valueAt(S[k], Math.min(m.tData, m.tEnd)) }));
    for (const r of refs) {
      const p = linePath(S[r.k], m, y, m.t0, m.tEnd, true);
      if (p) svg += `<path d="${p}" class="ln ref"/>`;
    }
    const shown = refs.filter(r => r.v != null).sort((p, q) => q.v - p.v);
    let lastTop = -Infinity;
    for (const r of shown) {
      let top = y(r.v) - 13;
      if (top - lastTop < 12) top = lastTop + 12;
      lastTop = top;
      const label = `${r.name} ${r.v.toFixed(1)}°`;
      html += `<span class="refl" style="top:${top.toFixed(1)}px">${label}</span>`;
      taken.push([m.W - textW(label, 10), top, m.W, top + 13]);
    }
  }
  const p = linePath(S.room, m, y, m.t0, m.tData, false);
  if (p) svg += `<path d="${areaPath(p, b.bottom)}" class="roomarea"/><path d="${p}" class="ln room"/>`;
  const ex = extremesMarks(m, b, sc, extremes(S.room, m.t0, m.tData), () => 'var(--hp-room)', taken);
  return { svg: svg + ex.svg, html: html + ex.html };
}

function renderOutside(m, b) {
  const { S } = m, sc = m.sc.outside, y = sc.y;
  const grad = `og-${m.uid}`;
  const defs = `<linearGradient id="${grad}" x1="0" x2="0" y1="${y(sc.hi)}" y2="${y(sc.lo)}" gradientUnits="userSpaceOnUse">${
    [0, 0.25, 0.5, 0.75, 1].map(f => `<stop offset="${f}" stop-color="${mix(AIR, sc.hi - f * (sc.hi - sc.lo))}"/>`).join('')}</linearGradient>`;
  const g = gridLines(m, b, sc);
  let svg = g.svg, html = g.html;
  const p = linePath(S.outside, m, y, m.t0, m.tData, false);
  if (p) svg += `<path d="${areaPath(p, b.bottom)}" fill="url(#${grad})" fill-opacity="0.15"/><path d="${p}" class="ln" stroke="url(#${grad})" stroke-width="1.75"/>`;
  const ex = extremesMarks(m, b, sc, extremes(S.outside, m.t0, m.tData), v => mix(AIR, v));
  return { svg: svg + ex.svg, html: html + ex.html, defs };
}

// the graphs you can switch on
const EXTRA = {
  power: { keys: [['heat', COL.heat, 'heat'], ['power', COL.elec, 'in']], unit: ' kW', zero: true, minSpan: 2, area: 'power' },
  cop: { keys: [['cop', COL.cop, '']], unit: '', zero: true, minSpan: 4 },
  tank: { keys: [['tank', COL.tank, 'tank'], ['dhw_target', COL.tank, 'target', true]], unit: '°', minSpan: 10, pad: 2 },
  flow_rate: { keys: [['flow_rate', COL.rate, '']], unit: '', minSpan: 5, pad: 1 },
  compressor: { keys: [['compressor', COL.comp, '']], unit: '', zero: true, minSpan: 10 },
};
function renderExtra(m, b) {
  const spec = EXTRA[b.key], { S } = m, sc = m.sc[b.key];
  const g = gridLines(m, b, sc, b.key === 'tank' ? '°' : '');
  let svg = g.svg;
  for (const [k, col, , dashed] of spec.keys) {
    const p = linePath(S[k], m, sc.y, m.t0, m.tData, !!dashed);
    if (!p) continue;
    if (spec.area === k) svg += `<path d="${areaPath(p, b.bottom)}" fill="${col}" fill-opacity="0.25"/>`;
    svg += `<path d="${p}" class="ln" stroke="${col}" stroke-width="${dashed ? 1.25 : 1.5}"${dashed ? ' stroke-dasharray="4 3"' : ''}/>`;
  }
  return { svg, html: g.html };
}

// the heat pump lane: what it was doing, as a bar (names written in where they fit) or as a strip as tall as
// the electrical power it used, coloured by what it was doing
function renderLane(m, b) {
  const { S } = m;
  let svg = '', html = '', defs = '';
  const tEnd = m.tData, id = m.uid;
  svg += `<rect x="0" y="${b.top}" width="${m.x(tEnd).toFixed(1)}" height="${b.h}" rx="4" class="track"/>`;
  defs += `<clipPath id="lc-${id}"><rect x="0" y="${b.top}" width="${m.x(tEnd).toFixed(1)}" height="${b.h}" rx="4"/></clipPath>`;
  const plain = m.acts.filter(r => r[2] !== 'Defrost' && r[2] !== 'Oil return');
  const blips = m.acts.filter(r => r[2] === 'Defrost' || r[2] === 'Oil return');
  let body = '';
  if (m.prefs.lane === 'power') {
    let mx = 1.2;
    for (const v of valuesIn(S.power, m.t0, tEnd)) if (v > mx) mx = v;
    const yp = v => b.bottom - (v / mx) * (b.h - 2);
    const line = linePath(S.power, m, yp, m.t0, tEnd, false);
    const area = line ? areaPath(line, b.bottom) : '';
    const byCol = {};
    for (const [a, e, v] of plain) (byCol[v] = byCol[v] || []).push([a, e]);
    for (const [v, list] of Object.entries(byCol)) {
      const cid = `la-${id}-${ACT_ORDER.indexOf(v)}`;
      defs += `<clipPath id="${cid}">${list.map(([a, e]) => `<rect x="${m.x(a).toFixed(2)}" y="${b.top}" width="${Math.max(0.5, m.x(e) - m.x(a)).toFixed(2)}" height="${b.h}"/>`).join('')}</clipPath>`;
      if (area) body += `<path d="${area}" fill="${COL.act[v] || COL.act.Off}" clip-path="url(#${cid})"/>`;
    }
    for (const [a, e, v] of blips) {
      const w = Math.max(2, m.x(e) - m.x(a));
      body += `<rect x="${(m.x(a) + (m.x(e) - m.x(a)) / 2 - w / 2).toFixed(2)}" y="${b.top}" width="${w.toFixed(2)}" height="${b.h}" fill="${COL.act[v]}" opacity="0.9"/>`;
    }
    html += `<span class="lanescale" style="top:${b.top - 1}px">${mx.toFixed(1)} kW</span>`;
  } else {
    for (const [a, e, v] of plain) {
      const xa = m.x(a), w = m.x(e) - xa;
      body += `<rect x="${(xa + 0.5).toFixed(2)}" y="${b.top}" width="${Math.max(0.5, w - 1).toFixed(2)}" height="${b.h}" fill="${COL.act[v] || COL.act.Off}"/>`;
      const label = v === 'Paused' ? `Paused ${dur(e - a)}` : ACT_NAME[v] || v;
      if (w >= label.length * 5.6 + 10) html += `<span class="lanel" style="left:${(xa + w / 2).toFixed(1)}px;top:${b.top}px;color:${COL.actInk[v] || 'inherit'}">${label}</span>`;
    }
    for (const [a, e, v] of blips) {
      const w = Math.max(2.5, m.x(e) - m.x(a));
      body += `<rect x="${(m.x(a) + (m.x(e) - m.x(a)) / 2 - w / 2).toFixed(2)}" y="${b.top}" width="${w.toFixed(2)}" height="${b.h}" fill="${COL.act[v]}"/>`;
    }
  }
  svg += `<g clip-path="url(#lc-${id})">${body}</g>`;
  return { svg, html, defs };
}

// a block's heading: its values at the moment shown (the inspector, or now when live), or a key otherwise
function blockHead(m, b, t) {
  const S = m.S, at = k => (t == null ? null : valueAt(S[k], t));
  const key = (c, dash) => `<i class="k${dash ? ' dash' : ''}" style="--c:${c}"></i>`;
  const name = `<span class="bn">${b.kind === 'lane' ? 'Heat pump' : GRAPHS[b.key].label}</span>`;
  let body = '', right = '';
  if (b.key === 'water') {
    const tk = t == null ? 'heat' : m.keyAt(t);
    if (t == null) body = `${key(COL.flow)}flow ${key(COL.tgt.heat)}target${m.prefs.ret ? ` ${key(COL.ret)}return` : ''}`;
    else {
      const f = at('flow'), tg = at('target'), r = at('return'), hw = tk === 'hw';
      const d = f != null && tg != null && !hw ? f - tg : null;
      body = `${key(COL.flow)}<b>${deg(f)}</b> flow · ${key(COL.tgt[tk], hw)}<b>${deg(tg, 0)}</b> ${hw ? 'tank' : 'target'}`;
      if (m.prefs.ret) body += ` · ${key(COL.ret)}<b>${deg(r)}</b> return`;
      else if (d != null) body += `<span class="dw"> · ${Math.abs(d) < 0.05 ? 'on target' : `${Math.abs(d).toFixed(1)}° ${d < 0 ? 'below' : 'above'}`}</span>`;
    }
  } else if (b.key === 'room') {
    if (t == null) body = `${key('var(--hp-room)')}room ${key('var(--hp-sub)', true)}day / night temps ${key(COL.sat)}satisfied`;
    else {
      const sat = valueAt(S.satisfied, t) === 'on';
      body = `${key('var(--hp-room)')}<b>${deg(at('room'))}</b><span class="dw"> · ${sat ? 'satisfied' : 'below its set temp'}</span>`;
    }
  } else if (b.key === 'outside') {
    body = t == null ? `${key(`linear-gradient(90deg, ${AIR.map(a => a[1]).join(', ')})`)}outside` : `<b style="color:${at('outside') != null ? mix(AIR, at('outside')) : ''}">${deg(at('outside'))}</b>`;
  } else if (b.kind === 'lane') {
    const states = ACT_ORDER.filter(s => m.acts.some(r => r[2] === s));
    if (t == null || t > m.now) body = states.map(s => `<i class="k blk" style="--c:${COL.act[s]}"></i>${ACT_NAME[s].toLowerCase()}`).join(' ');
    else {
      const a = valueAt(S.activity, t) || 'Off', p = at('power');
      body = `<i class="k blk" style="--c:${COL.act[a] || COL.act.Off}"></i><b>${ACT_NAME[a] || a}</b>${p != null && m.prefs.lane === 'power' ? `<span class="dw"> · ${p.toFixed(2)} kW</span>` : ''}`;
    }
    const nd = m.acts.filter(r => r[2] === 'Defrost' && r[0] > m.t0).length;
    if (nd) right = `<span class="cnt" title="Defrosts on screen">${icon('defrost', 14)}${nd}</span>`;
  } else {
    const spec = EXTRA[b.key];
    body = spec.keys.map(([k, col, label, dashed]) => {
      const v = at(k);
      return t == null ? `${key(col, dashed)}${label || GRAPHS[b.key].label.toLowerCase()}`
        : `${key(col, dashed)}<b>${v == null ? '–' : b.key === 'tank' ? deg(v, k === 'dhw_target' ? 0 : 1) : trimNum(v)}${v == null ? '' : spec.unit === '°' ? '' : spec.unit}</b>${label ? ` ${label}` : ''}`;
    }).join(' · ');
  }
  return `<div class="bh" style="top:${b.head.top}px">${name}<span class="bv">${body}</span>${right}</div>`;
}

// the inspector: a line through everything and a dot on each line at that moment
function cursorSvg(m, t) {
  const X = m.x(t), S = m.S, L = m.L;
  let s = `<line x1="${X.toFixed(1)}" x2="${X.toFixed(1)}" y1="${L.plotTop}" y2="${L.lane.bottom}" class="cross"/>`;
  const dot = (v, yf, col, b) => {
    if (v == null || typeof v !== 'number') return;
    const Y = yf(v);
    if (Y < b.top - 1 || Y > b.bottom + 1) return;
    s += `<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.75" style="fill:${col}" class="dot"/>`;
  };
  for (const b of L.graphs) {
    const sc = m.sc[b.key];
    if (b.key === 'water') {
      if (m.prefs.ret) dot(valueAt(S.return, t), sc.y, COL.ret, b);
      dot(valueAt(S.target, t), sc.y, COL.tgt[m.keyAt(t)], b);
      dot(valueAt(S.flow, t), sc.y, COL.flow, b);
    } else if (b.key === 'room') dot(valueAt(S.room, t), sc.y, 'var(--hp-room)', b);
    else if (b.key === 'outside') { const v = valueAt(S.outside, t); dot(v, sc.y, v != null ? mix(AIR, v) : '', b); }
    else for (const [k, col] of EXTRA[b.key].keys) dot(valueAt(S[k], t), sc.y, col, b);
  }
  return s;
}
