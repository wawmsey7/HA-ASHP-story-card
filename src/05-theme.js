
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
