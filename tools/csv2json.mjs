// Converts a Home Assistant history CSV export (entity_id,state,last_changed) into a compact fixture
// for the harness and the prototype page: { start, end, e: { entity_id: [deltas_ds, values] } }
// deltas are tenths of a second since the previous reading (the first since `start`).
import fs from 'node:fs';

const [, , src, dst] = process.argv;
const KEEP = [
  'sensor.heat_pump_activity_log', 'binary_sensor.thermostat_setback', 'sensor.room_thermostat_request',
  'sensor.target_flow_temp_2', 'sensor.actual_flow_temp_2', 'sensor.actual_return_temp_2',
  'sensor.room_thermostat_temp', 'sensor.exterior_weather_sensor',
  'sensor.heat_pump_electrical_power_2', 'sensor.heat_pump_thermal_power_2', 'sensor.ashp_power_usage',
  'sensor.circuit_1_comfort_day_temp', 'sensor.circuit_1_eco_night_temp', 'sensor.weather_comp_curve',
  'sensor.curve_shift', 'sensor.room_temperature_correction', 'sensor.circuit_1_temp_reduction',
  'sensor.circuit_1_hysteresis_2', 'sensor.dhw_target_temp_setting', 'sensor.c1_desired_heating_lwt_2',
  'sensor.actual_dhw_temp_2', 'sensor.hot_water_remaining', 'sensor.flow_rate_2',
  'sensor.compressor_frequency_2', 'sensor.cop_real', 'sensor.flow_target_breakdown',
];
const rows = fs.readFileSync(src, 'utf8').trim().split('\n').slice(1);
const by = {};
let start = Infinity, end = -Infinity;
for (const line of rows) {
  const i = line.indexOf(','), j = line.lastIndexOf(',');
  const id = line.slice(0, i), state = line.slice(i + 1, j), t = Date.parse(line.slice(j + 1));
  if (!KEEP.includes(id) || !Number.isFinite(t)) continue;
  (by[id] = by[id] || []).push([t, state]);
  start = Math.min(start, t); end = Math.max(end, t);
}
const e = {};
for (const [id, list] of Object.entries(by)) {
  list.sort((a, b) => a[0] - b[0]);
  let prev = start;
  const d = [], v = [];
  for (const [t, s] of list) {
    d.push(Math.round((t - prev) / 100));
    prev = prev + Math.round((t - prev) / 100) * 100;
    const n = Number(s);
    v.push(s !== '' && Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : s);
  }
  e[id] = [d, v];
}
fs.writeFileSync(dst, JSON.stringify({ start, end, e }));
const pts = Object.values(e).reduce((a, x) => a + x[0].length, 0);
console.log(`${Object.keys(e).length} entities, ${pts} readings, ${(fs.statSync(dst).size / 1024).toFixed(0)} KB, ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);
