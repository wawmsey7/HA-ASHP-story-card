
// ---------- 8. styles ----------
// Theme variables come from Home Assistant when they exist, with fallbacks so the card also runs on its own.
// Controls follow the plan card: grey fills, black when selected (white in dark mode), a black time pill.
const STYLE = `
:host {
  display: block;
  --hp-text: var(--primary-text-color, #1d1f23);
  --hp-sub: var(--secondary-text-color, #646a73);
  --hp-line: var(--divider-color, rgba(0, 0, 0, 0.12));
  --hp-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --hp-link: var(--primary-color, #03a9f4);
  --hp-grid: rgba(0, 0, 0, 0.065);
  --hp-ctl: rgba(118, 124, 134, 0.12);
  --hp-ctl-h: rgba(118, 124, 134, 0.22);
  --hp-sel: #1d1f23;
  --hp-sel-ink: #fff;
  --hp-room: #6f56c9;
  --hp-sun-day: #ffe39a;
  --hp-sun-night: #eceef3;
  --hp-sun-ink: #6d5300;
  --hp-future: rgba(118, 124, 134, 0.07);
  --hp-hatch: rgba(118, 124, 134, 0.2);
  --hp-hw-ink: #9a5f00;
  --hp-sat-ink: #17845a;
  --hp-shadow: 0 8px 28px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.1);
  --hp-halo: 0 0 2px var(--hp-bg), 0 0 2px var(--hp-bg), 0 0 4px var(--hp-bg);
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif));
  -webkit-tap-highlight-color: transparent;
}
:host([dark]) {
  --hp-grid: rgba(255, 255, 255, 0.075);
  --hp-ctl: rgba(255, 255, 255, 0.09);
  --hp-ctl-h: rgba(255, 255, 255, 0.16);
  --hp-sel: #f1f2f4;
  --hp-sel-ink: #16181c;
  --hp-room: #ab98ff;
  --hp-sun-day: #5e5020;
  --hp-sun-night: #262a32;
  --hp-sun-ink: #ffe7a0;
  --hp-future: rgba(255, 255, 255, 0.045);
  --hp-hatch: rgba(255, 255, 255, 0.13);
  --hp-hw-ink: #f7c35f;
  --hp-sat-ink: #5fd6a2;
  --hp-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
ha-card { display: block; }
.wrap { position: relative; padding: 14px 14px 12px; color: var(--hp-text); }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
button:disabled { opacity: 0.32; cursor: default; }
button svg { flex: none; }
button:focus-visible, .hit:focus-visible { outline: 2px solid var(--hp-link); outline-offset: 2px; }
.link { display: inline-flex; align-items: center; gap: 2px; padding: 4px 0; color: var(--hp-link); font-size: 13px; font-weight: 500; }

/* now */
.now { display: flex; align-items: center; gap: 12px; min-height: 52px; }
.badge { position: relative; flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; color: var(--c); }
.badge::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--c); opacity: 0.17; }
.badge svg { position: relative; }
.nt { flex: 1; min-width: 0; }
.n1 { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 6px; font-size: 16px; line-height: 21px; }
.n1 b { font-weight: 600; }
.since { font-size: 12.5px; color: var(--hp-sub); }
.n2 { margin-top: 2px; font-size: 12.5px; line-height: 17px; color: var(--hp-sub); }
.big { flex: none; display: flex; flex-direction: column; align-items: flex-end; padding: 5px 11px 6px; border-radius: 14px; background: var(--hp-ctl); text-align: right; }
.big .bv { font-size: 24px; font-weight: 600; line-height: 28px; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.big .bv small { margin-right: 5px; font-size: 12px; font-weight: 500; letter-spacing: 0; color: var(--hp-sub); }
.big .bs { display: flex; align-items: center; gap: 5px; font-size: 12px; line-height: 15px; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.big .bs i { width: 12px; height: 3px; border-radius: 2px; }

/* time bar */
.tb { position: relative; display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.tt { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; text-align: left; border-radius: 8px; }
.t1 { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 600; line-height: 22px; }
.t1::after { content: ''; display: inline-block; margin: 0 0 3px 6px; vertical-align: middle; border: 4.5px solid transparent; border-top: 5px solid var(--hp-sub); border-bottom: 0; }
.t2 { display: flex; align-items: center; gap: 6px; font-size: 12.5px; line-height: 17px; color: var(--hp-sub); }
.ld { width: 7px; height: 7px; border-radius: 50%; background: #2fb67c; box-shadow: 0 0 0 3px rgba(47, 182, 124, 0.22); }
.nowchip { flex: none; display: inline-flex; align-items: center; height: 32px; padding: 0 6px 0 12px; border-radius: 16px; background: var(--hp-sel); color: var(--hp-sel-ink); font-size: 13px; font-weight: 600; }
.pager { flex: none; display: flex; gap: 6px; }
.pb { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--hp-ctl); }
.pb:not(:disabled):active, .ctl:active, .tg:active { background: var(--hp-ctl-h); }
.menu { position: absolute; z-index: 6; top: calc(100% + 4px); left: -4px; width: 244px; padding: 6px; border-radius: 14px; border: 1px solid var(--hp-line); background: var(--hp-bg); box-shadow: var(--hp-shadow); }
.mi { display: flex; align-items: center; gap: 12px; width: 100%; height: 40px; padding: 0 10px; border-radius: 9px; font-size: 14px; text-align: left; }
.mi svg { color: var(--hp-sub); }
.mi:hover { background: var(--hp-ctl); }
.cal { margin-top: 4px; padding: 8px 2px 2px; border-top: 1px solid var(--hp-line); }
.cal .cm { padding: 0 6px 6px; font-size: 12px; font-weight: 600; color: var(--hp-sub); }
.cal .cg { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal .cw { padding-bottom: 2px; text-align: center; font-size: 10.5px; color: var(--hp-sub); }
.cal button { height: 30px; border-radius: 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
.cal button.today { box-shadow: inset 0 0 0 1.5px var(--hp-text); font-weight: 600; }
.cal button.sel { background: var(--hp-sel); color: var(--hp-sel-ink); }
.cal button:not(:disabled):not(.sel):hover { background: var(--hp-ctl); }

/* zoom */
.zoom { display: flex; gap: 2px; margin: 8px 0 4px; padding: 3px; border-radius: 12px; background: var(--hp-ctl); }
.zoom button { flex: 1; height: 30px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.zoom button[aria-pressed="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }

/* the chart */
.stage { position: relative; margin-top: 6px; -webkit-user-select: none; user-select: none; touch-action: pan-y; }
.chart, .cursor { position: absolute; left: 0; top: 0; width: 100%; overflow: visible; }
.cursor { pointer-events: none; }
.labels, .heads { position: absolute; inset: 0; pointer-events: none; }
.labels > span { position: absolute; white-space: nowrap; font-size: 10.5px; line-height: 13px; }
.hit { position: absolute; left: 0; right: 0; touch-action: pan-y; cursor: crosshair; outline: none; }
.sun-night { fill: var(--hp-sun-night); }
.sun-day { fill: var(--hp-sun-day); }
.labels > .sunl { line-height: 20px; font-weight: 600; color: var(--hp-sun-ink); font-variant-numeric: tabular-nums; }
.sunl.r { transform: translateX(-100%); }
.labels > .moon { transform: translateX(-50%); color: var(--hp-sub); opacity: 0.55; line-height: 0; }
.labels > .tk { transform: translateX(-50%); line-height: 16px; font-size: 11px; color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.labels > .tk.day { font-weight: 600; color: var(--hp-text); }
.altday { fill: rgba(118, 124, 134, 0.05); }
.future, .nohist { fill: var(--hp-future); }
.nowline { stroke: #2fb67c; stroke-width: 1.5; stroke-dasharray: 2 3; }
.grid { stroke: var(--hp-grid); stroke-width: 1; shape-rendering: crispEdges; }
.dayline { stroke: var(--hp-line); stroke-width: 1; shape-rendering: crispEdges; }
.labels > .dayl { font-weight: 600; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.hatchbg { fill: var(--hp-future); }
.hatchfg { fill: var(--hp-hatch); }
.labels > .veil { transform: translate(-50%, -50%); padding: 2px 9px; border-radius: 10px; background: var(--hp-bg); font-size: 11.5px; line-height: 16px; color: var(--hp-sub); }
.labels > .yl { left: 0; color: var(--hp-sub); font-variant-numeric: tabular-nums; text-shadow: var(--hp-halo); }
.hwband { fill: rgba(245, 165, 36, 0.14); }
.labels > .bandl { font-weight: 600; color: var(--hp-hw-ink); text-shadow: var(--hp-halo); }
.labels > .peak { transform: translateX(-50%); padding: 0 5px; border-radius: 8px; background: rgba(245, 165, 36, 0.24); font-weight: 700; line-height: 15px; color: var(--hp-hw-ink); }
.ln { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.ln.flow { stroke: #4269d0; stroke-width: 2; }
.ln.ret { stroke: #8fa6e6; stroke-width: 1.4; }
.ln.tgt { stroke-width: 1.6; }
.ln.tgt.hw { stroke-dasharray: 4 3; }
.ln.tgt.off { stroke-dasharray: 2 3; }
.dot { stroke: var(--hp-bg); stroke-width: 1.5; }
.satbar { fill: #2fb67c; }
.labels > .satl { font-size: 10px; font-weight: 600; line-height: 12px; color: var(--hp-sat-ink); text-shadow: var(--hp-halo); }
.planarea { fill: rgba(255, 114, 92, 0.12); }
.ln.plan { stroke: #ff725c; stroke-width: 1.25; }
.ln.ref { stroke: var(--hp-sub); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.55; }
.labels > .refl { right: 0; font-size: 10px; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.roomarea { fill: var(--hp-room); fill-opacity: 0.1; }
.ln.room { stroke: var(--hp-room); stroke-width: 1.75; }
.labels > .ml { font-weight: 600; color: var(--hp-text); text-shadow: var(--hp-halo); font-variant-numeric: tabular-nums; }
.ml.r { transform: translateX(-100%); }
.track { fill: var(--hp-ctl); }
.labels > .lanel { transform: translateX(-50%); font-weight: 600; line-height: 18px; }
.labels > .lanescale { left: 2px; font-size: 9.5px; color: var(--hp-sub); text-shadow: var(--hp-halo); }
.cross { stroke: var(--hp-text); stroke-width: 1; opacity: 0.5; }

/* block headings */
.bh { position: absolute; left: 0; right: 0; height: 18px; display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap; font-size: 12px; line-height: 18px; }
.bn { flex: none; font-weight: 600; }
.bh .bv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--hp-sub); }
.bh .bv b { color: var(--hp-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.k { display: inline-block; width: 10px; height: 3px; margin: 0 4px 2px 0; border-radius: 2px; background: var(--c); vertical-align: middle; }
.k.dash { background: repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 5px); }
.k.blk { width: 9px; height: 9px; margin-bottom: 1px; border-radius: 3px; }
.cnt { flex: none; display: inline-flex; align-items: center; gap: 2px; color: #0f9ad9; font-weight: 600; font-variant-numeric: tabular-nums; }

/* marks, the time pill, the overlays */
.marks { position: absolute; left: 0; right: 0; top: 0; height: 0; }
.mk { position: absolute; z-index: 2; width: 28px; height: 28px; margin: -14px 0 0 -14px; display: grid; place-items: center; isolation: isolate; font-size: 9.5px; font-weight: 700; color: var(--hp-sel-ink); }
.mk::before { content: ''; position: absolute; z-index: -1; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 2px; transform: rotate(45deg); background: var(--hp-sub); }
.mk.n::before { width: 14px; height: 14px; margin: -7px 0 0 -7px; background: var(--hp-text); }
.pill { position: absolute; z-index: 3; display: flex; align-items: center; height: 22px; padding: 0 2px 0 9px; border-radius: 11px; background: var(--hp-sel); color: var(--hp-sel-ink); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22); font-size: 12px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; touch-action: none; cursor: ew-resize; }
.pill::before { content: ''; position: absolute; inset: -9px -2px; }
.px { position: relative; width: 20px; height: 20px; margin-left: 3px; display: grid; place-items: center; border-radius: 50%; opacity: 0.75; }
.glance { position: absolute; z-index: 3; left: 50%; top: 48px; transform: translateX(-50%); padding: 6px 12px; border-radius: 14px; background: var(--hp-sel); color: var(--hp-sel-ink); font-size: 13px; font-weight: 600; white-space: nowrap; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.glance.on { opacity: 0.92; transition: none; }
.hint { position: absolute; z-index: 3; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 16px); display: flex; align-items: center; gap: 10px; padding: 7px 7px 7px 14px; border-radius: 14px; background: var(--hp-sel); color: var(--hp-sel-ink); box-shadow: var(--hp-shadow); font-size: 13px; line-height: 17px; }
.hint .link { flex: none; padding: 5px 10px; border-radius: 9px; background: rgba(127, 127, 127, 0.28); color: inherit; font-weight: 600; }
.tip { position: absolute; z-index: 4; min-width: 160px; max-width: 270px; padding: 10px 12px 8px; border: 1px solid var(--hp-line); border-radius: 12px; background: var(--hp-bg); box-shadow: var(--hp-shadow); font-size: 12.5px; line-height: 18px; }
.th { display: flex; align-items: center; gap: 7px; margin-bottom: 2px; font-size: 13.5px; }
.th i { width: 10px; height: 10px; border-radius: 3px; }
.tr { color: var(--hp-sub); font-variant-numeric: tabular-nums; }
.tr b { color: var(--hp-text); font-weight: 600; }
.tr.dim { margin-top: 4px; font-size: 11.5px; }
.tr .from { color: var(--hp-sub); }
.tr span:first-child { color: var(--hp-text); }

/* the day row: tap a day; the shaded part (and the thumb on the rail under it) is what's on screen */
.dayrow { display: flex; align-items: stretch; gap: 2px; margin-top: 10px; padding-bottom: 12px; }
.drn { flex: none; width: 24px; display: grid; place-items: center; border-radius: 8px; color: var(--hp-sub); }
.drc { position: relative; flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); touch-action: pan-y; }
.drc::after { content: ''; position: absolute; left: 0; right: 0; bottom: -9px; height: 4px; border-radius: 2px; background: var(--hp-ctl); }
.dc { display: flex; flex-direction: column; align-items: center; padding: 5px 0 4px; border-radius: 10px; font-variant-numeric: tabular-nums; }
.dc .dw { font-size: 11px; line-height: 14px; color: var(--hp-sub); }
.dc .dd { font-size: 15px; font-weight: 600; line-height: 20px; }
.dc .dk { display: flex; align-items: flex-end; height: 12px; margin-top: 1px; }
.dc .dk i { width: 6px; border-radius: 2px 2px 0 0; background: #7d8bb0; }
.dc .dv { min-height: 13px; font-size: 10px; line-height: 13px; color: var(--hp-sub); }
.dc.today .dw { color: var(--hp-text); font-weight: 600; }
.dc.sel { background: var(--hp-sel); color: var(--hp-sel-ink); }
.dc.sel .dw, .dc.sel .dv { color: inherit; opacity: 0.8; }
.dc.sel .dk i { background: currentColor; opacity: 0.7; }
.dc.empty .dd { opacity: 0.4; }
.box { position: absolute; z-index: 1; top: 0; bottom: 0; border-radius: 10px; background: rgba(118, 124, 134, 0.16); cursor: grab; touch-action: none; }
.box.whole { background: transparent; }
.box::after { content: ''; position: absolute; left: 0; right: 0; bottom: -9px; height: 4px; border-radius: 2px; background: var(--hp-text); }
.box .h { position: absolute; bottom: -17px; width: 22px; height: 20px; cursor: ew-resize; }
.box .h.l { left: -11px; }
.box .h.r { right: -11px; }
.box .h::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border: 2px solid var(--hp-bg); border-radius: 50%; background: var(--hp-text); }
.off { position: absolute; bottom: -15px; font-size: 13px; font-weight: 700; line-height: 16px; pointer-events: none; }
.off.l { left: -10px; }
.off.r { right: -10px; }

/* worth a look, the summary */
.worth:empty, .summary:empty { display: none; }
.warn { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 7px 10px 7px 12px; border-radius: 12px; background: rgba(245, 165, 36, 0.13); font-size: 13px; line-height: 18px; }
.warn > svg { color: #d48806; }
.warn > span { flex: 1; min-width: 0; }
.warn .link { flex: none; }
.summary { margin-top: 12px; }
.sh { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.st { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sc { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 14px; background: var(--hp-ctl); font-size: 12.5px; color: var(--hp-sub); white-space: nowrap; }
.sc b { color: var(--hp-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.sc i { width: 8px; height: 8px; border-radius: 50%; }
.stats { margin-top: 10px; }
.split { display: flex; gap: 1px; height: 10px; border-radius: 5px; overflow: hidden; }
.key { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: var(--hp-sub); }
.key i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; }
.key b { color: var(--hp-text); font-weight: 600; }
.sec { margin: 14px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hp-sub); }
.etab { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.etab th { padding: 0 0 4px; font-size: 11.5px; font-weight: 500; text-align: right; color: var(--hp-sub); }
.etab td { padding: 5px 0; border-top: 1px solid var(--hp-line); text-align: right; color: var(--hp-sub); }
.etab td.l { text-align: left; color: var(--hp-text); }
.etab td.l span { display: inline-flex; align-items: center; gap: 6px; }
.etab td.l svg { color: var(--hp-sub); }
.etab td.t b { color: var(--hp-text); font-weight: 600; }
.trio { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.cell { min-width: 0; padding: 8px 10px; border-radius: 12px; background: var(--hp-ctl); }
.cl { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--hp-sub); }
.cv { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cs { margin-top: 1px; font-size: 11px; line-height: 14px; color: var(--hp-sub); }

/* footer and panels */
.foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ctl { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px 0 12px; border-radius: 18px; background: var(--hp-ctl); font-size: 13px; font-weight: 500; }
.ctl.round { width: 36px; margin-left: auto; padding: 0; justify-content: center; }
.ctl[aria-expanded="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }
.ctl:not(.round)[aria-expanded="true"] svg:last-child { transform: rotate(180deg); }
.panel { margin-top: 10px; padding: 12px; border: 1px solid var(--hp-line); border-radius: 14px; }
.pg + .pg { margin-top: 14px; }
.ph { margin-bottom: 7px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hp-sub); }
.tgs { display: flex; flex-wrap: wrap; gap: 6px; }
.tg { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px 0 8px; border-radius: 16px; background: var(--hp-ctl); font-size: 13px; }
.tg.on { background: var(--hp-sel); color: var(--hp-sel-ink); }
.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--hp-ctl); }
.seg button { height: 30px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--hp-sub); }
.seg button[aria-pressed="true"] { background: var(--hp-sel); color: var(--hp-sel-ink); }
.keys { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; }
.ki { display: inline-flex; align-items: center; gap: 6px; }
.ki i { width: 16px; height: 3px; border-radius: 2px; }
.howto { display: grid; gap: 6px; font-size: 13px; line-height: 18px; color: var(--hp-sub); }
.howto b { color: var(--hp-text); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .glance { transition: none; } }
`;
