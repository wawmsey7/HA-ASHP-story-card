
// ---------- 4. the model: readings → series, stretches and numbers (no DOM, tested in node) ----------
const BAD = ['unknown', 'unavailable', '', 'None', 'none'];

// readings [time, state] → [time, value], dropping what `read` rejects (undefined) and bridging dropouts
// (null) shorter than BRIDGE; `dedupe` drops repeats of the same value
function cleanSeries(points, read, now, dedupe) {
  const out = [];
  for (const [t, s] of points || []) {
    const v = read(s);
    if (v !== undefined) out.push([t, v]);
  }
  const keep = new Array(out.length);
  let nextGood = now;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i][1] === null) keep[i] = nextGood - out[i][0] >= BRIDGE;
    else { keep[i] = true; nextGood = out[i][0]; }
  }
  const res = [];
  for (let i = 0; i < out.length; i++) {
    if (!keep[i]) continue;
    if (dedupe && res.length && res[res.length - 1][1] === out[i][1]) continue;
    res.push(out[i]);
  }
  return res;
}

// index of the last reading at or before t (-1 if none)
function indexAt(points, t) {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (points[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
const valueAt = (points, t) => { const i = indexAt(points, t); return i < 0 ? null : points[i][1]; };

// stretches of the same state inside [t0, t1]: [start, end, state, realStart, realEnd]
function runs(points, t0, t1, now) {
  const out = [];
  for (let i = Math.max(0, indexAt(points, t0)); i < points.length; i++) {
    const [t, s] = points[i], end = i + 1 < points.length ? points[i + 1][0] : now;
    if (t >= t1) break;
    if (end <= t0 || s == null) continue;
    out.push([Math.max(t, t0), Math.min(end, t1), s, t, end]);
  }
  return out;
}

function readNum(k) {
  const lim = LIMITS[k] || TEMP_LIMITS;
  return s => {
    if (BAD.includes(s)) return null;
    const v = parseFloat(s);
    if (!Number.isFinite(v)) return null;
    return v >= lim[0] && v < lim[1] ? v : undefined;
  };
}
const STEPPY = ['target', 'day_temp', 'night_temp', 'curve', 'shift', 'room_factor', 'setback_size', 'hyst', 'dhw_target'];

// everything the card draws, from the raw readings
function buildSeries(store, now) {
  const S = {};
  S.activity = cleanSeries(store.activity, s => (BAD.includes(s) ? null : RENAME[s] || s), now, true);
  S.satisfied = cleanSeries(store.satisfied, s => (s === 'on' || s === 'Satisfied' ? 'on' : s === 'off' || s === 'Heat' ? 'off' : null), now, true);
  for (const k of NUMERIC) S[k] = cleanSeries(store[k], readNum(k), now, STEPPY.includes(k));
  S.plan = cleanSeries(store.plan, s => { if (s === 'off') return 'off'; const v = parseFloat(s); return Number.isFinite(v) ? v : null; }, now, true);
  return S;
}

// the values of a series inside [a, b] (including the one in force at a)
function valuesIn(points, a, b) {
  const out = [], v0 = valueAt(points, a);
  if (v0 != null && typeof v0 === 'number') out.push(v0);
  for (let i = indexAt(points, a) + 1; i < points.length && points[i][0] <= b; i++) if (typeof points[i][1] === 'number') out.push(points[i][1]);
  return out;
}

// the lowest and highest readings inside [a, b], as [time, value]
function extremes(points, a, b) {
  let mn = null, mx = null;
  const v0 = valueAt(points, a);
  const consider = p => { if (p[1] == null) return; if (!mn || p[1] < mn[1]) mn = p; if (!mx || p[1] > mx[1]) mx = p; };
  if (v0 != null) consider([a, v0]);
  for (let i = indexAt(points, a) + 1; i < points.length && points[i][0] <= b; i++) consider(points[i]);
  return { min: mn, max: mx };
}

// stretches with no readings at all (longer than BRIDGE): drawn as "No data"
function gaps(points, t0, t1) {
  const out = [];
  for (let i = Math.max(0, indexAt(points, t0)); i < points.length; i++) {
    const [t, v] = points[i];
    if (t >= t1) break;
    if (v !== null) continue;
    const end = i + 1 < points.length ? points[i + 1][0] : t1;
    if (end > t0) out.push([Math.max(t, t0), Math.min(end, t1)]);
  }
  return out;
}

// The target's colour over time: amber while it's for the hot water, grey while off, green while the room is
// satisfied (the hub lowers the water by the setback), otherwise coral. A defrost or oil return keeps the colour
// of what it interrupted. The thermostat and activity readings change a minute or two before or after the target
// steps, so a colour change within 10 minutes of a step moves onto that step.
function targetColours(S, t0, t1) {
  const act = S.activity.filter(p => p[1] !== 'Defrost' && p[1] !== 'Oil return');
  const keyAt = t => {
    const a = valueAt(act, t);
    return a === 'Hot water' ? 'hw' : a === 'Off' ? 'off' : valueAt(S.satisfied, t) === 'on' ? 'sat' : 'heat';
  };
  const SNAP = 10 * MIN, steps = [];
  for (let i = 0; i < S.target.length; i++) {
    const p = S.target[i];
    if (p[1] != null && (i === 0 || p[1] !== S.target[i - 1][1]) && p[0] > t0 - SNAP && p[0] < t1 + SNAP) steps.push(p[0]);
  }
  const near = c => {
    let best = null;
    for (const st of steps) if (Math.abs(st - c) <= SNAP && (best == null || Math.abs(st - c) < Math.abs(best - c))) best = st;
    return best;
  };
  const changes = [...act.map(p => p[0]), ...S.satisfied.map(p => p[0])].filter(c => c > t0 && c < t1).sort((a, b) => a - b);
  let tl = [[t0, keyAt(t0)]];
  for (const c of changes) {
    const k = keyAt(c);
    if (k === tl[tl.length - 1][1]) continue;
    const st = near(c);
    tl.push([st != null ? Math.max(st, t0) : c, k]);
  }
  tl.sort((a, b) => a[0] - b[0]);
  tl = tl.filter((p, i) => i + 1 >= tl.length || tl[i + 1][0] !== p[0]);
  return tl.filter((p, i) => i === 0 || p[1] !== tl[i - 1][1]);
}

// the numbers for a stretch: time split, starts, defrosts, energy and COP, temperatures
function computeStats(S, t0, t1, now) {
  const tEnd = Math.min(t1, now);
  const st = { t0, t1: tEnd, span: Math.max(0, tEnd - t0), ran: 0, heating: 0, hw: 0, paused: 0, defrost: 0, oil: 0, off: 0,
    defrosts: 0, hwRuns: 0, starts: 0, satisfied: 0,
    elec: 0, heat: 0, elecHeat: 0, heatHeat: 0, elecHw: 0, heatHw: 0, meter: false, power: false, hasHeat: false,
    flowSum: 0, dtSum: 0, heatN: 0, oSum: 0, oN: 0, rSum: 0, rN: 0, rMin: null, rMax: null };
  if (st.span <= 0) return st;
  const acts = runs(S.activity, t0, tEnd, now);
  // (a defrost or oil return in the middle of a hot water run doesn't make it two runs)
  let prev = valueAt(S.activity, t0 - 1), prevND = prev;
  for (let i = indexAt(S.activity, t0 - 1); i >= 0 && (prevND === 'Defrost' || prevND === 'Oil return'); i--) prevND = S.activity[i][1];
  for (const [a, b, v] of acts) {
    const d = b - a;
    if (RUNNING.includes(v)) st.ran += d;
    if (v === 'Heating') st.heating += d;
    else if (v === 'Hot water') { st.hw += d; if (a > t0 && prevND !== 'Hot water') st.hwRuns++; }
    else if (v === 'Paused') st.paused += d;
    else if (v === 'Defrost') { st.defrost += d; if (a > t0) st.defrosts++; }
    else if (v === 'Oil return') st.oil += d;
    else if (v === 'Off') st.off += d;
    if (a > t0 && (v === 'Heating' || v === 'Hot water') && (!prev || prev === 'Off' || prev === 'Paused')) st.starts++;
    prev = v;
    if (v !== 'Defrost' && v !== 'Oil return') prevND = v;
  }
  for (const [a, b, v] of runs(S.satisfied, t0, tEnd, now)) if (v === 'on') st.satisfied += b - a;
  // energy and averages, sampled through the stretch. Electricity comes from the meter when it has readings
  // here (each step's increase), otherwise from the power reading.
  const step = Math.max(MIN, st.span / 3000), hrs = step / HOUR;
  st.meter = S.meter.some(p => p[0] > t0 && p[0] <= tEnd);
  st.power = st.meter || S.power.some(p => p[0] > t0 && p[0] <= tEnd);
  st.hasHeat = S.heat.some(p => p[0] > t0 && p[0] <= tEnd);
  for (let t = t0; t < tEnd; t += step) {
    const a = valueAt(S.activity, t), q = valueAt(S.heat, t);
    let e = null;
    if (st.meter) {
      const e1 = valueAt(S.meter, t), e2 = valueAt(S.meter, Math.min(tEnd, t + step));
      if (e1 != null && e2 != null && e2 >= e1 && e2 - e1 < 5) e = e2 - e1;
    } else {
      const p = valueAt(S.power, t);
      if (p != null) e = p * hrs;
    }
    if (e != null) { st.elec += e; if (a === 'Heating') st.elecHeat += e; if (a === 'Hot water') st.elecHw += e; }
    if (q != null) { st.heat += q * hrs; if (a === 'Heating') st.heatHeat += q * hrs; if (a === 'Hot water') st.heatHw += q * hrs; }
    if (a === 'Heating') {
      const f = valueAt(S.flow, t), r = valueAt(S.return, t);
      if (f != null && r != null) { st.flowSum += f; st.dtSum += f - r; st.heatN++; }
    }
    const o = valueAt(S.outside, t);
    if (o != null) { st.oSum += o; st.oN++; }
    const rm = valueAt(S.room, t);
    if (rm != null) { st.rSum += rm; st.rN++; st.rMin = st.rMin == null ? rm : Math.min(st.rMin, rm); st.rMax = st.rMax == null ? rm : Math.max(st.rMax, rm); }
  }
  const cop = (h, e) => (e >= 0.1 ? h / e : null);
  st.cop = cop(st.heat, st.elec); st.copHeat = cop(st.heatHeat, st.elecHeat); st.copHw = cop(st.heatHw, st.elecHw);
  const ox = extremes(S.outside, t0, tEnd);
  st.oMin = ox.min; st.oMax = ox.max;
  return st;
}

// energy and COP for one run (a tap on the heat pump lane)
function runEnergy(S, a, b) {
  const e1 = valueAt(S.meter, a), e2 = valueAt(S.meter, b);
  let elec = e1 != null && e2 != null && e2 >= e1 ? e2 - e1 : null;
  let heat = 0, has = false;
  const step = Math.max(MIN, (b - a) / 400);
  if (elec == null) { elec = 0; for (let t = a; t < b; t += step) { const p = valueAt(S.power, t); if (p != null) elec += p * step / HOUR; } }
  for (let t = a; t < b; t += step) { const q = valueAt(S.heat, t); if (q != null) { heat += q * step / HOUR; has = true; } }
  return { elec, heat: has ? heat : null, cop: has && elec >= 0.05 ? heat / elec : null };
}

// things worth a look (at most two): short cycling, flow well under its target, a long hot water run, lots of defrosting
function warnings(S, t0, t1, now, st, fmt) {
  const acts = runs(S.activity, t0, Math.min(t1, now), now), out = [];
  const starts = [];
  let prev = valueAt(S.activity, t0 - 1);
  for (const [a, , v] of acts) {
    if (a > t0 && (v === 'Heating' || v === 'Hot water') && (!prev || prev === 'Off' || prev === 'Paused')) starts.push(a);
    prev = v;
  }
  let best = null;
  for (let i = 0; i < starts.length; i++) {
    let j = i;
    while (j + 1 < starts.length && starts[j + 1] - starts[i] <= HOUR) j++;
    if (j - i + 1 >= 4 && (!best || j - i + 1 > best.n)) best = { n: j - i + 1, t: starts[i] };
  }
  if (best) out.push({ title: 'Short cycling', text: `${best.n} starts within an hour, from ${fmt.when(best.t, now)}`, t: best.t, span: 3 * HOUR });
  let worst = null;
  for (const [a, b, v] of acts) {
    if (v !== 'Heating' || b - a < 90 * MIN) continue;
    let from = null, sum = 0, n = 0;
    const close = t => { if (from != null && t - from >= 45 * MIN && (!worst || t - from > worst.d)) worst = { t: from, d: t - from, gap: sum / n }; from = null; sum = 0; n = 0; };
    for (let t = a + 45 * MIN; t < b; t += 2 * MIN) {
      const f = valueAt(S.flow, t), tg = valueAt(S.target, t);
      if (f != null && tg != null && tg - f >= 3) { if (from == null) from = t; sum += tg - f; n++; } else close(t);
    }
    close(b);
  }
  if (worst) out.push({ title: 'Flow short of target', text: `${worst.gap.toFixed(0)}° under for ${dur(worst.d)}, from ${fmt.when(worst.t, now)}`, t: worst.t, span: Math.max(3 * HOUR, worst.d * 2) });
  const hw = acts.filter(([a, b, v]) => v === 'Hot water' && b - a >= 90 * MIN).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  if (hw) out.push({ title: 'Long hot water run', text: `${dur(hw[1] - hw[0])}, from ${fmt.when(hw[0], now)}`, t: hw[0], span: 3 * HOUR });
  if (st && st.defrosts >= 3 && st.ran > 0 && st.defrost / st.ran > 0.15) out.push({ title: 'Lots of defrosting', text: `${st.defrosts} defrosts, ${dur(st.defrost)} in total`, t: null });
  return out.slice(0, 2);
}

// setting changes inside [t0, t1], with changes a few minutes apart grouped and brief flickers ignored
function settingChanges(S, t0, t1) {
  const ev = [];
  for (const [k, label, dp, unit] of SETTINGS) {
    const pts = (S[k] || []).filter(p => p[1] != null);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] === pts[i - 1][1]) continue;
      if (i + 1 < pts.length && pts[i + 1][1] === pts[i - 1][1] && pts[i + 1][0] - pts[i][0] < 10 * MIN) { i++; continue; }
      ev.push({ t: pts[i][0], k, label, dp, unit, from: pts[i - 1][1], to: pts[i][1] });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  const groups = [];
  for (const e of ev) {
    const g = groups[groups.length - 1];
    if (g && e.t - g.last <= 10 * MIN) { g.items.push(e); g.last = e.t; } else groups.push({ t: e.t, last: e.t, items: [e] });
  }
  return groups.map(g => {
    const by = new Map();
    for (const e of g.items) { const o = by.get(e.k); if (o) o.to = e.to; else by.set(e.k, { ...e }); }
    return { t: g.t, items: [...by.values()].filter(o => o.from !== o.to) };
  }).filter(g => g.items.length && g.t > t0 && g.t <= t1);
}

// one day for the day row: kWh from the meter, hours heating, defrosts (from history, when it's loaded)
function dayStats(S, start, end, now) {
  const tEnd = Math.min(end, now);
  if (tEnd <= start) return null;
  const e1 = valueAt(S.meter, start), e2 = valueAt(S.meter, tEnd);
  let defrosts = 0, heating = 0;
  for (const [a, b, v] of runs(S.activity, start, tEnd, now)) { if (v === 'Defrost' && a > start) defrosts++; if (v === 'Heating') heating += b - a; }
  return { kwh: e1 != null && e2 != null && e2 >= e1 ? e2 - e1 : null, defrosts, heating };
}

// the sun: its height in degrees at time t, and the day's sunrise and sunset
function sunHeight(t, lat, lon) {
  const r = Math.PI / 180, d = (t - 946728000000) / 86400000;
  const g = (357.529 + 0.98560028 * d) * r;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 0.00000036 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const h = (((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(h)) / r;
}
function sunTimes(day0, lat, lon) {
  const H = -0.833, end = addDays(day0, 1);
  const refine = (a, b, rising) => {
    for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if ((sunHeight(m, lat, lon) >= H) === rising) b = m; else a = m; }
    return Math.round(b / MIN) * MIN;
  };
  let rise = null, set = null, pt = day0, ph = sunHeight(day0, lat, lon);
  for (let t = day0 + 10 * MIN; t <= end; t += 10 * MIN) {
    const h = sunHeight(t, lat, lon);
    if (ph < H && h >= H && rise == null) rise = refine(pt, t, true);
    if (ph >= H && h < H && set == null) set = refine(pt, t, false);
    pt = t; ph = h;
  }
  return { rise, set };
}
