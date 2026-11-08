
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
