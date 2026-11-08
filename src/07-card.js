
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
