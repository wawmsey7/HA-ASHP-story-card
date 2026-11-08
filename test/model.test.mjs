// Run with: TZ=Europe/London node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, loadFixture } from './load.mjs';

const M = loadModules();
const plain = x => JSON.parse(JSON.stringify(x));
const F = loadFixture(M);
const now = F.end;
const S = M.buildSeries(F.store, now);
const day = iso => new Date(iso).getTime();   // local midnight (TZ=Europe/London, GMT in November)

test('fixture covers the three days', () => {
  assert.ok(S.flow.length > 4000, 'flow readings');
  assert.ok(S.activity.length > 50, 'activity changes');
  assert.ok(S.meter.length > 15000, 'meter readings');
});

test('hub dropouts are bridged: no gaps in the flow', () => {
  assert.deepEqual(plain(M.gaps(S.flow, F.start, now)), []);
  // ...and the "unavailable" blips are gone from the activity
  assert.ok(!S.activity.some(p => p[1] === null || p[1] === 'unavailable'));
});

test('Sun 8 Nov: 11 defrosts, 1 hot water run (a defrost inside it does not split it), 3 starts', () => {
  const st = M.computeStats(S, day('2026-11-08T00:00:00'), day('2026-11-09T00:00:00'), now);
  assert.equal(st.defrosts, 11);
  assert.equal(st.hwRuns, 1);
  assert.equal(st.starts, 3);
  // energy from the meter and the hub's heat reading (matches the plan's table)
  assert.ok(Math.abs(st.elec - 21.1) < 0.3, `electricity ${st.elec}`);
  assert.ok(Math.abs(st.heat - 118.9) < 3, `heat ${st.heat}`);
  assert.ok(st.cop > 5 && st.cop < 6.2, `COP ${st.cop}`);
});

test('Fri 6 and Sat 7 Nov look like normal days', () => {
  for (const [a, b] of [['2026-11-06', '2026-11-07'], ['2026-11-07', '2026-11-08']]) {
    const st = M.computeStats(S, day(`${a}T00:00:00`), day(`${b}T00:00:00`), now);
    console.log(a, { defrosts: st.defrosts, hwRuns: st.hwRuns, starts: st.starts, elec: +st.elec.toFixed(1), heat: +st.heat.toFixed(1), heating: M.dur(st.heating), satisfied: M.dur(st.satisfied) });
    assert.ok(st.defrosts >= 5 && st.defrosts <= 12);
    assert.ok(st.hwRuns >= 1 && st.hwRuns <= 3);
    assert.ok(st.elec > 18 && st.elec < 23);
    assert.ok(st.heating > 15 * M.HOUR);
  }
});

test('target colour: green from the step down after the room is satisfied (Sat 18:57)', () => {
  const t0 = day('2026-11-07T18:00:00'), t1 = day('2026-11-07T21:00:00');
  const tl = M.targetColours(S, t0, t1);
  const sat = tl.find(p => p[1] === 'sat');
  assert.ok(sat, 'has a satisfied stretch');
  assert.ok(Math.abs(sat[0] - day('2026-11-07T18:57:36')) < 10 * M.MIN, `starts ${new Date(sat[0]).toISOString()}`);
});

test('target colour: amber over the hot water run at 13:02 on Sun 8', () => {
  const tl = M.targetColours(S, day('2026-11-08T12:00:00'), day('2026-11-08T15:00:00'));
  const hw = tl.find(p => p[1] === 'hw');
  assert.ok(hw && Math.abs(hw[0] - day('2026-11-08T13:02:00')) < 10 * M.MIN);
  // the defrost in the middle doesn't break the amber
  const after = tl.filter(p => p[0] > hw[0] && p[0] < day('2026-11-08T13:50:00'));
  assert.ok(!after.length, JSON.stringify(after));
});

test('setting changes on Sun 8: the curve shift and day temp moves', () => {
  const g = M.settingChanges(S, day('2026-11-08T00:00:00'), now);
  const shift = g.flatMap(x => x.items).filter(i => i.k === 'shift').map(i => `${i.from}→${i.to}`);
  assert.deepEqual(plain(shift), ['0→4', '4→5', '5→6', '6→5']);
  const dayT = g.flatMap(x => x.items).filter(i => i.k === 'day_temp').map(i => `${i.from}→${i.to}`);
  assert.deepEqual(plain(dayT), ['21.5→22', '22→22.2']);
});

test('warnings: nothing alarming in an ordinary day', () => {
  const fmt = M.makeFmt({ language: 'en-GB', time_format: '24' });
  const t0 = day('2026-11-07T00:00:00'), t1 = day('2026-11-08T00:00:00');
  const w = M.warnings(S, t0, t1, now, M.computeStats(S, t0, t1, now), fmt);
  assert.ok(Array.isArray(w) && w.length <= 2);
  console.log('warnings Sat 7:', w.map(x => `${x.title}: ${x.text}`));
});

test('sun times for the Midlands in early November', () => {
  const { rise, set } = M.sunTimes(day('2026-11-08T00:00:00'), 52.5, -1.9);
  const fmt = M.makeFmt({ language: 'en-GB', time_format: '24' });
  assert.ok(rise && set);
  const r = new Date(rise), s = new Date(set);
  assert.ok(r.getHours() === 7, fmt.hm(rise));
  assert.ok(s.getHours() === 16, fmt.hm(set));
});

test('formatting', () => {
  const fmt = M.makeFmt({ language: 'en-GB', time_format: '24' });
  assert.equal(M.deg(-1.68), '−1.7°');
  assert.equal(M.deg(0.04), '0.0°');
  assert.equal(M.signed(-1.68), '−1.7');
  assert.equal(M.dur(80 * M.MIN), '1h 20m');
  assert.equal(M.spanWords(12 * M.HOUR), '12 hours');
  assert.equal(M.spanWords(M.HOUR), '1 hour');
  assert.equal(M.spanWords(30 * M.MIN), '30 minutes');
  assert.equal(M.spanWords(72 * M.HOUR), '3 days');
  assert.equal(fmt.hm(day('2026-11-08T06:05:00')), '06:05');
  assert.equal(fmt.tick(day('2026-11-08T06:00:00')), '06');
  const f12 = M.makeFmt({ language: 'en-GB', time_format: '12' });
  assert.equal(f12.hm(day('2026-11-08T18:05:00')), '6:05 PM');
  assert.equal(f12.tick(day('2026-11-08T18:00:00')), '6 PM');
});
