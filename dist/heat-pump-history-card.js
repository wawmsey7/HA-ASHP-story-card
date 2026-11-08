/*
 * Heat pump history card for Home Assistant
 * -----------------------------------------
 * A timeline you read left to right: what the heat pump did, how hard it worked and why, with the flow
 * against its target, the room against its set temps, and the outside temperature on one shared time axis.
 *
 *   Top:       what it's doing now, in words, with the flow and its target.
 *   Time bar:  what's on screen in plain words ("Last 12 hours", "Yesterday", "Sat 18:00 – Sun 06:00"),
 *              Live or not, ‹ › to step a window at a time, Now to come back, and the zoom chips.
 *   Timeline:  sun bar and hours along the top, then the water, room and outside graphs (and any extra graphs
 *              you switch on), then the heat pump lane (a bar, or a strip as tall as the power it used).
 *   Day row:   the last 7 days with a box showing where you are; tap a day to see it, drag the box to move.
 *   Below:     anything worth a look, and the numbers for what's on screen.
 *
 * Moving through time:
 *   Phone:     drag sideways to move, pinch to zoom, tap to inspect a moment (drag the time pill to scrub).
 *   Computer:  hover to inspect (click to pin), drag to move, Ctrl/⌘ + scroll or a trackpad pinch to zoom,
 *              Shift + scroll or a sideways swipe to move. Keys: ← → inspect, Shift+← → move, + − zoom.
 *
 * Install: copy to /config/www/cards/ashp/heat-pump-history-card.js and add the resource
 *          /local/cards/ashp/heat-pump-history-card.js?v=0.1 (JavaScript module; raise the number on each update).
 * Use:     type: custom:heat-pump-history-card
 * Options (all optional):
 *   hours: 12             the zoom it opens on the first time (after that it remembers your choice)
 *   graphs: [water, room, outside]   which graphs to show, in order (also: power, cop, tank, flow_rate, compressor)
 *   lane: bar             the heat pump lane as a bar, or `power` for a strip as tall as the power used
 *   entities:             swap any sensor, e.g.  room: sensor.lounge_temperature
 *   scripts:              swap the scripts Tune uses
 */
(() => {
'use strict';


const VERSION = '0.1.0';


// ---------- 1. config ----------
const MIN = 60000, HOUR = 3600e3, DAY = 86400e3;

// Only what the hub really reports. (The old sensor.heating_period guessed Day/Night and flickered, so it's
// not used; the room graph shows the day and night temps as references until the plan provides the real one.)
const DEFAULT_ENTITIES = {
  activity: 'sensor.heat_pump_activity_log',      // Heating, Hot water, Defrost, Paused, Oil return (Off)
  satisfied: 'binary_sensor.thermostat_setback',  // the room thermostat is satisfied, so the water is lowered
  target: 'sensor.target_flow_temp_2',
  flow: 'sensor.actual_flow_temp_2',
  return: 'sensor.actual_return_temp_2',
  room: 'sensor.room_thermostat_temp',
  outside: 'sensor.exterior_weather_sensor',
  power: 'sensor.heat_pump_electrical_power_2',   // kW in
  heat: 'sensor.heat_pump_thermal_power_2',       // kW out (as the hub reports it)
  meter: 'sensor.ashp_power_usage',               // kWh running total (electricity meter)
  day_temp: 'sensor.circuit_1_comfort_day_temp',
  night_temp: 'sensor.circuit_1_eco_night_temp',
  curve: 'sensor.weather_comp_curve',
  shift: 'sensor.curve_shift',
  room_factor: 'sensor.room_temperature_correction',
  setback_size: 'sensor.circuit_1_temp_reduction',
  hyst: 'sensor.circuit_1_hysteresis_2',
  dhw_target: 'sensor.dhw_target_temp_setting',
  desired: 'sensor.c1_desired_heating_lwt_2',
  tank: 'sensor.actual_dhw_temp_2',
  tank_pct: 'sensor.hot_water_remaining',
  flow_rate: 'sensor.flow_rate_2',
  compressor: 'sensor.compressor_frequency_2',
  cop: 'sensor.cop_real',
  weather: 'weather.forecast_home',
  plan: '',                                        // later: the plan's sensor (state = set temp or "off")
};
// option names from the old story card that mean the same thing here
const OLD_KEYS = { at_temp: 'satisfied', energy: 'meter' };
const DEFAULT_SCRIPTS = {
  curve: 'script.grant_set_weather_curve',
  shift: 'script.grant_set_curve_shift',
  room_factor: 'script.grant_set_room_temp_correction',
  day_temp: 'script.grant_set_daytemp_target',
  night_temp: 'script.grant_set_nighttemp_target',
  setback_size: 'script.grant_set_temp_reduction',
};

// the zoom chips
const SPAN_LIST = [3, 6, 12, 24, 72, 168].map(h => h * HOUR);
const SPAN_NAME = new Map([[3 * HOUR, '3h'], [6 * HOUR, '6h'], [12 * HOUR, '12h'], [24 * HOUR, '24h'], [72 * HOUR, '3d'], [168 * HOUR, '7d']]);
const MIN_SPAN = 30 * MIN, MAX_SPAN = 7 * DAY, MAX_BACK = 14 * DAY;
const BRIDGE = 10 * MIN;            // hub dropouts shorter than this are bridged, longer ones show as a gap

// graphs, top to bottom. The first three are the main ones; the rest can be switched on.
const GRAPHS = {
  water: { label: 'Water', h: 164 },
  room: { label: 'Room', h: 64 },
  outside: { label: 'Outside', h: 44 },
  power: { label: 'Power', h: 52 },
  cop: { label: 'COP', h: 44 },
  tank: { label: 'Hot water tank', h: 52 },
  flow_rate: { label: 'Flow rate', h: 40 },
  compressor: { label: 'Compressor', h: 40 },
};
const CORE_GRAPHS = ['water', 'room', 'outside'];
const EXTRA_GRAPHS = ['power', 'cop', 'tank', 'flow_rate', 'compressor'];

// readings outside these are hub glitches (e.g. 32.8 kW) and are skipped
const LIMITS = { power: [0, 10], heat: [0, 25], compressor: [0, 150], flow_rate: [0, 80], cop: [0, 15], tank_pct: [0, 100], meter: [0, 1e9],
  curve: [0, 10], shift: [-30, 30], room_factor: [0, 20], setback_size: [0, 30], hyst: [0, 10] };
const TEMP_LIMITS = [-40, 95];
const NUMERIC = ['target', 'flow', 'return', 'room', 'outside', 'power', 'heat', 'meter', 'day_temp', 'night_temp', 'curve', 'shift',
  'room_factor', 'setback_size', 'hyst', 'dhw_target', 'desired', 'tank', 'tank_pct', 'flow_rate', 'compressor', 'cop'];
// settings: a change shows as a mark on the time axis
const SETTINGS = [['curve', 'Weather curve', 1, ''], ['shift', 'Curve shift', 0, ' °C'], ['room_factor', 'Room correction', 1, ''],
  ['day_temp', 'Day temperature', 1, ' °C'], ['night_temp', 'Night temperature', 1, ' °C'], ['setback_size', 'Setback', 0, ' °C'],
  ['dhw_target', 'Hot water target', 0, ' °C']];
const RENAME = { Circulating: 'Paused', Idle: 'Off', Standby: 'Off', Stopped: 'Off' };
const RUNNING = ['Heating', 'Hot water', 'Defrost', 'Oil return'];
const STORE_PREFIX = 'hp-history:';


// ---------- 2. formatting ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const p2 = n => String(n).padStart(2, '0');
const deg = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -dp ? '−' : ''}${Math.abs(v).toFixed(dp)}°`);
const signed = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '–'
  : Math.abs(v) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}`);
const dur = ms => {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const kwh = v => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(v >= 10 ? 0 : 1));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function hour12Of(locale) {
  if (!locale) return false;
  if (locale.time_format === '12') return true;
  if (locale.time_format === '24') return false;
  try {
    return !!new Intl.DateTimeFormat(locale.time_format === 'system' ? undefined : locale.language, { hour: 'numeric' }).resolvedOptions().hour12;
  } catch (e) { return false; }
}

// words for times, days and spans
function makeFmt(locale) {
  const h12 = hour12Of(locale);
  const wdNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const moNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f = {
    h12,
    hm(t) {
      const d = new Date(t);
      return h12 ? `${d.getHours() % 12 || 12}:${p2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}` : `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    },
    // hour ticks: "06" (or "6 AM"); off the hour "06:30"
    tick(t) {
      const d = new Date(t);
      if (d.getMinutes()) return h12 ? `${d.getHours() % 12 || 12}:${p2(d.getMinutes())}` : `${p2(d.getHours())}:${p2(d.getMinutes())}`;
      return h12 ? `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? 'AM' : 'PM'}` : p2(d.getHours());
    },
    wd: t => wdNames[new Date(t).getDay()],
    dm: t => { const d = new Date(t); return `${d.getDate()} ${moNames[d.getMonth()]}`; },
    wdd: t => { const d = new Date(t); return `${wdNames[d.getDay()]} ${d.getDate()}`; },
    full: t => { const d = new Date(t); return `${wdNames[d.getDay()]} ${d.getDate()} ${moNames[d.getMonth()]}`; },
    mo: t => moNames[new Date(t).getMonth()],
  };
  // a moment: "18:17" today, "Sat 18:17" this week, "Sat 1 Nov 18:17" before that
  f.when = (t, now) => {
    const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
    return days === 0 ? f.hm(t) : days > 0 && days < 7 ? `${f.wd(t)} ${f.hm(t)}` : `${f.full(t)} ${f.hm(t)}`;
  };
  // a day: "Today", "Yesterday", "Thu 6 Nov"
  f.dayWord = (t, now) => {
    const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days === -1 ? 'Tomorrow' : f.full(t);
  };
  return f;
}

// a length of time in words: "45 minutes", "1 hour", "8 hours", "2.5 days", "7 days"
function spanWords(ms) {
  const mins = Math.round(ms / MIN);
  if (mins < 60) return `${mins} minutes`;
  const h = ms / HOUR;
  if (h < 47.5) {
    const r = Math.round(h * 2) / 2;
    return r === 1 ? '1 hour' : `${trimNum(r)} hours`;
  }
  const d = Math.round((ms / DAY) * 2) / 2;
  return `${trimNum(d)} days`;
}
const trimNum = v => String(Number(v.toFixed(1)));


// ---------- 3. time and the view ----------
// Local time throughout: days start at local midnight, so a daylight-saving day is 23 or 25 hours long.
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
function isMidnight(t) { return startOfDay(t) === t; }
function floorTo(t, unit) {
  const d = new Date(t);
  if (unit >= DAY) { d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (unit >= HOUR) { const k = Math.max(1, Math.round(unit / HOUR)); d.setHours(Math.floor(d.getHours() / k) * k, 0, 0, 0); return d.getTime(); }
  const k = Math.max(1, Math.round(unit / MIN));
  d.setMinutes(Math.floor(d.getMinutes() / k) * k, 0, 0);
  return d.getTime();
}
function stepOf(t, unit, n = 1) {
  if (unit >= DAY) return addDays(t, n * Math.round(unit / DAY));
  const d = new Date(t);
  if (unit >= HOUR) d.setHours(d.getHours() + n * Math.round(unit / HOUR));
  else d.setMinutes(d.getMinutes() + n * Math.round(unit / MIN));
  return d.getTime();
}
function ceilTo(t, unit) { const f = floorTo(t, unit); return f === t ? t : stepOf(f, unit); }
function roundTo(t, unit) { const f = floorTo(t, unit), c = stepOf(f, unit); return t - f <= c - t ? f : c; }

// A view is one of:
//   { kind: 'live', span }        the last `span` up to now, moving on with time
//   { kind: 'days', start, n }    whole days from local midnight (if it includes today it's live too)
//   { kind: 'free', t0, span }    any other stretch of the past
function windowOf(v, now) {
  if (v.kind === 'live') return { t0: now - v.span, t1: now, live: true, rolling: true };
  if (v.kind === 'days') { const t1 = addDays(v.start, v.n); return { t0: v.start, t1, live: v.start <= now && now < t1, rolling: false }; }
  return { t0: v.t0, t1: v.t0 + v.span, live: false, rolling: false };
}
const spanOf = (v, now) => { const w = windowOf(v, now); return w.t1 - w.t0; };
const sameView = (a, b) => a && b && a.kind === b.kind && a.span === b.span && a.t0 === b.t0 && a.start === b.start && a.n === b.n;

// the zoom chip this view matches, or null (after a pinch to an in-between span)
function chipOf(v) {
  if (v.kind === 'days') { const s = v.n * DAY; return SPAN_LIST.includes(s) ? s : null; }
  return SPAN_LIST.find(c => Math.abs(c - v.span) < MIN) || null;
}

// the zoom the Now button goes back to
const liveOf = v => ({ kind: 'live', span: v.kind === 'days' ? v.n * DAY : v.span });

// ‹ and ›: one window back or forward.
//   From live: the whole days before today (24h → Yesterday), or the previous stretch ending on the hour.
//   Days page by days (Yesterday ↔ Today, like the plan card); other stretches by their own length.
//   Reaching now goes live again. Returns the same view when there's nowhere to go.
function stepView(v, dir, now, minT = -Infinity) {
  let out;
  if (v.kind === 'live') {
    if (dir > 0) return v;
    if (v.span % DAY === 0) {
      const n = v.span / DAY;
      out = { kind: 'days', start: addDays(startOfDay(now), -n), n };
    } else {
      const t1 = ceilTo(now - v.span, HOUR);
      out = { kind: 'free', t0: t1 - v.span, span: v.span };
    }
  } else if (v.kind === 'days') {
    const w = windowOf(v, now);
    if (dir > 0 && w.t1 > now) return v;
    let start = addDays(v.start, dir * v.n);
    const latest = addDays(startOfDay(now), 1 - v.n);     // the stretch that ends tonight
    if (start > latest) start = latest;
    out = { kind: 'days', start, n: v.n };
  } else {
    const t0 = v.t0 + dir * v.span;
    if (t0 + v.span >= now) return { kind: 'live', span: v.span };
    out = { kind: 'free', t0, span: v.span };
  }
  // nothing to show before the oldest history
  if (windowOf(out, now).t1 <= minT) return v;
  return out;
}

// a zoom chip (or the keyboard): live stays live with now at the right; otherwise zoom around the anchor
// (the inspector if there is one, else the middle of what's on screen) so what you were looking at stays in view
function zoomView(v, span, now, anchor) {
  span = clamp(span, MIN_SPAN, MAX_SPAN);
  if (v.kind === 'live') return { kind: 'live', span };
  const w = windowOf(v, now);
  let a = anchor != null ? anchor : (w.t0 + Math.min(w.t1, now)) / 2;
  a = Math.min(a, now);
  if (span % DAY === 0) {
    const n = span / DAY;
    let start = addDays(startOfDay(a), -Math.floor((n - 1) / 2));
    const latest = addDays(startOfDay(now), 1 - n);
    if (start > latest) start = latest;
    return { kind: 'days', start, n };
  }
  const unit = span <= 3 * HOUR ? 15 * MIN : span <= 12 * HOUR ? 30 * MIN : HOUR;
  let t0 = floorTo(a - span / 2, unit);
  if (t0 + span <= a) t0 = floorTo(a, unit);
  if (t0 + span >= now) return { kind: 'live', span };
  return { kind: 'free', t0, span };
}

// a tap on a day: that whole day (never a day after today)
const dayView = (t, now) => ({ kind: 'days', start: Math.min(startOfDay(t), startOfDay(now)), n: 1 });

// after a drag or pinch: snap the span to a chip when it's close (pinch), tidy the start to a clean time,
// and go live when the right-hand edge is at now
function settleView(t0, span, now, { snapSpan = false, anchor = null, minT = -Infinity } = {}) {
  span = clamp(span, MIN_SPAN, MAX_SPAN);
  if (snapSpan) {
    let best = null;
    for (const c of SPAN_LIST) {
      const r = Math.abs(Math.log(c / span));
      if (r < Math.log(1.15) && (!best || r < best.r)) best = { c, r };
    }
    if (best) {
      const a = anchor != null ? anchor : t0 + span / 2;
      t0 = a - (a - t0) * (best.c / span);
      span = best.c;
    }
  }
  const tol = Math.max(MIN, span / 80);
  if (t0 + span >= now - tol) return { kind: 'live', span };
  if (t0 < minT) t0 = minT;
  const unit = span <= 6 * HOUR ? 5 * MIN : span <= 26 * HOUR ? 15 * MIN : HOUR;
  t0 = roundTo(t0, unit);
  if (span % DAY === 0 && isMidnight(t0)) {
    const n = span / DAY, latest = addDays(startOfDay(now), 1 - n);
    return { kind: 'days', start: Math.min(t0, latest), n };
  }
  if (t0 + span >= now) return { kind: 'live', span };
  return { kind: 'free', t0, span };
}

// what's on screen, in plain words
function titleOf(v, now, fmt) {
  const w = windowOf(v, now), span = w.t1 - w.t0;
  if (v.kind === 'live') return { title: `Last ${spanWords(v.span)}`, span, live: true };
  if (v.kind === 'days') {
    if (v.n === 1) return { title: fmt.dayWord(v.start, now), span, live: w.live, whole: true };
    const last = addDays(v.start, v.n - 1), sameMonth = new Date(v.start).getMonth() === new Date(last).getMonth();
    return { title: sameMonth ? `${fmt.wdd(v.start)} – ${fmt.wdd(last)} ${fmt.mo(last)}` : `${fmt.full(v.start)} – ${fmt.full(last)}`,
      span, live: w.live, whole: true };
  }
  const { t0, t1 } = w;
  if (span >= 2 * DAY - HOUR) {
    const e = t1 - 1, sameMonth = new Date(t0).getMonth() === new Date(e).getMonth();
    return { title: sameMonth ? `${fmt.wdd(t0)} – ${fmt.wdd(e)} ${fmt.mo(e)}` : `${fmt.full(t0)} – ${fmt.full(e)}`, span, live: false };
  }
  const d0 = startOfDay(t0), d1 = startOfDay(t1 - 1);
  if (d0 === d1) return { title: `${fmt.dayWord(t0, now)} · ${fmt.hm(t0)}–${fmt.hm(t1)}`, span, live: false };
  const recent = Math.round((startOfDay(now) - d0) / DAY) < 7;
  const dn = t => (recent ? fmt.wd(t) : fmt.full(t));
  return { title: `${dn(t0)} ${fmt.hm(t0)} – ${dn(t1)} ${fmt.hm(t1)}`, span, live: false };
}


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


// ---------- 5. colours ----------
// One colour, one meaning. Blue is water. The target's colour says what the heat pump is doing (coral heating,
// green when the room is satisfied and the water is lowered, amber hot water, grey off); hot water is also dashed.
const COL = {
  flow: '#4269d0',
  ret: '#8fa6e6',
  tgt: { heat: '#ff725c', sat: '#2fb67c', hw: '#f5a524', off: '#9aa0aa' },
  act: { Heating: '#ff7a4d', 'Hot water': '#ffb627', Defrost: '#12b5ff', 'Oil return': '#ec6fa8', Paused: 'rgba(255,122,77,0.42)', Off: 'rgba(148,152,160,0.4)' },
  actInk: { Heating: '#4a1a07', 'Hot water': '#422b00', Paused: '#5c2a12', 'Oil return': '#46102a', Off: '#3b3f46' },
  sat: '#2fb67c',
  hwBand: 'rgba(245,165,36,0.14)',
  elec: '#7d8bb0',
  heat: '#ff7a4d',
  cop: '#2fb67c',
  tank: '#f5a524',
  rate: '#2f9e97',
  comp: '#8a7fd0',
};
const ACT_ORDER = ['Heating', 'Hot water', 'Defrost', 'Oil return', 'Paused', 'Off'];
const ACT_NAME = { Heating: 'Heating', 'Hot water': 'Hot water', Defrost: 'Defrost', 'Oil return': 'Oil return', Paused: 'Paused', Off: 'Off' };
// the outside temperature, coloured by how warm it is
const AIR = [[-5, '#4f86d6'], [5, '#62a8d8'], [12, '#4fb3a5'], [18, '#e9b949'], [26, '#f08c4a']];
const mix = (stops, t) => {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t >= a && t <= b) {
      const f = (t - a) / (b - a), x = rgb(ca), y = rgb(cb);
      return `rgb(${x.map((v, j) => Math.round(v + (y[j] - v) * f)).join(',')})`;
    }
  }
  return stops[0][1];
};
const icon = (name, size = 20, color = 'currentColor') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" d="${ICONS[name] || ''}"/></svg>`;


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

// Icons (MDI paths), reused from the heat pump story card
const ICONS = {
  chevron: 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z',
  restore: 'M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z',
  flash: 'M7,2V13H10V22L17,10H13L17,2H7Z',
  fire: 'M17.66 11.2C17.43 10.9 17.15 10.64 16.89 10.38C16.22 9.78 15.46 9.35 14.82 8.72C13.33 7.26 13 4.85 13.95 3C13 3.23 12.17 3.75 11.46 4.32C8.87 6.4 7.85 10.07 9.07 13.22C9.11 13.32 9.15 13.42 9.15 13.55C9.15 13.77 9 13.97 8.8 14.05C8.57 14.15 8.33 14.09 8.14 13.93C8.08 13.88 8.04 13.83 8 13.76C6.87 12.33 6.69 10.28 7.45 8.64C5.78 10 4.87 12.3 5 14.47C5.06 14.97 5.12 15.47 5.29 15.97C5.43 16.57 5.7 17.17 6 17.7C7.08 19.43 8.95 20.67 10.96 20.92C13.1 21.19 15.39 20.8 17.03 19.32C18.86 17.66 19.5 15 18.56 12.72L18.43 12.46C18.22 12 17.66 11.2 17.66 11.2M14.5 17.5C14.22 17.74 13.76 18 13.4 18.1C12.28 18.5 11.16 17.94 10.5 17.28C11.69 17 12.4 16.12 12.61 15.23C12.78 14.43 12.46 13.77 12.33 13C12.21 12.26 12.23 11.63 12.5 10.94C12.69 11.32 12.89 11.7 13.13 12C13.9 13 15.11 13.44 15.37 14.8C15.41 14.94 15.43 15.08 15.43 15.23C15.46 16.05 15.1 16.95 14.5 17.5H14.5Z',
  play: 'M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M10,16.5L16,12L10,7.5V16.5Z',
  defrost: 'M8 17.85C8 19.04 7.11 20 6 20S4 19.04 4 17.85C4 16.42 6 14 6 14S8 16.42 8 17.85M16.46 12V10.56L18.46 9.43L20.79 10.05L21.31 8.12L19.54 7.65L20 5.88L18.07 5.36L17.45 7.69L15.45 8.82L13 7.38V5.12L14.71 3.41L13.29 2L12 3.29L10.71 2L9.29 3.41L11 5.12V7.38L8.5 8.82L6.5 7.69L5.92 5.36L4 5.88L4.47 7.65L2.7 8.12L3.22 10.05L5.55 9.43L7.55 10.56V12H2V13H22V12H16.46M9.5 12V10.56L12 9.11L14.5 10.56V12H9.5M20 17.85C20 19.04 19.11 20 18 20S16 19.04 16 17.85C16 16.42 18 14 18 14S20 16.42 20 17.85M14 20.85C14 22.04 13.11 23 12 23S10 22.04 10 20.85C10 19.42 12 17 12 17S14 19.42 14 20.85Z',
  waves: 'M20,12H22V14H20C18.62,14 17.26,13.65 16,13C13.5,14.3 10.5,14.3 8,13C6.74,13.65 5.37,14 4,14H2V12H4C5.39,12 6.78,11.53 8,10.67C10.44,12.38 13.56,12.38 16,10.67C17.22,11.53 18.61,12 20,12M20,6H22V8H20C18.62,8 17.26,7.65 16,7C13.5,8.3 10.5,8.3 8,7C6.74,7.65 5.37,8 4,8H2V6H4C5.39,6 6.78,5.53 8,4.67C10.44,6.38 13.56,6.38 16,4.67C17.22,5.53 18.61,6 20,6M20,18H22V20H20C18.62,20 17.26,19.65 16,19C13.5,20.3 10.5,20.3 8,19C6.74,19.65 5.37,20 4,20H2V18H4C5.39,18 6.78,17.53 8,16.67C10.44,18.38 13.56,18.38 16,16.67C17.22,17.53 18.61,18 20,18Z',
  thermo: 'M15 13V5A3 3 0 0 0 9 5V13A5 5 0 1 0 15 13M12 4A1 1 0 0 1 13 5V8H11V5A1 1 0 0 1 12 4Z',
  home: 'M19 8C20.11 8 21 8.9 21 10V16.76C21.61 17.31 22 18.11 22 19C22 20.66 20.66 22 19 22C17.34 22 16 20.66 16 19C16 18.11 16.39 17.31 17 16.76V10C17 8.9 17.9 8 19 8M19 9C18.45 9 18 9.45 18 10V11H20V10C20 9.45 19.55 9 19 9M12 5.69L7 10.19V18H14.1L14 19L14.1 20H5V12H2L12 3L16.4 6.96C15.89 7.4 15.5 7.97 15.25 8.61L12 5.69Z',
  calendar: 'M7 11H9V13H7V11M21 5V19C21 20.11 20.11 21 19 21H5C3.89 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H6V1H8V3H16V1H18V3H19C20.11 3 21 3.9 21 5M5 7H19V5H5V7M19 19V9H5V19H19M15 13V11H17V13H15M11 13V11H13V13H11M7 15H9V17H7V15M15 17V15H17V17H15M11 17V15H13V17H11Z',
  today: 'M7,10H12V15H7M19,19H5V8H19M19,3H18V1H16V3H8V1H6V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3Z',
  yesterday: 'M19 3H18V1H16V3H8V1H6V3H5C3.89 3 3 3.89 3 5V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.89 20.1 3 19 3M19 19H5V8H19V19M12 10V12H16V15H12V17L8 13.5L12 10Z',
  week: 'M6 1H8V3H16V1H18V3H19C20.11 3 21 3.9 21 5V19C21 20.11 20.11 21 19 21H5C3.89 21 3 20.1 3 19V5C3 3.89 3.89 3 5 3H6V1M5 8V19H19V8H5M7 10H17V12H7V10Z',
  left: 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z',
  right: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z',
  close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
  tune: 'M8 13C6.14 13 4.59 14.28 4.14 16H2V18H4.14C4.59 19.72 6.14 21 8 21S11.41 19.72 11.86 18H22V16H11.86C11.41 14.28 9.86 13 8 13M8 19C6.9 19 6 18.1 6 17C6 15.9 6.9 15 8 15S10 15.9 10 17C10 18.1 9.1 19 8 19M19.86 6C19.41 4.28 17.86 3 16 3S12.59 4.28 12.14 6H2V8H12.14C12.59 9.72 14.14 11 16 11S19.41 9.72 19.86 8H22V6H19.86M16 9C14.9 9 14 8.1 14 7C14 5.9 14.9 5 16 5S18 5.9 18 7C18 8.1 17.1 9 16 9Z',
  minus: 'M19,13H5V11H19V13Z',
  check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
  plus: 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z',
  down: 'M7,10L12,15L17,10H7Z',
  compare: 'M9 14H2V16H9V19L13 15L9 11V14M15 13V10H22V8H15V5L11 9L15 13Z',
  arrow: 'M4,11V13H16L10.5,18.5L11.92,19.92L19.84,12L11.92,4.08L10.5,5.5L16,11H4Z',
  alert: 'M12,2L1,21H23M12,6L19.53,19H4.47M11,10V14H13V10M11,16V18H13V16',
  setback: 'M17.41 12.17L14.24 9L12.83 10.41L17.41 15L22 10.41L20.58 9M10 13V5C10 3.34 8.66 2 7 2S4 3.34 4 5V13C1.79 14.66 1.34 17.79 3 20S7.79 22.66 10 21 12.66 16.21 11 14C10.72 13.62 10.38 13.28 10 13M7 4C7.55 4 8 4.45 8 5V8H6V5C6 4.45 6.45 4 7 4Z',
  stats: 'M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17M19 19H5V5H19V19.1M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z',
  timer: 'M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M11,14H13V8H11M15,1H9V3H15V1Z',
  gauge: 'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12C20,14.4 19,16.5 17.3,18C15.9,16.7 14,16 12,16C10,16 8.2,16.7 6.7,18C5,16.5 4,14.4 4,12A8,8 0 0,1 12,4M14,5.89C13.62,5.9 13.26,6.15 13.1,6.54L11.81,9.77L11.71,10C11,10.13 10.41,10.6 10.14,11.26C9.73,12.29 10.23,13.45 11.26,13.86C12.29,14.27 13.45,13.77 13.86,12.74C14.12,12.08 14,11.32 13.57,10.76L13.67,10.5L14.96,7.29L14.97,7.26C15.17,6.75 14.92,6.17 14.41,5.96C14.28,5.91 14.15,5.89 14,5.89M10,6A1,1 0 0,0 9,7A1,1 0 0,0 10,8A1,1 0 0,0 11,7A1,1 0 0,0 10,6M7,9A1,1 0 0,0 6,10A1,1 0 0,0 7,11A1,1 0 0,0 8,10A1,1 0 0,0 7,9M17,9A1,1 0 0,0 16,10A1,1 0 0,0 17,11A1,1 0 0,0 18,10A1,1 0 0,0 17,9Z',
  help: 'M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z',
  curve: 'M4 19V20H22V22H2V2H4V17C7 17 10 15 12.1 11.4C15.1 6.4 18.4 4 22 4V6C19.2 6 16.5 8.1 13.9 12.5C11.3 16.6 7.7 19 4 19Z',
  shift: 'M10,8H6L12,2L18,8H14V16H18L12,22L6,16H10V8Z',
  roomf: 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z',
  dayt: 'M10 2L7.6 5.4C8.4 5.2 9.2 5 10 5S11.6 5.2 12.4 5.4L10 2M21 13.8V7C21 5.9 20.1 5 19 5S17 5.9 17 7V13.8C16.4 14.4 16 15.2 16 16C16 17.7 17.3 19 19 19S22 17.7 22 16C22 15.1 21.6 14.3 21 13.8M20 8H18V7C18 6.4 18.4 6 19 6S20 6.4 20 7V8M5.5 6.7L1.3 7L3.1 10.8C3.2 10 3.5 9.2 3.9 8.5C4.4 7.8 4.9 7.2 5.5 6.7M10 7C7.2 7 5 9.2 5 12S7.2 17 10 17 15 14.8 15 12 12.8 7 10 7M10 15C8.3 15 7 13.7 7 12S8.3 9 10 9 13 10.3 13 12 11.7 15 10 15M3.2 13.2L1.4 17L5.5 17.4C5 16.9 4.4 16.2 4 15.5C3.5 14.8 3.3 14 3.2 13.2M7.6 18.6L10 22L12.4 18.6C11.6 18.8 10.8 19 10 19C9.1 19 8.3 18.8 7.6 18.6Z',
  night: 'M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z',
  coolant: 'M11.5,1A1.5,1.5 0 0,0 10,2.5V14.5C9.37,14.97 9,15.71 9,16.5A2.5,2.5 0 0,0 11.5,19A2.5,2.5 0 0,0 14,16.5C14,15.71 13.63,15 13,14.5V13H17V11H13V9H17V7H13V5H17V3H13V2.5A1.5,1.5 0 0,0 11.5,1M0,15V17C0.67,17 0.79,17.21 1.29,17.71C1.79,18.21 2.67,19 4,19C5.33,19 6.21,18.21 6.71,17.71C6.82,17.59 6.91,17.5 7,17.41V15.16C6.21,15.42 5.65,15.93 5.29,16.29C4.79,16.79 4.67,17 4,17C3.33,17 3.21,16.79 2.71,16.29C2.21,15.79 1.33,15 0,15M16,15V17C16.67,17 16.79,17.21 17.29,17.71C17.79,18.21 18.67,19 20,19C21.33,19 22.21,18.21 22.71,17.71C23.21,17.21 23.33,17 24,17V15C22.67,15 21.79,15.79 21.29,16.29C20.79,16.79 20.67,17 20,17C19.33,17 19.21,16.79 18.71,16.29C18.21,15.79 17.33,15 16,15M8,20C6.67,20 5.79,20.79 5.29,21.29C4.79,21.79 4.67,22 4,22C3.33,22 3.21,21.79 2.71,21.29C2.35,20.93 1.79,20.42 1,20.16V22.41C1.09,22.5 1.18,22.59 1.29,22.71C1.79,23.21 2.67,24 4,24C5.33,24 6.21,23.21 6.71,22.71C7.21,22.21 7.33,22 8,22C8.67,22 8.79,22.21 9.29,22.71C9.73,23.14 10.44,23.8 11.5,23.96C11.66,24 11.83,24 12,24C13.33,24 14.21,23.21 14.71,22.71C15.21,22.21 15.33,22 16,22C16.67,22 16.79,22.21 17.29,22.71C17.79,23.21 18.67,24 20,24C21.33,24 22.21,23.21 22.71,22.71C22.82,22.59 22.91,22.5 23,22.41V20.16C22.21,20.42 21.65,20.93 21.29,21.29C20.79,21.79 20.67,22 20,22C19.33,22 19.21,21.79 18.71,21.29C18.21,20.79 17.33,20 16,20C14.67,20 13.79,20.79 13.29,21.29C12.79,21.79 12.67,22 12,22C11.78,22 11.63,21.97 11.5,21.92C11.22,21.82 11.05,21.63 10.71,21.29C10.21,20.79 9.33,20 8,20Z',
  sand: 'M6,2H18V8H18V8L14,12L18,16V16H18V22H6V16H6V16L10,12L6,8V8H6V2M16,16.5L12,12.5L8,16.5V20H16V16.5M12,11.5L16,7.5V4H8V7.5L12,11.5M10,6H14V6.75L12,8.75L10,6.75V6Z',
  dhw: 'M16.95,16.95L14.83,14.83C15.55,14.1 16,13.1 16,12C16,11.26 15.79,10.57 15.43,10L17.6,7.81C18.5,9 19,10.43 19,12C19,13.93 18.22,15.68 16.95,16.95M12,5C13.57,5 15,5.5 16.19,6.4L14,8.56C13.43,8.21 12.74,8 12,8A4,4 0 0,0 8,12C8,13.1 8.45,14.1 9.17,14.83L7.05,16.95C5.78,15.68 5,13.93 5,12A7,7 0 0,1 12,5M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,6.47 17.5,2 12,2Z',
  wNight: 'M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z',
  wCloudy: 'M6,19A5,5 0 0,1 1,14A5,5 0 0,1 6,9C7,6.65 9.3,5 12,5C15.43,5 18.24,7.66 18.5,11.03L19,11A4,4 0 0,1 23,15A4,4 0 0,1 19,19H6M19,13H17V12A5,5 0 0,0 12,7C9.5,7 7.45,8.82 7.06,11.19C6.73,11.07 6.37,11 6,11A3,3 0 0,0 3,14A3,3 0 0,0 6,17H19A2,2 0 0,0 21,15A2,2 0 0,0 19,13Z',
  wFog: 'M3,15H13A1,1 0 0,1 14,16A1,1 0 0,1 13,17H3A1,1 0 0,1 2,16A1,1 0 0,1 3,15M16,15H21A1,1 0 0,1 22,16A1,1 0 0,1 21,17H16A1,1 0 0,1 15,16A1,1 0 0,1 16,15M1,12A5,5 0 0,1 6,7C7,4.65 9.3,3 12,3C15.43,3 18.24,5.66 18.5,9.03L19,9C21.19,9 22.97,10.76 23,13H21A2,2 0 0,0 19,11H17V10A5,5 0 0,0 12,5C9.5,5 7.45,6.82 7.06,9.19C6.73,9.07 6.37,9 6,9A3,3 0 0,0 3,12C3,12.35 3.06,12.69 3.17,13H1.1L1,12M3,19H5A1,1 0 0,1 6,20A1,1 0 0,1 5,21H3A1,1 0 0,1 2,20A1,1 0 0,1 3,19M8,19H21A1,1 0 0,1 22,20A1,1 0 0,1 21,21H8A1,1 0 0,1 7,20A1,1 0 0,1 8,19Z',
  wHail: 'M6,14A1,1 0 0,1 7,15A1,1 0 0,1 6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14M10,18A2,2 0 0,1 12,20A2,2 0 0,1 10,22A2,2 0 0,1 8,20A2,2 0 0,1 10,18M14.5,16A1.5,1.5 0 0,1 16,17.5A1.5,1.5 0 0,1 14.5,19A1.5,1.5 0 0,1 13,17.5A1.5,1.5 0 0,1 14.5,16M10.5,12A1.5,1.5 0 0,1 12,13.5A1.5,1.5 0 0,1 10.5,15A1.5,1.5 0 0,1 9,13.5A1.5,1.5 0 0,1 10.5,12Z',
  wLight: 'M6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14H7A1,1 0 0,1 8,15A1,1 0 0,1 7,16H6M12,11H15L13,15H15L11.25,22L12,17H9.5L12,11Z',
  wLightRain: 'M4.5,13.59C5,13.87 5.14,14.5 4.87,14.96C4.59,15.44 4,15.6 3.5,15.33V15.33C2,14.47 1,12.85 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16A1,1 0 0,1 18,15A1,1 0 0,1 19,14A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,12.11 3.6,13.08 4.5,13.6V13.59M9.5,11H12.5L10.5,15H12.5L8.75,22L9.5,17H7L9.5,11M17.5,18.67C17.5,19.96 16.5,21 15.25,21C14,21 13,19.96 13,18.67C13,17.12 15.25,14.5 15.25,14.5C15.25,14.5 17.5,17.12 17.5,18.67Z',
  wPartly: 'M12.74,5.47C15.1,6.5 16.35,9.03 15.92,11.46C17.19,12.56 18,14.19 18,16V16.17C18.31,16.06 18.65,16 19,16A3,3 0 0,1 22,19A3,3 0 0,1 19,22H6A4,4 0 0,1 2,18A4,4 0 0,1 6,14H6.27C5,12.45 4.6,10.24 5.5,8.26C6.72,5.5 9.97,4.24 12.74,5.47M11.93,7.3C10.16,6.5 8.09,7.31 7.31,9.07C6.85,10.09 6.93,11.22 7.41,12.13C8.5,10.83 10.16,10 12,10C12.7,10 13.38,10.12 14,10.34C13.94,9.06 13.18,7.86 11.93,7.3M13.55,3.64C13,3.4 12.45,3.23 11.88,3.12L14.37,1.82L15.27,4.71C14.76,4.29 14.19,3.93 13.55,3.64M6.09,4.44C5.6,4.79 5.17,5.19 4.8,5.63L4.91,2.82L7.87,3.5C7.25,3.71 6.65,4.03 6.09,4.44M18,9.71C17.91,9.12 17.78,8.55 17.59,8L19.97,9.5L17.92,11.73C18.03,11.08 18.05,10.4 18,9.71M3.04,11.3C3.11,11.9 3.24,12.47 3.43,13L1.06,11.5L3.1,9.28C3,9.93 2.97,10.61 3.04,11.3M19,18H16V16A4,4 0 0,0 12,12A4,4 0 0,0 8,16H6A2,2 0 0,0 4,18A2,2 0 0,0 6,20H19A1,1 0 0,0 20,19A1,1 0 0,0 19,18Z',
  wPour: 'M9,12C9.53,12.14 9.85,12.69 9.71,13.22L8.41,18.05C8.27,18.59 7.72,18.9 7.19,18.76C6.65,18.62 6.34,18.07 6.5,17.54L7.78,12.71C7.92,12.17 8.47,11.86 9,12M13,12C13.53,12.14 13.85,12.69 13.71,13.22L11.64,20.95C11.5,21.5 10.95,21.8 10.41,21.66C9.88,21.5 9.56,20.97 9.7,20.43L11.78,12.71C11.92,12.17 12.47,11.86 13,12M17,12C17.53,12.14 17.85,12.69 17.71,13.22L16.41,18.05C16.27,18.59 15.72,18.9 15.19,18.76C14.65,18.62 14.34,18.07 14.5,17.54L15.78,12.71C15.92,12.17 16.47,11.86 17,12M17,10V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,12.11 3.6,13.08 4.5,13.6V13.59C5,13.87 5.14,14.5 4.87,14.96C4.59,15.43 4,15.6 3.5,15.32V15.33C2,14.47 1,12.85 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12C23,13.5 22.2,14.77 21,15.46V15.46C20.5,15.73 19.91,15.57 19.63,15.09C19.36,14.61 19.5,14 20,13.72V13.73C20.6,13.39 21,12.74 21,12A2,2 0 0,0 19,10H17Z',
  wRain: 'M6,14.03A1,1 0 0,1 7,15.03C7,15.58 6.55,16.03 6,16.03C3.24,16.03 1,13.79 1,11.03C1,8.27 3.24,6.03 6,6.03C7,3.68 9.3,2.03 12,2.03C15.43,2.03 18.24,4.69 18.5,8.06L19,8.03A4,4 0 0,1 23,12.03C23,14.23 21.21,16.03 19,16.03H18C17.45,16.03 17,15.58 17,15.03C17,14.47 17.45,14.03 18,14.03H19A2,2 0 0,0 21,12.03A2,2 0 0,0 19,10.03H17V9.03C17,6.27 14.76,4.03 12,4.03C9.5,4.03 7.45,5.84 7.06,8.21C6.73,8.09 6.37,8.03 6,8.03A3,3 0 0,0 3,11.03A3,3 0 0,0 6,14.03M12,14.15C12.18,14.39 12.37,14.66 12.56,14.94C13,15.56 14,17.03 14,18C14,19.11 13.1,20 12,20A2,2 0 0,1 10,18C10,17.03 11,15.56 11.44,14.94C11.63,14.66 11.82,14.4 12,14.15M12,11.03L11.5,11.59C11.5,11.59 10.65,12.55 9.79,13.81C8.93,15.06 8,16.56 8,18A4,4 0 0,0 12,22A4,4 0 0,0 16,18C16,16.56 15.07,15.06 14.21,13.81C13.35,12.55 12.5,11.59 12.5,11.59',
  wSnow: 'M6,14A1,1 0 0,1 7,15A1,1 0 0,1 6,16A5,5 0 0,1 1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16H18A1,1 0 0,1 17,15A1,1 0 0,1 18,14H19A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11A3,3 0 0,0 6,14M7.88,18.07L10.07,17.5L8.46,15.88C8.07,15.5 8.07,14.86 8.46,14.46C8.85,14.07 9.5,14.07 9.88,14.46L11.5,16.07L12.07,13.88C12.21,13.34 12.76,13.03 13.29,13.17C13.83,13.31 14.14,13.86 14,14.4L13.41,16.59L15.6,16C16.14,15.86 16.69,16.17 16.83,16.71C16.97,17.24 16.66,17.79 16.12,17.93L13.93,18.5L15.54,20.12C15.93,20.5 15.93,21.15 15.54,21.54C15.15,21.93 14.5,21.93 14.12,21.54L12.5,19.93L11.93,22.12C11.79,22.66 11.24,22.97 10.71,22.83C10.17,22.69 9.86,22.14 10,21.6L10.59,19.41L8.4,20C7.86,20.14 7.31,19.83 7.17,19.29C7.03,18.76 7.34,18.21 7.88,18.07Z',
  wSnowRain: 'M18.5,18.67C18.5,19.96 17.5,21 16.25,21C15,21 14,19.96 14,18.67C14,17.12 16.25,14.5 16.25,14.5C16.25,14.5 18.5,17.12 18.5,18.67M4,17.36C3.86,16.82 4.18,16.25 4.73,16.11L7,15.5L5.33,13.86C4.93,13.46 4.93,12.81 5.33,12.4C5.73,12 6.4,12 6.79,12.4L8.45,14.05L9.04,11.8C9.18,11.24 9.75,10.92 10.29,11.07C10.85,11.21 11.17,11.78 11,12.33L10.42,14.58L12.67,14C13.22,13.83 13.79,14.15 13.93,14.71C14.08,15.25 13.76,15.82 13.2,15.96L10.95,16.55L12.6,18.21C13,18.6 13,19.27 12.6,19.67C12.2,20.07 11.54,20.07 11.15,19.67L9.5,18L8.89,20.27C8.75,20.83 8.18,21.14 7.64,21C7.08,20.86 6.77,20.29 6.91,19.74L7.5,17.5L5.26,18.09C4.71,18.23 4.14,17.92 4,17.36M1,11A5,5 0 0,1 6,6C7,3.65 9.3,2 12,2C15.43,2 18.24,4.66 18.5,8.03L19,8A4,4 0 0,1 23,12A4,4 0 0,1 19,16A1,1 0 0,1 18,15A1,1 0 0,1 19,14A2,2 0 0,0 21,12A2,2 0 0,0 19,10H17V9A5,5 0 0,0 12,4C9.5,4 7.45,5.82 7.06,8.19C6.73,8.07 6.37,8 6,8A3,3 0 0,0 3,11C3,11.85 3.35,12.61 3.91,13.16C4.27,13.55 4.26,14.16 3.88,14.54C3.5,14.93 2.85,14.93 2.47,14.54C1.56,13.63 1,12.38 1,11Z',
  wSun: 'M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,2L14.39,5.42C13.65,5.15 12.84,5 12,5C11.16,5 10.35,5.15 9.61,5.42L12,2M3.34,7L7.5,6.65C6.9,7.16 6.36,7.78 5.94,8.5C5.5,9.24 5.25,10 5.11,10.79L3.34,7M3.36,17L5.12,13.23C5.26,14 5.53,14.78 5.95,15.5C6.37,16.24 6.91,16.86 7.5,17.37L3.36,17M20.65,7L18.88,10.79C18.74,10 18.47,9.23 18.05,8.5C17.63,7.78 17.1,7.15 16.5,6.64L20.65,7M20.64,17L16.5,17.36C17.09,16.85 17.62,16.22 18.04,15.5C18.46,14.77 18.73,14 18.87,13.21L20.64,17M12,22L9.59,18.56C10.33,18.83 11.14,19 12,19C12.82,19 13.63,18.83 14.37,18.56L12,22Z',
  wWind: 'M4,10A1,1 0 0,1 3,9A1,1 0 0,1 4,8H12A2,2 0 0,0 14,6A2,2 0 0,0 12,4C11.45,4 10.95,4.22 10.59,4.59C10.2,5 9.56,5 9.17,4.59C8.78,4.2 8.78,3.56 9.17,3.17C9.9,2.45 10.9,2 12,2A4,4 0 0,1 16,6A4,4 0 0,1 12,10H4M19,12A1,1 0 0,0 20,11A1,1 0 0,0 19,10C18.72,10 18.47,10.11 18.29,10.29C17.9,10.68 17.27,10.68 16.88,10.29C16.5,9.9 16.5,9.27 16.88,8.88C17.42,8.34 18.17,8 19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14H5A1,1 0 0,1 4,13A1,1 0 0,1 5,12H19M18,18H4A1,1 0 0,1 3,17A1,1 0 0,1 4,16H18A3,3 0 0,1 21,19A3,3 0 0,1 18,22C17.17,22 16.42,21.66 15.88,21.12C15.5,20.73 15.5,20.1 15.88,19.71C16.27,19.32 16.9,19.32 17.29,19.71C17.47,19.89 17.72,20 18,20A1,1 0 0,0 19,19A1,1 0 0,0 18,18Z',
  wAlert: 'M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z',
};



// ---------- 8. styles ----------
// Theme variables come from Home Assistant when they exist, with fallbacks so the card also runs on its own.
// Controls follow the plan card: grey fills, black when selected (white in dark mode), a black time pill.
const STYLE = `
:host {
  display: block;
  --hp-text: var(--primary-text-color, #1d1f23);
  --hp-sub: var(--secondary-text-color, #646a73);
  --hp-line: var(--divider-color, rgba(0, 0, 0, 0.12));
  --hp-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --hp-link: var(--primary-color, #03a9f4);
  --hp-grid: rgba(0, 0, 0, 0.065);
  --hp-ctl: rgba(118, 124, 134, 0.12);
  --hp-ctl-h: rgba(118, 124, 134, 0.22);
  --hp-sel: #1d1f23;
  --hp-sel-ink: #fff;
  --hp-room: #6f56c9;
  --hp-sun-day: #ffe39a;
  --hp-sun-night: #eceef3;
  --hp-sun-ink: #6d5300;
  --hp-future: rgba(118, 124, 134, 0.07);
  --hp-hatch: rgba(118, 124, 134, 0.2);
  --hp-hw-ink: #9a5f00;
  --hp-sat-ink: #17845a;
  --hp-shadow: 0 8px 28px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.1);
  --hp-halo: 0 0 2px var(--hp-bg), 0 0 2px var(--hp-bg), 0 0 4px var(--hp-bg);
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif));
  -webkit-tap-highlight-color: transparent;
}
:host([dark]) {
  --hp-grid: rgba(255, 255, 255, 0.075);
  --hp-ctl: rgba(255, 255, 255, 0.09);
  --hp-ctl-h: rgba(255, 255, 255, 0.16);
  --hp-sel: #f1f2f4;
  --hp-sel-ink: #16181c;
  --hp-room: #ab98ff;
  --hp-sun-day: #5e5020;
  --hp-sun-night: #262a32;
  --hp-sun-ink: #ffe7a0;
  --hp-future: rgba(255, 255, 255, 0.045);
  --hp-hatch: rgba(255, 255, 255, 0.13);
  --hp-hw-ink: #f7c35f;
  --hp-sat-ink: #5fd6a2;
  --hp-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
ha-card { display: block; }
.wrap { position: relative; padding: 14px 14px 12px; color: var(--hp-text); }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
button:disabled { opacity: 0.32; cursor: default; }
button svg { flex: none; }
button:focus-visible, .hit:focus-visible { outline: 2px solid var(--hp-link); outline-offset: 2px; }
.link { display: inline-flex; align-items: center; gap: 2px; padding: 4px 0; color: var(--hp-link); font-size: 13px; font-weight: 500; }

/* now */
.now { display: flex; align-items: center; gap: 12px; min-height: 52px; }
.badge { position: relative; flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; color: var(--c); }
.badge::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--c); opacity: 0.17; }
.badge svg { position: relative; }
.nt { flex: 1; min-width: 0; }
.n1 { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 6px; font-size: 16px; line-height: 21px; }
.n1 b { font-weight: 600; }
.since { font-size: 12.5px; color: var(--hp-sub); }
.n2 { margin-top: 2px; font-size: 12.5px; line-height: 17px; color: var(--hp-sub); }
.big { flex: none; display: flex; flex-direction: column; align-items: flex-end; padding: 5px 11px 6px; border-radius: 14px; background: var(--hp-ctl); text-align: right; }
.big .bv { font-size: 24px; font-weight: 600; line-height: 28px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.big .bv small { margin-right: 5px; font-size: 12px; font-weight: 500; letter-spacing: 0; color: var(--hp-sub); }
.big .bs { display: flex; align-items: center; gap: 5px; font-size: 12px; line-height: 15px; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.big .bs i { width: 12px; height: 3px; border-radius: 2px; }

/* time bar */
.tb { position: relative; display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.tt { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; text-align: left; border-radius: 8px; }
.t1 { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 600; line-height: 22px; }
.t1::after { content: ''; display: inline-block; margin: 0 0 3px 6px; vertical-align: middle; border: 4.5px solid transparent; border-top: 5px solid var(--hp-sub); border-bottom: 0; }
.t2 { display: flex; align-items: center; gap: 6px; font-size: 12.5px; line-height: 17px; color: var(--hp-sub); }
.ld { width: 7px; height: 7px; border-radius: 50%; background: #2fb67c; box-shadow: 0 0 0 3px rgba(47, 182, 124, 0.22); }
.nowchip { flex: none; display: inline-flex; align-items: center; height: 32px; padding: 0 6px 0 12px; border-radius: 16px; background: var(--hp-sel); color: var(--hp-sel-ink); font-size: 13px; font-weight: 600; }
.pager { flex: none; display: flex; gap: 6px; }
.pb { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--hp-ctl); }
.pb:not(:disabled):active, .ctl:active, .tg:active { background: var(--hp-ctl-h); }
.menu { position: absolute; z-index: 6; top: calc(100% + 4px); left: -4px; width: 244px; padding: 6px; border-radius: 14px; border: 1px solid var(--hp-line); background: var(--hp-bg); box-shadow: var(--hp-shadow); }
.mi { display: flex; align-items: center; gap: 12px; width: 100%; height: 40px; padding: 0 10px; border-radius: 9px; font-size: 14px; text-align: left; }
.mi svg { color: var(--hp-sub); }
.mi:hover { background: var(--hp-ctl); }
.cal { margin-top: 4px; padding: 8px 2px 2px; border-top: 1px solid var(--hp-line); }
.cal .cm { padding: 0 6px 6px; font-size: 12px; font-weight: 600; color: var(--hp-sub); }
.cal .cg { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal .cw { padding-bottom: 2px; text-align: center; font-size: 10.5px; color: var(--hp-sub); }
.cal button { height: 30px; border-radius: 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
.cal button.today { box-shadow: inset 0 0 0 1.5px var(--hp-text); font-weight: 600; }
.cal button.sel { background: var(--hp-sel); color: var(--hp-sel-ink); }
.cal button:not(:disabled):not(.sel):hover { background: var(--hp-ctl); }

/* zoom */
.zoom { display: flex; gap: 2px; margin: 8px 0 4px; padding: 3px; border-radius: 12px; background: var(--hp-ctl); }
.zoom button { flex: 1; height: 30px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.zoom button[aria-pressed="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }

/* the chart */
.stage { position: relative; margin-top: 6px; -webkit-user-select: none; user-select: none; touch-action: pan-y; }
.chart, .cursor { position: absolute; left: 0; top: 0; width: 100%; overflow: visible; }
.cursor { pointer-events: none; }
.labels, .heads { position: absolute; inset: 0; pointer-events: none; }
.labels > span { position: absolute; white-space: nowrap; font-size: 10.5px; line-height: 13px; }
.hit { position: absolute; left: 0; right: 0; touch-action: pan-y; cursor: crosshair; outline: none; }
.sun-night { fill: var(--hp-sun-night); }
.sun-day { fill: var(--hp-sun-day); }
.labels > .sunl { line-height: 20px; font-weight: 600; color: var(--hp-sun-ink); font-variant-numeric: tabular-nums; }
.sunl.r { transform: translateX(-100%); }
.labels > .moon { transform: translateX(-50%); color: var(--hp-sub); opacity: 0.55; line-height: 0; }
.labels > .tk { transform: translateX(-50%); line-height: 16px; font-size: 11px; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.labels > .tk.day { font-weight: 600; color: var(--hp-text); }
.altday { fill: rgba(118, 124, 134, 0.05); }
.future, .nohist { fill: var(--hp-future); }
.nowline { stroke: #2fb67c; stroke-width: 1.5; stroke-dasharray: 2 3; }
.grid { stroke: var(--hp-grid); stroke-width: 1; shape-rendering: crispEdges; }
.dayline { stroke: var(--hp-line); stroke-width: 1; shape-rendering: crispEdges; }
.labels > .dayl { font-weight: 600; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.hatchbg { fill: var(--hp-future); }
.hatchfg { fill: var(--hp-hatch); }
.labels > .veil { transform: translate(-50%, -50%); padding: 2px 9px; border-radius: 10px; background: var(--hp-bg); font-size: 11.5px; line-height: 16px; color: var(--hp-sub); }
.labels > .yl { left: 0; color: var(--hp-sub); font-variant-numeric: tabular-nums; text-shadow: var(--hp-halo); }
.hwband { fill: rgba(245, 165, 36, 0.14); }
.labels > .bandl { font-weight: 600; color: var(--hp-hw-ink); text-shadow: var(--hp-halo); }
.labels > .peak { transform: translateX(-50%); padding: 0 5px; border-radius: 8px; background: rgba(245, 165, 36, 0.24); font-weight: 700; line-height: 15px; color: var(--hp-hw-ink); }
.ln { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.ln.flow { stroke: #4269d0; stroke-width: 2; }
.ln.ret { stroke: #8fa6e6; stroke-width: 1.4; }
.ln.tgt { stroke-width: 1.6; }
.ln.tgt.hw { stroke-dasharray: 4 3; }
.ln.tgt.off { stroke-dasharray: 2 3; }
.dot { stroke: var(--hp-bg); stroke-width: 1.5; }
.satbar { fill: #2fb67c; }
.labels > .satl { font-size: 10px; font-weight: 600; line-height: 12px; color: var(--hp-sat-ink); text-shadow: var(--hp-halo); }
.planarea { fill: rgba(255, 114, 92, 0.12); }
.ln.plan { stroke: #ff725c; stroke-width: 1.25; }
.ln.ref { stroke: var(--hp-sub); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.55; }
.labels > .refl { right: 0; font-size: 10px; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.roomarea { fill: var(--hp-room); fill-opacity: 0.1; }
.ln.room { stroke: var(--hp-room); stroke-width: 1.75; }
.labels > .ml { font-weight: 600; color: var(--hp-text); text-shadow: var(--hp-halo); font-variant-numeric: tabular-nums; }
.ml.r { transform: translateX(-100%); }
.track { fill: var(--hp-ctl); }
.labels > .lanel { transform: translateX(-50%); font-weight: 600; line-height: 18px; }
.labels > .lanescale { left: 2px; font-size: 9.5px; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.cross { stroke: var(--hp-text); stroke-width: 1; opacity: 0.5; }

/* block headings */
.bh { position: absolute; left: 0; right: 0; height: 18px; display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap; font-size: 12px; line-height: 18px; }
.bn { flex: none; font-weight: 600; }
.bh .bv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--hp-sub); }
.bh .bv b { color: var(--hp-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.k { display: inline-block; width: 10px; height: 3px; margin: 0 4px 2px 0; border-radius: 2px; background: var(--c); vertical-align: middle; }
.k.dash { background: repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 5px); }
.k.blk { width: 9px; height: 9px; margin-bottom: 1px; border-radius: 3px; }
.cnt { flex: none; display: inline-flex; align-items: center; gap: 2px; color: #0f9ad9; font-weight: 600; font-variant-numeric: tabular-nums; }

/* marks, the time pill, the overlays */
.marks { position: absolute; left: 0; right: 0; top: 0; height: 0; }
.mk { position: absolute; z-index: 2; width: 28px; height: 28px; margin: -14px 0 0 -14px; display: grid; place-items: center; isolation: isolate; font-size: 9.5px; font-weight: 700; color: var(--hp-sel-ink); }
.mk::before { content: ''; position: absolute; z-index: -1; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 2px; transform: rotate(45deg); background: var(--hp-sub); }
.mk.n::before { width: 14px; height: 14px; margin: -7px 0 0 -7px; background: var(--hp-text); }
.pill { position: absolute; z-index: 3; display: flex; align-items: center; height: 22px; padding: 0 2px 0 9px; border-radius: 11px; background: var(--hp-sel); color: var(--hp-sel-ink); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22); font-size: 12px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; touch-action: none; cursor: ew-resize; }
.pill::before { content: ''; position: absolute; inset: -9px -2px; }
.px { position: relative; width: 20px; height: 20px; margin-left: 3px; display: grid; place-items: center; border-radius: 50%; opacity: 0.75; }
.glance { position: absolute; z-index: 3; left: 50%; top: 48px; transform: translateX(-50%); padding: 6px 12px; border-radius: 14px; background: var(--hp-sel); color: var(--hp-sel-ink); font-size: 13px; font-weight: 600; white-space: nowrap; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.glance.on { opacity: 0.92; transition: none; }
.hint { position: absolute; z-index: 3; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 16px); display: flex; align-items: center; gap: 10px; padding: 7px 7px 7px 14px; border-radius: 14px; background: var(--hp-sel); color: var(--hp-sel-ink); box-shadow: var(--hp-shadow); font-size: 13px; line-height: 17px; }
.hint .link { flex: none; padding: 5px 10px; border-radius: 9px; background: rgba(127, 127, 127, 0.28); color: inherit; font-weight: 600; }
.tip { position: absolute; z-index: 4; min-width: 160px; max-width: 270px; padding: 10px 12px 8px; border: 1px solid var(--hp-line); border-radius: 12px; background: var(--hp-bg); box-shadow: var(--hp-shadow); font-size: 12.5px; line-height: 18px; }
.th { display: flex; align-items: center; gap: 7px; margin-bottom: 2px; font-size: 13.5px; }
.th i { width: 10px; height: 10px; border-radius: 3px; }
.tr { color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.tr b { color: var(--hp-text); font-weight: 600; }
.tr.dim { margin-top: 4px; font-size: 11.5px; }
.tr .from { color: var(--hp-sub); }
.tr span:first-child { color: var(--hp-text); }

/* the day row: tap a day; the shaded part (and the thumb on the rail under it) is what's on screen */
.dayrow { display: flex; align-items: stretch; gap: 2px; margin-top: 10px; padding-bottom: 12px; }
.drn { flex: none; width: 24px; display: grid; place-items: center; border-radius: 8px; color: var(--hp-sub); }
.drc { position: relative; flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); touch-action: pan-y; }
.drc::after { content: ''; position: absolute; left: 0; right: 0; bottom: -9px; height: 4px; border-radius: 2px; background: var(--hp-ctl); }
.dc { display: flex; flex-direction: column; align-items: center; padding: 5px 0 4px; border-radius: 10px; font-variant-numeric: tabular-nums; }
.dc .dw { font-size: 11px; line-height: 14px; color: var(--hp-sub); }
.dc .dd { font-size: 15px; font-weight: 600; line-height: 20px; }
.dc .dk { display: flex; align-items: flex-end; height: 12px; margin-top: 1px; }
.dc .dk i { width: 6px; border-radius: 2px 2px 0 0; background: #7d8bb0; }
.dc .dv { min-height: 13px; font-size: 10px; line-height: 13px; color: var(--hp-sub); }
.dc.today .dw { color: var(--hp-text); font-weight: 600; }
.dc.sel { background: var(--hp-sel); color: var(--hp-sel-ink); }
.dc.sel .dw, .dc.sel .dv { color: inherit; opacity: 0.8; }
.dc.sel .dk i { background: currentColor; opacity: 0.7; }
.dc.empty .dd { opacity: 0.4; }
.box { position: absolute; z-index: 1; top: 0; bottom: 0; border-radius: 10px; background: rgba(118, 124, 134, 0.16); cursor: grab; touch-action: none; }
.box.whole { background: transparent; }
.box::after { content: ''; position: absolute; left: 0; right: 0; bottom: -9px; height: 4px; border-radius: 2px; background: var(--hp-text); }
.box .h { position: absolute; bottom: -17px; width: 22px; height: 20px; cursor: ew-resize; }
.box .h.l { left: -11px; }
.box .h.r { right: -11px; }
.box .h::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border: 2px solid var(--hp-bg); border-radius: 50%; background: var(--hp-text); }
.off { position: absolute; bottom: -15px; font-size: 13px; font-weight: 700; line-height: 16px; pointer-events: none; }
.off.l { left: -10px; }
.off.r { right: -10px; }

/* worth a look, the summary */
.worth:empty, .summary:empty { display: none; }
.warn { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 7px 10px 7px 12px; border-radius: 12px; background: rgba(245, 165, 36, 0.13); font-size: 13px; line-height: 18px; }
.warn > svg { color: #d48806; }
.warn > span { flex: 1; min-width: 0; }
.warn .link { flex: none; }
.summary { margin-top: 12px; }
.sh { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.st { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sc { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 14px; background: var(--hp-ctl); font-size: 12.5px; color: var(--hp-sub); white-space: nowrap; }
.sc b { color: var(--hp-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.sc i { width: 8px; height: 8px; border-radius: 50%; }
.stats { margin-top: 10px; }
.split { display: flex; gap: 1px; height: 10px; border-radius: 5px; overflow: hidden; }
.key { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: var(--hp-sub); }
.key i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; }
.key b { color: var(--hp-text); font-weight: 600; }
.sec { margin: 14px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hp-sub); }
.etab { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.etab th { padding: 0 0 4px; font-size: 11.5px; font-weight: 500; text-align: right; color: var(--hp-sub); }
.etab td { padding: 5px 0; border-top: 1px solid var(--hp-line); text-align: right; color: var(--hp-sub); }
.etab td.l { text-align: left; color: var(--hp-text); }
.etab td.l span { display: inline-flex; align-items: center; gap: 6px; }
.etab td.l svg { color: var(--hp-sub); }
.etab td.t b { color: var(--hp-text); font-weight: 600; }
.trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.cell { min-width: 0; padding: 8px 10px; border-radius: 12px; background: var(--hp-ctl); }
.cl { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--hp-sub); }
.cv { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cs { margin-top: 1px; font-size: 11px; line-height: 14px; color: var(--hp-sub); }

/* footer and panels */
.foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ctl { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px 0 12px; border-radius: 18px; background: var(--hp-ctl); font-size: 13px; font-weight: 500; }
.ctl.round { width: 36px; margin-left: auto; padding: 0; justify-content: center; }
.ctl[aria-expanded="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }
.ctl:not(.round)[aria-expanded="true"] svg:last-child { transform: rotate(180deg); }
.panel { margin-top: 10px; padding: 12px; border: 1px solid var(--hp-line); border-radius: 14px; }
.pg + .pg { margin-top: 14px; }
.ph { margin-bottom: 7px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hp-sub); }
.tgs { display: flex; flex-wrap: wrap; gap: 6px; }
.tg { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px 0 8px; border-radius: 16px; background: var(--hp-ctl); font-size: 13px; }
.tg.on { background: var(--hp-sel); color: var(--hp-sel-ink); }
.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--hp-ctl); }
.seg button { height: 30px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--hp-sub); }
.seg button[aria-pressed="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }
.keys { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; }
.ki { display: inline-flex; align-items: center; gap: 6px; }
.ki i { width: 16px; height: 3px; border-radius: 2px; }
.howto { display: grid; gap: 6px; font-size: 13px; line-height: 18px; color: var(--hp-sub); }
.howto b { color: var(--hp-text); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .glance { transition: none; } }
`;


// ---------- 7. the card ----------
const REDUCED = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

class HeatPumpHistoryCard extends HTMLElement {
  constructor() {
    super();
    this._uid = Math.random().toString(36).slice(2, 7);
    this._seen = {};
    this._store = {};
    this._days = {};
    this._ver = 0;
    this._rowWeeks = 0;   // the day row: 0 = the week ending today, 1 = the week before, ...
  }

  // ---------- Home Assistant plumbing ----------
  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    this._config = { hours: 12, ...config };
    const ent = { ...DEFAULT_ENTITIES };
    for (const [k, v] of Object.entries(config.entities || {})) ent[OLD_KEYS[k] || k] = v;
    this._ent = ent;
    this._scripts = { ...DEFAULT_SCRIPTS, ...(config.scripts || {}) };
    this._prefs = this._loadPrefs();
    const span = SPAN_LIST.includes(this._prefs.span) ? this._prefs.span : clamp((Number(this._config.hours) || 12) * HOUR, MIN_SPAN, MAX_SPAN);
    this._view = { kind: 'live', span };
    this._store = {}; this._from = null; this._oldest = null; this._ver++;
    if (this._hass && this._root) this._start();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._root) this._setup();
    if (!this._fmt || hass.locale !== this._locale) { this._locale = hass.locale; this._fmt = makeFmt(hass.locale); }
    let changed = false;
    for (const [k, id] of Object.entries(this._ent || {})) {
      const s = id && hass.states[id];
      if (s && s !== this._seen[k]) { this._seen[k] = s; changed = true; if (this._from != null) this._append(k, s); }
    }
    const dark = hass.themes && hass.themes.darkMode != null ? !!hass.themes.darkMode : this._darkGuess();
    if (dark !== this._dark) { this._dark = dark; this.toggleAttribute('dark', dark); }
    if (first) this._start();
    else if (changed && !this._drag) this._redraw();
  }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(false), 30000);
    this._onVis = () => {
      if (document.visibilityState === 'hidden') this._hiddenAt = Date.now();
      else this._tick(true);
    };
    document.addEventListener('visibilitychange', this._onVis);
    if (this._root && this._hass) this._redraw();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    document.removeEventListener('visibilitychange', this._onVis);
    this._stopAnim();
  }

  getCardSize() { return Math.ceil(((this._layout && this._layout.height) || 560) / 50) + 4; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }
  static getStubConfig() { return {}; }

  // the time now (the prototype page moves the clock to match its recorded data)
  _now() { return Date.now() + (this.clockOffset || 0); }

  _darkGuess() {
    const c = getComputedStyle(this).getPropertyValue('--card-background-color').trim();
    const m = c.match(/^#([0-9a-f]{6})$/i), r = c.match(/rgba?\(([^)]+)\)/);
    const rgb = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : r ? r[1].split(',').slice(0, 3).map(Number) : null;
    return rgb ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 110 : false;
  }

  _loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(`${STORE_PREFIX}prefs`) || '{}'); } catch (e) { /* private mode */ }
    const cfgGraphs = Array.isArray(this._config.graphs) ? this._config.graphs.filter(g => GRAPHS[g]) : null;
    const graphs = Array.isArray(p.graphs) ? p.graphs.filter(g => GRAPHS[g]) : cfgGraphs || CORE_GRAPHS.slice();
    return { span: p.span, graphs, lane: p.lane || this._config.lane || 'bar', ret: !!p.ret, changes: p.changes !== false,
      dhwFull: !!p.dhwFull, hintSeen: !!p.hintSeen, statsOpen: !!p.statsOpen };
  }

  _savePrefs() {
    try { localStorage.setItem(`${STORE_PREFIX}prefs`, JSON.stringify(this._prefs)); } catch (e) { /* private mode */ }
  }

  // every 30 s: the live view moves on; the last day is fetched again now and then in case anything was missed;
  // coming back after half an hour away goes back to now
  _tick(visible) {
    if (!this._hass) return;
    const now = this._now();
    if (visible && this._hiddenAt && Date.now() - this._hiddenAt > 30 * MIN && !windowOf(this._view, now).live) {
      this._view = liveOf(this._view); this._insp = null;
    }
    if (now - (this._fetchedAt || 0) > 30 * MIN) this._queue(Math.max(this._from ?? 0, now - 26 * HOUR), now);
    if (startOfDay(now) !== this._dayKey) { this._dayKey = startOfDay(now); this._fetchDays(); }
    if (!this._drag && windowOf(this._view, now).live) this._redraw();
  }

  // ---------- history ----------
  // Loads the last day first (so it draws straight away), then the rest of the week in the background.
  _start() {
    const now = this._now();
    this._dayKey = startOfDay(now);
    this._from = null; this._oldest = null;
    const span = spanOf(this._view, now);
    this._queue(now - Math.max(26 * HOUR, span + HOUR), now).then(() => this._prefetch());
    this._fetchDays();
    this._redraw();
  }

  _prefetch() {
    const now = this._now(), want = addDays(startOfDay(now), -7);
    if (this._from == null || this._from <= want || (this._oldest != null && this._from <= this._oldest)) return;
    this._queue(Math.max(want, this._from - 2 * DAY), this._from).then(() => this._prefetch());
  }

  // what's on screen (and a window before it, so moving back is instant) should be loaded
  _need(t0, span) {
    if (this._from == null) return;
    const now = this._now();
    let want = Math.max(t0 - (span || DAY), now - MAX_BACK);
    if (this._oldest != null) want = Math.max(want, this._oldest);
    if (want >= this._from - MIN || this._prepending) return;
    this._prepending = true;
    this._queue(Math.min(want, this._from - DAY), this._from).then(() => { this._prepending = false; this._redraw(); this._need(t0, span); });
  }

  _queue(a, b) {
    this._q = (this._q || Promise.resolve()).then(() => this._fetch(a, b));
    return this._q;
  }

  async _fetch(a, b) {
    if (!this._hass) return;
    const now = this._now();
    a = Math.max(a, now - MAX_BACK - DAY);
    if (b <= a) return;
    this._loading = true;
    try {
      const ids = [...new Set(Object.values(this._ent).filter(id => id && !id.startsWith('weather.')))];
      const res = await this._hass.callWS({
        type: 'history/history_during_period', start_time: new Date(a).toISOString(), end_time: new Date(b).toISOString(),
        entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      for (const [k, id] of Object.entries(this._ent)) {
        if (!id || id.startsWith('weather.')) continue;
        const got = (res[id] || []).map(e => [e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
          String(e.s != null ? e.s : e.state).trim()]).filter(p => Number.isFinite(p[0])).sort((p, q) => p[0] - q[0]);
        const old = this._store[k] || [];
        this._store[k] = old.filter(p => p[0] < a).concat(got, old.filter(p => p[0] > b));
      }
      // nothing recorded before this point: stop asking for older history
      const flow = res[this._ent.flow] || [];
      const firstT = flow.length ? (flow[0].lu != null ? flow[0].lu * 1000 : Date.parse(flow[0].last_changed || '')) : null;
      if (this._from != null && a < this._from && (!flow.length || firstT > a + HOUR)) this._oldest = flow.length ? firstT : this._from;
      this._from = this._from == null ? a : Math.min(this._from, a);
      this._error = null;
    } catch (err) {
      this._error = 'History isn’t available';
      console.warn('heat-pump-history-card: history', err);
    }
    this._ver++;
    this._fetchedAt = this._now();
    this._loading = false;
    this._redraw();
  }

  _append(k, s) {
    const list = this._store[k] || (this._store[k] = []);
    const t = Date.parse(s.last_changed || s.last_updated), v = String(s.state).trim();
    const last = list[list.length - 1];
    if (Number.isFinite(t) && (!last || (t > last[0] && v !== last[1]))) { list.push([t, v]); this._ver++; }
  }

  // kWh per day for the day row, from the meter's long-term statistics (weeks back, beyond the history)
  async _fetchDays() {
    const id = this._ent.meter;
    if (!id || !this._hass) return;
    const now = this._now(), start = addDays(startOfDay(now), -7 * (this._rowWeeks + 1) - 7);
    try {
      const res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(), statistic_ids: [id], period: 'day', types: ['change'] });
      for (const r of (res && res[id]) || []) {
        const t = typeof r.start === 'number' ? r.start : Date.parse(r.start);
        if (Number.isFinite(t) && r.change != null) this._days[startOfDay(t)] = { kwh: r.change };
      }
      this._redraw();
    } catch (e) { /* no statistics: the day row works kWh out from the history where it's loaded */ }
  }

  _series(now) {
    if (!this._S || this._sVer !== this._ver || now - this._sAt > 60000) {
      this._S = buildSeries(this._store, now);
      this._sVer = this._ver; this._sAt = now;
    }
    return this._S;
  }

  _sunFor(d0) {
    const c = this._sunCache || (this._sunCache = new Map());
    if (!c.has(d0)) { const h = this._hass.config || {}; c.set(d0, sunTimes(d0, h.latitude, h.longitude)); }
    return c.get(d0);
  }

  // ---------- structure (built once) ----------
  _setup() {
    const root = (this._root = this.attachShadow({ mode: 'open' }));
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card><div class="wrap">
        <div class="now"></div>
        <div class="tb">
          <button class="tt" data-act="dates" aria-haspopup="true" aria-expanded="false"><span class="t1"></span><span class="t2"></span></button>
          <button class="nowchip" data-act="now" hidden>Now${icon('right', 18)}</button>
          <div class="pager" role="group" aria-label="Move through time">
            <button class="pb" data-act="prev" aria-label="Earlier">${icon('left', 22)}</button>
            <button class="pb" data-act="next" aria-label="Later">${icon('right', 22)}</button>
          </div>
          <div class="menu dates" hidden></div>
        </div>
        <div class="zoom" role="group" aria-label="Zoom">${SPAN_LIST.map(s => `<button data-span="${s}" aria-pressed="false">${SPAN_NAME.get(s)}</button>`).join('')}</div>
        <div class="stage">
          <svg class="chart" aria-hidden="true"></svg>
          <div class="labels"></div>
          <div class="heads"></div>
          <svg class="cursor" aria-hidden="true"></svg>
          <div class="hit" tabindex="0" role="img"></div>
          <div class="marks"></div>
          <div class="pill" hidden><span class="pt"></span><button class="px" data-act="uninspect" aria-label="Stop inspecting">${icon('close', 14)}</button></div>
          <div class="glance" aria-hidden="true"></div>
          <div class="hint" hidden></div>
          <div class="tip" hidden></div>
        </div>
        <div class="dayrow"></div>
        <div class="worth"></div>
        <div class="summary"></div>
        <div class="foot">
          <button class="ctl" data-act="layers" aria-expanded="false">${icon('tune', 18)}<span>Graphs &amp; layers</span>${icon('chevron', 18)}</button>
          <button class="ctl round" data-act="help" aria-expanded="false" aria-label="Key and how to move around">${icon('help', 20)}</button>
        </div>
        <div class="panel" hidden></div>
      </div></ha-card>`;
    const $ = s => root.querySelector(s);
    this._el = { now: $('.now'), tt: $('.tt'), t1: $('.t1'), t2: $('.t2'), nowchip: $('.nowchip'), prev: $('[data-act="prev"]'),
      next: $('[data-act="next"]'), dates: $('.menu.dates'), zoom: $('.zoom'), stage: $('.stage'), chart: $('.chart'), labels: $('.labels'),
      heads: $('.heads'), cursor: $('.cursor'), hit: $('.hit'), marks: $('.marks'), pill: $('.pill'), pt: $('.pt'), glance: $('.glance'),
      hint: $('.hint'), tip: $('.tip'), dayrow: $('.dayrow'), worth: $('.worth'), summary: $('.summary'), panel: $('.panel'),
      layersBtn: $('[data-act="layers"]'), helpBtn: $('[data-act="help"]') };

    root.addEventListener('click', e => {
      const path = e.composedPath();
      const el = path.find(n => n.dataset && (n.dataset.act || n.dataset.span || n.dataset.day || n.dataset.entity || n.dataset.mark));
      if (this._datesOpen && !path.includes(this._el.dates) && !(el && el.dataset.act === 'dates')) { this._datesOpen = false; this._drawTimebar(this._m); }
      if (this._ignoreClick) { this._ignoreClick = false; return; }
      if (!el) { if (!path.includes(this._el.hit) && !path.includes(this._el.tip)) this._hideTip(); return; }
      const d = el.dataset;
      if (d.span) this._go(zoomView(this._view, Number(d.span), this._now(), this._insp));
      else if (d.day) { this._datesOpen = false; this._go(dayView(Number(d.day), this._now())); }
      else if (d.mark != null && d.mark !== '') this._showChange(Number(d.mark));
      else if (d.entity) this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: d.entity } }));
      else if (d.act) this._act(d.act, el);
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this._datesOpen = false; this._hideTip(); this._drawTimebar(this._m); }
    });
    this._gestures();
    this._dayrowGestures();
    new ResizeObserver(() => {
      const w = this._el.stage.clientWidth;
      if (w && w !== this._w) { this._w = w; this._redraw(); }
    }).observe(this._el.stage);
  }

  _act(act, el) {
    const now = this._now();
    if (act !== 'zoomrun') this._hideTip();
    switch (act) {
      case 'prev': case 'next': {
        const v = stepView(this._view, act === 'next' ? 1 : -1, now, this._minT());
        if (!sameView(v, this._view)) this._go(v);
        break;
      }
      case 'now': this._go(liveOf(this._view)); break;
      case 'dates': this._datesOpen = !this._datesOpen; this._drawTimebar(this._m); break;
      case 'today': this._datesOpen = false; this._go(dayView(now, now)); break;
      case 'yesterday': this._datesOpen = false; this._go(dayView(addDays(now, -1), now)); break;
      case 'week': this._datesOpen = false; this._go({ kind: 'live', span: 7 * DAY }); break;
      case 'uninspect': this._uninspect(); break;
      case 'week-prev': case 'week-next':
        this._rowWeeks = Math.max(0, this._rowWeeks + (act === 'week-prev' ? 1 : -1));
        this._rowPinned = true;
        this._fetchDays();
        this._drawDayrow(this._m);
        break;
      case 'layers': this._panel = this._panel === 'layers' ? null : 'layers'; this._drawPanel(); break;
      case 'help': this._panel = this._panel === 'help' ? null : 'help'; this._drawPanel(); break;
      case 'graph': {
        const g = el.dataset.k, list = this._prefs.graphs;
        this._prefs.graphs = list.includes(g) ? list.filter(x => x !== g) : [...CORE_GRAPHS, ...EXTRA_GRAPHS].filter(x => x === g || list.includes(x));
        this._savePrefs(); this._drawPanel(); this._redraw();
        break;
      }
      case 'lane': this._prefs.lane = el.dataset.k; this._savePrefs(); this._drawPanel(); this._redraw(); break;
      case 'pref': this._prefs[el.dataset.k] = !this._prefs[el.dataset.k]; this._savePrefs(); this._drawPanel(); this._redraw(); break;
      case 'stats': this._prefs.statsOpen = !this._prefs.statsOpen; this._savePrefs(); this._drawBelow(this._m, true); break;
      case 'warn': {
        const t = Number(el.dataset.t), span = Number(el.dataset.span) || 3 * HOUR;
        this._go(settleView(t - span * 0.25, span, now, { minT: this._minT() }));
        break;
      }
      case 'zoomrun': {
        const a = Number(el.dataset.a), b = Number(el.dataset.b), span = clamp((b - a) * 1.6, MIN_SPAN, MAX_SPAN);
        this._hideTip();
        this._go(settleView((a + b) / 2 - span / 2, span, now, { minT: this._minT() }));
        break;
      }
      case 'hint-ok': this._prefs.hintSeen = true; this._savePrefs(); this._el.hint.hidden = true; break;
    }
  }

  // ---------- moving through time ----------
  _minT() { const now = this._now(); return Math.max(now - MAX_BACK, this._oldest ?? -Infinity); }

  // what's on screen right now (during a gesture or an animation, the in-between stretch)
  _curWin() {
    if (this._drag) return { t0: this._drag.t0, span: this._drag.span };
    const w = windowOf(this._view, this._now());
    return { t0: w.t0, span: w.t1 - w.t0 };
  }

  // the furthest the left edge can go each way for a span: back to the oldest history, forward until the right
  // edge reaches now (or the end of today, when what's on screen already ran past now)
  _limits(span) {
    const now = this._now();
    const right = Math.max(now, this._gestureRight || now);
    return { min: this._minT(), max: right - span };
  }

  _go(v, { animate = true } = {}) {
    const now = this._now();
    this._stopAnim();
    const from = this._curWin();
    this._view = v;
    this._drag = null;
    const w = windowOf(v, now), to = { t0: w.t0, span: w.t1 - w.t0 };
    this._need(w.t0, to.span);
    const chip = chipOf(v);
    if (chip && chip !== this._prefs.span) { this._prefs.span = chip; this._savePrefs(); }
    if (!this._rowPinned) this._rowWeeks = 0;
    this._rowPinned = false;
    if (this._insp != null && (this._insp < w.t0 || this._insp > Math.min(w.t1, now))) { this._insp = null; this._inspPinned = false; }
    this._hideTip();
    if (animate && !REDUCED() && (Math.abs(from.t0 - to.t0) > 1000 || Math.abs(from.span - to.span) > 1000)) this._animate(from, to);
    else this._redraw();
  }

  // glide from one stretch to another (the span changes on a log scale, so zooming feels even)
  _animate(from, to, ms = 230) {
    const start = performance.now(), ease = u => 1 - Math.pow(1 - u, 3);
    const f1 = from.t0 + from.span, t1 = to.t0 + to.span;
    const step = ts => {
      const u = Math.min(1, (ts - start) / ms), e = ease(u);
      if (u >= 1) { this._anim = null; this._drag = null; this._draw(); return; }
      const span = Math.exp(Math.log(from.span) + (Math.log(to.span) - Math.log(from.span)) * e);
      const right = f1 + (t1 - f1) * e;
      this._drag = { t0: right - span, span, anim: true };
      this._draw(true);
      this._anim = requestAnimationFrame(step);
    };
    this._anim = requestAnimationFrame(step);
  }

  _stopAnim() {
    if (this._anim) { cancelAnimationFrame(this._anim); this._anim = null; }
    if (this._mom) { cancelAnimationFrame(this._mom); this._mom = null; }
  }

  // during a drag or pinch: the in-between stretch, drawn every frame
  _transient(t0, span) {
    this._drag = { t0, span };
    this._draw(true);
  }

  // after a drag or pinch: settle on a tidy view (a nudge of Today goes back to Today)
  _settle(opts = {}) {
    const d = this._drag;
    if (!d) return;
    const now = this._now();
    let v = settleView(d.t0, d.span, now, { ...opts, minT: this._minT() });
    const g = this._gestureFrom;
    if (g && g.kind === 'days') {
      const gw = windowOf(g, now);
      if (Math.abs(d.t0 - gw.t0) < (gw.t1 - gw.t0) * 0.05 && Math.abs(d.span - (gw.t1 - gw.t0)) < MIN) v = g;
    }
    this._gestureFrom = null; this._gestureRight = null;
    this._go(v);
    this._fadeGlance();
  }

  _beginGesture() {
    this._stopAnim();
    const now = this._now(), w = windowOf(this._view, now);
    this._gestureFrom = this._view;
    this._gestureRight = w.t1;
    this._hideTip();
    if (!this._drag) this._drag = { t0: w.t0, span: w.t1 - w.t0 };
  }

  _rubber(t0, span) {
    const lim = this._limits(span);
    if (t0 < lim.min) return lim.min - (lim.min - t0) * 0.3;
    if (t0 > lim.max) return lim.max + (t0 - lim.max) * 0.3;
    return t0;
  }

  // a flick keeps moving and slows down
  _momentum(vPx, span) {
    const W = this._m.W;
    let v = (-vPx * span) / W, last = performance.now();
    const step = ts => {
      const dt = Math.min(48, ts - last);
      last = ts;
      v *= Math.pow(0.9935, dt);
      let t0 = this._drag.t0 + v * dt;
      const lim = this._limits(span);
      if (t0 < lim.min) { t0 = lim.min; v = 0; }
      if (t0 > lim.max) { t0 = lim.max; v = 0; }
      this._drag = { t0, span };
      this._draw(true);
      if ((Math.abs(v) * 16 * W) / span < 0.4) { this._mom = null; this._settle(); return; }
      this._mom = requestAnimationFrame(step);
    };
    this._mom = requestAnimationFrame(step);
  }

  _gestures() {
    const hit = this._el.hit, pill = this._el.pill;
    const pts = new Map();
    let g = null, lastChip = null;
    const pos = e => { const r = this._el.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, ts: e.timeStamp }; };
    const W = () => (this._m ? this._m.W : 1);

    hit.addEventListener('pointerdown', e => {
      if (!this._m) return;
      this._stopAnim();
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      pts.set(e.pointerId, pos(e));
      if (pts.size === 2) {
        // two fingers: pinch to zoom around them (and move with them)
        if (g && g.long) clearTimeout(g.long);
        const [a, b] = [...pts.values()];
        this._beginGesture();
        const c = this._curWin(), mid = (a.x + b.x) / 2;
        g = { mode: 'pinch', d0: Math.max(24, Math.abs(a.x - b.x)), span0: c.span, anchor: c.t0 + (mid / W()) * c.span };
        lastChip = chipOf({ kind: 'free', span: c.span });
        this._showGlance();
        return;
      }
      const p = pos(e), c = this._curWin();
      g = { mode: null, x0: p.x, y0: p.y, t0: c.t0, span: c.span, touch: e.pointerType !== 'mouse', samples: [p] };
      if (g.touch) {
        // touch and hold: inspect and slide
        g.long = setTimeout(() => {
          if (!g || g.mode) return;
          g.mode = 'scrub';
          if (navigator.vibrate) navigator.vibrate(8);
          this._inspect(this._m.tAt(p.x), true);
        }, 420);
      }
    });

    hit.addEventListener('pointermove', e => {
      if (!this._m) return;
      const p = pos(e);
      if (!pts.has(e.pointerId)) {
        // a mouse hovering: the inspector follows (until you click to pin it)
        if (e.pointerType === 'mouse' && !e.buttons && !this._inspPinned && !this._drag) this._inspect(this._m.tAt(p.x), false);
        return;
      }
      pts.set(e.pointerId, p);
      if (g && g.mode === 'pinch' && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const span = clamp((g.span0 * g.d0) / Math.max(24, Math.abs(a.x - b.x)), MIN_SPAN, MAX_SPAN);
        const mid = (a.x + b.x) / 2;
        let t0 = g.anchor - (mid / W()) * span;
        t0 = this._rubber(t0, span);
        const chip = SPAN_LIST.find(s => Math.abs(Math.log(s / span)) < 0.03) || null;
        if (chip && chip !== lastChip && navigator.vibrate) navigator.vibrate(6);
        lastChip = chip;
        this._transient(t0, span);
        this._showGlance();
        return;
      }
      if (!g) return;
      const dx = p.x - g.x0, dy = p.y - g.y0;
      if (!g.mode && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 0.9) {
        clearTimeout(g.long);
        g.mode = 'pan';
        this._beginGesture();
        if (!this._inspPinned) this._insp = null;
      }
      if (g.mode === 'pan') {
        g.samples.push(p);
        while (g.samples.length > 2 && p.ts - g.samples[0].ts > 90) g.samples.shift();
        this._transient(this._rubber(g.t0 - (dx / W()) * g.span, g.span), g.span);
        this._showGlance();
      } else if (g.mode === 'scrub') this._inspect(this._m.tAt(p.x), true);
    });

    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g) return;
      clearTimeout(g.long);
      if (g.mode === 'pinch') {
        if (!pts.size) { this._settle({ snapSpan: true, anchor: g.anchor }); g = null; }
        return;
      }
      if (g.mode === 'pan') {
        const s = g.samples, a = s[0], b = s[s.length - 1];
        const v = s.length > 1 && b.ts > a.ts ? (b.x - a.x) / (b.ts - a.ts) : 0;
        if (e.type === 'pointerup' && Math.abs(v) > 0.35) this._momentum(v, g.span);
        else this._settle();
      } else if (!g.mode && e.type === 'pointerup') this._tap(g.x0, g.y0, g.touch);
      g = null;
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
    hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pts.size && !this._inspPinned && this._insp != null) this._uninspect(); });

    // the time pill: drag it to scrub
    pill.addEventListener('pointerdown', e => {
      if (e.target.closest('.px')) return;
      e.stopPropagation();
      try { pill.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      pill.dataset.drag = '1';
    });
    pill.addEventListener('pointermove', e => {
      if (pill.dataset.drag !== '1' || !this._m) return;
      const r = this._el.stage.getBoundingClientRect();
      this._inspect(this._m.tAt(e.clientX - r.left), true);
    });
    const pillEnd = () => { delete pill.dataset.drag; };
    pill.addEventListener('pointerup', pillEnd);
    pill.addEventListener('pointercancel', pillEnd);

    // trackpads and mice: Ctrl/⌘ + scroll (or a pinch) zooms, a sideways swipe or Shift + scroll moves;
    // ordinary scrolling still scrolls the page
    let wheelT = null, wheelAnchor = null;
    hit.addEventListener('wheel', e => {
      if (!this._m) return;
      const p = pos(e);
      const zoom = e.ctrlKey || e.metaKey, side = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!zoom && !side) return;
      e.preventDefault();
      if (!this._drag) this._beginGesture();
      const c = this._curWin();
      if (zoom) {
        const span = clamp(c.span * Math.exp(e.deltaY * 0.01), MIN_SPAN, MAX_SPAN), a = c.t0 + (p.x / this._m.W) * c.span;
        wheelAnchor = a;
        this._transient(this._rubber(a - (p.x / this._m.W) * span, span), span);
      } else {
        const d = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        this._transient(this._rubber(c.t0 + (d / this._m.W) * c.span, c.span), c.span);
      }
      this._showGlance();
      clearTimeout(wheelT);
      wheelT = setTimeout(() => this._settle(zoom ? { snapSpan: true, anchor: wheelAnchor } : {}), 260);
    }, { passive: false });

    hit.addEventListener('keydown', e => {
      if (!this._m) return;
      const now = this._now(), m = this._m;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) { const c = this._curWin(); this._go(settleView(c.t0 + dir * c.span / 4, c.span, now, { minT: this._minT() })); return; }
        const base = this._insp != null ? this._insp : Math.min(m.tEnd, now);
        this._inspect(base + dir * (m.tEnd - m.t0) / 60, true);
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        e.preventDefault();
        const cur = chipOf(this._view) || spanOf(this._view, now);
        const i = SPAN_LIST.findIndex(s => s >= cur - MIN), next = e.key === '-' ? SPAN_LIST[Math.min(SPAN_LIST.length - 1, (i < 0 ? 5 : i) + 1)] : SPAN_LIST[Math.max(0, (i < 0 ? 5 : i) - 1)];
        this._go(zoomView(this._view, next, now, this._insp));
      } else if (e.key === 'End') { e.preventDefault(); this._go(liveOf(this._view)); }
      else if (e.key === 'Escape') this._uninspect();
    });
  }

  // a tap: on the heat pump lane, that run's details; anywhere else, put the inspector there
  _tap(x, y) {
    const m = this._m, lane = m.L.lane;
    if (y >= lane.head.top && y <= lane.bottom + 6) { this._showRun(m.tAt(x)); return; }
    this._hideTip();
    this._inspect(m.tAt(x), true);
  }

  _inspect(t, pinned) {
    const m = this._m;
    if (!m) return;
    t = clamp(Math.round(t / MIN) * MIN, m.t0, Math.min(m.tEnd, m.now));
    this._insp = t;
    if (pinned != null) this._inspPinned = pinned;
    if (pinned && !this._prefs.hintSeen) { this._prefs.hintSeen = true; this._savePrefs(); this._el.hint.hidden = true; }
    this._drawHeads(m);
  }

  _uninspect() {
    this._insp = null;
    this._inspPinned = false;
    if (this._m) this._drawHeads(this._m);
  }

  // while moving: what's on screen, in the middle of the chart, fading out after
  _showGlance() {
    const m = this._m, el = this._el.glance;
    if (!m) return;
    clearTimeout(this._glanceT);
    const v = { kind: 'free', t0: m.t0, span: m.tEnd - m.t0 };
    el.textContent = `${titleOf(v, m.now, m.fmt).title} · ${spanWords(m.tEnd - m.t0)}`;
    el.classList.add('on');
  }

  _fadeGlance() {
    clearTimeout(this._glanceT);
    this._glanceT = setTimeout(() => this._el.glance.classList.remove('on'), 500);
  }

  // ---------- drawing ----------
  _redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  // `light`: during a gesture or animation, only what moves (the numbers below are worked out once it settles)
  _draw(light) {
    if (!this._root || !this._hass || !this._fmt) return;
    const m = (this._m = this._model());
    this._el.stage.style.height = `${m.L.height}px`;
    this._drawTimebar(m);
    this._drawChart(m);
    this._drawHeads(m);
    this._drawDayrow(m);
    if (!light) { this._drawNow(m); this._drawBelow(m); this._drawHint(m); }
  }

  _model() {
    const now = this._now(), prefs = this._prefs;
    const W = this._w || this._el.stage.clientWidth || 340;
    const L = (this._layout = makeLayout(prefs.graphs, prefs.lane, prefs.changes));
    let t0, t1;
    if (this._drag) { t0 = this._drag.t0; t1 = t0 + this._drag.span; }
    else { const w = windowOf(this._view, now); t0 = w.t0; t1 = w.t1; }
    const tEnd = t1, tData = Math.min(t1, now), S = this._series(now), h = this._hass.config || {};
    const m = { now, W, L, t0, t1, tEnd, tData, live: !this._drag && windowOf(this._view, now).live, S, prefs, fmt: this._fmt, uid: this._uid,
      from: this._from, oldest: this._oldest, lat: h.latitude, lon: h.longitude, sun: d0 => this._sunFor(d0),
      x: t => ((t - t0) / (tEnd - t0)) * W, tAt: px => t0 + (px / W) * (tEnd - t0) };
    m.acts = runs(S.activity, t0, tData, now);
    m.hw = hotWaterRuns(m);
    m.tl = targetColours(S, t0 - 1, tData + 1);
    m.keyAt = t => valueAt(m.tl, t) || 'heat';
    m.cuts = m.tl.slice(1).map(p => p[0]);
    m.flowGaps = gaps(S.flow, t0, tData);
    m.ticks = tickPlan(m);
    m.sc = {};
    for (const b of L.graphs) m.sc[b.key] = this._scale(m, b);
    // setting changes: marks closer than 18 px share one
    m.flags = [];
    if (prefs.changes) {
      for (const grp of settingChanges(S, t0, tData)) {
        const X = m.x(grp.t), f = m.flags[m.flags.length - 1];
        if (f && X - f.x0 < 18) { f.groups.push(grp); f.x = (f.x0 + X) / 2; } else m.flags.push({ x: X, x0: X, groups: [grp] });
      }
    }
    return m;
  }

  _scale(m, b) {
    const S = m.S, { t0, tData } = m;
    if (b.key === 'water') {
      // fit the heating: leave out the hot water runs (the tank's 56° would squash everything else)
      const fit = !m.prefs.dhwFull, vals = [];
      const skip = t => fit && m.hw.some(([a, e]) => t >= a - MIN && t <= e + 6 * MIN);
      for (const k of ['flow', 'target', ...(m.prefs.ret ? ['return'] : [])]) {
        const pts = S[k], v0 = valueAt(pts, t0);
        if (typeof v0 === 'number' && !skip(t0) && !(k === 'target' && fit && m.keyAt(t0) === 'hw')) vals.push(v0);
        for (let i = indexAt(pts, t0) + 1; i < pts.length && pts[i][0] <= tData; i++) {
          const [t, v] = pts[i];
          if (typeof v === 'number' && !skip(t) && !(k === 'target' && fit && m.keyAt(t) === 'hw')) vals.push(v);
        }
      }
      let [lo, hi] = vals.length ? minMax(vals) : [25, 45];
      lo = Math.floor((lo - 1) / 5) * 5; hi = Math.ceil((hi + 1) / 5) * 5;
      if (hi - lo < 10) hi = lo + 10;
      const sc = scaleFor([lo, hi], b, { pad: 0, minSpan: 10 });
      return sc;
    }
    if (b.key === 'room') {
      const vals = valuesIn(S.room, t0, tData);
      const planHas = S.plan.some(p => p[0] <= m.tEnd && p[0] >= t0 - 2 * DAY);
      for (const k of planHas ? ['plan'] : ['day_temp', 'night_temp']) for (const v of valuesIn(S[k], t0, m.tEnd)) if (typeof v === 'number') vals.push(v);
      return scaleFor(vals, b, { minSpan: 2, pad: 0.3 });
    }
    if (b.key === 'outside') return scaleFor(valuesIn(S.outside, t0, tData), b, { minSpan: 3, pad: 0.6 });
    const spec = EXTRA[b.key], vals = [];
    for (const [k] of spec.keys) for (const v of valuesIn(S[k], t0, tData)) vals.push(v);
    return scaleFor(vals, b, { minSpan: spec.minSpan, pad: spec.pad ?? 0, zero: !!spec.zero });
  }

  _drawChart(m) {
    const L = m.L;
    const parts = [renderBackdrop(m), renderSun(m)];
    for (const b of L.graphs) {
      parts.push(b.key === 'water' ? renderWater(m, b) : b.key === 'room' ? renderRoom(m, b) : b.key === 'outside' ? renderOutside(m, b) : renderExtra(m, b));
    }
    parts.push(renderLane(m, L.lane));
    let labels = '';
    for (const [t, isDay, show] of m.ticks) {
      if (!show) continue;
      labels += `<span class="tk${isDay ? ' day' : ''}" style="left:${m.x(t).toFixed(1)}px;top:${L.ticks.top}px">${isDay ? m.fmt.wd(t) : m.fmt.tick(t)}</span>`;
    }
    if (this._error) labels += `<span class="veil" style="left:${m.W / 2}px;top:${L.graphs[0] ? L.graphs[0].top + 30 : 80}px">${this._error}</span>`;
    this._el.chart.setAttribute('viewBox', `0 0 ${m.W} ${L.height}`);
    this._el.chart.style.height = `${L.height}px`;
    this._el.chart.innerHTML = `<defs>${parts.map(p => p.defs || '').join('')}<pattern id="hatch-${m.uid}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" class="hatchbg"/><rect width="2" height="6" class="hatchfg"/></pattern></defs>${parts.map(p => p.svg).join('')}`;
    this._el.labels.innerHTML = labels + parts.map(p => p.html || '').join('');
    // the hit area covers the hours and every block; the marks sit on top so they can be tapped
    Object.assign(this._el.hit.style, { top: `${L.ticks.top}px`, height: `${L.lane.bottom + 6 - L.ticks.top}px` });
    this._el.hit.setAttribute('aria-label', `Chart for ${titleOf(this._drag ? { kind: 'free', t0: m.t0, span: m.tEnd - m.t0 } : this._view, m.now, m.fmt).title}. Drag to move, pinch to zoom, tap to inspect. Arrow keys inspect, plus and minus zoom.`);
    this._el.marks.innerHTML = !L.marks ? '' : m.flags.map((f, i) => `<button class="mk${f.groups.length > 1 ? ' n' : ''}" data-mark="${i}" aria-label="Settings changed"
      style="left:${f.x.toFixed(1)}px;top:${L.marks.y}px">${f.groups.length > 1 ? f.groups.length : ''}</button>`).join('');
  }

  // block headings (values at the inspector or now, otherwise a key), the inspector line and its time pill
  _drawHeads(m) {
    const t = this._insp != null ? this._insp : m.live && m.now <= m.tEnd ? m.now : null;
    this._el.heads.innerHTML = m.L.blocks.map(b => blockHead(m, b, t)).join('');
    const pill = this._el.pill;
    if (this._insp == null) { this._el.cursor.innerHTML = ''; pill.hidden = true; return; }
    this._el.cursor.style.height = `${m.L.height}px`;
    this._el.cursor.setAttribute('viewBox', `0 0 ${m.W} ${m.L.height}`);
    this._el.cursor.innerHTML = cursorSvg(m, this._insp);
    this._el.pt.textContent = m.fmt.when(this._insp, m.now);
    pill.hidden = false;
    const w = pill.offsetWidth || 70, X = m.x(this._insp);
    pill.style.left = `${clamp(X - w / 2, 0, m.W - w).toFixed(1)}px`;
    pill.style.top = `${m.L.ticks.top - 3}px`;
  }

  _drawTimebar(m) {
    if (!m) return;
    const now = m.now, v = this._view;
    const ti = this._drag ? titleOf({ kind: 'free', t0: m.t0, span: m.tEnd - m.t0 }, now, m.fmt) : titleOf(v, now, m.fmt);
    const live = !this._drag && windowOf(v, now).live;
    this._el.t1.textContent = ti.title;
    this._el.t2.innerHTML = live ? `<i class="ld"></i>Live · ${m.fmt.hm(now)}` : ti.whole ? (v.n > 1 ? `${v.n} days` : 'Whole day') : spanWords(ti.span);
    this._el.tt.setAttribute('aria-expanded', String(!!this._datesOpen));
    this._el.nowchip.hidden = live || !!this._drag;
    this._el.next.disabled = !this._drag && sameView(stepView(v, 1, now), v);
    this._el.prev.disabled = !this._drag && sameView(stepView(v, -1, now, this._minT()), v);
    const chip = this._drag ? SPAN_LIST.find(s => Math.abs(s - this._drag.span) < MIN) : chipOf(v);
    for (const b of this._el.zoom.children) b.setAttribute('aria-pressed', String(Number(b.dataset.span) === chip));
    const dm = this._el.dates;
    dm.hidden = !this._datesOpen;
    if (this._datesOpen) {
      const item = (act, ic, label) => `<button class="mi" data-act="${act}">${icon(ic, 20)}<span>${label}</span></button>`;
      dm.innerHTML = item('today', 'today', 'Today') + item('yesterday', 'yesterday', 'Yesterday') + item('week', 'week', 'Last 7 days') + this._calHtml(m);
    }
  }

  // the calendar in the date menu: whole weeks (Monday first) back to the oldest history
  _calHtml(m) {
    const now = m.now, today = startOfDay(now), minT = this._minT();
    const first = startOfDay(Math.max(minT, addDays(today, -27)));
    let d = addDays(first, -((new Date(first).getDay() + 6) % 7));
    const sel = !this._drag && this._view.kind === 'days' && this._view.n === 1 ? this._view.start : null;
    const months = new Set();
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => `<span class="cw">${w}</span>`).join('');
    for (; d <= today; d = addDays(d, 1)) {
      const off = addDays(d, 1) <= minT;
      if (!off) months.add(m.fmt.mo(d));
      cells += `<button data-day="${d}"${off ? ' disabled' : ''} class="${d === today ? 'today' : ''}${d === sel ? ' sel' : ''}"
        aria-label="${m.fmt.full(d)}">${new Date(d).getDate()}</button>`;
    }
    return `<div class="cal"><div class="cm">${[...months].join(' – ')}</div><div class="cg">${cells}</div></div>`;
  }

  // the day row: the last 7 days (or an earlier week), each with its kWh, and a box for what's on screen
  _drawDayrow(m) {
    if (!m) return;
    const now = m.now;
    let end = addDays(startOfDay(now), 1 - 7 * this._rowWeeks);
    // follow what's on screen when it's in another week (unless you've just paged the row yourself)
    if (!this._rowPinned && !this._drag) {
      while (m.t0 < addDays(end, -7) - HOUR && this._rowWeeks < 8) { this._rowWeeks++; end = addDays(end, -7); }
    }
    const start = addDays(end, -7), S = m.S, days = [];
    this._rowStart = start;
    for (let d = start; d < end; d = addDays(d, 1)) {
      const st = this._days[d] || null, hs = dayStats(S, d, addDays(d, 1), now);
      const kwh = st && st.kwh != null ? st.kwh : hs && hs.kwh != null ? hs.kwh : null;
      days.push({ d, kwh, today: d === startOfDay(now), future: d > now, loaded: this._from != null && d >= startOfDay(this._from) });
    }
    const max = Math.max(1, ...days.map(x => x.kwh || 0));
    // whole days on screen are filled in; any other stretch is shaded
    const sel = new Set();
    if (!this._drag && this._view.kind === 'days') for (let i = 0; i < this._view.n; i++) sel.add(addDays(this._view.start, i));
    const cells = days.map(x => `<button class="dc${x.today ? ' today' : ''}${sel.has(x.d) ? ' sel' : ''}${x.kwh == null && !x.loaded ? ' empty' : ''}"
        data-day="${x.d}" ${x.future ? 'disabled' : ''} aria-label="${m.fmt.full(x.d)}${x.kwh != null ? `, ${kwh(x.kwh)} kWh` : ''}">
        <span class="dw">${x.today ? 'Today' : m.fmt.wd(x.d)}</span><span class="dd">${new Date(x.d).getDate()}</span>
        <span class="dk"><i style="height:${x.kwh != null ? Math.max(2, (x.kwh / max) * 12).toFixed(1) : 0}px"></i></span>
        <span class="dv">${x.kwh != null ? kwh(x.kwh) : ''}</span></button>`).join('');
    // the box: what's on screen, on this week's scale
    const a = Math.max(m.t0, start), b = Math.min(m.tEnd, end);
    const rowW = (this._el.dayrow.clientWidth || 340) - 52, frac = (b - a) / (end - start);
    const box = b > a ? `<div class="box${sel.size ? ' whole' : ''}" style="left:${((a - start) / (end - start)) * 100}%;width:max(10px, ${frac * 100}%)">${
      frac * rowW >= 44 ? '<i class="h l" data-h="l"></i><i class="h r" data-h="r"></i>' : ''}</div>` : '';
    const offL = m.t0 < start, offR = m.tEnd > end && end <= startOfDay(now);
    this._el.dayrow.innerHTML = `<button class="drn" data-act="week-prev" aria-label="Earlier week">${icon('left', 18)}</button>
      <div class="drc">${cells}${box}${offL ? '<span class="off l">‹</span>' : ''}${offR ? '<span class="off r">›</span>' : ''}</div>
      <button class="drn" data-act="week-next" aria-label="Later week" ${this._rowWeeks === 0 ? 'disabled' : ''}>${icon('right', 18)}</button>`;
  }

  // drag the box to move, drag its ends to zoom, swipe the row for another week
  _dayrowGestures() {
    const row = this._el.dayrow;
    let g = null;
    row.addEventListener('pointerdown', e => {
      const cont = row.querySelector('.drc');
      if (!cont || !this._m || !e.composedPath().includes(cont)) return;
      const handle = e.target.closest && e.target.closest('.h'), onBox = e.target.closest && e.target.closest('.box');
      const r = cont.getBoundingClientRect(), c = this._curWin();
      g = { x0: e.clientX, w: r.width, t0: c.t0, span: c.span, mode: handle ? `resize-${handle.dataset.h}` : onBox ? 'move' : 'swipe', moved: false, id: e.pointerId };
      if (g.mode !== 'swipe') { try { row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } e.preventDefault(); }
    });
    row.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      if (!g.moved && Math.abs(dx) < 5) return;
      if (!g.moved) { g.moved = true; if (g.mode !== 'swipe') this._beginGesture(); }
      const dt = (dx / g.w) * 7 * DAY;
      if (g.mode === 'move') this._transient(this._rubber(g.t0 + dt, g.span), g.span);
      else if (g.mode === 'resize-r') { const span = clamp(g.span + dt, MIN_SPAN, MAX_SPAN); this._transient(g.t0, span); }
      else if (g.mode === 'resize-l') { const span = clamp(g.span - dt, MIN_SPAN, MAX_SPAN); this._transient(g.t0 + g.span - span, span); }
      if (g.mode !== 'swipe') this._showGlance();
    });
    const end = e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      if (g.moved) {
        this._ignoreClick = true;
        setTimeout(() => { this._ignoreClick = false; }, 50);
        if (g.mode === 'swipe') { if (Math.abs(dx) > 30) this._act(dx > 0 ? 'week-prev' : 'week-next'); }
        else this._settle(g.mode.startsWith('resize') ? { snapSpan: true } : {});
      } else if (g.mode !== 'swipe' && e.type === 'pointerup' && this._rowStart != null) {
        const cont = row.querySelector('.drc'), r = cont.getBoundingClientRect();
        const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * 7), 0, 6), d = addDays(this._rowStart, i);
        this._ignoreClick = true;
        setTimeout(() => { this._ignoreClick = false; }, 50);
        if (d <= this._now()) this._go(dayView(d, this._now()));
      }
      g = null;
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  }

  // what it's doing now, in words, with the flow and its target (always now, whatever's on screen)
  _drawNow(m) {
    const S = m.S, now = m.now;
    const act = valueAt(S.activity, now) || 'Off', sat = valueAt(S.satisfied, now) === 'on';
    const flow = valueAt(S.flow, now), tgt = valueAt(S.target, now);
    const tlNow = targetColours(S, now - 3 * HOUR, now), key = (tlNow.length ? tlNow[tlNow.length - 1][1] : 'heat');
    const since = (series, val) => {
      let s = null;
      for (let i = indexAt(series, now); i >= 0; i--) { if (series[i][1] === val) s = series[i][0]; else break; }
      return s;
    };
    const room = valueAt(S.room, now), setback = valueAt(S.setback_size, now) ?? 3, pct = valueAt(S.tank_pct, now), dhw = valueAt(S.dhw_target, now);
    let title = ACT_NAME[act] || act, why = '', badge = COL.act[act] || COL.act.Off, ic = 'fire', from = since(S.activity, act);
    if (act === 'Hot water') { ic = 'dhw'; why = `Heating the tank${pct != null ? ` · ${Math.round(pct)}% full` : ''}${dhw != null ? `, aiming for ${dhw.toFixed(0)}°` : ''}`; }
    else if (act === 'Defrost') { ic = 'defrost'; title = 'Defrosting'; why = 'Melting ice off the outdoor unit · back to heating in a few minutes'; }
    else if (act === 'Oil return') { ic = 'restore'; why = 'A few minutes, then back to heating'; }
    else if (act === 'Off') { ic = 'close'; why = 'Not running'; }
    else if (sat) {
      title = act === 'Paused' ? 'Paused, room satisfied' : 'At temperature'; badge = COL.sat; ic = 'setback'; from = since(S.satisfied, 'on');
      why = `Room ${deg(room)} · water ${setback.toFixed(0)}° cooler until it drops below its set temp`;
    } else if (act === 'Paused') { ic = 'timer'; why = `Room ${deg(room)}, still below its set temp`; }
    else why = `Warming the room · ${deg(room)}, still below its set temp`;
    if (act === 'Paused' && !sat) badge = COL.act.Heating;
    if (act === 'Off') badge = '#8a8f98';
    const sinceTxt = from != null ? `since ${m.fmt.when(from, now)}` : '';
    this._el.now.innerHTML = `<span class="badge" style="--c:${badge}">${icon(ic, 22)}</span>
      <div class="nt"><div class="n1"><b>${title}</b>${sinceTxt ? `<span class="since">${sinceTxt}</span>` : ''}</div><div class="n2">${why}</div></div>
      <button class="big" data-entity="${this._ent.flow}" aria-label="Flow ${deg(flow)}, target ${deg(tgt, 0)}">
        <span class="bv"><small>Flow</small>${deg(flow)}</span><span class="bs"><i style="background:${COL.tgt[key]}"></i>${key === 'hw' ? 'tank' : 'target'} ${deg(tgt, 0)}</span></button>`;
  }

  // under the chart: anything worth a look, then the numbers for what's on screen
  _drawBelow(m, force) {
    if (!m) return;
    const key = `${m.t0}|${m.tData}|${this._ver}|${this._prefs.statsOpen}`;
    if (!force && key === this._belowKey && Math.abs(m.now - (this._belowAt || 0)) < 60000) return;
    this._belowKey = key; this._belowAt = m.now;
    const ready = this._from != null && m.t0 >= this._from - MIN;
    const st = ready ? computeStats(m.S, m.t0, m.tData, m.now) : null;
    const warns = ready ? warnings(m.S, m.t0, m.tData, m.now, st, m.fmt) : [];
    this._el.worth.innerHTML = warns.map(w => `<div class="warn">${icon('alert', 18)}<span><b>${w.title}</b> · ${w.text}</span>${w.t != null
      ? `<button class="link" data-act="warn" data-t="${w.t}" data-span="${w.span || 3 * HOUR}">Show</button>` : ''}</div>`).join('');
    if (!st || st.span <= 0) { this._el.summary.innerHTML = ''; return; }
    const ti = titleOf(this._view, m.now, m.fmt).title;
    const chip = (col, label, val) => `<span class="sc">${col ? `<i style="background:${col}"></i>` : ''}${label} <b>${val}</b></span>`;
    let chips = '';
    if (st.heating) chips += chip(COL.act.Heating, 'Heating', dur(st.heating));
    if (st.hw) chips += chip(COL.act['Hot water'], 'Hot water', dur(st.hw));
    chips += chip(COL.act.Defrost, 'Defrosts', String(st.defrosts));
    chips += chip(null, 'Starts', String(st.starts));
    if (st.power) chips += chip(null, 'Used', `${kwh(st.elec)} kWh`);
    if (st.cop != null) chips += chip(null, 'COP', st.cop.toFixed(1));
    this._el.summary.innerHTML = `<div class="sh"><span class="st">${esc(ti)}</span>
        <button class="link" data-act="stats" aria-expanded="${!!this._prefs.statsOpen}">${this._prefs.statsOpen ? 'Less' : 'Details'}${icon('chevron', 16)}</button></div>
      <div class="chips">${chips}</div>${this._prefs.statsOpen ? this._statsHtml(m, st) : ''}`;
  }

  _statsHtml(m, st) {
    const off = Math.max(0, st.span - st.heating - st.hw - st.defrost - st.paused - st.oil);
    const parts = [['Heating', st.heating, COL.act.Heating], ['Hot water', st.hw, COL.act['Hot water']], ['Defrost', st.defrost, COL.act.Defrost],
      ['Oil return', st.oil, COL.act['Oil return']], ['Paused', st.paused, COL.act.Paused], ['Off', off, 'rgba(127,127,127,0.2)']].filter(p => p[1] >= MIN);
    const bar = parts.map(([, ms, col]) => `<span style="flex:${ms};background:${col}"></span>`).join('');
    const keyH = parts.map(([n, ms, col]) => `<span><i style="background:${col}"></i>${n} <b>${dur(ms)}</b></span>`).join('');
    const cop = v => (v == null ? '–' : v.toFixed(1));
    const row = (ic, label, total, unit, heat, hw) => `<tr><td class="l"><span>${icon(ic, 18)}${label}</span></td><td class="t"><b>${total}</b>${unit ? `<small> ${unit}</small>` : ''}</td><td>${heat}</td><td>${hw}</td></tr>`;
    const energy = !st.power ? '' : `<div class="sec">Energy</div><table class="etab"><tr><th></th><th>Total</th><th>Heating</th><th>Hot water</th></tr>
      ${row('flash', 'Electricity', kwh(st.elec), 'kWh', kwh(st.elecHeat), kwh(st.elecHw))}
      ${st.hasHeat ? row('fire', 'Heat made', kwh(st.heat), 'kWh', kwh(st.heatHeat), kwh(st.heatHw)) : ''}
      ${st.hasHeat ? row('gauge', 'COP', cop(st.cop), '', cop(st.copHeat), cop(st.copHw)) : ''}</table>`;
    const cell = (ic, label, value, sub) => `<div class="cell"><div class="cl">${icon(ic, 18)}<span>${label}</span></div><div class="cv">${value}</div>${sub ? `<div class="cs">${sub}</div>` : ''}</div>`;
    const flowAvg = st.heatN ? st.flowSum / st.heatN : null;
    return `<div class="stats"><div class="split">${bar}</div><div class="key">${keyH}</div>${energy}
      <div class="sec">Running</div><div class="trio">
        ${cell('timer', 'Running', dur(st.ran), `${Math.round((st.ran / st.span) * 100)}% of the time`)}
        ${cell('play', 'Starts', String(st.starts), st.starts ? `${dur((st.heating + st.hw) / st.starts)} a run` : '')}
        ${cell('defrost', 'Defrosts', String(st.defrosts), st.defrost ? `${dur(st.defrost)} in all` : '')}</div>
      <div class="sec">Temperatures</div><div class="trio">
        ${cell('waves', 'Average flow', flowAvg != null ? deg(flowAvg) : '–', flowAvg != null ? `return ${deg(st.dtSum / st.heatN)} lower` : '')}
        ${cell('thermo', 'Outside', st.oMin ? `${st.oMin[1].toFixed(1)}–${deg(st.oMax[1])}` : '–', st.oN ? `average ${deg(st.oSum / st.oN)}` : '')}
        ${cell('home', 'Room', st.rMin != null ? `${st.rMin.toFixed(1)}–${deg(st.rMax)}` : '–', st.rN ? `average ${deg(st.rSum / st.rN)}` : '')}</div></div>`;
  }

  // the first time: how to move around, over the chart, until you try it or tap Got it
  _drawHint(m) {
    const el = this._el.hint;
    if (this._prefs.hintSeen || this._from == null) { el.hidden = true; return; }
    el.hidden = false;
    el.style.top = `${(m.L.graphs[0] ? m.L.graphs[0].top + 40 : 80)}px`;
    el.innerHTML = `<span>Drag to move · Pinch to zoom · Tap to inspect</span><button class="link" data-act="hint-ok">Got it</button>`;
  }

  // the panel under the footer: graphs & layers, or the key and how to move around
  _drawPanel() {
    const p = this._el.panel, pr = this._prefs;
    this._el.layersBtn.setAttribute('aria-expanded', String(this._panel === 'layers'));
    this._el.helpBtn.setAttribute('aria-expanded', String(this._panel === 'help'));
    p.hidden = !this._panel;
    if (this._panel === 'layers') {
      const tg = (act, k, on, label, extra = '') => `<button class="tg${on ? ' on' : ''}" data-act="${act}" data-k="${k}" aria-pressed="${on}">${icon(on ? 'check' : 'plus', 16)}${label}${extra}</button>`;
      p.innerHTML = `<div class="pg"><div class="ph">Graphs</div><div class="tgs">
          ${[...CORE_GRAPHS, ...EXTRA_GRAPHS].map(g => tg('graph', g, pr.graphs.includes(g), GRAPHS[g].label)).join('')}</div></div>
        <div class="pg"><div class="ph">Heat pump lane</div><div class="seg" role="group">
          <button data-act="lane" data-k="bar" aria-pressed="${pr.lane !== 'power'}">Bar</button>
          <button data-act="lane" data-k="power" aria-pressed="${pr.lane === 'power'}">Power strip</button></div></div>
        <div class="pg"><div class="ph">Show</div><div class="tgs">
          ${tg('pref', 'ret', pr.ret, 'Return line')}${tg('pref', 'changes', pr.changes, 'Setting changes')}${tg('pref', 'dhwFull', pr.dhwFull, 'Hot water at full scale')}</div></div>`;
    } else if (this._panel === 'help') {
      const k = (style, label) => `<span class="ki"><i style="${style}"></i>${label}</span>`;
      p.innerHTML = `<div class="pg"><div class="ph">Water</div><div class="keys">
          ${k(`background:${COL.flow}`, 'Flow')}${k(`background:${COL.tgt.heat}`, 'Target, heating')}${k(`background:${COL.tgt.sat}`, 'Target, room satisfied (water lowered)')}
          ${k(`background:repeating-linear-gradient(90deg, ${COL.tgt.hw} 0 4px, transparent 4px 7px)`, 'Target for the hot water')}${k(`background:${COL.ret}`, 'Return')}
          ${k(`background:${COL.hwBand.replace('0.14', '0.5')};height:10px;border-radius:3px`, 'Hot water run')}</div></div>
        <div class="pg"><div class="ph">Room</div><div class="keys">
          ${k('background:var(--hp-room)', 'Room temperature')}${k('background:repeating-linear-gradient(90deg, var(--hp-sub) 0 3px, transparent 3px 6px)', 'Day and night set temps')}
          ${k(`background:${COL.sat}`, 'Satisfied: the water is lowered')}</div></div>
        <div class="pg"><div class="ph">Heat pump</div><div class="keys">
          ${ACT_ORDER.filter(s => s !== 'Off').map(s => k(`background:${COL.act[s]};height:10px;border-radius:3px`, ACT_NAME[s])).join('')}</div></div>
        <div class="pg"><div class="ph">Moving around</div><div class="howto">
          <div><b>Zoom</b> with the chips, or pinch (Ctrl + scroll on a computer)</div>
          <div><b>Move</b> by dragging the chart sideways, or with ‹ ›</div>
          <div><b>Jump</b> to a day by tapping it in the day row; drag the shaded part to move, its ends to zoom</div>
          <div><b>Inspect</b> a moment by tapping the chart; drag the time pill to slide</div>
          <div><b>Now</b> brings you back to live</div></div></div>`;
    }
  }

  // ---------- pop-ups ----------
  _place(html, x, yTop) {
    const tip = this._el.tip, m = this._m;
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${clamp(x - w / 2, 0, m.W - w)}px`;
    tip.style.top = `${Math.max(0, yTop - h - 6)}px`;
  }

  _hideTip() { if (this._el && !this._el.tip.hidden) this._el.tip.hidden = true; this._tipKind = null; }

  // a tap on the heat pump lane: that run from start to finish, with its energy, and Zoom to this
  _showRun(t) {
    const m = this._m, r = runs(m.S.activity, t - 1, t + 1, m.now).find(q => q[3] <= t && q[4] > t);
    if (!r) { this._hideTip(); return; }
    const [, , v, a, b] = r, ongoing = b >= m.now - MIN, en = runEnergy(m.S, a, Math.min(b, m.now));
    this._tipKind = 'run';
    this._place(`<div class="th"><i style="background:${COL.act[v] || COL.act.Off}"></i><b>${ACT_NAME[v] || v}</b></div>
      <div class="tr">${m.fmt.when(a, m.now)} – ${ongoing ? 'now' : startOfDay(a) === startOfDay(b) ? m.fmt.hm(b) : m.fmt.when(b, m.now)} · ${ongoing ? 'so far ' : ''}${dur(b - a)}</div>
      ${en.elec > 0.01 ? `<div class="tr">${kwh(en.elec)} kWh used${en.heat != null ? ` · ${kwh(en.heat)} kWh heat` : ''}${en.cop != null ? ` · COP ${en.cop.toFixed(1)}` : ''}</div>` : ''}
      <button class="link" data-act="zoomrun" data-a="${a}" data-b="${Math.min(b, m.now)}">Zoom to this</button>`, m.x(clamp(t, m.t0, m.tData)), m.L.lane.top);
  }

  // a tap on a mark: what changed (old → new)
  _showChange(i) {
    const m = this._m, f = m && m.flags[i];
    if (!f) return;
    this._tipKind = 'change';
    const unitOf = k => (SETTINGS.find(s => s[0] === k) || [])[3] || '';
    const dpOf = k => (SETTINGS.find(s => s[0] === k) || [])[2] ?? 1;
    const val = (k, x) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(dpOf(k))}${unitOf(k)}`;
    this._place(f.groups.map(g => `<div class="tr dim">${m.fmt.when(g.t, m.now)}</div>${g.items.map(o =>
      `<div class="tr"><span>${o.label}</span> <span class="from">${val(o.k, o.from)}</span> → <b>${val(o.k, o.to)}</b></div>`).join('')}`).join(''),
      f.x, m.L.marks ? m.L.marks.y - 6 : m.L.lane.top);
  }
}


// ---------- 9. register ----------
if (!customElements.get('heat-pump-history-card')) customElements.define('heat-pump-history-card', HeatPumpHistoryCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'heat-pump-history-card')) {
  window.customCards.push({ type: 'heat-pump-history-card', name: 'Heat pump history', preview: false,
    description: 'What the heat pump did and why: flow against its target, the room and outside on one timeline you can zoom and drag.' });
}
console.info(`%c HEAT PUMP HISTORY %c ${VERSION} `, 'background:#ff7a4d;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px',
  'background:#4269d0;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px');

})();
