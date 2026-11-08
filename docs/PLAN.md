# Plan: rebuild the heat pump history card from scratch

## Context

**What exists.** `heat-pump-story-card.js` v5.10.3: 2,336 lines, a plain custom element in `/config/www/cards/ashp/`. It covers:
- **Charts:** flow, target and return; room against its set temp; outside temperature.
- **Strips:** Day/Night, activity and sun.
- **Navigation:** ranges, pan, pinch, scrub and date jumps.
- **Extras:** compare, forecast (beta), warnings, the story line, the Key and the stats drop-down.
- **Adjust:** six settings with a Now/New breakdown, saved through the Grant scripts.

It grew one feature at a time, so it's dense:
- the header packs icons and chips into one row;
- there are five unlabelled strips that need the Key;
- some features are hidden behind small icons;
- moving through time relies on gestures you have to discover (touch-and-hold to scrub, double-tap for now) and a date bar behind a calendar icon;
- it looks unlike the new Plan card.

**What the 3-day history (5–8 Nov) and your answers tell us:**
- **The econet API doesn't expose its schedule.** `sensor.heating_period` was an attempt to infer it, and it flips Day↔Night 106 times in 3 days. The new card won't use it. It relies only on what the hub really reports:
  - the flow target;
  - the room thermostat's Heat/Satisfied state (`room_thermostat_request` and `binary_sensor.thermostat_setback`);
  - the day and night temperatures;
  - the flow, return, room and outside readings.
- **The Plan card is still in design, on demo data.** An HA schedule will probably take the reins, with econet night mode as a backup. The plan will have **usual** settings plus **just-this-step** changes, covering temperatures and settings such as curve shift.
- **Daily figures:**

  | Day | Electricity | Heat (hub) | COP (hub) | Starts | Defrosts | Hot water runs |
  |---|---|---|---|---|---|---|
  | Nov 6 | 20.9 kWh | 132 kWh | 6.3 | 5 | 7 | 3 |
  | Nov 7 | 19.9 kWh | 127 kWh | 6.4 | 1 | 8 | 3 |
  | Nov 8 (to 18:20) | 21.1 kWh | 119 kWh | 5.7 | 3 | 11 | 2 |

  It heats about 85% of the time. The hub's COP of about 6 looks high: check it against flow rate × ΔT before making it a headline.
- **Hub dropouts.** It reports "unavailable" for about 5 s several times a day, with occasional 10–18 min stretches and no new flow reading.

**Goal.** A timeline you read left to right that answers:
1. What is it doing now?
2. What happened, and why?
3. How efficient was it?
4. Why is the target what it is?

It should always be obvious **which stretch of time you're looking at**, and zooming, moving and changing days should feel natural without instructions. It should look like part of the same family as the Plan card and behave like a native Lovelace card.

## Decisions from your answers
- **The three main graphs stay visible together:**
  - Water: flow, its target, and return as an option.
  - Room: the thermostat temp and its target.
  - Outside.

  Each can be hidden, and extra graphs (power, COP, tank, flow rate, compressor) can be added.
- **The story is read from the timeline itself:** bars, shading and short labels written straight onto them. A "What happened" list is optional, collapsed by default, and built so it can also stand alone as a card later.
- **The target recipe and weather-curve diagram are in.** They are the "why" behind the target.
- **All the extras are in, each switchable:** the power strip, hot water on its own scale, the Days view and the visual editor.
- **Try before building.** You get an interactive prototype with your real data that opens on your phone before the full build.
- **Tune is its own component.** It works inside this card and as a separate card, and it's ready for the plan's "this step / usual" choice.

## Design

### Principles
1. **Same family as the Plan card:**
   - time bar ("Today · Sun 18:17" with ‹ ›);
   - sun bar with sunrise and sunset times, 24 h ticks at the top, and a black time pill;
   - a day row like its week schedule;
   - y labels inside the chart on the left;
   - grey HA-style controls and a black primary button;
   - period colours by temperature, with Off hatched, once the plan exists.
2. **Always know where you are.** Plain-words title, a Live or History state, a "you are here" box on the day row, and day labels on the chart.
3. **Every gesture has a visible button too.** Gestures are shortcuts, never the only way.
4. **Hub truth only.** No inferred states. Bridge short dropouts, drop glitch readings (≥10 kW), and say when history is missing.
5. **One colour, one meaning:**
   - blue is water;
   - target colour shows the state: coral for heating, green when satisfied (setback), amber for hot water, grey for off;
   - hot water and off also get a dash or hatch.
6. **Label where it is.** Names and values sit on the strips; details open in place.

### Navigating time

**Three words for the whole model: *zoom* (pick the scale), *move* (drag or ‹ ›), *jump* (tap a day).** A single **Now** button gets you back.

**The controls, all visible:**

| Control | Where | What it does |
|---|---|---|
| **Title** | Top left of the time bar | Plain words for what's on screen: "Last 12 hours", "Today", "Yesterday", "Thu 6 Nov · 06:00–18:00", "Mon 3 – Sun 9 Nov". Tap it to pick an older date. |
| **Live / History state** | Under the title | "● Live · 18:17" (green dot, the now line glowing at the right edge), or "History" with a **Now →** chip beside the pager. |
| **‹ ›** | Top right, Plan-card style | Step back or forward **one window** (the same size). |
| **Zoom chips** | Under the title | 3h · 6h · 12h · 24h · 3d · 7d. The active one is filled. After a pinch to an in-between span, none is filled and the title shows it ("8 hours"). |
| **Day row** | Under the charts, like the Plan card's week row | The last 7 days ("Mon 3 … Sun 9", Today outlined). Each day carries a tiny kWh bar, so unusual days stand out. The window on screen is drawn as a box on the row: the "you are here" scrollbar. |

**The rules (what each action does):**

| Action | Result |
|---|---|
| Tap a zoom chip while live | The window grows or shrinks, and its right edge stays at now. |
| Tap a zoom chip while looking back | It zooms around the cursor if you have one, otherwise around the middle of the window. What you were looking at stays in view. |
| ‹ from live | Moves to the previous window, with its start and end tidied to clean times: whole hours up to 12 h, midnight for 24 h and over. For example "Sat 18:00 – Sun 06:00". |
| ‹ or › while looking back | Steps by the window's size. Once a day is showing, it pages day by day, exactly like the Plan card. |
| Reaching now with › or a drag | Switches back to **Live** automatically. |
| Tap a day on the day row | Shows that whole day, 00:00–24:00, and selects 24h. Swipe the day row for earlier weeks. "Earlier…" at its left end opens a date picker. |
| Drag the box on the day row | Moves the window. Drag the box's edges to zoom. |
| **Now** chip | Returns to Live at your current zoom. |
| Reopening after 30 min away | The card comes back Live at your last zoom, never stuck in the past. |

**Gestures on the chart (shortcuts for the above):**

| Phone | Desktop | Does |
|---|---|---|
| **Drag sideways** | Drag | Moves through time, with momentum. An up-and-down drag still scrolls the dashboard. |
| **Pinch** | Ctrl/⌘ + scroll, or trackpad pinch | Zooms around your fingers or the pointer. It snaps to a zoom chip when close, with a light haptic tick. |
| **Tap** | Hover (click to pin) | Puts the **inspector** there: a line with a black time pill. Every graph's values and the header show that moment. |
| **Drag the pill** (or touch-and-hold, then slide) | Hover | Scrubs. |
| Tap the pill's ×, or Esc | Esc | Clears the inspector. |
| Tap a block or mark | Click | Shows its details, with a "Zoom to this" button. |
| — | Shift + scroll, or trackpad sideways swipe | Moves through time. Plain scroll still scrolls the page. |
| — | ← → scrub · Shift+← → move · + − zoom · Home/End | Keyboard. |

There's no double-tap action. Single taps act instantly, with no waiting to see if a second tap follows.

**Orientation aids:**
- Day boundaries have a line and the day's name ("Mon 9") at the top of the chart. At 3d and 7d, alternate days get a faint background.
- The sun bar shows night and day at a glance.
- While dragging or pinching, a soft overlay in the middle shows the window ("Sat 14:00–22:00 · 8 h") and fades on release.
- Changing scale or day is animated: the axis glides over about 200 ms, so you see where you went. Reduced motion is respected.
- When a window has odd start and end times, they show faintly in the corners.
- The inspector keeps its moment while you zoom or move.

**Edges and loading:**
- **Before the oldest history:** a rubber-band stop and "No history before Fri 31 Oct".
- **The future:** reachable only as far as the forecast; that stretch is greyed and labelled "Forecast".
- **Data still loading:** a hatched "Loading…" area. Neighbouring windows are fetched ahead, so moving rarely shows it.
- **Hub gaps:** a hatched "No data" area.

**Detail at each scale:**
- **≤ 6 h:** every defrost tick and run label.
- **3d and 7d:** activity blocks are merged, water lines become a min–max band with an average line (from 5-minute statistics), and per-day figures show on the day row.

**Smooth movement:**
- During a drag or pinch, the drawn layers are moved and scaled with a CSS transform, so they follow your fingers at 60 fps.
- They are redrawn sharp once you let go.
- Days are aligned to local midnight, so daylight-saving days are 23 or 25 hours.

### What goes in a graph, a lane, or on top of a graph
- **Graph:** for quantities whose size matters and that you compare. Water, room and outside always; power, COP, tank, flow rate and compressor as options.
- **On the graph it explains:** for states that change that graph's meaning.
  - **Hot water:** an amber band on the water graph.
  - **Setback (satisfied):** the target line turns green, and a green edge runs along the top of the room graph.
  - **Defrosts:** the flow dips speak for themselves, with a tick.
  - **The plan:** later, the room target becomes a step area in the period's colour, as in the Plan card.
- **Lane:** for categorical states that don't belong to one graph. One lane, showing **what the heat pump was doing**.
  - It can be a flat bar, or a **power strip**: an area whose height is electrical kW, coloured by activity. The prototype decides the default.
  - Daylight is the sun bar along the top axis.
- **Marks on the axis:** setting changes (diamonds, tagged "by the plan" later) and warnings.

### Layout (top to bottom; designed at 380 px, scales to 12 columns)
1. **Now:**
   - "● Flow" with a big **37.2°** and a small **−0.8** against target.
   - On the right, a grey "Target 38°" box. Tapping it opens the target recipe.
   - A second row: Return / ΔT, Outside with a weather icon, and Room against its target.
   - A status line, e.g. "Room satisfied since 15:11 · water 3° cooler until it drops".
   - With the inspector placed, everything shows that moment, with the same black pill.
2. **Time bar:** the title and the Live/History state on the left, ‹ › and the Now chip on the right, then the zoom chips beneath.
3. **Timeline:**
   - the sun bar with 24 h ticks;
   - the **water graph** (about 170 px), with fit-heating scale by default: the tank spike is clipped and marked by a "↑ 51° tank" chip;
   - the **room graph** (about 64 px), with faint dashed day and night reference lines plus the satisfied stretches until the plan exists;
   - the **outside graph** (about 44 px), with the forecast dotted;
   - any optional graphs;
   - the **activity lane or power strip**;
   - the change marks.
4. **Day row**, the navigator described above.
5. **Worth a look:** at most two notes. Tap one to zoom to it.
6. **Summary for the window,** titled with the same words as the time bar (e.g. "Last 12 hours"):
   - chips such as "Heating 15h 20m · Hot water 1h 20m · 8 defrosts · 3 starts · 21 kWh · COP x";
   - tap › to open the full stats, with compare deltas.
7. **Optional "What happened":** a collapsible event list. Tap an event to jump to it.
8. **Footer:**
   - "Graphs & layers ⌄": show or hide each graph, Return, Setting changes, Forecast β, Compare, and Hot water at full scale. Choices are remembered on each device.
   - "i" for the key and gestures, also shown once as a first-run hint: "Drag to move · Pinch to zoom · Tap to inspect".
   - **Tune** on the right.

### Reading the story from the timeline
Labels go straight onto the timeline, but only where they fit, measured before drawing. Otherwise the inspector shows them.
- **Activity blocks:** "Hot water", "Paused 26m".
- **The defrost count** at the end of the lane.
- **Hot water band:** "Hot water 13:02–14:01".
- **Satisfied stretches:** "Satisfied" along the green target.
- **Room target values** at each change.
- **Outside:** high and low.
- **Change marks:** "shift 6".

Tapping a run gives its start and end, how long it lasted, its kWh, its COP, and "Zoom to this".

### Tune (one component, two homes)
- **One custom element:** `<heat-pump-tune>`. It opens inline in this card as an outlined panel with a black Save, as in the Plan card's editor, and it is also available as `custom:heat-pump-tune-card`.
- **Flow target recipe:** a big "38° → ≈40°", and Curve · Room · Setback · Rounding for Now and New. It follows the inspector.
- **Weather-curve diagram:**
  - outside temperature along the bottom, colder to the right;
  - the current curve solid and the new curve dashed;
  - the outside range for the last 24 h as a band, with a dot for now.
- **Steppers:** curve, shift, room correction and setback. Day and night temperatures only while there's no plan.
- **Forecast preview:** "Tonight: about 2° warmer water".
- **Scope:**
  - **Now:** saving writes to the hub through your Grant scripts.
  - **Once the plan exists:** a choice between **"Just this step (until 23:00)"** and **"Usual setting"**, written through plan scripts. If you write straight to the hub, a note warns that the plan resets the value at its next change.
- **Saving:** settings are sent one at a time, then read back to confirm. A change mark appears on the chart.

### Days view (switchable)
- The day row expands into a fuller view: daily kWh, heat and COP with average outside temperature, from recorder **long-term statistics**, so weeks are available beyond the ~10 days of raw history.
- Tap a day to open it on the timeline.

## Data

**Today, from the hub only.** The defaults are the current `DEFAULT_ENTITIES` and `DEFAULT_SCRIPTS` (old card, lines 49–85), with the same `entities:` and `scripts:` override keys.
- **Drop** `heating_period`.
- **Colour the target** from `thermostat_setback`, the activity log and the target steps.
- **Add:**
  - `power_kw`: `sensor.heat_pump_electrical_power_2`
  - `meter`: `sensor.ashp_power_usage`
  - `tank`: `sensor.actual_dhw_temp_2`
  - `tank_pct`: `sensor.hot_water_remaining`
  - `dhw_target`: `sensor.dhw_target_temp_setting`
  - `flow_rate`: `sensor.flow_rate_2`
  - `compressor`: `sensor.compressor_frequency_2`
  - `cop`: `sensor.cop_real`

**Later: a small plan sensor, proposed to the Plan card's backend.** Entity `sensor.heating_plan`:

| Part | Content | Used for |
|---|---|---|
| State | the period's set temp in °C, or `off` | drawing the past plan (it must be in the state, since the card reads history without attributes) |
| `period` | the period's name | labels |
| `until` | when this period ends | look-ahead, Tune notes |
| `usual` | true, or false for a change made just for today | Tune scope |
| `settings` | this step's overrides, e.g. `{curve_shift: 0}` | Tune notes |
| `upcoming` | the next 24 h of periods | look-ahead (read live) |

Plus two scripts for Tune's scope: `plan_set_step` and `plan_set_usual`. Without the plan sensor, the card falls back to the hub's references.

**Upstream tidy-ups (optional):**
- Retire `heating_period`.
- Debounce or retire `flow_target_breakdown` (the card can work the recipe out itself).
- Choose the trusted heat source for COP. If it's flow × ΔT, add a heat-energy sensor so it gets long-term statistics.

## Technical approach

**One file, two cards.**
- New file `/config/www/cards/ashp/heat-pump-history-card.js`. It defines `heat-pump-history-card`, `heat-pump-tune-card` and the shared `<heat-pump-tune>` element.
- Install it alongside the old card until it replaces it.
- Keep `entities`, `scripts` and `hours` working.

**No dependencies.** A plain custom element in shadow DOM, drawn in SVG layers:
- the static chart, redrawn when the view changes, and moved or scaled by CSS transform during gestures;
- the cursor;
- the HTML labels;
- requestAnimationFrame batching.

**Built to run outside HA as well.**
- **Icons** are inline SVG (MDI paths) rather than `ha-icon`.
- **Theme variables** all have fallbacks.

This lets the same code run on the prototype page.

**Sections inside the file:**
1. config
2. formatting (`hass.locale`)
3. shared theme (the same values as the Plan card)
4. data: history over the websocket, statistics, an IndexedDB cache, live appends, prefetching neighbouring windows
5. model: pure functions, tested
6. **view state machine**: live/history, span, alignment, snapping, animation
7. layout
8. rendering
9. gestures
10. panels
11. Tune
12. editor

**Reused from the old card, as tested pure functions:**
- `cleanSeries`, `valueAt`, `runs`
- `_path` (min/max per pixel), `sunHeight`
- the gesture plumbing (pointer capture, pinch, wheel)
- the `_predict` and `_calcTable` maths
- the forecast subscription, `_stats`, `_warnings`, `_changes`
- `_windowLabel` wording, extended

**Lovelace fit:**
- `getGridOptions` (12 columns, at least 6, rows auto), `getCardSize`
- `getConfigElement` with an `ha-form` schema, `getStubConfig`
- `ha-card`, theme variables, more-info events

## Phases (try first, then build)
1. **Harness and model:**
   - A test page with a fake `hass` driven by `history_18.csv`.
   - The model functions and the view state machine, with node tests.
2. **Interactive prototype on your phone.** The card running on a private Artifact page with your real 3 days, so you can try:
   - zoom chips, pinch, drag;
   - ‹ ›, the day row and Now;
   - the inspector;
   - the flat bar against the power strip;
   - fitted hot water against full scale.

   We iterate on it until moving through time feels right.
3. **Timeline build:** the agreed navigation, the three graphs and optional graphs, the lane or strip, marks, cache and prefetch.
4. **Now and summary:** header, status line, warnings, summary and stats, the optional "What happened".
5. **Tune:** recipe, curve diagram, steppers, save through the scripts, and the standalone card.
6. **Extras:** look-ahead, compare, the Days view from statistics, the visual editor.
7. **Polish:**
   - accessibility: chart summary, live region, keyboard, contrast-checked colours, hatching;
   - dark mode;
   - performance: 60 fps while dragging, under 16 ms per scrub frame at 7d;
   - docs.
8. **Plan hook-up** once the Plan card's backend exists: the plan sensor, the target filled with period colours, and Tune's scope choice.

## Verification
- **Node tests on the CSV.** Check each against the history:
  - runs, starts, defrosts and hot water runs per day match the counts above;
  - bridging and glitch filtering work;
  - the Tune maths agrees with past changes (shift +1 gives target +1; day 21.5 → 22.2 gives +3.5);
  - the view state machine:
    - ‹ from live aligns to clean times, and › back reaches Live;
    - a zoom keeps the cursor in view;
    - a pinch snaps to the chips;
    - tapping a day gives 00:00–24:00;
    - daylight-saving days come out at 23 and 25 h.
- **Harness with Playwright:**
  - screenshots at 360, 412 and 600 px, light and dark;
  - scripted touch and pointer sequences (drag, pinch, tap, pill drag, day row, ‹ ›, Now) checking the resulting window and title;
  - vertical drags must still scroll the page;
  - frame timing during a drag.
- **You on your phone** (phase 2 prototype): find yesterday at 14:00, zoom into one defrost, go back to now, and say which stretch of time is on screen, all without help.
- **In HA:**
  - add the new card beside the old one;
  - check the script traces;
  - check sections-view sizing, the mobile app and dark mode.

## Inputs that would help
- **Plan card JS (yes, helpful now).** I'll copy its exact colours, sizes and controls (time bar, day chips, black pill) into the shared theme. I'll also shape the plan sensor so the Plan card can provide it easily. It isn't blocking.
- **Template YAML (optional).** For `hot_water_remaining`, `cop_real` and `heat_pump_activity_log`.
