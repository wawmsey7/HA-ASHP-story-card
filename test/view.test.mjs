// Run with: TZ=Europe/London node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './load.mjs';

const M = loadModules();
const plain = x => JSON.parse(JSON.stringify(x));
const { HOUR, DAY, MIN } = M;
const T = iso => new Date(iso).getTime();
const now = T('2026-11-08T18:17:00');              // Sun 8 Nov, 18:17
const fmt = M.makeFmt({ language: 'en-GB', time_format: '24' });
const title = v => M.titleOf(v, now, fmt).title;
const win = v => { const w = M.windowOf(v, now); return [new Date(w.t0).toString().slice(0, 21), new Date(w.t1).toString().slice(0, 21)]; };

test('live views: the right edge is now', () => {
  const v = { kind: 'live', span: 12 * HOUR };
  assert.equal(title(v), 'Last 12 hours');
  const w = M.windowOf(v, now);
  assert.equal(w.t1, now); assert.equal(w.t0, now - 12 * HOUR); assert.ok(w.live);
  assert.equal(M.chipOf(v), 12 * HOUR);
});

test('‹ from live 12h: the previous stretch, ending on the hour', () => {
  const v = M.stepView({ kind: 'live', span: 12 * HOUR }, -1, now);
  assert.equal(v.kind, 'free');
  assert.equal(title(v), 'Sat 19:00 – Sun 07:00');
  assert.equal(M.chipOf(v), 12 * HOUR);
});

test('‹ from live 24h is Yesterday; › then gives Today, and › again stays', () => {
  const y = M.stepView({ kind: 'live', span: 24 * HOUR }, -1, now);
  assert.deepEqual(plain([y.kind, y.n, title(y)]), ['days', 1, 'Yesterday']);
  const t = M.stepView(y, 1, now);
  assert.equal(title(t), 'Today');
  assert.ok(M.windowOf(t, now).live, 'Today is live');
  assert.ok(M.sameView(M.stepView(t, 1, now), t), 'nowhere to go after today');
  const fri = M.stepView(M.stepView(t, -1, now), -1, now);
  assert.equal(title(fri), 'Fri 6 Nov');
});

test('› on an old stretch that reaches now goes live', () => {
  const v = { kind: 'free', t0: now - 14 * HOUR, span: 12 * HOUR };
  const n = M.stepView(v, 1, now);
  assert.deepEqual(plain(n), { kind: 'live', span: 12 * HOUR });
});

test('‹ stops at the oldest history', () => {
  const minT = T('2026-11-05T17:00:00');
  const fri = { kind: 'days', start: T('2026-11-06T00:00:00'), n: 1 };
  const thu = M.stepView(fri, -1, now, minT);
  assert.equal(title(thu), 'Thu 5 Nov', 'Thursday still has its evening');
  assert.ok(M.sameView(M.stepView(thu, -1, now, minT), thu), 'nothing before Thursday');
});

test('zoom chips: live stays live; elsewhere zoom around the inspector', () => {
  assert.deepEqual(plain(M.zoomView({ kind: 'live', span: 12 * HOUR }, 3 * HOUR, now)), { kind: 'live', span: 3 * HOUR });
  const y = { kind: 'days', start: T('2026-11-07T00:00:00'), n: 1 };
  const z = M.zoomView(y, 3 * HOUR, now, T('2026-11-07T14:05:00'));
  assert.equal(title(z), 'Yesterday · 12:30–15:30');
  const w = M.windowOf(z, now);
  assert.ok(w.t0 <= T('2026-11-07T14:05:00') && T('2026-11-07T14:05:00') <= w.t1, 'the inspector stays in view');
  // without an inspector: around the middle
  assert.equal(title(M.zoomView(y, 6 * HOUR, now)), 'Yesterday · 09:00–15:00');
  // zooming out to 3 days from today: the three days ending tonight
  const t = { kind: 'days', start: T('2026-11-08T00:00:00'), n: 1 };
  assert.equal(title(M.zoomView(t, 72 * HOUR, now)), 'Fri 6 – Sun 8 Nov');
  // zooming in near now goes live
  assert.deepEqual(plain(M.zoomView({ kind: 'free', t0: now - 5 * HOUR, span: 6 * HOUR }, 3 * HOUR, now, now - 20 * MIN)), { kind: 'live', span: 3 * HOUR });
});

test('a tap on a day shows that whole day', () => {
  const v = M.dayView(T('2026-11-06T15:00:00'), now);
  assert.deepEqual(plain(win(v)), ['Fri Nov 06 2026 00:00', 'Sat Nov 07 2026 00:00']);
  assert.equal(M.chipOf(v), 24 * HOUR);
  assert.equal(title(M.dayView(now + DAY, now)), 'Today', 'never a day after today');
});

test('after a drag: tidy times, live when the right edge reaches now', () => {
  assert.deepEqual(plain(M.settleView(now - 12 * HOUR - 20000, 12 * HOUR, now)), { kind: 'live', span: 12 * HOUR });
  const v = M.settleView(T('2026-11-08T03:07:00'), 6 * HOUR, now);
  assert.equal(title(v), 'Today · 03:05–09:05');
  const w = M.settleView(T('2026-11-07T00:06:00'), 24 * HOUR, now);
  assert.deepEqual(plain([w.kind, title(w)]), ['days', 'Yesterday'], 'lands on whole days → pages by days');
});

test('after a pinch: snaps to a chip when within 15%, keeping the fingers\' moment still', () => {
  const anchor = T('2026-11-08T10:00:00');
  const v = M.settleView(T('2026-11-08T05:00:00'), 11 * HOUR, now, { snapSpan: true, anchor });
  assert.equal(M.chipOf(v), 12 * HOUR);
  const w = M.windowOf(v, now);
  assert.ok(Math.abs((anchor - w.t0) / (w.t1 - w.t0) - 5 / 11) < 0.02, 'anchor stays at the same place');
  const odd = M.settleView(T('2026-11-08T05:00:00'), 8 * HOUR, now, { snapSpan: true });
  assert.equal(M.chipOf(odd), null, '8 hours is not near a chip');
  assert.equal(title(odd), 'Today · 05:00–13:00');
});

test('titles for longer and older stretches', () => {
  assert.equal(title({ kind: 'days', start: T('2026-11-02T00:00:00'), n: 7 }), 'Mon 2 – Sun 8 Nov');
  assert.equal(title({ kind: 'days', start: T('2026-10-30T00:00:00'), n: 3 }), 'Fri 30 Oct – Sun 1 Nov');
  assert.equal(title({ kind: 'free', t0: T('2026-10-28T18:00:00'), span: 12 * HOUR }), 'Wed 28 Oct 18:00 – Thu 29 Oct 06:00');
  assert.equal(title({ kind: 'live', span: 72 * HOUR }), 'Last 3 days');
});

test('daylight saving: whole days are 25 and 23 hours long', () => {
  const autumn = { kind: 'days', start: T('2026-10-25T00:00:00'), n: 1 };
  const w = M.windowOf(autumn, now);
  assert.equal((w.t1 - w.t0) / HOUR, 25);
  const spring = { kind: 'days', start: T('2026-03-29T00:00:00'), n: 1 };
  const w2 = M.windowOf(spring, T('2026-04-10T12:00:00'));
  assert.equal((w2.t1 - w2.t0) / HOUR, 23);
  // stepping across the change keeps midnight to midnight
  const next = M.stepView(autumn, 1, now);
  assert.equal(new Date(next.start).getHours(), 0);
  assert.equal(title(next), 'Mon 26 Oct');
});
