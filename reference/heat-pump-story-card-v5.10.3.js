/*
 * Heat pump story chart for Home Assistant
 * ----------------------------------------
 * The heat pump's last few hours (or days) in one picture:
 *   Flow:      the flow temperature (blue) and its target: coral, green while the setback lowers it (the room
 *              at its set temp), amber while it's for the hot water, grey while the heat pump is off.
 *              Return can be switched on in the key.
 *   Room:      the room against its set temp (grey dashed); the line turns green while it's at temp.
 *   Outside:   the outside temperature, with the weather now by the value.
 *   Timeline:  the Day/Night schedule (thin line), what it was doing (orange heating, amber hot water,
 *              faded orange paused, blue ticks defrosts, empty off) and how high the sun is.
 *   Ahead:     when showing now, the chart runs on past now by a quarter of the range (1 to 12 hours): the
 *              forecast outside temp (weather.forecast_home, nudged to match your sensor now), the Day/Night
 *              schedule as it was this time yesterday, and the flow target those would give if nothing else
 *              changes (dotted, ≈). Scrub into it for the numbers. Beta: off until you switch it on in the key.
 *   Below:     a warning line if something looks off in the range on screen (short cycling, flow well short
 *              of its target, a long hot water run, lots of defrosting; tap it to zoom in), what it's doing
 *              now (or at the moment you're scrubbing) with the Key button, and what's going on in a few words.
 *              The key has the switches for the return line and setting changes.
 * Top left: the numbers for what's on screen (time split, energy and COP, starts, defrosts, temperatures).
 *
 * Phone:     drag sideways to move through time, pinch to zoom, tap or touch-and-hold-and-slide to scrub.
 *            Tap the timeline to see that stretch. Double-tap to go back to now.
 * Computer:  hover to scrub, drag to move, pinch on a trackpad (or Ctrl + scroll) to zoom,
 *            double-click to go back to now.
 * While scrubbing, the headings show the values at that moment.
 * Calendar button: opens a bar to step back and forward (tap the date for today, yesterday, last 7 days or
 *   any date) and compare with the same time on an earlier day (dashed lines, and differences in the stats).
 *   It stays until you close it; closing it goes back to now.
 * Adjust: how the flow target is worked out, and changes to the curve, shift, room correction, setback and
 *   day/night temps with a preview of the new target, using your Grant scripts. A changed setting shows in orange with the old value in
 *   brackets: tap the old value to put it back. The i in the heading explains each setting.
 *
 * Install: copy to /config/www/cards/ashp/heat-pump-story-card.js and add the resource
 *          /local/cards/ashp/heat-pump-story-card.js?v=25.3 (JavaScript module; raise the number on each update,
 *          decimals are fine).
 * Use:     type: custom:heat-pump-story-card
 * Options (all optional):
 *   hours: 12               the range it opens on the first time (after that it remembers your choice)
 *   paused_style: striped   paused as orange stripes rather than faded orange (or grey, as before)
 *   setback_style: none     don't colour the target green during a setback (the room line still turns green)
 *   forecast: false         hide the forecast switch in the key
 *   scripts:                swap the scripts Adjust uses, e.g.  shift: script.my_curve_shift
 *   entities:               swap any sensor, e.g.  room: sensor.lounge_temperature
 */

const VERSION = '5.10.3';

const DEFAULT_ENTITIES = {
  activity: 'sensor.heat_pump_activity_log',
  period: 'sensor.heating_period',
  at_temp: 'binary_sensor.thermostat_setback',
  target: 'sensor.target_flow_temp_2',
  flow: 'sensor.actual_flow_temp_2',
  return: 'sensor.actual_return_temp_2',
  breakdown: 'sensor.flow_target_breakdown',
  room: 'sensor.room_thermostat_temp',
  outside: 'sensor.exterior_weather_sensor',
  energy: 'sensor.ashp_power_usage',              // electricity meter (running kWh total); used for kWh and COP when present
  power: 'sensor.heat_pump_electrical_power_2',   // otherwise electricity comes from this (kW)
  heat: 'sensor.heat_pump_thermal_power_2',
  // settings: a change shows as a flag on the time axis
  curve: 'sensor.weather_comp_curve',
  shift: 'sensor.curve_shift',
  room_factor: 'sensor.room_temperature_correction',
  day_temp: 'sensor.circuit_1_comfort_day_temp',
  night_temp: 'sensor.circuit_1_eco_night_temp',
  setback_size: 'sensor.circuit_1_temp_reduction',
  dhw_target: 'number.dhw_target',
  desired: 'sensor.c1_desired_heating_lwt_2',      // the controller's own desired flow (anchors the Adjust preview)
  weather: 'weather.forecast_home',                // its conditions show beside the time while scrubbing
  hyst: 'sensor.circuit_1_hysteresis',             // how far the room drops below its set temp before the setback ends
};
// Home Assistant's weather conditions and their icons
const WX = { 'clear-night': 'wNight', cloudy: 'wCloudy', fog: 'wFog', hail: 'wHail', lightning: 'wLight', 'lightning-rainy': 'wLightRain',
  partlycloudy: 'wPartly', pouring: 'wPour', rainy: 'wRain', snowy: 'wSnow', 'snowy-rainy': 'wSnowRain', sunny: 'wSun', windy: 'wWind', 'windy-variant': 'wWind', exceptional: 'wAlert' };
// the scripts the Adjust panel uses (yours, unchanged)
const DEFAULT_SCRIPTS = {
  curve: 'script.grant_set_weather_curve',
  shift: 'script.grant_set_curve_shift',
  room_factor: 'script.grant_set_room_temp_correction',
  day_temp: 'script.grant_set_daytemp_target',
  night_temp: 'script.grant_set_nighttemp_target',     // new: see the scripts that come with this card
  setback_size: 'script.grant_set_temp_reduction',      // new
};
const ADJUST = [
  ['curve', 'Weather curve', 'How much hotter the water runs as it gets colder outside. Higher = steeper: more heat on cold days, little difference on mild ones.', 0.1, 0, 4, 1, ''],
  ['shift', 'Curve shift', 'Moves the whole curve up or down: every step is one degree warmer (or cooler) water, whatever the weather.', 1, -20, 20, 0, ' °C'],
  ['room_factor', 'Room correction', 'How strongly the room being below (or above) its set temp raises (or lowers) the water temperature. Each degree the room is off adds this many degrees.', 0.1, 0, 10, 1, ''],
  ['setback_size', 'Setback', 'How far the water drops once the room reaches its set temp, day or night. Bigger saves more but lets the room cool further before it picks up again.', 1, 0, 20, 0, ' °C'],
  ['day_temp', 'Day temperature', 'The room set temp in the day. Once the room reaches it, the water drops by the setback.', 0.1, 14, 25, 1, ' °C'],
  ['night_temp', 'Night temperature', 'The room set temp at night. Once the room reaches it, the water drops by the setback.', 0.1, 10, 25, 1, ' °C'],
];
// the icon beside each setting (the same ones your settings use elsewhere)
const TGT_OFF = '#9aa0aa';   // the flow target while the heat pump is off
const ROW_ICONS = { curve: 'curve', shift: 'shift', room_factor: 'roomf', day_temp: 'dayt', night_temp: 'night', setback_size: 'setback' };
const SETTINGS = [['curve', 'Curve', ''], ['shift', 'Shift', ''], ['room_factor', 'Room correction', ''],
  ['day_temp', 'Day temp', '°'], ['night_temp', 'Night temp', '°'], ['setback_size', 'Setback', '°'], ['dhw_target', 'Hot water target', '°']];
// readings at or above these are hub glitches (e.g. 32.8 kW) and are skipped
const LIMITS = { power: 10, heat: 25 };
const NUM_KEYS = ['target', 'flow', 'return', 'room', 'outside', 'power', 'heat'];
const RANGES = [['3h', 3], ['6h', 6], ['12h', 12], ['24h', 24], ['3d', 72]];
const MIN_SPAN = 30 * 60000, MAX_SPAN = 7 * 86400000, MAX_BACK = 14 * 86400000;
const STORE_KEY = 'heat-pump-story-hours', CACHE_KEY = 'heat-pump-story-cache', CHANGES_KEY = 'heat-pump-story-changes', COMPARE_KEY = 'heat-pump-story-compare', LINES_KEY = 'heat-pump-story-lines';

// ---------- colours ----------
const C = { target: '#ff725c', flow: '#4269d0', ret: '#8fa6e6', hw: '#f5a524', hwRet: '#f6c674', atTemp: '#2fb67c', track: 'rgba(127,127,127,0.09)' };
const ACT_FILL = { 'Heating': '#ff7a4d', 'Hot water': '#ffb627', 'Paused': 'rgba(150,156,168,0.42)', 'Oil return': '#ec6fa8' };
const ACT_DOT = { 'Heating': '#ff7a4d', 'Hot water': '#ffb627', 'Paused': '#bfc3ca', 'Defrost': '#12b5ff', 'Oil return': '#ec6fa8', 'Off': '#bfc3ca' };
const DEFROST = '#12b5ff';
const MODE_FILL = { Day: 'rgba(255,206,84,0.8)', Night: '#7b68ee', Off: 'rgba(148,152,160,0.45)' };
const MODE_DOT = { Day: '#ffce54', Night: '#7b68ee', Off: '#9aa0aa' };
const RENAME = { Circulating: 'Paused', Idle: 'Off' };
const RUNNING = ['Heating', 'Hot water', 'Defrost', 'Oil return'];
const SKY = [[-18, '#34416e'], [-12, '#3f4f86'], [-6, '#6670b0'], [-2, '#b88ab8'], [0, '#ef9a8a'], [3, '#f7b26c'],
  [10, '#f9cd6a'], [25, '#fbdc82'], [50, '#fce39a']];
const AIR = [[-5, '#4f86d6'], [5, '#62a8d8'], [12, '#4fb3a5'], [18, '#e9b949'], [26, '#f08c4a']];
const SUN_ICON = { day: ['sun', '#f2b84b'], up: ['rise', '#f39a6b'], down: ['set', '#e9877a'], night: ['moon', '#7c84c4'] };

// ---------- layout (px, from the top of the chart area) ----------
const GUTTER_L = 30, GUTTER_R = 10;
const MAIN_H = 210, ROOM_H = 40, OUT_H = 30, SKY_H = 4, AXIS_H = 18;
const BRIDGE = 10 * 60000;    // hub dropouts shorter than this are bridged rather than shown as gaps
const REFRESH = 30 * 60000;   // fetch the last day again now and then, in case anything was missed
const DAY = 86400000;
// The layout depends on which strips sit under the charts (each can move into a chart instead) and on whether
// setting changes are showing (they get their own row of marks).
function makeY(o) {
  const flowHead = { top: 0 };
  const main = { top: 24, bottom: 24 + MAIN_H };
  const roomHead = { top: main.bottom + 16 };
  const room = { top: roomHead.top + 18, bottom: roomHead.top + 18 + ROOM_H };
  const outHead = { top: room.bottom + 12 };
  const out = { top: outHead.top + 18, bottom: outHead.top + 18 + OUT_H };
  let y = out.bottom + 16;
  const mode = o.mode ? { key: 'period', top: y, h: 3 } : null;
  if (mode) y += 6;
  const act = { key: 'activity', top: y, h: 10 };
  y += 10;
  const at = o.at ? { key: 'at_temp', top: y + 3, h: 3 } : null;
  if (at) y += 6;
  const sky = o.sky ? { top: y + 7, bottom: y + 7 + SKY_H } : null;
  if (sky) y = sky.bottom;
  const mark = o.marks ? { y: y + 11 } : null;
  if (mark) y += 18;
  const axis = { top: y + 5 };
  // tapping the timeline: which strip is nearest
  const lanes = [mode, act, at].filter(Boolean);
  const bands = lanes.map((l, i) => [i ? (lanes[i - 1].top + lanes[i - 1].h + l.top) / 2 : l.top - 8,
    i < lanes.length - 1 ? (l.top + l.h + lanes[i + 1].top) / 2 : l.top + l.h + 6, l]);
  return { flowHead, mode, act, at, lanes, bands, main, roomHead, room, outHead, out, sky, mark, axis, chartBottom: y, height: axis.top + AXIS_H };
}
let Y = makeY({ mode: true, at: true, sky: true });

// ---------- small helpers ----------
const icon = (name, color, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" d="${ICONS[name]}"/></svg>`;
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
const deg = (v, dp = 1) => (v == null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}°`);
const signed = v => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`);
const dur = ms => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
};
const trim = v => String(Number(v.toFixed(2)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// sun height in degrees at time t (ms) for a latitude/longitude
function sunHeight(t, lat, lon) {
  const r = Math.PI / 180, d = (t - 946728000000) / 86400000;
  const g = (357.529 + 0.98560028 * d) * r;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 0.00000036 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const h = (((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(h)) / r;
}

// the Flow Target Breakdown helper's text, e.g. "curve 33.4 · room +0.2 · setback −3 · rounded +0.4"
function breakdown(text) {
  const t = String(text || '');
  const num = re => { const m = t.match(re); return m ? parseFloat(m[1].replace('−', '-')) : null; };
  if (!t.startsWith('curve')) return t && !['unknown', 'unavailable'].includes(t) ? { note: t.replace(': target is for the tank', ' (target is for the tank)') } : null;
  const c = num(/curve ([-−+]?[0-9.]+)/);
  const margin = num(/(?:margin|round-up) ([-−+]?[0-9.]+)/);
  let rounded = num(/rounded ([-−+]?[0-9.]+)/);
  if (rounded == null) rounded = margin == null ? 0 : margin - 1;
  return { curve: c == null ? null : c + (margin != null ? 1 : 0), room: num(/room ([-−+]?[0-9.]+)/) ?? 0, setback: num(/setback ([-−+]?[0-9.]+)/), rounded };
}

// readings -> [time, value], with values `read` rejects dropped and short dropouts (null) bridged
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

// the value at time t (the last reading at or before it)
function valueAt(points, t) {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (points[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans < 0 ? null : points[ans][1];
}

// stretches of the same state inside [t0, t1]: [start, end, state]
function runs(points, t0, t1, now) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const [t, s] = points[i], end = i + 1 < points.length ? points[i + 1][0] : now;
    if (end <= t0 || s == null || t >= t1) continue;
    out.push([Math.max(t, t0), Math.min(end, t1), s, t, end]);
  }
  return out;
}


class HeatPumpStoryCard extends HTMLElement {
  // ---------- Home Assistant plumbing ----------
  setConfig(config) {
    this._config = { hours: 12, ...config };
    this._ent = { ...DEFAULT_ENTITIES, ...(config.entities || {}) };
    this._scripts = { ...DEFAULT_SCRIPTS, ...(config.scripts || {}) };
    let saved = null;
    try {
      saved = Number(localStorage.getItem(STORE_KEY));
      this._showChanges = localStorage.getItem(CHANGES_KEY) === '1';
      this._compare = localStorage.getItem(COMPARE_KEY) === '1';
      this._lines = JSON.parse(localStorage.getItem(LINES_KEY) || '{}');
    } catch (e) { /* private mode */ }
    this._keyOpen = !!(this._lines && this._lines.key);
    // paused is a rest between heating runs: shown as a faded heating colour (or stripes), not grey like off
    const ps = this._config.paused_style || 'faded';
    ACT_FILL.Paused = ps === 'grey' ? 'rgba(150,156,168,0.42)' : ps === 'striped' ? 'url(#paused)' : 'rgba(255,122,77,0.38)';
    ACT_DOT.Paused = ps === 'grey' ? '#bfc3ca' : ps === 'striped' ? 'repeating-linear-gradient(135deg, #ff7a4d 0 2px, rgba(255,122,77,0.25) 2px 4px)' : 'rgba(255,122,77,0.45)';
    this._lines = { ret: !!(this._lines && this._lines.ret) };
    this._span = (RANGES.some(r => r[1] === saved) ? saved : this._config.hours) * 3600e3;
    this._end = null;   // null = live (the right-hand edge is now)
    this._store = {};
    this._from = null;
    this._oldest = null;
    if (this._hass) this._start();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._root) this._setup();
    let changed = false;
    for (const [k, id] of Object.entries(this._ent)) {
      const s = hass.states[id];
      if (s && s !== this._seen[k]) {
        this._seen[k] = s;
        changed = true;
        if (this._from != null) this._append(k, s);
      }
    }
    if (first) this._start();
    this._subForecast();
    const dark = hass.themes && hass.themes.darkMode != null ? hass.themes.darkMode : this._darkGuess();
    if (dark !== this._dark) { this._dark = dark; this.toggleAttribute('dark', !!dark); }
    if (changed || first) this._redraw();
  }

  _darkGuess() {
    const c = getComputedStyle(this).getPropertyValue('--card-background-color').trim();
    const m = c.match(/^#([0-9a-f]{6})$/i) || null, r = c.match(/rgba?\(([^)]+)\)/);
    const rgb = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : r ? r[1].split(',').slice(0, 3).map(Number) : null;
    return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 110 : false;
  }

  connectedCallback() {
    this._timer = setInterval(() => {
      if (Date.now() - (this._fetchedAt || 0) > REFRESH) this._refresh(); else if (this._end == null) this._redraw();
    }, 60000);
    this._onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - (this._fetchedAt || 0) > 120000) this._refresh();
    };
    document.addEventListener('visibilitychange', this._onVisible);
    if (this._root && this._hass) { this._subForecast(); this._redraw(); }
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    document.removeEventListener('visibilitychange', this._onVisible);
    if (this._fcSub) { this._fcSub.then(u => u && u()).catch(() => {}); this._fcSub = null; }
  }

  // the hourly weather forecast (for the look ahead), kept up to date by Home Assistant
  _subForecast() {
    if (this._fcSub || !this._lines.fc || !this._hass || !this._hass.connection || !this._ent.weather || this._config.forecast === false) return;
    this._fcSub = this._hass.connection.subscribeMessage(msg => {
      this._fc = ((msg && msg.forecast) || []).map(f => [Date.parse(f.datetime), Number(f.temperature), f.condition])
        .filter(f => Number.isFinite(f[0]) && Number.isFinite(f[1])).sort((a, b) => a[0] - b[0]);
      this._redraw();
    }, { type: 'weather/subscribe_forecast', forecast_type: 'hourly', entity_id: this._ent.weather });
    this._fcSub.catch(() => { this._fcSub = null; });
  }

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  static getStubConfig() {
    return {};
  }

  // ---------- history ----------
  // Opens from the copy saved last time (so it draws straight away), then tops up. Holds at least 24 hours,
  // so 3h to 24h switch instantly; older history is fetched a day at a time as you move back.
  _start() {
    const now = Date.now();
    const cache = this._loadCache();
    if (cache) {
      this._store = cache.store;
      this._from = cache.from;
      this._queue(cache.at - 10 * 60000, now);
      this._need(now - this._span);
    } else {
      this._queue(now - Math.max(24 * 3600e3, this._span), now);
    }
  }

  _refresh() {
    const now = Date.now();
    this._queue(Math.max(this._from ?? 0, now - 26 * 3600e3), now);
  }

  _need(t0) {
    if (this._from == null || this._oldest != null && t0 < this._oldest) return;
    if (t0 >= this._from - 60000 || this._prepending) return;
    const now = Date.now();
    const a = Math.max(Math.min(t0, this._from - 24 * 3600e3), now - MAX_BACK);
    if (a >= this._from - 60000) return;
    this._prepending = true;
    this._queue(a, this._from).then(() => { this._prepending = false; this._need(this._view().t0); });
  }

  _queue(a, b) {
    this._q = (this._q || Promise.resolve()).then(() => this._fetch(a, b));
    return this._q;
  }

  async _fetch(a, b) {
    if (!this._hass) return;
    this._loading = true;
    this._redraw();
    try {
      // one request for every sensor on the card
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(a).toISOString(),
        end_time: new Date(b).toISOString(),
        entity_ids: [...new Set(Object.values(this._ent))],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      for (const [k, id] of Object.entries(this._ent)) {
        const got = (res[id] || [])
          .map(e => [e.lu != null ? e.lu * 1000 : e.lc != null ? e.lc * 1000 : Date.parse(e.last_changed || e.last_updated),
                     String(e.s != null ? e.s : e.state).trim()])
          .sort((p, q) => p[0] - q[0]);
        const old = this._store[k] || [];
        this._store[k] = old.filter(p => p[0] < a).concat(got, old.filter(p => p[0] > b));
      }
      // nothing recorded before this point: stop asking for older history
      const flow = res[this._ent.flow] || [];
      if (this._from != null && a < this._from && (!flow.length || (flow[0].lu ?? 0) * 1000 > a + 3600e3)) this._oldest = a;
      this._from = this._from == null ? a : Math.min(this._from, a);
      this._error = null;
      this._saveCache();
    } catch (err) {
      this._error = 'History not available';
      console.warn('heat-pump-story-card: history', err);
    }
    this._fetchedAt = Date.now();
    this._loading = false;
    this._redraw();
  }

  _append(k, s) {
    const list = this._store[k] || (this._store[k] = []);
    const t = Date.parse(s.last_changed), v = String(s.state).trim();
    const last = list[list.length - 1];
    if (!last || (t > last[0] && v !== last[1])) list.push([t, v]);
  }

  _cacheKey() {
    return `${CACHE_KEY}:${Object.values(this._ent).join(',').length}:${this._ent.flow}`;
  }

  _loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(this._cacheKey()) || 'null');
      if (!c || Date.now() - c.at > 12 * 3600e3 || !c.store) return null;
      return c;
    } catch (e) {
      return null;
    }
  }

  _saveCache() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try {
        const now = Date.now(), from = Math.max(this._from, now - 26 * 3600e3), store = {};
        for (const [k, list] of Object.entries(this._store)) {
          const i = list.findIndex(p => p[0] >= from);
          store[k] = i < 0 ? list.slice(-1) : list.slice(Math.max(0, i - 1));
        }
        localStorage.setItem(this._cacheKey(), JSON.stringify({ at: now, from, store }));
      } catch (e) { /* storage full or private mode: just skip the instant reopen */ }
    }, 2000);
  }

  // ---------- what's on screen ----------
  _view() {
    const now = Date.now(), end = this._end != null ? Math.min(this._end, now) : now;
    return { now, end, t0: end - this._span, span: this._span };
  }

  // move or zoom: t0 = left-hand edge, span = width in ms; snaps back to live at the right-hand edge
  _setView(t0, span) {
    const now = Date.now();
    span = clamp(span, MIN_SPAN, MAX_SPAN);
    let end = clamp(t0 + span, now - MAX_BACK + span, now);
    this._span = span;
    this._end = end >= now - 20000 ? null : end;
    if (this._end == null) end = now;
    this._need(end - span);
    this._redraw();
  }

  // ---------- page structure (built once) ----------
  _setup() {
    this._seen = {};
    this._uid = Math.random().toString(36).slice(2, 8);
    const root = (this._root = this.attachShadow({ mode: 'open' }));
    root.innerHTML = `<style>${STYLE}</style>
      <ha-card><div class="wrap">
        <div class="head">
          <button class="ctl summary" aria-expanded="false" aria-label="Numbers for this range" title="Numbers for this range">${icon('stats', 'currentColor', 20)}</button>
          <div class="sinfo" aria-live="polite"></div>
          <button class="ctl cal" data-act="menu" aria-label="Choose dates and view options" aria-expanded="false">${icon('calendar', 'currentColor', 20)}</button>
          <div class="ranges" role="group" aria-label="Time range">${RANGES.map(([l, h]) =>
            `<button data-hours="${h}" aria-pressed="false">${l}</button>`).join('')}</div>
          <input class="date" type="date" tabindex="-1" aria-hidden="true">
        </div>
        <div class="navbar" hidden></div>
        <div class="stats" hidden></div>
        <div class="stage" style="height:${Y.height}px">
          <svg class="chart" aria-hidden="true"></svg>
          <div class="labels"></div>
          <svg class="cursor" aria-hidden="true"></svg>
          <div class="hit" tabindex="0" aria-label="Chart. Arrow keys step through time, plus and minus zoom."></div>
          <div class="ui"></div>
          <div class="tip" hidden></div>
        </div>
        <div class="legend"></div>
        <div class="whyrow"><div class="why"></div>
          <button class="ctl adjust-btn" data-act="adjust" aria-expanded="false">${icon('tune', 'currentColor', 18)}Adjust</button></div>
        <div class="adjust" hidden></div>
      </div></ha-card>`;
    const $ = s => root.querySelector(s);
    this._el = { stage: $('.stage'), summary: $('.summary'), sinfo: $('.sinfo'), head: $('.head'), stats: $('.stats'), ranges: $('.ranges'), chart: $('.chart'),
      labels: $('.labels'), cursor: $('.cursor'), hit: $('.hit'), ui: $('.ui'), tip: $('.tip'), legend: $('.legend'),
      why: $('.why'), navbar: $('.navbar'), cal: $('.cal'), date: $('.date'), adjust: $('.adjust'), adjustBtn: $('.adjust-btn') };

    this._el.ranges.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const h = Number(b.dataset.hours);
      try { localStorage.setItem(STORE_KEY, String(h)); } catch (err) { /* private mode */ }
      this._go(Date.now() - h * 3600e3, h * 3600e3);
    });
    this._el.summary.addEventListener('click', () => {
      this._statsOpen = !this._statsOpen;
      this._redraw();
    });
    this._el.date.addEventListener('change', () => {
      const v = this._el.date.value;
      if (!v) return;
      const [yy, mm, dd] = v.split('-').map(Number);
      this._day(new Date(yy, mm - 1, dd).getTime());
      this._menuOpen = false;
      this._drawNav();
    });
    // taps: legend items open that sensor; the water lines open the history page; buttons with data-act do
    // their thing; a mark shows what changed; anywhere else closes pop-ups
    root.addEventListener('click', e => {
      const path = e.composedPath();
      const el = path.find(n => n.dataset && (n.dataset.entity || n.dataset.history || n.dataset.change || n.dataset.live || n.dataset.act));
      if (this._menuOpen && !path.some(n => n.classList && n.classList.contains('presets')) && !(el && el.dataset.act === 'presets')) {
        this._menuOpen = false; this._drawNav();
      }
      if (!el) { if (!path.includes(this._el.hit)) this._hideTip(); return; }
      e.stopPropagation();
      const d = el.dataset;
      if (d.act) this._act(d.act, el);
      else if (d.entity) this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: d.entity } }));
      else if (d.history) {
        const v = this._view(), ids = [this._ent.flow, this._ent.return, this._ent.target].join(',');
        history.pushState(null, '', `/history?entity_id=${ids}&start_date=${new Date(v.t0).toISOString()}&end_date=${new Date(v.end).toISOString()}`);
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
      } else if (d.change) {
        if (this._tipKind === 'change' && this._tipChange === Number(d.change)) { this._hideTip(); this._drawChart(); }
        else { this._showChange(Number(d.change)); this._drawChart(); }
      }
      else if (d.live) this._go(Date.now() - this._span, this._span);
    });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._menuOpen) { this._menuOpen = false; this._drawNav(); return; }
      const d = e.target.dataset;
      if ((e.key === 'Enter' || e.key === ' ') && d && (d.entity || d.history || d.change || d.live || (d.act && e.target.tagName !== 'BUTTON'))) {
        e.preventDefault(); e.target.click();
      }
    });
    root.addEventListener('pointerup', e => {
      const b = e.composedPath().find(n => n.tagName === 'BUTTON');
      if (b && e.pointerType) setTimeout(() => b.blur(), 0);
    });
    this._gestures();
    new ResizeObserver(() => {
      const w = this._el.stage.clientWidth;
      if (w && w !== this._w) { this._w = w; this._redraw(); }
    }).observe(this._el.stage);
  }

  // jump to a window (t0 = left edge, span = width); live if it reaches now
  _go(t0, span) {
    this._hideTip();
    this._unscrub();
    this._setView(t0, span);
  }

  // a whole calendar day (today: from midnight until now)
  _day(t) {
    const d0 = new Date(t);
    d0.setHours(0, 0, 0, 0);
    const now = Date.now();
    if (d0.getTime() + DAY > now) this._go(d0.getTime(), Math.max(30 * 60000, now - d0.getTime()));
    else this._go(d0.getTime(), DAY);
  }

  // buttons in the menu, the compare chip and the Adjust panel
  _act(act, el) {
    const v = this._view();
    switch (act) {
      case 'menu':
        // the calendar button shows or hides the date bar; hiding it goes back to now
        this._navOpen = !this._navOpen;
        this._menuOpen = false;
        if (!this._navOpen && this._end != null) this._go(Date.now() - this._span, this._span);
        else this._redraw();
        break;
      case 'presets': this._menuOpen = !this._menuOpen; break;
      case 'prev': this._go(v.t0 - v.span, v.span); break;
      case 'next': this._go(v.t0 + v.span, v.span); break;
      case 'today': this._day(Date.now()); this._menuOpen = false; break;
      case 'yesterday': this._day(Date.now() - DAY); this._menuOpen = false; break;
      case 'week': this._go(Date.now() - 7 * DAY, 7 * DAY); this._menuOpen = false; break;
      case 'pick': {
        this._menuOpen = false;
        const d = this._el.date, min = new Date(Date.now() - 13 * DAY), max = new Date();
        const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
        d.min = iso(min); d.max = iso(max); d.value = iso(new Date(v.t0));
        try { d.showPicker(); } catch (err) { d.click(); }
        break;
      }
      case 'live': this._go(Date.now() - this._span, this._span); this._menuOpen = false; break;
      case 'warn': { const t = Number(el.dataset.t), span = 3 * 3600e3; this._go(Math.min(t - 0.25 * span, Date.now() - span), span); break; }
      case 'compare':
        this._compare = !this._compare;
        try { localStorage.setItem(COMPARE_KEY, this._compare ? '1' : '0'); } catch (err) { /* private mode */ }
        this._redraw();
        break;
      case 'changes':
        this._showChanges = !this._showChanges;
        try { localStorage.setItem(CHANGES_KEY, this._showChanges ? '1' : '0'); } catch (err) { /* private mode */ }
        this._hideTip();
        this._redraw();
        break;
      case 'line':
        this._lines[el.dataset.k] = !this._lines[el.dataset.k];
        if (el.dataset.k === 'fc') this._subForecast();
        try { localStorage.setItem(LINES_KEY, JSON.stringify({ ...this._lines, key: !!this._keyOpen })); } catch (err) { /* private mode */ }
        this._redraw();
        break;
      case 'adj-reset':
        if (this._adj && !this._adj.saving) { this._adj.draft = { ...this._adj.cur }; this._adj.status = ''; this._drawAdjust(); }
        break;
      case 'key':
        this._keyOpen = !this._keyOpen;
        try { localStorage.setItem(LINES_KEY, JSON.stringify({ ...this._lines, key: this._keyOpen })); } catch (err) { /* private mode */ }
        this._drawPanel();
        break;
      case 'cmp-next': {
        const opts = this._cmpOptions(v.span), cur = this._cmpShift(v.span) / DAY;
        this._cmpDays = opts[(opts.indexOf(cur) + 1) % opts.length];
        this._redraw();
        break;
      }
      case 'adj-undo':
        if (this._adj && !this._adj.saving) { this._adj.draft[el.dataset.k] = this._adj.cur[el.dataset.k]; this._drawAdjust(); }
        break;
      case 'adj-help': if (this._adj) { this._adj.help = !this._adj.help; this._drawAdjust(); } break;
      case 'adjust': this._adjOpen(!this._adj || !this._adj.open); break;
      case 'adj-close': case 'adj-cancel': this._adjOpen(false); break;
      case 'adj-dec': case 'adj-inc': this._adjStep(el.dataset.k, act === 'adj-inc' ? 1 : -1); break;
      case 'adj-save': this._adjSave(); break;
    }
    this._drawNav();
  }

  // ---------- gestures ----------
  _gestures() {
    const hit = this._el.hit;
    const pts = new Map();
    let mode = null, start = null, pinch = null, longT = null, lastTap = 0;
    const pos = e => { const r = this._el.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const width = () => this._m.X1 - this._m.X0;
    const anchor = x => { const v = this._view(); return v.t0 + ((x - this._m.X0) / width()) * v.span; };

    hit.addEventListener('pointerdown', e => {
      if (!this._m) return;
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      pts.set(e.pointerId, pos(e));
      clearTimeout(this._hold);
      if (pts.size === 2) {
        // two fingers: pinch to zoom (and move with them)
        clearTimeout(longT);
        const [a, b] = [...pts.values()], v = this._view();
        mode = 'pinch';
        pinch = { d: Math.max(20, Math.abs(a.x - b.x)), mid: (a.x + b.x) / 2, span: v.span, at: anchor((a.x + b.x) / 2) };
        this._hideTip();
        this._unscrub();
        return;
      }
      const p = pos(e), v = this._view();
      start = { ...p, t0: v.t0, span: v.span, touch: e.pointerType !== 'mouse' };
      mode = null;
      if (start.touch) {
        // touch and hold: scrub the details instead of moving
        longT = setTimeout(() => {
          if (mode) return;
          mode = 'scrub';
          if (navigator.vibrate) navigator.vibrate(8);
          this._scrub(p.x);
        }, 380);
      }
    });

    hit.addEventListener('pointermove', e => {
      if (!this._m) return;
      const p = pos(e);
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && !e.buttons) this._scrub(p.x);   // hover
        return;
      }
      pts.set(e.pointerId, p);
      if (mode === 'pinch' && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const span = pinch.span * (pinch.d / Math.max(20, Math.abs(a.x - b.x)));
        const mid = (a.x + b.x) / 2;
        this._setView(pinch.at - ((mid - this._m.X0) / width()) * clamp(span, MIN_SPAN, MAX_SPAN), span);
        return;
      }
      if (!start) return;
      const dx = p.x - start.x, dy = p.y - start.y;
      if (!mode && Math.hypot(dx, dy) > 6) {
        clearTimeout(longT);
        mode = 'pan';
        this._hideTip();
        this._unscrub();
      }
      if (mode === 'pan') this._setView(start.t0 - (dx / width()) * start.span, start.span);
      else if (mode === 'scrub') this._scrub(p.x);
    });

    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      clearTimeout(longT);
      if (mode === 'pinch') { if (!pts.size) mode = null; start = null; return; }
      if (e.type === 'pointerup' && !mode && start) {
        // a tap: a strip shows its stretch; anywhere else shows the details (double-click/tap = back to now)
        const now = Date.now();
        if (now - lastTap < 300) { this._hideTip(); this._unscrub(); this._setView(now - this._span, this._span); lastTap = 0; }
        else { lastTap = now; this._tap(start.x, start.y, start.touch); }
      }
      if (mode === 'scrub' && start && start.touch) this._hold = setTimeout(() => this._unscrub(), 5000);
      mode = null;
      start = null;
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
    hit.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && !pts.size) this._unscrub();
    });
    // trackpads: pinch (sent as Ctrl + scroll) zooms, a sideways swipe moves; ordinary scrolling still scrolls the page
    hit.addEventListener('wheel', e => {
      if (!this._m) return;
      const p = pos(e), v = this._view();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const span = clamp(v.span * Math.exp(e.deltaY * 0.01), MIN_SPAN, MAX_SPAN);
        this._setView(anchor(p.x) - ((p.x - this._m.X0) / width()) * span, span);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        this._hideTip();
        this._setView(v.t0 + (e.deltaX / width()) * v.span, v.span);
      }
    }, { passive: false });
    hit.addEventListener('keydown', e => {
      if (!this._m) return;
      const v = this._view();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const t = clamp((this._scrubT ?? v.end) + (e.key === 'ArrowLeft' ? -1 : 1) * v.span / 60, v.t0, v.end);
        this._scrub(this._m.x(t));
      } else if (e.key === '+' || e.key === '=' || e.key === '-') {
        e.preventDefault();
        const span = v.span * (e.key === '-' ? 1.5 : 1 / 1.5);
        this._setView(v.end - span, span);
      } else if (e.key === 'Escape') this._unscrub();
    });
    hit.addEventListener('blur', () => this._unscrub());
  }

  _tap(x, y, touch) {
    const band = Y.bands.find(([a, b]) => y >= a && y < b);
    if (band) this._showRun(band[2], this._m.tAt(x));
    else if (touch) { this._scrub(x); clearTimeout(this._hold); this._hold = setTimeout(() => this._unscrub(), 6000); }
  }

  _redraw() {
    // several sensors often change together, and moving fires many events: draw once per frame
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  // ---------- working out what to draw ----------
  _model() {
    const { now, end, t0, span } = this._view();
    const W = this._w || this._el.stage.clientWidth || 380;
    const X0 = GUTTER_L, X1 = W - GUTTER_R;
    const st = this._store;
    const S = {};
    const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : undefined; };
    S.activity = cleanSeries(st.activity, s => (['unknown', 'unavailable', ''].includes(s) ? null : RENAME[s] || s), now, true);
    S.period = cleanSeries(st.period, s => (['Day', 'Night', 'Off'].includes(s) ? s : null), now, true);
    S.at_temp = cleanSeries(st.at_temp, s => (s === 'on' ? 'on' : s === 'off' ? 'off' : null), now, true);
    for (const k of NUM_KEYS) {
      const lim = LIMITS[k];
      S[k] = cleanSeries(st[k], s => {
        const v = parseFloat(s);
        if (!Number.isFinite(v)) return null;
        if (lim != null) return v >= 0 && v < lim ? v : undefined;
        return v > -40 && v < 95 ? v : undefined;
      }, now, false);
    }
    S.weather = cleanSeries(st.weather, s => (WX[s] ? s : null), now, true);
    S.setback_size = cleanSeries(st.setback_size, s => { const v = parseFloat(s); return Number.isFinite(v) ? v : undefined; }, now, true);
    // the settings and the hub's desired flow over time (Adjust's sums follow the scrub)
    for (const k of ['curve', 'shift', 'room_factor', 'day_temp', 'night_temp', 'desired']) S[k] = cleanSeries(st[k], num, now, true);
    S.energy = cleanSeries(st.energy, s => { const v = parseFloat(s); return Number.isFinite(v) && v >= 0 ? v : undefined; }, now, true);
    S.breakdown = (st.breakdown || []).filter(p => !['unknown', 'unavailable'].includes(p[1]));
    S.sb = S.breakdown.map(([t, txt]) => { const w = breakdown(txt); return [t, w && w.setback ? 'on' : 'off']; })
      .filter((p, i, a) => i === 0 || p[1] !== a[i - 1][1]);
    // the room set temp over time: the day or night temp, whichever is in use (none while heating is off)
    const dayT = cleanSeries(st.day_temp, num, now, true), nightT = cleanSeries(st.night_temp, num, now, true);
    const times = [...new Set([...S.period, ...dayT, ...nightT].map(p => p[0]))].sort((a, b) => a - b);
    S.setp = cleanSeries(times.map(t => {
      const p = valueAt(S.period, t);
      return [t, p === 'Night' ? valueAt(nightT, t) : p === 'Day' ? valueAt(dayT, t) : null];
    }), v => v, now, true);
    // a set temp that changes and goes straight back within 10 minutes (a setting tried and undone, or a brief
    // schedule flicker) isn't drawn
    S.setp = S.setp.filter((p, i, a) => !(i > 0 && i + 1 < a.length && a[i + 1][0] - p[0] < 10 * 60000 && a[i + 1][1] === a[i - 1][1] && p[1] !== a[i - 1][1]))
      .filter((p, i, a) => i === 0 || p[1] !== a[i - 1][1]);

    // the look ahead (only when showing now): the forecast outside temp, the schedule as it was this time
    // yesterday, and the target those would give if nothing else changes. The chart runs on past now by a quarter
    // of the range (1 to 12 hours).
    const ahead = this._end == null && this._lines.fc === true && this._config.forecast !== false && this._fc && this._fc.length
      ? clamp(span / 4, 3600e3, 12 * 3600e3) : 0;
    const fc = ahead ? this._forecast(S, now, now + ahead) : null;
    const fEnd = fc ? fc.end : end, xs = fEnd - t0;
    const x = t => X0 + ((t - t0) / xs) * (X1 - X0);

    const acts = runs(S.activity, t0, end, now);
    const hw = acts.filter(r => r[2] === 'Hot water');
    const shift = this._compare ? this._cmpShift(span) : 0;
    const cmp = this._compare ? { t0: t0 - shift, end: end - shift, shift } : null;
    const inRange = (k, a, b) => {
      const out = [], v0 = valueAt(S[k], a);
      if (v0 != null) out.push(v0);
      for (const [t, v] of S[k]) if (t > a && t <= b && v != null) out.push(v);
      return out;
    };

    // water temperature scale: everything on screen (and the dashed comparison), in steps of 5 or 10
    const showRet = this._lines.ret;
    const vals = [...inRange('target', t0, end), ...inRange('flow', t0, end), ...(showRet ? inRange('return', t0, end) : []),
      ...(cmp ? inRange('flow', cmp.t0, cmp.end) : []), ...(fc ? fc.target.map(p => p[1]) : [])];
    let lo = vals.length ? Math.min(...vals) : 20, hi = vals.length ? Math.max(...vals) : 50;
    lo = Math.floor((lo - 1) / 5) * 5;
    hi = Math.ceil((hi + 1) / 5) * 5;
    if (hi - lo < 10) hi = lo + 10;
    // about 30 px between lines, like the Home Assistant graphs
    const step = [2, 5, 10, 20].find(st => (st * MAIN_H) / (hi - lo) >= 30) || 20;
    const y = v => Y.main.bottom - ((v - lo) / (hi - lo)) * MAIN_H;

    // small charts: each its own low to high (at least 2 degrees)
    const small = (keys, box, H) => {
      let pts = [];
      for (const k of keys) pts = pts.concat(inRange(k, t0, end), cmp ? inRange(k, cmp.t0, cmp.end) : [], fc && fc[k] ? fc[k].map(p => p[1]).filter(v => v != null) : []);
      let a = pts.length ? Math.min(...pts) : 0, b = pts.length ? Math.max(...pts) : 10;
      if (b - a < 2) { const c = (a + b) / 2; a = c - 1; b = c + 1; }
      return { lo: a, hi: b, y: v => box.bottom - 3 - ((v - a) / (b - a)) * (H - 6) };
    };
    const extremes = k => {
      let mn = null, mx = null;
      for (const p of [[t0, valueAt(S[k], t0)], ...S[k].filter(p => p[0] > t0 && p[0] <= end)]) {
        if (p[1] == null) continue;
        if (!mn || p[1] < mn[1]) mn = p;
        if (!mx || p[1] > mx[1]) mx = p;
      }
      return { min: mn, max: mx };
    };
    const O = small(['outside'], Y.out, OUT_H), R = small(['room', 'setp'], Y.room, ROOM_H);

    return { now, end, t0, span, xs, fEnd, fc, live: this._end == null, W, X0, X1, x, S, acts, hw, lo, hi, step, y, cmp,
      olo: O.lo, ohi: O.hi, yo: O.y, rlo: R.lo, rhi: R.hi, yr: R.y, oext: extremes('outside'), rext: extremes('room'),
      changes: this._changes(S, t0, end, now), tAt: px => t0 + ((px - X0) / (X1 - X0)) * xs };
  }

  // the look ahead from now to fEnd: outside from the hourly forecast (nudged to match your sensor now, fading
  // out over 6 hours), the Day/Night schedule as it was 24 hours earlier, the set temp that gives, and the target
  // from the weather curve, holding the room's part as it is now (≈, so it's a guide)
  _forecast(S, now, fEnd) {
    const F = this._fc, out0 = valueAt(S.outside, now);
    const fAt = t => {
      if (t <= F[0][0]) return F[0][1];
      for (let i = 1; i < F.length; i++) if (F[i][0] >= t) return F[i - 1][1] + (F[i][1] - F[i - 1][1]) * (t - F[i - 1][0]) / (F[i][0] - F[i - 1][0]);
      return null;
    };
    const bias = out0 != null && fAt(now) != null ? out0 - fAt(now) : 0;
    const out = [];
    for (let t = now; t <= fEnd + 1; t += 10 * 60000) {
      const v = fAt(t);
      if (v == null) break;
      out.push([t, t === now && out0 != null ? out0 : v + bias * Math.max(0, 1 - (t - now) / (6 * 3600e3))]);
    }
    if (!out.length) return null;
    const end = Math.min(fEnd, out[out.length - 1][0]);
    const cond = F.filter(f => f[0] <= end).map(f => [f[0], f[2]]);
    // the schedule: as it is now, then yesterday's changes a day on
    const p0 = valueAt(S.period, now);
    const period = [[now, p0], ...S.period.filter(p => p[0] > now - DAY && p[0] <= end - DAY).map(p => [p[0] + DAY, p[1]])]
      .filter((p, i, a) => i === 0 || p[1] !== a[i - 1][1]);
    const dayT = this._num('day_temp'), nightT = this._num('night_temp');
    const spOf = p => (p === 'Day' ? dayT : p === 'Night' ? nightT : null);
    const setp = period.map(([t, p]) => [t, spOf(p)]);
    // (while the schedule has the heating off, the hub still works the target out, from the night temp)
    const spModel = p => (p === 'Day' ? dayT : nightT);
    // the target: from the curve, with the room's part (and the setback) worked out from the room as it is now
    let target = [];
    const curve = this._num('curve'), shift = this._num('shift'), factor = this._num('room_factor');
    const room = valueAt(S.room, now), tgt0 = valueAt(S.target, now), sb = this._num('setback_size') ?? 3;
    if (curve != null && shift != null && factor != null && out0 != null && tgt0 != null) {
      const curveT = o => 20 + shift + curve * Math.pow(Math.max(20 - o, 0), 1.15);
      const model = (o, p) => {
        const sp = spModel(p);
        if (sp == null || room == null) return curveT(o);
        return curveT(o) + factor * (sp - room) - (room >= sp ? sb : 0);
      };
      const w = breakdown(this._hass.states[this._ent.breakdown]?.state);
      const desired = this._num('desired');
      const base = desired != null ? desired : w && w.curve != null ? w.curve + (w.room ?? 0) + (w.setback ?? 0) - 1 : model(out0, p0);
      const resid = base - model(out0, p0);
      const hwNow = valueAt(S.activity, now) === 'Hot water';
      const ref = hwNow ? Math.ceil(base - 1e-9) + 1 : tgt0;
      for (const [t, o] of out) {
        const v = ref + Math.ceil(model(o, valueAt(period, t)) + resid - 1e-9) - Math.ceil(base - 1e-9);
        if (!target.length || target[target.length - 1][1] !== v) target.push([t, v]);
      }
      // ...and at each change of schedule
      for (const [t, p] of period.slice(1)) {
        const v = ref + Math.ceil(model(valueAt(out, t), p) + resid - 1e-9) - Math.ceil(base - 1e-9);
        target.push([t, v]);
      }
      target.sort((a, b) => a[0] - b[0]);
      target = target.filter((q, i, a) => i === 0 || q[1] !== a[i - 1][1]);
    }
    // its colour: as the target is now until the schedule changes (coral rather than amber: the tank will be
    // done), then coral, or grey while the schedule has the heating off
    const firstChange = period.length > 1 ? period[1][0] : Infinity;
    const colAt = t => {
      if (t >= firstChange) return valueAt(period, t) === 'Off' ? TGT_OFF : C.target;
      const c0 = this._tgtCol ? this._tgtCol(now - 1000) : C.target;
      return c0 === C.hw ? C.target : c0;
    };
    return { end, outside: out, cond, period, setp, target, colAt };
  }

  // setting changes, with changes a few minutes apart grouped and brief flickers ignored
  _changes(S0, t0, end, now) {
    const ev = [];
    for (const [k, label, unit] of SETTINGS) {
      const pts = cleanSeries(this._store[k], s => { const v = parseFloat(s); return Number.isFinite(v) ? v : undefined; }, now, true);
      for (let i = 1; i < pts.length; i++) {
        // a value that flips and comes straight back within 5 minutes is a hub glitch
        if (i + 1 < pts.length && pts[i + 1][1] === pts[i - 1][1] && pts[i + 1][0] - pts[i][0] < 10 * 60000) { i++; continue; }
        ev.push({ t: pts[i][0], k, label, unit, from: pts[i - 1][1], to: pts[i][1] });
      }
    }
    ev.sort((a, b) => a.t - b.t);
    const groups = [];
    for (const e of ev) {
      const g = groups[groups.length - 1];
      if (g && e.t - g.last <= 10 * 60000) { g.items.push(e); g.last = e.t; } else groups.push({ t: e.t, last: e.t, items: [e] });
    }
    return groups.map(g => {
      const by = new Map();
      for (const e of g.items) {
        const o = by.get(e.k);
        if (o) o.to = e.to; else by.set(e.k, { ...e });
      }
      return { t: g.t, items: [...by.values()].filter(o => o.from !== o.to) };
    }).filter(g => g.items.length && g.t > t0 && g.t <= end);
  }

  _draw() {
    if (!this._root || !this._hass || !this._config) return;
    Y = makeY({ mode: true, at: false, sky: true, marks: !!this._showChanges });
    // the look ahead needs the schedule from this time yesterday
    if (this._end == null && this._fc) this._need(Date.now() - DAY);
    this._el.stage.style.height = `${Y.height}px`;
    this._m = this._model();
    const m = this._m;
    if (m.cmp) this._need(m.cmp.t0);
    // marks closer than 18 px share one
    m.flags = [];
    if (this._showChanges) {
      for (const g of m.changes) {
        const X = m.x(g.t), f = m.flags[m.flags.length - 1];
        if (f && X - f.x0 < 18) { f.groups.push(g); f.x = (f.x0 + X) / 2; } else m.flags.push({ x: X, x0: X, groups: [g] });
      }
    }
    Object.assign(this._el.hit.style, { left: `${m.X0 - 6}px`, width: `${m.X1 - m.X0 + 12}px`, top: '-8px', height: `${Y.chartBottom + 12}px` });
    for (const b of this._el.ranges.children) {
      b.setAttribute('aria-pressed', String(m.live && Number(b.dataset.hours) * 3600e3 === m.span));
    }
    if (!m.live) this._navOpen = true;
    this._drawNav();
    this._drawChart();
    this._drawUi();
    this._drawPanel();
    this._drawStats();
    if (this._adj && this._adj.open) this._drawAdjust();
    if (this._tipKind === 'change') this._showChange(this._tipChange);
    if (this._scrubT != null) this._scrub(m.x(this._scrubT));
  }

  // a small chart (room or outside): line coloured by temperature, its low and high on the left
  _small(m, k, box, H, yf, lo, hi, ext, id, extra, green) {
    let s = '', labels = '';
    const grad = `${k}-${id}`;
    const defs = `<linearGradient id="${grad}" x1="0" x2="0" y1="${yf(hi)}" y2="${yf(lo)}" gradientUnits="userSpaceOnUse">${
      [0, 0.25, 0.5, 0.75, 1].map(f => `<stop offset="${f}" stop-color="${mix(AIR, hi - f * (hi - lo))}"/>`).join('')}</linearGradient>`;
    s += extra || '';
    if (m.cmp) {
      const pm = { t0: m.cmp.t0, end: m.cmp.end, x: t => m.x(t + m.cmp.shift) };
      const pp = this._path(m.S[k], pm, yf, false);
      if (pp) s += `<path d="${pp}" class="ln prev" stroke="var(--secondary-text-color)" stroke-width="1"/>`;
    }
    const p = this._path(m.S[k], m, yf, false);
    if (p) {
      for (const seg of p.split('M').filter(Boolean)) {
        const c = seg.trim().split('L').map(q => q.trim().split(' '));
        s += `<path d="M${seg} L${c[c.length - 1][0]} ${box.bottom} L${c[0][0]} ${box.bottom} Z" fill="url(#${grad})" fill-opacity="0.14"/>`;
      }
      s += green ? `<g mask="url(#${green.mask})"><path d="${p}" class="ln" stroke="url(#${grad})" stroke-width="1.25"/></g>
        <g clip-path="url(#${green.clip})"><path d="${p}" class="ln" stroke="${C.atTemp}" stroke-width="1.75"/></g>`
        : `<path d="${p}" class="ln" stroke="url(#${grad})" stroke-width="1.25"/>`;
      for (const q of [ext.max, ext.min]) if (q) s += `<circle cx="${Math.max(m.X0, m.x(q[0])).toFixed(1)}" cy="${yf(q[1]).toFixed(1)}" r="2.75" fill="${mix(AIR, q[1])}" class="dot"/>`;
      let yHi = ext.max ? yf(ext.max[1]) : null, yLo = ext.min ? yf(ext.min[1]) : null;
      if (yHi != null && yLo != null && yLo - yHi < 12) { const c = (yHi + yLo) / 2; yHi = c - 6; yLo = c + 6; }
      if (ext.max) labels += `<span class="olabel" style="top:${yHi.toFixed(1)}px;right:${m.W - m.X0 + 5}px;color:${mix(AIR, ext.max[1])}">${deg(ext.max[1])}</span>`;
      if (ext.min && ext.min[1] !== ext.max[1]) labels += `<span class="olabel" style="top:${yLo.toFixed(1)}px;right:${m.W - m.X0 + 5}px;color:${mix(AIR, ext.min[1])}">${deg(ext.min[1])}</span>`;
    }
    return { s, labels, defs };
  }

  // ---------- the picture ----------
  _drawChart() {
    const m = this._m, { X0, X1, x, S, t0, end, y } = m;
    const id = this._uid;
    const ticks = this._ticks(m);
    let s = '';
    const defs = [];

    // ---- timeline: Day/Night line, activity bar (with defrost ticks), at-temp line ----
    const XN = x(end), fc = m.fc;
    // the look ahead: a faint wash over the charts after now
    if (fc) {
      for (const [a, b] of [[Y.main.top, Y.main.bottom], [Y.room.top, Y.room.bottom], [Y.out.top, Y.out.bottom]]) {
        s += `<rect x="${XN.toFixed(1)}" width="${(X1 - XN).toFixed(1)}" y="${a}" height="${b - a}" class="ahead"/>`;
      }
    }
    s += `<rect x="${X0}" width="${(XN - X0).toFixed(1)}" y="${Y.act.top}" height="${Y.act.h}" rx="3" fill="${C.track}"/>`;
    defs.push(`<clipPath id="act-${id}"><rect x="${X0}" width="${(XN - X0).toFixed(1)}" y="${Y.act.top}" height="${Y.act.h}" rx="3"/></clipPath>`);
    let bar = '';
    for (const [a, b, v] of m.acts) {
      if (!ACT_FILL[v]) continue;
      bar += `<rect x="${x(a).toFixed(2)}" width="${Math.max(0.5, x(b) - x(a)).toFixed(2)}" y="${Y.act.top}" height="${Y.act.h}" fill="${ACT_FILL[v] === 'url(#paused)' ? `url(#paused-${id})` : ACT_FILL[v]}"/>`;
    }
    for (const [a, b, v] of m.acts) {
      if (v !== 'Defrost') continue;
      const w = Math.max(2, x(b) - x(a));
      bar += `<rect x="${(x(a) + (x(b) - x(a)) / 2 - w / 2).toFixed(2)}" width="${w.toFixed(2)}" y="${Y.act.top}" height="${Y.act.h}" fill="${DEFROST}"/>`;
    }
    defs.push(`<pattern id="paused-${id}" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
      <rect width="4" height="4" fill="rgba(255,122,77,0.22)"/><rect width="2" height="4" fill="#ff7a4d"/></pattern>`);
    s += `<g clip-path="url(#act-${id})">${bar}</g>`;
    for (const [a, b, v] of runs(S.period, t0, end, m.now)) {
      if (MODE_DOT[v]) s += `<rect x="${x(a).toFixed(2)}" width="${Math.max(0.5, x(b) - x(a)).toFixed(2)}" y="${Y.mode.top}" height="${Y.mode.h}" rx="1.5" fill="${v === 'Off' ? 'rgba(148,152,160,0.5)' : MODE_DOT[v]}"/>`;
    }
    if (fc) for (const [a, b, v] of runs(fc.period, end, fc.end, fc.end)) {
      if (MODE_DOT[v]) s += `<rect x="${(x(a) + 1.5).toFixed(2)}" width="${Math.max(0.5, x(b) - x(a) - 1.5).toFixed(2)}" y="${Y.mode.top}" height="${Y.mode.h}" rx="1.5" fill="${v === 'Off' ? 'rgba(148,152,160,0.5)' : MODE_DOT[v]}" opacity="0.4"/>`;
    }

    // ---- water temperatures ----
    for (let v = Math.ceil(m.lo / m.step) * m.step; v <= m.hi + 0.01; v += m.step) {
      s += `<line x1="${X0}" x2="${X1}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/>`;
    }
    for (const [t] of ticks) {
      const X = x(t).toFixed(1);
      for (const [a, b] of [[Y.main.top, Y.main.bottom], [Y.room.top, Y.room.bottom], [Y.out.top, Y.out.bottom]]) {
        s += `<line x1="${X}" x2="${X}" y1="${a}" y2="${b}" class="grid"/>`;
      }
    }
    // setting changes: a dotted line through every chart
    for (const f of m.flags) {
      for (const [a, b] of [[Y.main.top, Y.main.bottom], [Y.room.top, Y.room.bottom], [Y.out.top, Y.out.bottom]]) {
        s += `<line x1="${f.x.toFixed(1)}" x2="${f.x.toFixed(1)}" y1="${a}" y2="${b}" class="change${this._tipKind === 'change' && m.flags[this._tipChange] === f ? ' sel' : ''}"/>`;
      }
    }

    // the previous period, dashed underneath
    if (m.cmp) {
      const pm = { t0: m.cmp.t0, end: m.cmp.end, x: t => x(t + m.cmp.shift) };
      s += `<path d="${this._path(S.flow, pm, y, false)}" class="ln prev" stroke="${C.flow}" stroke-width="1.25"/>`;
    }

    // ---- the lines: return (if switched on), the target and the flow ----
    const ret = this._lines.ret ? this._path(S.return, m, y, false) : '', flow = this._path(S.flow, m, y, false);
    // the setback (the room at its set temp, so the water target is lowered): the stretches it's on, joining any
    // break of under 10 minutes (e.g. a short hot water run), each from where the target actually steps down
    // (the hub can take a few minutes after the room gets there)
    const sbRuns = [];
    for (const r of runs(S.sb, t0, end, m.now).filter(q => q[2] === 'on')) {
      const last = sbRuns[sbRuns.length - 1];
      if (last && r[0] - last[1] < 10 * 60000) last[1] = r[1]; else sbRuns.push([r[0], r[1]]);
    }
    const sbFrom = a0 => {
      const before = valueAt(S.target, a0 - 60000);
      for (const [t, v] of S.target) {
        if (t < a0 - 60000 || t > a0 + 15 * 60000) continue;
        if (before != null && v != null && v <= before - 1.5) return t;
      }
      return a0 + 3 * 60000;
    };
    const sbAdj = sbRuns.map(([a0, b]) => [sbFrom(a0), b]).filter(([a, b]) => a < b);
    // the target's colour: amber while it's for the hot water, grey while the heat pump is off, green while the
    // setback lowers it, otherwise coral (a defrost keeps the colour of what it interrupted)
    const showSb = this._config.setback_style !== 'none';
    const actND = S.activity.filter(p => p[1] !== 'Defrost');
    const colAt = t => {
      const act = valueAt(actND, t);
      return act === 'Hot water' ? C.hw : act === 'Off' ? TGT_OFF : showSb && sbAdj.some(([a, b]) => t >= a && t < b) ? C.atTemp : C.target;
    };
    // the activity sensor changes a minute or two after the target steps (or before), so a colour change within
    // 10 minutes of a step moves onto that step: the whole hot water block is amber, and the step after it isn't
    const SNAP = 10 * 60000;
    const steps = S.target.filter((p, i) => p[1] != null && (i === 0 || p[1] !== S.target[i - 1][1])).map(p => p[0])
      .filter(t => t > t0 - SNAP && t < end + SNAP);
    const near = c => {
      let best = null;
      for (const st of steps) if (Math.abs(st - c) <= SNAP && (best == null || Math.abs(st - c) < Math.abs(best - c))) best = st;
      return best;
    };
    let tl = [[t0, colAt(t0)]];
    for (const c of [...actND.map(p => p[0]), ...sbAdj.flat()].filter(c => c > t0 && c < end).sort((a, b) => a - b)) {
      const col = colAt(c);
      if (col === tl[tl.length - 1][1]) continue;
      const st = near(c);
      tl.push([st != null ? Math.max(st, t0) : c, col]);
    }
    tl.sort((a, b) => a[0] - b[0]);
    tl = tl.filter((p, i) => i + 1 >= tl.length || tl[i + 1][0] !== p[0]);
    this._tgtCol = t => valueAt(tl, t) || tl[0][1];
    this._tgtCuts = tl.slice(1).map(p => p[0]);
    s += `${ret ? `<path d="${ret}" class="ln" stroke="${C.ret}" stroke-width="1"/>` : ''}
      ${this._stepSegs(S.target, m, y, t => this._tgtCol(t), this._tgtCuts, C.hw)}
      <path d="${flow}" class="ln" stroke="${C.flow}" stroke-width="1.5"/>`;
    // the target ahead, dotted (grey while the schedule has the heating off)
    if (fc && fc.target.length) {
      const fm = { t0: end, end: fc.end, x };
      s += this._stepSegs(fc.target, fm, y, fc.colAt).replace(/class="ln"/g, 'class="ln fc"');
    }

    let labels = '';
    // end dots
    const ends = [['target', this._tgtCol(m.end - 1000), 0, 3], ['flow', C.flow, 1, 3.5]]
      .map(([k, col, dp, r]) => ({ col, dp, r, v: valueAt(S[k], m.end) })).filter(o => o.v != null);
    for (const o of ends) s += `<circle cx="${XN.toFixed(1)}" cy="${y(o.v).toFixed(1)}" r="${o.r}" fill="${o.col}" class="dot"/>`;
    for (let v = Math.ceil(m.lo / m.step) * m.step; v <= m.hi + 0.01; v += m.step) {
      labels += `<span class="ytick" style="top:${y(v).toFixed(1)}px;right:${m.W - X0 + 5}px">${v}°</span>`;
    }
    labels += `<span class="shead" style="top:${Y.flowHead.top}px;left:${X0}px;width:${X1 - X0}px">
      <span data-history="1" role="button" tabindex="0">Flow</span><span class="hv flow-val"></span></span>`;

    // ---- room: against its set temp (grey dashed); the room line turns green while it's at temp ----
    // (only while there's a set temp: the hub's flag means nothing while the heating's off)
    const hasSet = runs(S.setp.map(([t, v]) => [t, v == null ? 'no' : 'yes']), t0, end, m.now).filter(r => r[2] === 'yes');
    const atRuns = [];
    for (const [a, b] of runs(S.at_temp, t0, end, m.now).filter(r => r[2] === 'on')) {
      for (const [c, d] of hasSet) { const p = Math.max(a, c), q = Math.min(b, d); if (q > p) atRuns.push([p, q]); }
    }
    let roomGreen = null;
    if (atRuns.length) {
      const atRects = atRuns.map(([a, b]) => `<rect x="${x(a).toFixed(1)}" y="${Y.room.top - 6}" width="${Math.max(1, x(b) - x(a)).toFixed(1)}" height="${ROOM_H + 12}"/>`).join('');
      defs.push(`<clipPath id="atc-${id}">${atRects}</clipPath><mask id="natc-${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${m.W}" height="${Y.height}">
        <rect x="0" y="0" width="${m.W}" height="${Y.height}" fill="white"/>${atRects.replace(/<rect /g, '<rect fill="black" ')}</mask>`);
      roomGreen = { clip: `atc-${id}`, mask: `natc-${id}` };
    }
    const sp = this._path(S.setp, m, m.yr, true);
    const fsp = fc ? this._path(fc.setp, { t0: end, end: fc.end, x }, m.yr, true) : '';
    const setLine = (sp ? `<path d="${sp}" class="ln" stroke="var(--secondary-text-color)" stroke-width="1.25" stroke-dasharray="3 3" stroke-opacity="0.75"/>` : '') +
      (fsp ? `<path d="${fsp}" class="ln" stroke="var(--secondary-text-color)" stroke-width="1.25" stroke-dasharray="3 3" stroke-opacity="0.4"/>` : '');
    const room = this._small(m, 'room', Y.room, ROOM_H, m.yr, m.rlo, m.rhi, m.rext, id, setLine, roomGreen);
    defs.push(room.defs); s += room.s; labels += room.labels;
    labels += `<span class="shead" style="top:${Y.roomHead.top}px;left:${X0}px;width:${X1 - X0}px">
      <span data-entity="${this._ent.room}" role="button" tabindex="0">Room</span><span class="hv room-val"></span></span>`;
    // ---- outside ----
    const out = this._small(m, 'outside', Y.out, OUT_H, m.yo, m.olo, m.ohi, m.oext, id, '');
    defs.push(out.defs); s += out.s; labels += out.labels;
    // the forecast outside temp, dotted
    if (fc && fc.outside.length > 1) {
      s += `<path d="${fc.outside.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${m.yo(v).toFixed(1)}`).join(' ')}" class="ln fc" stroke="url(#outside-${id})" stroke-width="1.5"/>`;
    }
    labels += `<span class="shead" style="top:${Y.outHead.top}px;left:${X0}px;width:${X1 - X0}px">
      <span data-entity="${this._ent.outside}" role="button" tabindex="0">Outside</span><span class="hv out-val"></span></span>`;

    // ---- sky: a thin strip over the time axis, coloured by how high the sun is ----
    const lat = this._hass.config && this._hass.config.latitude, lon = this._hass.config && this._hass.config.longitude;
    if (Y.sky && lat != null && lon != null) {
      const n = Math.min(240, Math.max(24, Math.round(m.xs / 600000)));
      defs.push(`<linearGradient id="sky-${id}" x1="${X0}" x2="${X1}" y1="0" y2="0" gradientUnits="userSpaceOnUse">${
        Array.from({ length: n + 1 }, (_, i) => `<stop offset="${(i / n).toFixed(4)}" stop-color="${mix(SKY, sunHeight(t0 + (i / n) * m.xs, lat, lon))}"/>`).join('')}</linearGradient>`);
      s += `<rect x="${X0}" width="${X1 - X0}" y="${Y.sky.top}" height="${SKY_H}" rx="2" fill="url(#sky-${id})"/>`;
    }
    for (const [t, isDay, show] of ticks) {
      if (!show) continue;
      labels += `<span class="xtick${isDay ? ' day' : ''}" style="top:${Y.axis.top}px;left:${x(t).toFixed(1)}px">${this._fmt(t, isDay ? 'day' : 'tick')}</span>`;
    }
    if (this._error) labels += `<span class="note" style="top:${Y.main.top + 6}px;left:${X0 + 8}px">${this._error}</span>`;
    else if ((this._from == null || (m.cmp ? m.cmp.t0 : m.t0) < this._from - 60000) && this._loading) {
      labels += `<span class="note" style="top:${Y.main.top + 6}px;left:${X0 + 8}px">Loading…</span>`;
    } else if (this._oldest != null && m.t0 < this._oldest) {
      labels += `<span class="note" style="top:${Y.main.top + 6}px;left:${X0 + 8}px">No history before ${this._fmt(this._oldest)}</span>`;
    }

    this._el.chart.style.height = `${Y.height}px`;
    this._el.chart.innerHTML = `<defs>${defs.join('')}</defs>${s}`;
    this._el.labels.innerHTML = labels;
  }


  // things worth a look in the range on screen (at most two): short cycling, flow well under its target, a long
  // hot water run, lots of defrosting
  _warnings(m) {
    const S = m.S, out = [];
    // short cycling: four or more starts (heating or hot water after off or paused) within an hour
    const starts = [];
    let prev = valueAt(S.activity, m.t0 - 1);
    for (const [a, , v] of m.acts) {
      if (a > m.t0 && ['Heating', 'Hot water'].includes(v) && (!prev || ['Off', 'Paused'].includes(prev))) starts.push(a);
      prev = v;
    }
    let best = null;
    for (let i = 0; i < starts.length; i++) {
      let j = i;
      while (j + 1 < starts.length && starts[j + 1] - starts[i] <= 3600e3) j++;
      if (j - i + 1 >= 4 && (!best || j - i + 1 > best.n)) best = { n: j - i + 1, t: starts[i] };
    }
    if (best) out.push(['Short cycling', `${best.n} starts within an hour, from ${this._fmt(best.t)}`, best.t]);
    // flow 3° or more under its target for 45 minutes or longer while heating (after the first 45 minutes of a run)
    let worst = null;
    for (const [a, b, v] of m.acts) {
      if (v !== 'Heating' || b - a < 90 * 60000) continue;
      let from = null, sum = 0, n = 0;
      const close = t => { if (from != null && t - from >= 45 * 60000 && (!worst || t - from > worst.d)) worst = { t: from, d: t - from, gap: sum / n }; from = null; sum = 0; n = 0; };
      for (let t = a + 45 * 60000; t < b; t += 120000) {
        const f = valueAt(S.flow, t), tg = valueAt(S.target, t);
        if (f != null && tg != null && tg - f >= 3) { if (from == null) from = t; sum += tg - f; n++; } else close(t);
      }
      close(b);
    }
    if (worst) out.push(['Flow short of target', `${worst.gap.toFixed(0)}° under for ${dur(worst.d)}, from ${this._fmt(worst.t)}`, worst.t]);
    // a long hot water run (the tank normally reheats within the hour)
    const hw = m.acts.filter(([a, b, v]) => v === 'Hot water' && b - a >= 90 * 60000).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (hw) out.push(['Long hot water run', `${dur(hw[1] - hw[0])}, from ${this._fmt(hw[0])}`, hw[0]]);
    // lots of defrosting: over 15% of the running time, and at least three
    const st = this._st;
    if (st && st.defrosts >= 3 && st.ran > 0 && st.defrost / st.ran > 0.15) out.push(['Lots of defrosting', `${st.defrosts} defrosts, ${dur(st.defrost)} in total`, null]);
    return out.slice(0, 2);
  }

  // what's going on, in a few words: the state in bold, then why (or until when)
  _story(a, t) {
    const S = this._m.S, hyst = this._num('hyst') ?? 0.1;
    const sinceOn = series => {
      let since = null;
      for (let i = series.length - 1; i >= 0; i--) {
        const [ts, v] = series[i];
        if (ts > t) continue;
        if (v === 'on') since = ts; else break;
      }
      return since;
    };
    const w = a.why, d = w && w.setback ? -w.setback : (this._num('setback_size') ?? 3);
    const b = x => `<b>${x}</b>`;
    if (a.act === 'Hot water') return `${b('Heating the tank')} · the room heating carries on after`;
    if (a.act === 'Defrost') return `${b('Defrosting')} · back to heating in a few minutes`;
    if (a.period === 'Off') return `${b('Heating off')} · by the schedule`;
    if (a.atTemp && a.setp != null) {
      const since = sinceOn(S.at_temp);
      return `${b(`${a.act === 'Paused' ? 'Paused, at temp' : 'At temp'}${since != null ? ` since ${this._fmt(since)}` : ''}`)} · water ${d}° cooler until the room's below ${deg(a.setp - hyst)}`;
    }
    if (a.room != null && a.setp != null) {
      const gap = a.setp - a.room, state = b(a.act === 'Paused' ? 'Paused' : gap >= 0.05 ? 'Warming up' : 'Heating');
      return Math.abs(gap) < 0.05 ? `${state} · room on its ${deg(a.setp)} set temp`
        : `${state} · room ${Math.abs(gap).toFixed(1)}° ${gap > 0 ? 'under' : 'over'} its ${deg(a.setp)} set temp`;
    }
    return '';
  }

  // a step line in several colours: each step, and the jump up or down into it, takes the colour at its start
  // (sticky: a colour that also takes the jumps out of it, so a hot water block is framed on both sides)
  _stepSegs(points, m, yf, colorAt, cuts = [], sticky = null) {
    const { t0, end, x } = m;
    const pts = [[t0, valueAt(points, t0)]];
    for (const [t, v] of points) { if (t <= t0) continue; if (t > end) break; pts.push([t, v]); }
    const segs = [];
    let cur = null, prevV = null;
    for (let i = 0; i < pts.length; i++) {
      const [t, v] = pts[i];
      if (v == null) { prevV = null; cur = null; continue; }
      const tNext = i + 1 < pts.length ? pts[i + 1][0] : end, Yv = yf(v).toFixed(1);
      // a step can change colour part way along (e.g. the heat pump goes off while the target stays put)
      const bounds = [t, ...cuts.filter(c => c > t && c < tNext), tNext];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const col = colorAt(bounds[k]), X = x(bounds[k]).toFixed(1), XN = x(bounds[k + 1]).toFixed(1);
        if (k === 0) {
          if (cur && cur.col === col) cur.d += ` L${X} ${Yv} L${XN} ${Yv}`;
          else if (cur && sticky && cur.col === sticky) { cur.d += ` L${X} ${Yv}`; cur = { col, d: `M${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
          else { cur = { col, d: `M${X} ${(prevV != null ? yf(prevV) : yf(v)).toFixed(1)} L${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
        } else if (cur.col === col) cur.d += ` L${XN} ${Yv}`;
        else { cur = { col, d: `M${X} ${Yv} L${XN} ${Yv}` }; segs.push(cur); }
      }
      prevV = v;
    }
    return segs.map(g => `<path d="${g.d}" class="ln" stroke="${g.col}" stroke-width="1.5"/>`).join('');
  }

  // setting-change marks, the Live button and the compare chip
  _drawUi() {
    const m = this._m;
    let h = m.flags.map((f, i) => `<span class="mark" data-change="${i}" role="button" tabindex="0" aria-label="Settings changed"
        style="left:${f.x.toFixed(1)}px;top:${Y.mark.y.toFixed(1)}px"><i${f.groups.length > 1 ? ' class="n"' : ''}>${f.groups.length > 1 ? f.groups.length : ''}</i></span>`).join('');
    if (m.cmp) h += `<span class="cmp" style="left:${m.X0 + 4}px;top:${Y.main.top + 4}px"><i></i>
        <span class="cn" data-act="cmp-next" role="button" tabindex="0" title="Compare with an earlier day">${this._prevName(m)}${icon('down', 'currentColor', 14)}</span>
        <span class="cx" data-act="compare" role="button" tabindex="0" aria-label="Stop comparing">${icon('close', 'currentColor', 13)}</span></span>`;
    this._el.ui.innerHTML = h;
  }

  // how long the window is, shown beside the date when it isn't a whole day or "last ..." (e.g. "20h", "2h 30m", "4 days")
  _spanChip(m) {
    const mid = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    if (m.live || (m.t0 === mid(m.t0) && Math.abs(m.span - DAY) < 60000)) return '';
    const mins = Math.round(m.span / 60000), h = Math.floor(mins / 60);
    const txt = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${h}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${+(m.span / DAY).toFixed(1)} days`;
    return `<em>· ${txt}</em>`;
  }

  // compare with the same times of day: the day before (or, for longer ranges, the same number of whole days
  // before); tap the name on the chart to step further back (2 days, 3 days, a week)
  _cmpOptions(span) {
    const min = Math.max(1, Math.ceil(span / DAY - 0.001));
    return [...new Set([min, min + 1, min + 2, Math.max(7, min * 2)])].filter(d => d <= 13);
  }

  _cmpShift(span) {
    const opts = this._cmpOptions(span);
    return (opts.includes(this._cmpDays) ? this._cmpDays : opts[0]) * DAY;
  }

  _prevName(m) {
    const days = Math.round(((m.cmp && m.cmp.shift) || this._cmpShift(m.span)) / DAY);
    if (m.span <= DAY + 60000) return days === 1 ? 'Yesterday' : days === 7 ? 'A week ago' : `${days} days ago`;
    return days === 7 ? 'A week earlier' : days === 14 ? 'Two weeks earlier' : `${days} days earlier`;
  }

  // what's on screen, in words: "Today", "Yesterday", "Thu 22 Oct", "Last 12 hours", "16 – 22 Oct"
  _windowLabel(m, short) {
    const mid = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = mid(Date.now());
    const dayName = t => {
      if (mid(t) === today) return 'Today';
      if (mid(t) === today - DAY) return 'Yesterday';
      const d = new Date(t);
      return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
    };
    if (m.t0 === mid(m.t0) && (Math.abs(m.span - DAY) < 60000 || (m.live && mid(m.now) === m.t0))) return dayName(m.t0);
    if (m.live) {
      const h = Math.round(m.span / 3600e3);
      return h < 48 ? `Last ${h === 1 ? 'hour' : `${h} hours`}` : `Last ${Math.round(h / 24)} days`;
    }
    if (m.span >= 2 * DAY) {
      const f = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `${f(m.t0)} – ${f(m.end)}`;
    }
    if (short) {
      // e.g. "Thu 10:00 – 16:00" or "Wed 16:00 – Thu 04:00" (times without AM/PM to keep it short);
      // where even that doesn't fit, just the start ("Wed 16:00"), as the chip beside it says how long
      const d0 = new Date(m.t0), d1 = new Date(m.end), hm = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      const wd = d => d.toLocaleDateString('en-GB', { weekday: 'short' });
      if (short === 'start') return `${wd(d0)} ${hm(d0)}`;
      return d0.toDateString() === d1.toDateString() ? `${wd(d0)} ${hm(d0)}–${hm(d1)}` : `${wd(d0)} ${hm(d0)}–${wd(d1)} ${hm(d1)}`;
    }
    return `${this._fmt(m.t0)} – ${this._fmt(m.end)}`;
  }

  // the date bar (from the calendar button): step back and forward, tap the date for quick picks,
  // compare and setting-change switches, and Now when looking back
  _drawNav() {
    const nb = this._el.navbar, m = this._m;
    this._el.cal.setAttribute('aria-expanded', String(!!this._navOpen));
    nb.hidden = !this._navOpen;
    if (!this._navOpen || !m) return;
    const tg = (act, on, ic, label) => `<button class="pb tg${on ? ' on' : ''}" data-act="${act}" role="switch" aria-checked="${on}" aria-label="${label}" title="${label}">
      ${icon(ic, 'currentColor', 20)}</button>`;
    const pick = (act, ic, label) => `<button class="mi" data-act="${act}">${icon(ic, 'currentColor', 20)}<span>${label}</span></button>`;
    // a spinbox for time: back and forward a window at a time, the date in the middle opens the quick picks
    nb.innerHTML = `<div class="pager">
        <button class="pb" data-act="prev" aria-label="Earlier">${icon('left', 'currentColor', 20)}</button>
        <button class="label" data-act="presets" aria-haspopup="true" aria-expanded="${!!this._menuOpen}"><span>${this._windowLabel(m, true)}</span>${this._spanChip(m)}<i class="dd">${icon('down', 'currentColor', 18)}</i></button>
        <button class="pb" data-act="next" aria-label="Later" ${m.live ? 'disabled' : ''}>${icon('right', 'currentColor', 20)}</button></div>
      ${tg('compare', !!this._compare, 'compare', `Compare with ${this._prevName(m).toLowerCase()}`)}
      ${m.live ? '' : `<button class="pb now" data-act="live" aria-label="Back to now">${icon('restore', 'currentColor', 18)}<span>Now</span></button>`}
      ${this._menuOpen ? `<div class="menu presets">${pick('today', 'today', 'Today')}${pick('yesterday', 'yesterday', 'Yesterday')}
        ${pick('week', 'week', 'Last 7 days')}${pick('pick', 'calendar', 'Pick a date…')}</div>` : ''}`;
    const lab = nb.querySelector('.label span');
    if (lab && lab.scrollWidth > lab.clientWidth + 1 && this._spanChip(m)) {
      lab.parentElement.title = lab.textContent;
      lab.textContent = this._windowLabel(m, 'start');
    }
  }

  // ---------- values: now, or the moment being scrubbed ----------
  _at(t) {
    const S = this._m.S, v = k => valueAt(S[k], t);
    return { act: v('activity') || 'Off', period: v('period'), atTemp: v('at_temp') === 'on', target: v('target'), flow: v('flow'),
      ret: v('return'), room: v('room'), setp: v('setp'), out: v('outside'), why: breakdown(valueAt(S.breakdown, t)),
      hw: this._m.hw.some(([a, b]) => t >= a && t <= b) };
  }

  // the header, the legend, the small-chart values and the "why" line all follow the scrub
  _drawPanel() {
    const m = this._m;
    if (!m) return;
    const t = this._scrubT != null ? this._scrubT : m.end;
    const ahead = m.fc && t > m.end ? m.fc : null;
    const a = this._at(Math.min(t, m.end));
    const scrubbing = this._scrubT != null;

    // the stats button (the numbers themselves are worked out once per range, not on every scrub)
    this._el.summary.setAttribute('aria-expanded', String(!!this._statsOpen));
    const ready = this._from != null && m.t0 >= this._from - 60000;
    if (!scrubbing || !this._st) { this._st = ready ? this._stats(m) : null; this._warns = ready ? this._warnings(m) : []; }
    // while scrubbing, the moment and what it was doing sit at the top left
    this._el.head.classList.toggle('scrubbing', scrubbing);
    this._el.sinfo.innerHTML = !scrubbing ? '' : `<span class="st">${this._fmt(t)}${ahead ? '<span class="sf"> · forecast</span>' : ''}</span><span class="ss" hidden><i style="background:${ACT_DOT[a.act] || ACT_DOT.Off}"></i>${a.act}${
      a.period ? ` · ${a.period === 'Off' ? 'heating off' : a.period}` : ''}${a.atTemp ? ' · at temp' : ''}</span>`;

    // legend: three sorted stacks, with the values
    const item = (label, color, attrs, on, kind, value, valColor, off) =>
      `<span class="item${on ? ' on' : ''}${off ? ' off' : ''}${value != null ? ' has-val' : ''}" style="--c:${color}" ${attrs} role="button" tabindex="0">
        <i class="${kind || 'dot'}"${kind ? '' : ` style="background:${color}"`}></i><span class="name">${label}</span>${value != null ? `<span class="val"${valColor ? ` style="color:${valColor}"` : ''}>${value}</span>` : ''}</span>`;
    const E = this._ent;
    const fc = C.flow, rc = C.ret, ftext = C.flow;
    const chip = (label, color, kind) => `<span class="nchip"><i class="${kind}" style="--c:${color};background:${color}"></i>${label}</span>`;
    const fp = ahead ? valueAt(ahead.period, t) : null;
    const chips = ahead ? chip('Forecast', 'transparent', 'fcd') + (fp ? chip(fp === 'Off' ? 'Heating off' : fp, MODE_DOT[fp], 'bar') : '')
      : chip(a.act, ACT_DOT[a.act] || ACT_DOT.Off, 'blk') + (a.period ? chip(a.period === 'Off' ? 'Heating off' : a.period, MODE_DOT[a.period], 'bar') : '') +
      (a.atTemp ? chip('Setback', C.atTemp, 'bar') : '');
    const warn = (this._warns || []).map(([h, d, t]) => `<div class="warn"${t != null ? ` data-act="warn" data-t="${t}" role="button" tabindex="0"` : ''}>${icon('alert', 'currentColor', 16)}<span><b>${h}</b> · ${d}</span></div>`).join('');
    this._keyHtml = `<div class="keyfull">
      <div class="col">${['Heating', 'Hot water', 'Paused', 'Defrost'].map(s => item(s, ACT_DOT[s], `data-entity="${E.activity}"`, a.act === s)).join('')}</div>
      <div class="col">${item('Day', MODE_DOT.Day, `data-entity="${E.period}"`, a.period === 'Day')}${item('Night', MODE_DOT.Night, `data-entity="${E.period}"`, a.period === 'Night')}
        ${item('At temp', C.atTemp, `data-entity="${E.at_temp}"`, a.atTemp, 'bar')}
        ${item('Room', a.room != null ? mix(AIR, a.room) : 'var(--secondary-text-color)', `data-entity="${E.room}"`, false, 'ring', deg(a.room))}</div>
      <div class="col">${item('Target', C.target, 'data-history="1"', false, 'line', deg(a.target, 0), C.target)}
        ${item('Flow', fc, 'data-history="1"', false, 'line', deg(a.flow), ftext)}
        ${item('Return', rc, 'data-history="1"', false, 'line', deg(a.ret))}
        ${item('Difference', fc, 'data-history="1"', false, 'none', a.flow != null && a.ret != null ? deg(a.flow - a.ret) : '–')}</div>
      <div class="kshow"><span>Show on the chart</span>
        <button class="kt${this._lines.ret ? ' on' : ''}" data-act="line" data-k="ret" aria-pressed="${!!this._lines.ret}"><i class="line" style="--c:${C.ret}"></i>Return</button>
        <button class="kt${this._showChanges ? ' on' : ''}" data-act="changes" aria-pressed="${!!this._showChanges}"><i class="mk"></i>Setting changes</button>
        ${this._config.forecast === false ? '' : `<button class="kt${this._lines.fc ? ' on' : ''}" data-act="line" data-k="fc" aria-pressed="${!!this._lines.fc}"><i class="fcl"></i>Forecast <span class="beta">beta</span></button>`}</div></div>`;
    this._el.legend.innerHTML = `${warn}<div class="nowrow"><div class="nchips">${chips}</div>
        <button class="keybtn" data-act="key" aria-expanded="${!!this._keyOpen}">Key${icon('chevron', 'currentColor', 16)}</button></div>
      ${this._keyOpen ? this._keyHtml : ''}`;

    // small-chart values
    const rv = this._root.querySelector('.room-val'), ov = this._root.querySelector('.out-val'), fv = this._root.querySelector('.flow-val');
    const dF = a.flow != null && a.target != null && !a.hw ? a.flow - a.target : null, dR = a.room != null && a.setp != null ? a.room - a.setp : null;
    const words = d => (d == null ? '' : `<span class="dw"> · ${Math.abs(d) < 0.05 ? 'on it' : `${Math.abs(d).toFixed(1)}° ${d < 0 ? 'below' : 'above'}`}</span>`);
    if (fv) fv.innerHTML = `<b style="color:${C.flow}">${deg(a.flow)}</b><span> · target </span><b style="color:${this._tgtCol ? this._tgtCol(Math.min(t, m.end - 1000)) : C.target}">${deg(a.target, 0)}</b>${
      words(dF)}${this._lines.ret ? `<span> · return </span><b style="color:${C.ret}">${deg(a.ret)}</b>` : ''}`;
    if (rv) rv.innerHTML = `<b style="color:${a.room != null ? mix(AIR, a.room) : ''}">${deg(a.room)}</b>${a.setp != null
      ? `<span> · set ${deg(a.setp)}</span>${words(dR)}` : ''}`;
    const wx = valueAt(this._m.S.weather, t);
    if (ov) ov.innerHTML = `${wx ? `<span class="wxi" title="${wx.replace('-', ' ')}" style="color:${a.out != null ? mix(AIR, a.out) : ''}">${icon(WX[wx], 'currentColor', 16)}</span>` : ''}<b style="color:${a.out != null ? mix(AIR, a.out) : ''}">${deg(a.out)}</b>`;

    if (ahead) {
      // in the look ahead: the forecast target, the set temp the schedule would give and the forecast outside temp
      const ft = valueAt(ahead.target, t), fo = valueAt(ahead.outside, t), fs = valueAt(ahead.setp, t), wx2 = valueAt(ahead.cond, t);
      const tc = ahead.colAt(t), oc = fo != null ? mix(AIR, fo) : '';
      if (fv) fv.innerHTML = ft != null ? `<span>target </span><b style="color:${tc}">≈ ${deg(ft, 0)}</b>` : '';
      if (rv) rv.innerHTML = fs != null ? `<span>set ${deg(fs)}</span>` : `<span>heating off</span>`;
      if (ov) ov.innerHTML = `${wx2 && WX[wx2] ? `<span class="wxi" title="${wx2.replace('-', ' ')}" style="color:${oc}">${icon(WX[wx2], 'currentColor', 16)}</span>` : ''}<b style="color:${oc}">≈ ${deg(fo)}</b>`;
      const t0v = valueAt(this._m.S.target, m.end), dt = ft != null && t0v != null ? ft - t0v : null;
      const story = fp === 'Off' ? `<b>Heating off</b> · if the schedule's the same as yesterday`
        : `<b>Forecast</b> · ${deg(fo)} outside, so a target of about ${deg(ft, 0)}${dt ? ` (${Math.abs(dt)}° ${dt > 0 ? 'higher' : 'lower'} than now)` : ''}`;
      this._el.why.innerHTML = `<div class="story">${story}</div>`;
      return;
    }
    // what it's doing, in a few words (the target's breakdown is in Adjust)
    const story = this._story(a, t);
    this._el.why.innerHTML = story ? `<div class="story">${story}</div>` : '';
  }

  _ticks(m) {
    const hourPx = (m.X1 - m.X0) / ((m.xs || m.span) / 3600e3);
    const label = this._hour12() ? 50 : 46;
    const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48];
    // a line every 40 px or so (like the Home Assistant graphs), with a time on every one that has room for it
    const step = (steps.find(h => h * hourPx >= 40) || 48) * 3600e3;
    const every = Math.max(1, Math.ceil(label / ((step / 3600e3) * hourPx)));
    const out = [];
    const d = new Date(m.t0);
    d.setMinutes(0, 0, 0);
    const inc = Math.min(step, 3600e3), DAY = 86400e3;
    for (let t = d.getTime(); t < (m.fEnd || m.end); t += inc) {
      const dt = new Date(t), X = m.x(t);
      const local = dt.getHours() * 3600e3 + dt.getMinutes() * 60000;
      if (step > DAY) { if (local !== 0 || Math.round(t / DAY) % (step / DAY) !== 0) continue; }
      else if (step >= 3600e3 && local % step !== 0) continue;
      if (X > m.X0 + 10 && X < m.X1 - 12) out.push([t, local === 0, (step >= DAY ? Math.round(t / DAY) : Math.round(local / step)) % every === 0]);
    }
    return out;
  }

  _hour12() {
    const loc = this._hass.locale || {};
    if (loc.time_format === '12') return true;
    if (loc.time_format === '24') return false;
    return new Intl.DateTimeFormat(loc.time_format === 'system' ? undefined : loc.language, { hour: 'numeric' }).resolvedOptions().hour12;
  }

  _fmt(t, kind) {
    const d = new Date(t), h12 = this._hour12();
    const hm = h12
      ? `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
    if (kind === 'day') return `${day} ${d.getDate()}`;
    if (kind === 'tick') {
      if (d.getMinutes()) return hm.replace(/ (AM|PM)$/, '');
      return h12 ? `${d.getHours() % 12 || 12} ${d.getHours() < 12 ? 'AM' : 'PM'}` : hm;
    }
    const today = new Date().toDateString() === d.toDateString();
    return today ? hm : `${day} ${hm}`;
  }

  // a line through readings; `step` holds each value until the next one (for the target)
  _path(points, m, yf, step) {
    const { t0, end, x } = m;
    const pts = [];
    const v0 = valueAt(points, t0);
    pts.push([t0, v0]);
    let prev = v0, prevT = t0;
    for (const [t, v] of points) {
      if (t <= t0) continue;
      if (t > end) break;
      if (prev != null && v != null) {
        if (step) pts.push([t, prev]);
        else if (t - prevT > 90000) pts.push([t - 60000, prev]);   // held until shortly before the change
      }
      pts.push([t, v]);
      prev = v; prevT = t;
    }
    if (prev != null) pts.push([end, prev]);
    // thin out to at most a few points per pixel column (first, lowest, highest, last)
    let d = '', run = [];
    const flush = () => {
      if (!run.length) return;
      const cols = new Map();
      for (const p of run) {
        const c = Math.round(p[0]);
        const b = cols.get(c);
        if (!b) cols.set(c, { first: p, last: p, min: p, max: p });
        else { b.last = p; if (p[1] < b.min[1]) b.min = p; if (p[1] > b.max[1]) b.max = p; }
      }
      let first = true;
      for (const b of cols.values()) {
        const seq = [b.first, b.min, b.max, b.last].filter((p, i, a) => a.indexOf(p) === i);
        seq.sort((p, q) => p[2] - q[2]);
        for (const p of seq) { d += `${first ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; first = false; }
      }
      run = [];
    };
    pts.forEach(([t, v], i) => {
      if (v == null) { flush(); return; }
      run.push([x(t), yf(v), i]);
    });
    flush();
    return d;
  }

  // ---------- numbers for what's on screen ----------
  _stats(m) {
    const { S, t0, end } = m;
    const st = { ran: 0, heating: 0, hw: 0, paused: 0, defrost: 0, defrosts: 0, hwRuns: 0, starts: 0,
      elec: 0, heat: 0, elecHeat: 0, heatHeat: 0, elecHw: 0, heatHw: 0, power: false,
      flowSum: 0, dtSum: 0, heatMin: 0, oSum: 0, oN: 0, roomMin: null, roomMax: null, rSum: 0, rN: 0 };
    let prev = valueAt(S.activity, t0 - 1);
    for (const [a, b, v] of m.acts) {
      const d = b - a;
      if (RUNNING.includes(v)) st.ran += d;
      if (v === 'Heating') st.heating += d;
      if (v === 'Hot water') { st.hw += d; if (a > t0) st.hwRuns++; }
      if (v === 'Paused') st.paused += d;
      if (v === 'Defrost') { st.defrost += d; if (a > t0) st.defrosts++; }
      if (a > t0 && ['Heating', 'Hot water'].includes(v) && (!prev || ['Off', 'Paused'].includes(prev))) st.starts++;
      prev = v;
    }
    // energy and averages, sampled through the range. Electricity comes from the meter when it has readings
    // here (each step's increase), otherwise from the power reading.
    const step = Math.max(60000, (end - t0) / 3000), hrs = step / 3600e3;
    const meter = S.energy.some(p => p[0] > t0 && p[0] <= end);
    st.power = meter || S.power.length > 0;
    st.meter = meter;
    for (let t = t0; t < end; t += step) {
      const a = valueAt(S.activity, t), q = valueAt(S.heat, t);
      let e = null;
      if (meter) {
        const e1 = valueAt(S.energy, t), e2 = valueAt(S.energy, Math.min(end, t + step));
        if (e1 != null && e2 != null && e2 >= e1 && e2 - e1 < 5) e = e2 - e1;
      } else {
        const p = valueAt(S.power, t);
        if (p != null) e = p * hrs;
      }
      if (e != null) { st.elec += e; if (a === 'Heating') st.elecHeat += e; if (a === 'Hot water') st.elecHw += e; }
      if (q != null) { st.heat += q * hrs; if (a === 'Heating') st.heatHeat += q * hrs; if (a === 'Hot water') st.heatHw += q * hrs; }
      if (a === 'Heating') {
        const f = valueAt(S.flow, t), r = valueAt(S.return, t);
        if (f != null && r != null) { st.flowSum += f; st.dtSum += f - r; st.heatMin++; }
      }
      const o = valueAt(S.outside, t);
      if (o != null) { st.oSum += o; st.oN++; }
      const rm = valueAt(S.room, t);
      if (rm != null) { st.rSum += rm; st.rN++; st.roomMin = st.roomMin == null ? rm : Math.min(st.roomMin, rm); st.roomMax = st.roomMax == null ? rm : Math.max(st.roomMax, rm); }
    }
    const cop = (h, e) => (e >= 0.1 ? (h / e).toFixed(1) : '–');
    st.cop = cop(st.heat, st.elec);
    st.copHeat = cop(st.heatHeat, st.elecHeat);
    st.copHw = cop(st.heatHw, st.elecHw);
    return st;
  }

  // ---------- the drop-down: the range on screen at a glance ----------
  _drawStats() {
    const m = this._m, box = this._el.stats;
    const st = this._st;
    box.hidden = !this._statsOpen || !st;
    if (box.hidden) return;
    const span = m.end - m.t0;
    // the previous period, for comparison
    let pv = null;
    if (m.cmp && this._from != null && m.cmp.t0 >= this._from - 60000) {
      pv = this._stats({ S: m.S, t0: m.cmp.t0, end: m.cmp.end, acts: runs(m.S.activity, m.cmp.t0, m.cmp.end, m.now) });
    }
    const delta = (a, b, f) => {
      if (!pv || a == null || b == null || !Number.isFinite(a - b)) return '';
      const d = a - b;
      return `<span class="d">${Math.abs(d) < 1e-9 ? 'same' : `${d > 0 ? '▲' : '▼'} ${f(Math.abs(d))}`}</span>`;
    };
    const off = Math.max(0, span - st.heating - st.hw - st.defrost - st.paused);
    const parts = [['Heating', st.heating, ACT_FILL.Heating], ['Hot water', st.hw, ACT_FILL['Hot water']], ['Defrost', st.defrost, DEFROST],
      ['Paused', st.paused, ACT_DOT.Paused], ['Off', off, 'rgba(127,127,127,0.18)']].filter(p => p[1] >= 60000);
    const bar = parts.map(([, ms, col]) => `<span style="flex:${ms};background:${col}"></span>`).join('');
    const key = parts.map(([n, ms, col]) => `<span><i style="background:${col}"></i>${n} <b>${dur(ms)}</b></span>`).join('');
    const kwh = v => `${v.toFixed(v >= 10 ? 0 : 1)}`;
    const copN = s => parseFloat(s);
    const range = (a, b) => (a == null ? '–' : `${a.toFixed(1)}–${deg(b)}`);
    const cell = (ic, label, value, sub, d) => `<div class="cell"><div class="cl">${icon(ic, 'currentColor', 18)}<span>${label}</span></div>
      <div class="cv">${value}</div>${d || ''}${sub ? `<div class="cs">${sub}</div>` : ''}</div>`;
    const flowAvg = st.heatMin ? st.flowSum / st.heatMin : null;
    // energy: total, heating and hot water side by side
    const erow = (ic, label, total, unit, heat, hw, d) => `<tr><td class="l"><span>${icon(ic, 'currentColor', 18)}${label}</span></td>
      <td class="t"><b>${total}</b>${unit ? `<small> ${unit}</small>` : ''}${d || ''}</td><td>${heat}</td><td>${hw}</td></tr>`;
    const energy = !st.power ? '' : `<div class="sec">Energy</div>
      <table class="etab"><tr><th></th><th>Total</th><th>Heating</th><th>Hot water</th></tr>
        ${erow('flash', 'Electricity', kwh(st.elec), 'kWh', kwh(st.elecHeat), kwh(st.elecHw), delta(st.elec, pv && pv.elec, v => `${kwh(v)} kWh`))}
        ${erow('fire', 'Heat made', kwh(st.heat), 'kWh', kwh(st.heatHeat), kwh(st.heatHw), delta(st.heat, pv && pv.heat, v => `${kwh(v)} kWh`))}
        ${erow('gauge', 'COP', st.cop, '', st.copHeat, st.copHw, delta(copN(st.cop), pv && copN(pv.cop), v => v.toFixed(1)))}</table>`;
    box.innerHTML = `<div class="when">${this._windowLabel(m)}${pv ? ` <span>· compared with ${this._prevName(m).toLowerCase()}</span>` : ''}</div>
      <div class="split">${bar}</div><div class="key">${key}</div>
      ${energy}
      <div class="sec">Running</div>
      <div class="trio">${cell('timer', 'Running', dur(st.ran), `${Math.round((st.ran / span) * 100)}% of the time`, delta(st.ran, pv && pv.ran, dur))}
        ${cell('play', 'Starts', String(st.starts), st.starts ? `${dur((st.heating + st.hw) / st.starts)} a run` : '', delta(st.starts, pv && pv.starts, v => String(v)))}
        ${cell('defrost', 'Defrosts', String(st.defrosts), st.defrost ? `${dur(st.defrost)} in total` : '', delta(st.defrosts, pv && pv.defrosts, v => String(v)))}</div>
      <div class="sec">Temperatures</div>
      <div class="trio">${cell('waves', 'Average flow', flowAvg != null ? deg(flowAvg) : '–', flowAvg != null ? `return ${deg(st.dtSum / st.heatMin)} lower` : '',
          delta(flowAvg, pv && pv.heatMin ? pv.flowSum / pv.heatMin : null, v => deg(v)))}
        ${cell('thermo', 'Outside', m.oext.min ? range(m.oext.min[1], m.oext.max[1]) : '–', st.oN ? `average ${deg(st.oSum / st.oN)}` : '',
          delta(st.oN ? st.oSum / st.oN : null, pv && pv.oN ? pv.oSum / pv.oN : null, v => deg(v)))}
        ${cell('home', 'Room', range(st.roomMin, st.roomMax), st.rN ? `average ${deg(st.rSum / st.rN)}` : '')}</div>`;
  }

  // ---------- scrubbing and pop-ups ----------
  _scrub(px) {
    const m = this._m;
    if (!m) return;
    const t = clamp(Math.round(m.tAt(px) / 60000) * 60000, m.t0, m.fEnd);
    this._scrubT = t;
    const X = m.x(t), S = m.S;
    let s = `<line x1="${X.toFixed(1)}" x2="${X.toFixed(1)}" y1="-2" y2="${Y.chartBottom + 2}" class="cross"/>`;
    // a dot on each line (the headings show the values at that moment); in the look ahead, on the forecast lines
    const fa = m.fc && t > m.end ? m.fc : null;
    for (const [k, col, yf] of fa ? [['target', fa.colAt(t), m.y], ['outside', null, m.yo]]
      : [['target', this._tgtCol ? this._tgtCol(Math.min(t, m.end - 1000)) : C.target, m.y], ...(this._lines.ret ? [['return', C.ret, m.y]] : []),
        ['flow', C.flow, m.y], ['room', null, m.yr], ['outside', null, m.yo]]) {
      const v = valueAt((fa || S)[k], t);
      if (v == null) continue;
      s += `<circle cx="${X.toFixed(1)}" cy="${yf(v).toFixed(1)}" r="3.5" fill="${col || mix(AIR, v)}" class="dot"/>`;
    }
    this._el.cursor.style.height = `${Y.height}px`;
    this._el.cursor.innerHTML = s;
    this._el.stage.classList.add('scrubbing');
    this._drawPanel();
    if (this._adj && this._adj.open) this._drawAdjust();
  }

  _unscrub() {
    if (this._scrubT == null) return;
    clearTimeout(this._hold);
    this._scrubT = null;
    this._el.cursor.innerHTML = '';
    this._el.stage.classList.remove('scrubbing');
    this._drawPanel();
    if (this._adj && this._adj.open) this._drawAdjust();
  }

  _hideTip() {
    this._tipKind = null;
    this._el.tip.hidden = true;
  }

  // ---------- Adjust: change the settings that make the flow target ----------
  _num(k) {
    const s = this._hass.states[this._ent[k]];
    const v = s ? parseFloat(s.state) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  // a setting can be changed here when its script exists
  _canSet(k) {
    return !!(this._scripts[k] && this._hass.states[this._scripts[k]]);
  }

  _adjOpen(open) {
    if (open) {
      const cur = {};
      for (const [k] of ADJUST) cur[k] = this._num(k);
      this._adj = { open: true, cur, draft: { ...cur }, status: '', saving: false };
    } else if (this._adj) {
      if (this._adj.saving) return;
      this._adj.open = false;
    }
    this._el.adjustBtn.setAttribute('aria-expanded', String(!!open));
    this._drawAdjust();
  }

  _adjStep(k, dir) {
    const a = this._adj, spec = ADJUST.find(r => r[0] === k);
    if (!a || a.saving || !spec) return;
    const [, , , step, min, max, dp] = spec;
    const v = a.draft[k] ?? a.cur[k] ?? 0;
    a.draft[k] = Number(clamp(v + dir * step, min, max).toFixed(dp));
    a.status = '';
    if (a.unconfirmed) delete a.unconfirmed[k];
    this._drawAdjust();
  }

  // what goes into the flow target at a moment: now (the live readings), or the moment you're scrubbing (history)
  _inputs(t) {
    const m = this._m;
    if (t == null || !m || t >= m.end - 30000) {
      const st = k => this._hass.states[this._ent[k]];
      return { live: true, out: this._num('outside'), room: this._num('room'), desired: this._num('desired'), target: this._num('target'),
        period: st('period') ? st('period').state : '', atTemp: st('at_temp')?.state === 'on', hw: /hot water/i.test(st('activity')?.state || ''),
        bd: breakdown(st('breakdown')?.state), set: this._adj.cur };
    }
    const S = m.S, v = k => valueAt(S[k] || [], t), set = {};
    for (const [k] of ADJUST) set[k] = v(k) ?? this._adj.cur[k];
    return { live: false, t, out: v('outside'), room: v('room'), desired: v('desired'), target: v('target'), period: v('period') || '',
      atTemp: v('at_temp') === 'on', hw: v('activity') === 'Hot water', bd: breakdown(valueAt(S.breakdown, t)), set };
  }

  // What the new settings would do to the flow target, right now (or at the moment you're scrubbing).
  // What's known accurately is how much a setting moves the controller's desired flow (checked against every
  // change in your history: shift exactly, day temp and room correction exactly once the setback switching is
  // included, the curve to within about 10%). The target itself is the desired flow rounded up plus 1 most of
  // the time, but the hub sometimes holds it elsewhere for reasons we can't see. So this starts from your
  // actual target now and adds only the change.
  _predict(draft, I) {
    const { out, room, desired, period, atTemp } = I;
    if (out == null || room == null || period === 'Off') return null;
    // at a scrubbed moment: the settings then, with the changes you're making added on
    const cur = I.set, vals = {};
    for (const [k] of ADJUST) vals[k] = I.live || draft[k] == null || this._adj.cur[k] == null ? draft[k] : cur[k] + (draft[k] - this._adj.cur[k]);
    if ([cur.curve, cur.shift, cur.room_factor, cur.day_temp].some(v => v == null)) return null;
    const night = period === 'Night', setKey = night ? 'night_temp' : 'day_temp';
    const terms = v => {
      const setp = v[setKey];
      // the setback applies while the room is at its set temp, so moving the set temp past the room
      // switches it on or off (checked against your history: e.g. 21.5 -> 22.2 gave +3.5, as predicted)
      const sb = setp != null && v[setKey] !== cur[setKey] ? room >= setp : atTemp;
      return { curve: 20 + v.shift + v.curve * Math.pow(Math.max(20 - out, 0), 1.15),
        room: v.room_factor * ((setp ?? room) - room), setback: sb ? -(v.setback_size ?? 3) : 0 };
    };
    const part = v => { const t = terms(v); return t.curve + t.room + t.setback; };
    const delta = part(vals) - part(cur);
    const hwNow = I.hw, target = I.target;
    // the desired flow (for the rounding step): the hub's own figure, or failing that your breakdown sensor's sum
    // (which includes the hub's +1), or failing that the sum worked out here
    const live = I.bd;
    const bdSum = live && live.curve != null ? live.curve + (live.room ?? 0) + (live.setback ?? 0) - 1 : null;
    const base = desired != null ? desired : bdSum != null ? bdSum : part(cur);
    const now = !hwNow && target != null ? target : Math.ceil(base) + 1;
    const steps = Math.ceil(base + delta - 1e-9) - Math.ceil(base - 1e-9);
    return { now, next: now + steps, delta, hwNow, night, terms: [terms(cur), terms(vals)], bd: I.bd, live: I.live, t: I.t, out };
  }

  // the flow target's sum, now and with the new settings: curve + room + setback + rounding = target.
  // Now comes from your Flow Target Breakdown sensor (what the hub is doing); New adds what each changed
  // setting does to each part, so the columns line up and show which part moved.
  _calcTable(p, any) {
    const [tc, tn] = p.terms;
    const live = p.bd;
    const bd = live && live.curve != null && !p.hwNow;
    const now = bd ? { curve: live.curve, room: live.room ?? 0, setback: live.setback ?? 0 } : { ...tc };
    const nw = { curve: now.curve + tn.curve - tc.curve, room: now.room + tn.room - tc.room, setback: now.setback + tn.setback - tc.setback };
    // now: the breakdown's own rounding (the same as the line under the chart); new: whatever makes it add up
    now.round = bd && live.rounded != null ? live.rounded : p.now - now.curve - now.room - now.setback;
    // the new rounding: the old one, adjusted by however much more (or less) the target moves than the sum does
    nw.round = now.round + (p.next - p.now) - (nw.curve + nw.room + nw.setback - now.curve - now.room - now.setback);
    const sg = v => (Math.abs(v) < 0.05 ? '0' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`);
    const sb = v => (Math.abs(v) < 0.05 ? '–' : `−${Math.abs(v).toFixed(0)}`);
    const cols = [['curve', 'Curve', v => v.toFixed(1)], ['room', 'Room', sg], ['setback', 'Setback', sb], ['round', 'Rounding', sg]];
    const cell = (k, f) => (!any ? '<td class="na">–</td>' : `<td${Math.abs(nw[k] - now[k]) >= 0.05 ? ' class="ch"' : ''}>${f(nw[k])}</td>`);
    return `<table class="calc${any ? '' : ' idle'}"><tr><th></th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>Target</th></tr>
      <tr><td class="l">${p.live ? 'Now' : 'Then'}</td>${cols.map(([k, , f]) => `<td>${f(now[k])}</td>`).join('')}<td><b>${p.now}</b></td></tr>
      <tr class="new"><td class="l">New</td>${cols.map(([k, , f]) => cell(k, f)).join('')}<td${any ? ' class="ch"' : ' class="na"'}>${any ? `<b>≈ ${p.next}</b>` : '–'}</td></tr></table>`;
  }

  // laid out like your other cards: an icon, the name (and what it's doing underneath), and a spinbox.
  // One help button in the heading shows what each setting does; a changed setting gets an orange dot.
  _drawAdjust() {
    const box = this._el.adjust, a = this._adj;
    box.hidden = !a || !a.open;
    if (box.hidden) return;
    const fmt = (v, dp, unit) => (v == null ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}${unit}`);
    const changed = ADJUST.filter(([k]) => a.draft[k] != null && a.draft[k] !== a.cur[k]);
    const I = this._inputs(this._scrubT), p = this._predict(a.draft, I), when = I.live ? '' : this._fmt(I.t);
    const help = text => (a.help ? `<div class="rh">${text}</div>` : '');
    const rows = ADJUST.map(([k, label, text, , min, max, dp, unit]) => {
      const v = a.draft[k], was = a.cur[k], isChanged = v != null && v !== was, sending = a.sending === k;
      if (!this._canSet(k)) {
        return `${k === 'day_temp' ? '<div class="adiv"></div>' : ''}<div class="arow ro"><span class="ric">${icon(ROW_ICONS[k], 'currentColor', 24)}</span>
          <div class="rt"><div class="rn"><span>${label}</span></div><div class="rs">Add its script to change it here</div></div>
          <span class="rv">${fmt(was, dp, unit)}</span>${help(text)}</div>`;
      }
      const sub = sending ? 'Saving…' : a.unconfirmed && a.unconfirmed[k] ? 'Not taken yet' : '';
      // the new value, and the old one in brackets (tap it to put that setting back)
      const val = v == null ? '–' : `<span class="cur">${fmt(v, dp, '')}<span class="u">${unit}</span></span>${isChanged
        ? `<button class="old" data-act="adj-undo" data-k="${k}" title="Put it back" aria-label="Put ${label.toLowerCase()} back to ${fmt(was, dp, unit)}">(${fmt(was, dp, '')})</button>` : ''}`;
      // a divider between the water settings and the room set temps
      return `${k === 'day_temp' ? '<div class="adiv"></div>' : ''}<div class="arow${isChanged ? ' changed' : ''}${sending ? ' sending' : ''}${a.unconfirmed && a.unconfirmed[k] ? ' unconf' : ''}">
        <span class="ric">${icon(sending ? 'sand' : ROW_ICONS[k], 'currentColor', 24)}</span>
        <div class="rt"><div class="rn"><span>${label}</span></div>${sub ? `<div class="rs">${sub}</div>` : ''}</div>
        <div class="spin" role="group" aria-label="${label}">
          <button class="op" data-act="adj-dec" data-k="${k}" aria-label="Lower ${label}" ${a.saving || v == null || v <= min ? 'disabled' : ''}>${icon('minus', 'currentColor', 16)}</button>
          <span class="v">${val}</span>
          <button class="op" data-act="adj-inc" data-k="${k}" aria-label="Raise ${label}" ${a.saving || v == null || v >= max ? 'disabled' : ''}>${icon('plus', 'currentColor', 16)}</button></div>
        ${help(text)}</div>`;
    }).join('');
    const signedC = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} °C`;
    const note = !p ? (I.live ? 'Heating is off, so there’s nothing to preview' : `At ${when} the heating was off`)
      : !changed.length ? (p.hwNow ? `For the heating (the tank was heating${I.live ? ' just now' : ` at ${when}`})` : I.live ? 'Right now' : `At ${when}`)
      : !I.live ? (p.next === p.now ? `At ${when}: ${signedC(p.delta)}, too small to change it` : `At ${when}: ${changed.some(c => c[0] === 'curve') ? 'about ' : ''}${signedC(p.delta)}, ${deg(p.out)} outside`)
      : p.night && changed.length === 1 && changed[0][0] === 'day_temp' ? 'The day temperature applies from the morning'
      : !p.night && changed.length === 1 && changed[0][0] === 'night_temp' ? 'The night temperature applies from tonight'
      : Math.abs(p.delta) < 0.05 ? (changed.length > 1 ? 'These changes cancel out at the moment'
        : changed[0][0] === 'setback_size' ? 'No change until the room reaches its set temp' : 'No change at the moment')
      : p.next === p.now ? `${signedC(p.delta)}, too small to change it yet`
      : `${changed.some(c => c[0] === 'curve') ? 'About ' : ''}${signedC(p.delta)} at ${deg(this._num('outside'))} outside`;
    const showNew = !!(p && changed.length && p.next !== p.now);
    box.innerHTML = `<div class="ahd"><span>Adjust heating</span><span class="hbtns">
        <button class="hbtn${a.help ? ' on' : ''}" data-act="adj-help" aria-pressed="${!!a.help}" aria-label="What these settings do" title="What these settings do">${icon('help', 'currentColor', 18)}</button></span></div>
      <div class="arow tgt">
        <span class="ric">${icon('coolant', 'currentColor', 24)}</span>
        <div class="rt"><div class="rn"><span>Flow target</span></div><div class="rs">${note}</div></div>
        <span class="rv">${!p ? '–' : showNew ? `<span class="old">${p.now} °C</span>${icon('arrow', 'currentColor', 16)}<b>≈ ${p.next} °C</b>` : `${p.now} °C`}</span>
        ${p ? this._calcTable(p, changed.length > 0) : ''}
        ${help('What the heat pump is aiming the water at, and how it adds up: the weather curve, plus or minus the room correction, minus the setback once the room is at temp, then rounded up. Change a setting and the New row shows which parts move, in orange. New values are worked out from your settings, so they’re approximate (≈).')}</div>
      <div class="adiv"></div>
      ${rows}
      <div class="aact"><span class="status${/Couldn|hasn’t/.test(a.status) ? ' err' : ''}">${a.status || ''}</span>
        <button class="ctl reset" data-act="adj-reset" aria-label="Put everything back" title="Put everything back" ${a.saving || !changed.length ? 'disabled' : ''}>${icon('restore', 'currentColor', 20)}</button>
        <button class="ctl" data-act="adj-cancel" ${a.saving ? 'disabled' : ''}>Cancel</button>
        <button class="ctl save" data-act="adj-save" ${a.saving || !changed.length ? 'disabled' : ''}>${a.saving ? 'Saving…' : changed.length > 1 ? `Save ${changed.length} changes` : 'Save'}</button></div>`;
  }

  async _adjSave() {
    const a = this._adj;
    if (!a || a.saving) return;
    const changed = ADJUST.filter(([k]) => a.draft[k] != null && a.draft[k] !== a.cur[k] && this._canSet(k));
    if (!changed.length) return;
    a.saving = true;
    for (const [k, label] of changed) {
      a.sending = k;
      a.status = `Sending ${label.toLowerCase()} to the heat pump…`;
      this._drawAdjust();
      try {
        // your script sends it to the hub and waits until the hub reports the new value; then this checks the
        // reading itself (for a few seconds, as the new state can arrive just after the script finishes)
        await this._hass.callService('script', this._scripts[k].replace(/^script\./, ''), { value: a.draft[k] });
        const dp = ADJUST.find(r => r[0] === k)[6], same = () => this._num(k) != null && Math.abs(this._num(k) - a.draft[k]) < 0.5 * 10 ** -dp;
        for (let i = 0; i < 8 && !same(); i++) await new Promise(r => setTimeout(r, 500));
        if (same()) { a.cur[k] = a.draft[k]; if (a.unconfirmed) delete a.unconfirmed[k]; }
        else { a.unconfirmed = { ...(a.unconfirmed || {}), [k]: true }; a.cur[k] = this._num(k) ?? a.cur[k]; }
      } catch (err) {
        a.saving = false;
        a.sending = null;
        a.status = `Couldn’t save ${label.toLowerCase()}: ${(err && err.message) || err}`;
        this._drawAdjust();
        return;
      }
    }
    a.saving = false;
    a.sending = null;
    const missed = changed.filter(([k]) => a.unconfirmed && a.unconfirmed[k]);
    a.status = !missed.length ? (changed.length > 1 ? 'Saved, the heat pump has them' : 'Saved, the heat pump has it')
      : `Sent, but the heat pump hasn’t taken ${missed.map(c => c[1].toLowerCase()).join(' or ')} yet. Try Save again`;
    this._drawAdjust();
  }

  _place(html, left, top, anchorBottom) {
    const tip = this._el.tip, m = this._m;
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${clamp(left(w), 0, m.W - w)}px`;
    tip.style.top = `${anchorBottom ? top - h : top}px`;
  }

  // the details box for one moment
  // tap on the timeline: that stretch, from start to finish
  _showRun(lane, t) {
    const m = this._m, pts = m.S[lane.key];
    const r = runs(pts, t - 1, t + 1, m.now).find(q => q[3] <= t && q[4] > t);
    if (!r) { this._hideTip(); return; }
    const [, , v, a, b] = r;
    const names = { period: { Day: 'Day', Night: 'Night', Off: 'Heating off' }, at_temp: { on: 'At temp', off: 'Below set temp' } };
    const name = (names[lane.key] && names[lane.key][v]) || v;
    const col = lane.key === 'activity' ? ACT_DOT[v] || ACT_DOT.Off : lane.key === 'period' ? MODE_DOT[v] : v === 'on' ? C.atTemp : '#bfc3ca';
    const ongoing = b >= m.now - 60000;
    this._tipKind = 'run';
    const X = m.x(clamp(t, m.t0, m.end));
    this._place(`<div class="chips"><span class="chip big"><i style="background:${col}"></i>${name}</span></div>
      <div class="row sub flat"><span>${this._fmt(a)} – ${ongoing ? 'now' : this._fmt(b)}</span></div>
      <div class="row"><span>${ongoing ? 'So far' : 'Lasted'}</span><b>${dur(b - a)}</b></div>`,
      w => X - w / 2, Y.lanes[0].top - 8, true);
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => this._hideTip(), 6000);
  }

  // tap on a mark: what changed, as a small card (time, then each setting with its icon, old → new)
  _showChange(i) {
    const m = this._m, f = m.flags && m.flags[i];
    if (!f) { this._hideTip(); return; }
    this._tipKind = 'change';
    this._tipChange = i;
    const DP = { curve: 1, shift: 0, room_factor: 1, day_temp: 1, night_temp: 1, setback_size: 0, dhw_target: 0 };
    const NAMES = { curve: 'Weather curve', shift: 'Curve shift', room_factor: 'Room correction', day_temp: 'Day temperature',
      night_temp: 'Night temperature', setback_size: 'Setback', dhw_target: 'Hot water target' };
    const C_ = ['shift', 'day_temp', 'night_temp', 'setback_size', 'dhw_target'];
    const val = (o, x) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(DP[o.k] ?? 1)}${C_.includes(o.k) ? ' °C' : ''}`;
    this._place(`<div class="chg">${f.groups.map(g => `<div class="cg"><div class="ct">${this._fmt(g.t)}</div>${g.items.map(o =>
      `<div class="cr"><span class="ci">${icon(ROW_ICONS[o.k] || 'dhw', 'currentColor', 18)}</span><span class="cn">${NAMES[o.k] || o.label}</span>
        <span class="chv"><span class="from">${val(o, o.from)}</span>${icon('arrow', 'currentColor', 14)}<b>${val(o, o.to)}</b></span></div>`).join('')}</div>`).join('')}</div>`,
      w => f.x - w / 2, Y.mark.y - 10, true);
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => this._hideTip(), 8000);
  }
}


const STYLE = `
:host {
  display: block;
  /* the same look as Home Assistant's tile features (and the service-call spinbox and buttons in your other cards) */
  --hp-ctl: color-mix(in srgb, var(--disabled-color, #bdbdbd) 20%, transparent);
  --hp-hover: color-mix(in srgb, var(--secondary-text-color, #727272) 10%, transparent);
  --hp-label: color-mix(in srgb, var(--primary-text-color, #212121) 90%, transparent);
  --hp-op: color-mix(in srgb, var(--primary-text-color, #212121) 77%, transparent);
  --hp-icon: var(--state-icon-color, #44739e);
  --hp-on: var(--primary-color, #03a9f4);
  --hp-on-text: var(--text-primary-color, #fff);
  --hp-change: #ff725c;
  --hp-sel: color-mix(in srgb, var(--primary-text-color, #212121) 11%, transparent);
  --hp-night: #3f4f86;
  --hp-pick: color-mix(in srgb, var(--primary-text-color, #212121) 7%, transparent);
}
ha-card { overflow: hidden; container-type: inline-size; }
.wrap { padding: 16px 16px 14px; }
svg { display: block; overflow: visible; }
button { font: inherit; color: inherit; }

.head { position: relative; display: flex; align-items: center; gap: 8px; min-height: 40px; margin-bottom: 12px; }
.head .summary { padding: 0; width: 32px; background: none; }
.sinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; padding-left: 4px; }
.sinfo .st { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; }
.sinfo .wx { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
.sinfo .wx svg { color: var(--hp-icon); }
.sinfo .ss[hidden] { display: none; }
.shead .wxi { display: inline-block; margin-right: 5px; vertical-align: -3px; color: var(--hp-icon); }
.sinfo .ss { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sinfo .ss i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.head .summary[aria-expanded="true"] { background: var(--hp-sel); }

/* buttons: a light grey fill, a slightly darker one when on (no theme colour: the colours are kept for the data) */
.ctl { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; height: 36px; min-width: 36px; padding: 0 16px;
  border: 0; border-radius: 12px; background: var(--hp-ctl); color: var(--hp-label); font-size: 14px; font-weight: 500; cursor: pointer;
  -webkit-tap-highlight-color: transparent; transition: background-color 180ms ease-in-out; }
.ctl svg { color: var(--hp-op); flex: none; }
.ctl.on, .ctl[aria-expanded="true"] { background: var(--hp-sel); color: var(--primary-text-color); }
.ctl:disabled { opacity: 0.5; cursor: default; }
.summary:focus-visible, .ctl:focus-visible, .pb:focus-visible, .pager .label:focus-visible, .spin .op:focus-visible, .hbtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--primary-color); }
.head .ctl, .adjust-btn { height: 32px; min-width: 32px; border-radius: 10px; }
.head .cal { padding: 0; width: 32px; background: none; }
.head .cal[aria-expanded="true"] { background: var(--hp-sel); }
.ranges { display: flex; flex: none; height: 32px; padding: 0; border-radius: 10px; background: var(--hp-ctl); }
.ranges button { height: 32px; min-width: 34px; padding: 0 9px; border: 0; border-radius: 10px; background: none; cursor: pointer;
  font-size: 14px; color: var(--hp-label); -webkit-tap-highlight-color: transparent; transition: background-color 180ms ease-in-out; }
.ranges button[aria-pressed="true"] { background: var(--hp-pick); color: var(--primary-text-color); }
.ranges button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--primary-color); }
.date { position: absolute; right: 0; top: 30px; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
@media (hover: hover) {
  .ctl:hover:not(:disabled), .pb:hover:not(:disabled), .pager .label:hover, .spin .op:hover:not(:disabled), .hbtn:hover,
  .ranges button:hover:not([aria-pressed="true"]) { background-image: linear-gradient(var(--hp-hover), var(--hp-hover)); }
}
/* the date bar: a grey box with back, the date and forward, and grey buttons beside it */
.navbar { position: relative; display: flex; align-items: center; gap: 8px; height: 32px; margin: -4px 0 10px; }
.navbar[hidden] { display: none; }
.pager { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; height: 32px; border-radius: 10px; background: var(--hp-ctl); }
.pb, .pager .label { display: inline-flex; align-items: center; justify-content: center; height: 32px; border: 0; border-radius: 10px; background: none;
  cursor: pointer; font: inherit; -webkit-tap-highlight-color: transparent; }
.pb { width: 32px; flex: none; padding: 0; color: var(--hp-op); }
.pb:disabled { opacity: 0.3; cursor: default; }
.pager .pb[data-act="next"]:disabled { visibility: hidden; }
.navbar > .pb { background: var(--hp-ctl); }
.navbar > .pb.on { background: var(--hp-sel); color: var(--primary-text-color); }
.pager .label { flex: 1 1 auto; min-width: 0; gap: 4px; padding: 0 4px; font-size: 14px; font-weight: 500; color: var(--hp-label); white-space: nowrap; }
.pager .label span { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pager .label em { flex: none; font-style: normal; font-weight: 400; color: var(--secondary-text-color); }
.pager .label .dd { display: inline-flex; font-style: normal; color: var(--secondary-text-color); }
.navbar .now { width: auto; gap: 4px; padding: 0 12px 0 8px; font-size: 14px; font-weight: 500; color: var(--hp-label); }
.menu { position: absolute; z-index: 5; top: 38px; left: 32px; width: 210px; padding: 6px; border-radius: 12px;
  background: var(--card-background-color, #fff); box-shadow: 0 0 0 1px rgba(127, 127, 127, 0.2), 0 8px 24px rgba(0, 0, 0, 0.18); }
.menu .mi { display: flex; align-items: center; justify-content: flex-start; gap: 16px; width: 100%; height: 40px; padding: 0 10px; border-radius: 8px;
  border: 0; background: none; cursor: pointer; font-size: 14px; text-align: left; color: var(--primary-text-color); }
.menu .mi svg { color: var(--secondary-text-color); flex: none; }
.menu .mi:hover { background: rgba(127, 127, 127, 0.08); }

.stats { margin: -4px 0 20px; padding: 0 0 10px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
  border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); }
.stats[hidden] { display: none; }
.stats .when { font-size: 14px; line-height: 28px; color: var(--secondary-text-color); margin-bottom: 0; }
/* the numbers: three to a row, each with a small icon and name, the number, and a line underneath */
.sec { margin: 10px 0 4px; padding-top: 8px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
  font-size: 12px; font-weight: 500; letter-spacing: 0.3px; color: var(--secondary-text-color); }
.etab { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.etab th { padding: 0 0 2px; font-size: 12px; font-weight: 400; color: var(--secondary-text-color); text-align: right; }
.etab td { padding: 2px 0; text-align: right; color: var(--secondary-text-color); white-space: nowrap; vertical-align: top; }
.etab td.l { text-align: left; color: var(--primary-text-color); }
.etab td.l span { display: inline-flex; align-items: center; gap: 8px; }
.etab td.l svg { color: var(--hp-icon); flex: none; }
.etab td.t b { font-size: 16px; font-weight: 400; color: var(--primary-text-color); }
.etab td.t small { font-size: 12px; }
.etab .d { display: block; font-size: 11px; line-height: 14px; }
.trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.cell { min-width: 0; }
.cl { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; }
.cl svg { color: var(--hp-icon); flex: none; }
.cv { margin-top: 1px; font-size: 18px; line-height: 22px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv small { font-size: 12px; color: var(--secondary-text-color); }
.cs { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); }
.nw { white-space: nowrap; }
.cell .d { display: block; font-size: 11px; line-height: 15px; }
.d { font-size: 12px; color: var(--secondary-text-color); font-weight: 500; white-space: nowrap; }
.split { display: flex; gap: 2px; height: 8px; margin: 4px 0 6px; border-radius: 4px; overflow: hidden; }
.split span { min-width: 2px; }
.key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--secondary-text-color); }
.key span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.key b { font-weight: 500; color: var(--primary-text-color); }
.key i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
/* rows like an entities card: icon, name with a second line, value on the right */
.ric { width: 40px; height: 40px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--hp-icon); }

.stage { position: relative; }
.chart, .cursor { position: absolute; left: 0; top: 0; width: 100%; pointer-events: none; }
.grid { stroke: rgba(127, 127, 127, 0.18); stroke-width: 1; }
.ln { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.ln.prev { stroke-dasharray: 4 3; stroke-opacity: 0.5; }
.ln.fc { stroke-dasharray: 0.5 3.5; stroke-width: 2; }
.ahead { fill: var(--primary-text-color, #212121); fill-opacity: 0.03; }
.sf { color: var(--secondary-text-color); font-weight: 400; }
.nchip .fcd { flex: none; width: 14px; height: 3px; background: radial-gradient(circle, var(--secondary-text-color) 1px, transparent 1.3px) 0 50% / 4px 3px repeat-x !important; }
.kt .fcl { width: 14px; height: 3px; background: radial-gradient(circle, var(--secondary-text-color) 1px, transparent 1.3px) 0 50% / 4px 3px repeat-x; opacity: 0.35; }
.kt.on .fcl { opacity: 1; }
.kt .beta { font-size: 10px; letter-spacing: 0.3px; text-transform: uppercase; color: var(--secondary-text-color); }
.dot { stroke: var(--card-background-color, #fff); stroke-width: 1.5; }
.cross { stroke: var(--primary-text-color); stroke-opacity: 0.35; stroke-width: 1; }
.change { stroke: var(--hp-icon); stroke-opacity: 0.5; stroke-width: 1; stroke-dasharray: 2 3; }
.change.sel { stroke-opacity: 1; stroke-dasharray: none; }
.nchip .since { color: var(--secondary-text-color); }


.labels, .ui { position: absolute; inset: 0; pointer-events: none; }
.labels > span, .ui > span { position: absolute; white-space: nowrap; }
.ytick, .olabel { transform: translateY(-50%); font-size: 12px; color: var(--primary-text-color); }
.olabel { font-weight: 500; }
.xtick { transform: translateX(-50%); font-size: 12px; color: var(--primary-text-color); }
.xtick.day { font-weight: 600; }
.tag { transform: translateY(-50%); font-size: 12px; font-weight: 600; line-height: 16px; }

.stage.scrubbing .labels .tag { opacity: 0.35; }
.shead { display: flex; align-items: baseline; justify-content: space-between; font-size: 12px; line-height: 16px; color: var(--primary-text-color); }
.shead [role="button"] { pointer-events: auto; cursor: pointer; }
.shead .hv b { font-size: 14px; font-weight: 600; }
.shead .dw { color: var(--secondary-text-color); }
.note { font-size: 12px; color: var(--secondary-text-color); }
.mark { transform: translate(-50%, -50%); pointer-events: auto; cursor: pointer; padding: 7px; display: inline-flex; -webkit-tap-highlight-color: transparent; }
.mark i { display: inline-flex; align-items: center; justify-content: center; width: 10px; height: 10px; border-radius: 50%; background: var(--hp-icon);
  box-shadow: 0 0 0 2px var(--card-background-color, #fff); font-style: normal; font-size: 9px; font-weight: 600; color: #fff; }
.mark i.n { width: 15px; height: 15px; }
.mark b { position: absolute; left: 15px; top: 0; font-size: 9px; font-weight: 600; line-height: 11px; padding: 0 3px; border-radius: 6px;
  color: var(--card-background-color, #fff); background: var(--secondary-text-color); }
.live, .cmp { pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 12px 0 8px;
  border-radius: 999px; font-size: 12px; font-weight: 500; -webkit-tap-highlight-color: transparent; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); }
.live { color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, var(--card-background-color, #fff)); }
.cmp { color: var(--secondary-text-color); background: var(--card-background-color, #fff); padding: 0 8px; }
.cmp i { width: 16px; height: 0; border-top: 2px dashed var(--secondary-text-color); opacity: 0.8; }
.cmp .cn, .cmp .cx { display: inline-flex; align-items: center; cursor: pointer; }
.cmp .cx { margin-left: 2px; padding: 2px; border-radius: 50%; }

.hit { position: absolute; touch-action: pan-y; outline: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: crosshair; }
.hit:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
.tip { position: absolute; z-index: 2; pointer-events: none; min-width: 140px; padding: 8px 10px 9px; border-radius: 10px;
  background: var(--card-background-color, #fff); color: var(--primary-text-color); font-size: 13px; line-height: 19px;
  box-shadow: 0 0 0 1px rgba(127, 127, 127, 0.22), 0 4px 14px rgba(0, 0, 0, 0.16); }
.tip[hidden] { display: none; }
.chg { white-space: nowrap; }
.chg .cg + .cg { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); }
.chg .ct { font-size: 12px; line-height: 18px; color: var(--secondary-text-color); }
.chg .cr { display: flex; align-items: center; gap: 8px; min-height: 28px; font-size: 13px; }
.chg .ci { display: inline-flex; color: var(--hp-icon); }
.chg .cn { flex: 1; }
.chg .chv { display: inline-flex; align-items: center; gap: 4px; margin-left: 14px; font-variant-numeric: tabular-nums; }
.chg .chv .from, .chg .chv svg { color: var(--secondary-text-color); }
.chg .chv b { font-weight: 500; }
.tip .when { font-weight: 500; margin-bottom: 3px; }
.tip .chips { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-bottom: 2px; }
.tip .chip { display: inline-flex; align-items: center; gap: 6px; }
.tip .chip.big { font-weight: 500; }
.tip i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.tip .row { display: flex; justify-content: space-between; gap: 14px; }
.tip .row b { font-weight: 600; }
.tip .row.sub { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); }
.tip .row.sub.flat { margin-bottom: 2px; }
.tip .gap { height: 6px; }

.legend { margin-top: 10px; font-size: 13px; }
.warn { display: flex; align-items: flex-start; gap: 8px; margin: 2px 0 6px; font-size: 12.5px; line-height: 18px; color: var(--secondary-text-color); }
.warn[data-act] { cursor: pointer; }
.warn svg { flex: none; margin-top: 1px; color: #e8a317; }
.warn b { font-weight: 500; color: var(--primary-text-color); }
.nowrow { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.nchips { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--primary-text-color); }
.nchip { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.nchip .blk { width: 10px; height: 10px; border-radius: 3px; background: var(--c); flex: none; }
.nchip .bar { width: 12px; height: 3px; border-radius: 2px; background: var(--c); flex: none; }
.keybtn { flex: none; display: inline-flex; align-items: center; gap: 2px; height: 32px; padding: 0 6px 0 10px; border: 0; border-radius: 10px; background: none;
  cursor: pointer; font: inherit; font-size: 13px; color: var(--secondary-text-color); -webkit-tap-highlight-color: transparent; }
.keybtn svg { transition: transform 0.2s; }
.keybtn[aria-expanded="true"] svg { transform: rotate(180deg); }
@media (hover: hover) { .keybtn:hover { background: var(--hp-hover); } }
.keyfull { display: grid; grid-template-columns: 1fr 1.05fr 1.15fr; gap: 0 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); }
.keyfull .col { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
:is(.legend, .keyfull) .item { display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 8px; margin-left: -8px; border-radius: 13px;
  cursor: pointer; color: var(--primary-text-color); white-space: nowrap; min-width: 0; -webkit-tap-highlight-color: transparent; }
:is(.legend, .keyfull) .item.has-val { align-self: stretch; }
:is(.legend, .keyfull) .item .name { flex: none; }
:is(.legend, .keyfull) .item .val { margin-left: auto; padding-left: 6px; color: var(--primary-text-color); font-weight: 500; font-variant-numeric: tabular-nums; }
:is(.legend, .keyfull) .item.on { background: color-mix(in srgb, var(--primary-text-color, #212121) 7%, transparent); font-weight: 500; }
:is(.legend, .keyfull) .item.off .name { color: var(--secondary-text-color); }
:is(.legend, .keyfull) .item.off .line { opacity: 0.3; }
:is(.legend, .keyfull) .none { width: 14px; flex: none; }
.kshow { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); font-size: 12px; color: var(--secondary-text-color); }
.kshow > span { margin-right: 2px; }
.kt { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px 0 10px; border: 0; border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--secondary-text-color); background: var(--hp-ctl); -webkit-tap-highlight-color: transparent; }
.kt.on { background: var(--hp-sel); color: var(--primary-text-color); }
.kt .line { width: 14px; height: 3px; border-radius: 2px; background: var(--c); opacity: 0.35; }
.kt .mk { width: 8px; height: 8px; border-radius: 50%; background: var(--hp-icon); opacity: 0.35; }
.kt.on .line, .kt.on .mk { opacity: 1; }
:is(.legend, .keyfull) .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: none; }
:is(.legend, .keyfull) .bar { width: 12px; height: 3px; border-radius: 2px; background: var(--c); flex: none; }
:is(.legend, .keyfull) .line { width: 14px; height: 3px; border-radius: 2px; background: var(--c); flex: none; }
:is(.legend, .keyfull) .ring { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--c); flex: none; }
.whyrow { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
/* room for two lines of each (the sum, then what's going on), always, so nothing moves as you scrub */
.why { flex: 1; min-width: 0; height: 36px; display: flex; align-items: center; font-size: 12px; line-height: 17px; color: var(--secondary-text-color); }
.why > div { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.why b { font-weight: 500; color: var(--primary-text-color); }
.why .story { margin-top: 0; }
.why .story b { color: var(--primary-text-color); }
.adjust-btn { padding: 0 14px 0 10px; }

[role="button"]:focus-visible, .mi:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }

/* Adjust: a section like the others in your cards (a divider and a small grey heading), then entity-style rows */
.adjust { margin-top: 10px; }
.adjust[hidden] { display: none; }
.ahd { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); font-size: 14px; line-height: 32px; color: var(--secondary-text-color); }
.arow { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 0 16px; min-height: 48px; }
.rh { flex-basis: 100%; padding: 2px 8px 12px 56px; font-size: 12px; line-height: 17px; color: var(--secondary-text-color); }
.arow.tgt .rh { padding-top: 6px; }
.hbtns { display: inline-flex; gap: 2px; margin-right: -4px; }
.calc { flex-basis: 100%; margin: 2px 0 6px 56px; width: calc(100% - 56px); border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.calc th { padding: 0 0 4px 4px; font-weight: 400; text-align: right; color: var(--secondary-text-color); white-space: nowrap; }
.calc td { padding: 3px 0 3px 4px; text-align: right; color: var(--primary-text-color); white-space: nowrap; }
.calc th:first-child, .calc td.l { padding-left: 0; text-align: left; color: var(--secondary-text-color); }
.calc tr + tr td { border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); }
.calc td b { font-weight: 500; }
.calc td.ch { color: var(--hp-change); }
.calc td.na { color: var(--disabled-text-color, #bdbdbd); }
.hbtn:disabled { opacity: 0.3; cursor: default; }
.hbtn { width: 32px; height: 32px; padding: 0; border: 0; border-radius: 10px; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); -webkit-tap-highlight-color: transparent; }
.hbtn.on { background: var(--hp-sel); color: var(--primary-text-color); }
.arow .rt { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.rn { display: flex; align-items: center; min-width: 0; font-size: 14px; line-height: 20px; color: var(--primary-text-color); }
.rn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rs { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arow.sending .ric { color: var(--disabled-color, #bdbdbd); }
.rv { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; }
.rv .old, .rv svg { color: var(--secondary-text-color); }
.rv b { font-weight: 500; color: var(--hp-change); }
/* the spinbox: the service-call one, 36 px high with 12 px corners, small − and + at the ends, the value in the middle */
.spin { position: relative; display: flex; align-items: center; justify-content: center; flex: none; width: 188px; height: 36px;
  border-radius: 12px; background: var(--hp-ctl); }
.spin .op { position: absolute; top: 0; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 12px; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: var(--hp-op); -webkit-tap-highlight-color: transparent; }
.spin .op:first-child { left: 0; }
.spin .op:last-child { right: 0; }
.spin .op svg { transform: scale(1.1); }
.spin .op:disabled { opacity: 0.3; cursor: default; }
.spin .v { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; line-height: 15px; color: var(--hp-label);
  font-variant-numeric: tabular-nums; white-space: nowrap; }
.spin .v .old { position: relative; z-index: 1; height: 26px; margin: 0 -4px; padding: 0 4px; border: 0; border-radius: 6px; background: none; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 400; color: var(--secondary-text-color); -webkit-tap-highlight-color: transparent; }
@media (hover: hover) { .spin .v .old:hover { background: var(--hp-hover); color: var(--primary-text-color); } }
.arow.changed .spin .cur { color: var(--hp-change); }
.aact { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; padding: 12px 0 4px; border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2)); }
.aact .status { flex: 1; min-width: 0; font-size: 12px; line-height: 16px; color: var(--secondary-text-color); }
.aact .status.err { color: var(--error-color, #db4437); }
.arow.unconf .rs { color: var(--error-color, #db4437); }
.adiv { height: 1px; margin: 8px 0 8px 56px; background: color-mix(in srgb, var(--divider-color, rgba(127, 127, 127, 0.2)) 70%, transparent); }
.aact .reset { padding: 0; width: 36px; }
.aact .save:not(:disabled) { background: var(--hp-sel); color: var(--primary-text-color); }

/* phones: less padding round the edge, slimmer controls */
@container (max-width: 420px) {
  .wrap { padding: 12px 12px 12px; }
  .head { gap: 6px; }
  .ranges button { padding: 0 6px; min-width: 32px; font-size: 13px; }
  .legend { font-size: 12.5px; }
  .keyfull { gap: 0 2px; }
  :is(.legend, .keyfull) .item { gap: 6px; padding: 0 6px; margin-left: -6px; }
  .navbar .now { padding: 0; width: 32px; }
  /* no room for the time beside the controls on a phone: they step aside while you scrub */
  .head.scrubbing .cal, .head.scrubbing .ranges { display: none; }
  .navbar .now span, .pager .label .dd { display: none; }
  .trio { gap: 6px; }
  .cv { font-size: 16px; }
  .etab th, .etab td { padding-left: 4px; }
  .cv { font-size: 16px; }
  .arow { gap: 0 12px; }
  .rh { padding-left: 52px; padding-right: 4px; }
  .calc { margin-left: 52px; width: calc(100% - 52px); font-size: 11.5px; }
  .spin { width: 148px; }
  .arow.changed .spin .u { display: none; }
}
`;

// Material Design Icons (pictogrammers.com/library/mdi), Apache 2.0
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

if (!customElements.get('heat-pump-story-card')) {
  customElements.define('heat-pump-story-card', HeatPumpStoryCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'heat-pump-story-card', name: 'Heat pump story', description: 'Flow, target and return with what the heat pump was doing' });
  console.info(`%c HEAT-PUMP-STORY-CARD %c ${VERSION} `, 'background:#4269d0;color:#fff;border-radius:3px 0 0 3px', 'background:#444;color:#fff;border-radius:0 3px 3px 0');
}