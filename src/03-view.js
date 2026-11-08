
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
