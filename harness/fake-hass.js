// A stand-in for Home Assistant's `hass` object, driven by the recorded history (fixture/history.json).
// The recording is moved forward by whole days so its last reading falls today, and the card's clock is set
// so "now" is that last reading (it then runs on in real time).
(function () {
  const DAY = 86400e3;
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function decode(fix) {
    const shift = Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(fix.end)) / DAY)) * DAY;
    const byId = {};
    for (const [id, [d, v]] of Object.entries(fix.e)) {
      let t = fix.start;
      byId[id] = d.map((dt, i) => { t += dt * 100; return [t + shift, String(v[i])]; });
    }
    return { byId, start: fix.start + shift, end: fix.end + shift };
  }

  // index of the last reading at or before t (-1 if none)
  function indexAt(list, t) {
    let lo = 0, hi = list.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid][0] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }

  window.makeFakeHass = function (fix, opts = {}) {
    const D = decode(fix);
    const log = opts.log || (() => {});
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const latency = opts.latency ?? 250;
    const states = {};
    for (const [id, list] of Object.entries(D.byId)) {
      const [t, s] = list[list.length - 1];
      const iso = new Date(t).toISOString();
      states[id] = { entity_id: id, state: s, last_changed: iso, last_updated: iso, attributes: {} };
    }
    const hass = {
      states,
      locale: { language: 'en-GB', number_format: 'language', time_format: opts.h12 ? '12' : '24' },
      config: { latitude: 52.48, longitude: -1.9, time_zone: 'Europe/London', unit_system: { temperature: '°C' } },
      themes: { darkMode: !!opts.dark },
      user: { name: 'Prototype' },
      async callWS(msg) {
        await delay(latency * (0.6 + Math.random() * 0.8));
        if (msg.type === 'history/history_during_period') {
          const a = Date.parse(msg.start_time), b = msg.end_time ? Date.parse(msg.end_time) : Date.now();
          const out = {};
          for (const id of msg.entity_ids) {
            const list = D.byId[id];
            if (!list) continue;
            const i0 = indexAt(list, a), rows = [];
            if (i0 >= 0) rows.push({ s: list[i0][1], lu: a / 1000 });
            for (let i = i0 + 1; i < list.length && list[i][0] <= b; i++) rows.push({ s: list[i][1], lu: list[i][0] / 1000 });
            if (rows.length) out[id] = rows;
          }
          return out;
        }
        if (msg.type === 'recorder/statistics_during_period') {
          const out = {};
          for (const id of msg.statistic_ids) {
            const list = D.byId[id];
            if (!list) continue;
            const rows = [];
            const a = Date.parse(msg.start_time), b = Date.parse(msg.end_time);
            for (let d = startOfDay(a); d < b; d = startOfDay(d + 36 * 3600e3)) {
              const e = startOfDay(d + 36 * 3600e3);
              if (d < D.start) continue;                       // only days the recording fully covers
              const i0 = indexAt(list, d), i1 = indexAt(list, Math.min(e, D.end));
              if (i0 < 0 || i1 < 0) continue;
              const v0 = parseFloat(list[i0][1]), v1 = parseFloat(list[i1][1]);
              if (Number.isFinite(v0) && Number.isFinite(v1)) rows.push({ start: d, end: e, change: v1 - v0 });
            }
            out[id] = rows;
          }
          return out;
        }
        throw new Error(`fake hass: ${msg.type} not handled`);
      },
      async callService(domain, service, data) { log(`${domain}.${service} ${JSON.stringify(data || {})}`); await delay(200); return {}; },
      async subscribeMessage() { return () => {}; },
      connection: { subscribeMessage: async () => () => {} },
    };
    return { hass, end: D.end, start: D.start };
  };

  // Home Assistant's card frame, near enough
  if (!customElements.get('ha-card')) {
    customElements.define('ha-card', class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = `<style>:host{display:block;background:var(--ha-card-background,var(--card-background-color,#fff));
          border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--ha-card-border-color,var(--divider-color,#e0e0e0));
          color:var(--primary-text-color);}</style><slot></slot>`;
      }
    });
  }
})();
