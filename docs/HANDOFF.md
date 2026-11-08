# Handoff: where the project is and how to pick it up

Last updated: Sun 8 Nov 2026, end of phase 2 (interactive prototype).

## The project in one paragraph

This is a from-scratch rebuild of the Home Assistant "heat pump story card" for a **Grant Aerona HP290** air-source heat pump.
- **The hub:** read through an **ecoNET300** hub with HA REST sensors.
- **The old card:** v5.10.3, a single 2,336-line file, kept in `reference/` for its maths and gestures.
- **The new card:** `custom:heat-pump-history-card`. It's a timeline you read left to right: flow against its target, the room against its set temps, the outside temperature, and what the heat pump was doing.
- **Navigation:** designed to be obvious, so you always know which stretch of time is on screen.
- **Companion:** it sits alongside the owner's separate **Plan card** (`HA-ASHP-heating-schedule-card`, still in design on demo data) and should look like part of the same family.

## Links

| What | Where |
|---|---|
| Interactive prototype (phase 2), on the real 5–8 Nov data | https://claude.ai/artifact/L81CQckDNhB8GDm34Ui8DZ (private to the owner) |
| First design drafts: five directions (A Calm, B Focus, C Story, D Instrument, E Curve) | https://claude.ai/artifact/9fxDwiyGqryQp9uKMfXCN6 (private). Source in `design/canvas/` |
| The approved plan | [`docs/PLAN.md`](PLAN.md) |

## What the owner asked for (summarised, in their words where it matters)

1. **Design brief.** Rework the card's design: "really great intuitive design… simple to understand and digest while also powerful and carrying detailed info". Keep the same information and capabilities, and offer several draft ideas. The five drafts were delivered.
2. **Planning brief.** Plan the card "as good as it can be, start from scratch". It must fit Lovelace and go with the Plan card, but doesn't have to copy it.
3. **Their answers to my questions:**
   - **Schedule.** The econet API doesn't expose its schedule. `sensor.heating_period` tried to infer Day/Night and was buggy (106 flips in 3 days), so **don't use it**. An HA schedule driven by the Plan card will probably take over, with econet night mode as a backup. This is still being designed.
   - **Settings scope.** The plan will have **usual (default) settings** plus **just-this-step changes**. Adjusting settings should let you choose between the current step and the usual settings. A separate adjustments card is possible.
   - **The story.** The event list should be optional (a drop-down or a separate card). The story should be read mainly **from the timeline itself**.
     - The **target recipe and weather-curve diagram** are wanted ("the why behind the target").
     - Use lanes and graphs intelligently.
     - **All three main graphs must be visible together:** flow target and actual; outside; the thermostat temp with its target. Graphs can be hidden or shown, and others added.
   - **Extras.** Open to all of them: power strip by activity, Days view (weeks of kWh/COP), hot water on its own scale, visual editor. "Difficult to know til I see."
4. **Feedback on the first plan (most important).** "It should also be really intuitive to use in terms of zooming to different scales, changing days, dragging the graph… simple to understand where you are at and what period of time you're looking at… simple and intuitive while still powerful and data rich." This produced the **Navigating time** section of the plan. The plan was then approved.
5. **Plan card JS.** The owner offered it. The answer given: helpful now (to copy its exact colours, sizes and controls, and to shape the plan sensor), but not blocking. **Not received yet.**

## Status by phase (see PLAN.md → Phases)

| Phase | State |
|---|---|
| 1. Harness and model with tests | **Done.** 21 node tests pass. |
| 2. Interactive prototype on the phone | **Done and published.** Waiting for the owner's feedback from their phone. |
| 3. Timeline build (min–max bands at 3d/7d, transform-based dragging, IndexedDB cache, forecast) | Next, after prototype feedback |
| 4. Now header and summary | Mostly done in the prototype. Still to do: the optional "What happened" list, and compare in stats. |
| 5. Tune (recipe, curve diagram, steppers, save through scripts, standalone card) | Not started. Maths to port: `_predict` / `_calcTable` in `reference/heat-pump-story-card-v5.10.3.js`. |
| 6. Extras (look-ahead, compare, Days view from long-term statistics, visual editor) | Not started |
| 7. Polish (accessibility, performance, docs) | Not started |
| 8. Plan hook-up (`sensor.heating_plan`, Tune scope "this step / usual") | Waiting on the Plan card's backend |

## Decisions made while building (differences from PLAN.md)

- **The Now header always shows live status.** The inspected moment's values appear in each graph's heading row instead, along with the black time pill on the axis.
- **The day row's "you are here" marker:**
  - A **shaded area plus a thumb on a rail** under the 7 days replaced the outlined box, which crowded the date numbers on short windows.
  - Whole days on screen are filled in black.
  - The thumb's ends have resize knobs when there's room.
  - Tapping inside the shaded area still opens that day.
- **The date menu has its own small calendar** (today back to the oldest history, Monday first), replacing the native date picker, which won't open inside embedded pages (iframes).
- **The menu's "Last 7 days"** goes to the rolling live 7-day view, so the label matches the title.
- **Labels avoid each other.** The room graph's high/low labels steer clear of "Satisfied" and the day/night labels, and a label that fits nowhere is left out. "Satisfied" is written once per view.
- **The prototype page freezes the card's clock** at the last recorded reading (via a `clockOffset` getter), because the recording ends there.

## Verified so far

- **Node tests on the real fixture:**
  - **Sun 8 Nov:** 11 defrosts, 1 hot water run (a defrost inside it doesn't split it), 3 starts, about 21.1 kWh, heat about 119 kWh, COP 5–6.2.
  - **Setting changes on Sun 8:** shift 0→4→5→6→5; day temp 21.5→22→22.2.
  - **Target colour:** turns green at Sat 18:57, amber at Sun 13:02.
  - **View state machine:** paging, zoom anchoring, chip snapping, live detection, local-midnight alignment and DST.
- **Playwright with real touch input** (Chromium input pipeline over CDP):
  - a vertical swipe on the chart scrolls the page;
  - a sideways swipe moves through time;
  - pinch snaps to the chips;
  - tap and touch-and-hold place the inspector.
- **Screens:** 360/412/600 px, light and dark, no console errors.
- **Timing (desktop):** about 4–7 ms per drag frame, under 1 ms per scrub frame.

## Not verified / known issues

- **Never run in a real Home Assistant.** The websocket calls follow HA's formats but haven't been tested live:
  - `history/history_during_period` with `minimal_response`, `no_attributes`, `significant_changes_only: false`;
  - `recorder/statistics_during_period` with `period: day`, `types: [change]`.
- **No real phones yet**, especially iOS Safari.
- **At 3d and 7d the water graph is dense.** A min–max band is planned for phase 3.
- **Drag smoothness at 3d and 7d** on older phones: the planned fix is a CSS transform during gestures.
- **COP of about 6 from the hub looks high.** Check it against flow rate × ΔT before making it a headline figure.
- **The fixture only covers Thu 5 17:00 → Sun 8 18:20**, so the day row is empty before Thu.

## Repository map

| Path | What |
|---|---|
| `src/00-head.js` | Header doc (layout, gestures, install, options) and `VERSION` |
| `src/01-config.js` | Default entities and scripts, zoom spans, graph list, limits, settings |
| `src/02-format.js` | Number, time and span wording (`makeFmt`, `deg`, `dur`, `spanWords`) |
| `src/03-view.js` | **View state machine:** `windowOf`, `stepView`, `zoomView`, `settleView`, `dayView`, `titleOf` |
| `src/04-model.js` | Pure data functions: `buildSeries`, `runs`, `targetColours`, `computeStats`, `warnings`, `settingChanges`, `dayStats`, `sunTimes` |
| `src/05-theme.js` | Colours (`COL`), activity order, outside-temperature gradient, `icon()` |
| `src/06-render.js` | SVG and HTML string builders (layout, scales, lines, lanes, block headings, cursor), testable in node |
| `src/07-card.js` | The custom element: data loading, gestures, drawing, panels, pop-ups |
| `src/08-style.js` | CSS (HA theme variables with fallbacks; dark mode via `:host([dark])`) |
| `src/12-icons.js` | MDI icon paths |
| `src/99-define.js` | `customElements.define` and `window.customCards` |
| `dist/heat-pump-history-card.js` | Built single file to install in HA |
| `tools/build.mjs` | Concatenates `src/` into `dist/`, wrapped in an IIFE |
| `tools/csv2json.mjs` | HA history CSV export → `fixture/history.json` |
| `tools/prototype.mjs` | Inlines card, fake hass and fixture into one page (`harness/prototype.html`) |
| `fixture/history.json` | 26 entities, 5–8 Nov 2026 (the owner's real readings) |
| `harness/fake-hass.js` | Stand-in `hass` driven by the fixture (history and statistics websocket calls, `ha-card` stub) |
| `harness/index.html` | Dev page. Query options: `dark=1`, `w=600`, `h12=1`, `fresh=1`, `lat=ms`, `config={json}` |
| `harness/prototype.html` | Template for the published prototype page |
| `test/` | `node --test` suites (model, view) and the vm loader |
| `reference/heat-pump-story-card-v5.10.3.js` | The old card |
| `reference/ha-config/` | The owner's REST sensors, REST commands and scripts, **with hub IPs and logins redacted** |
| `design/canvas/` | The five design drafts (Design canvas `.dc.html` files) |

## How to run things

```bash
npm test                 # or: TZ=Europe/London node --test test/*.test.mjs
npm run build            # → dist/heat-pump-history-card.js
npm run prototype        # → dist/prototype.html (one self-contained page)
python3 -m http.server 8765   # then open http://127.0.0.1:8765/harness/index.html?fresh=1
```

Tests must run with `TZ=Europe/London`: the fixture's day boundaries are UK local midnight.

To rebuild the fixture from a new HA history export, run `node tools/csv2json.mjs history.csv fixture/history.json`. The raw CSV isn't committed: it's 5 MB and holds every entity.

## Data rules (keep these)

- **Hub truth only.** Don't infer schedule states.
  - "Satisfied" comes from `binary_sensor.thermostat_setback`, also accepting Heat/Satisfied.
  - The room graph shows the day and night temps as dashed references until a plan sensor exists.
- **Bridge dropouts** shorter than 10 minutes. Longer gaps show as hatched "No data".
- **Drop glitch readings** using `LIMITS`, e.g. ≥10 kW power.
- **The proposed plan sensor contract** (PLAN.md → Data) is `sensor.heating_plan`:
  - **state:** the set temp, or `off`;
  - **attributes:** `period`, `until`, `usual`, `settings`, `upcoming`;
  - **scripts:** `plan_set_step` and `plan_set_usual`.

## Next steps

1. **Collect the owner's feedback** on the prototype (phone tasks: find yesterday 14:00, zoom into a defrost, back to now, say what's on screen). Iterate.
2. **Get the Plan card JS** and align the colours, controls, time bar and day chips.
3. **Phase 3:**
   - min–max bands at 3d/7d (5-minute statistics);
   - transform-based dragging;
   - IndexedDB cache;
   - forecast look-ahead.
4. **Phase 5:** Tune.
5. **Try `dist/` in real HA** alongside the old card. Check sections-view sizing, the mobile app and dark mode.
