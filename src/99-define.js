
// ---------- 9. register ----------
if (!customElements.get('heat-pump-history-card')) customElements.define('heat-pump-history-card', HeatPumpHistoryCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'heat-pump-history-card')) {
  window.customCards.push({ type: 'heat-pump-history-card', name: 'Heat pump history', preview: false,
    description: 'What the heat pump did and why: flow against its target, the room and outside on one timeline you can zoom and drag.' });
}
console.info(`%c HEAT PUMP HISTORY %c ${VERSION} `, 'background:#ff7a4d;color:#fff;border-radius:3px 0 0 3px;padding:1px 4px',
  'background:#4269d0;color:#fff;border-radius:0 3px 3px 0;padding:1px 4px');
