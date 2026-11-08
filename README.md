# Heat pump history card

A Home Assistant Lovelace card for a Grant Aerona air-source heat pump (ecoNET300 hub). It shows what the heat pump did and why on one timeline you can zoom and drag:
- the flow against its target, coloured by what the heat pump is doing;
- the room against its set temps;
- the outside temperature;
- a lane showing heating, hot water, defrosts and pauses.

**Status:** an early prototype (v0.1.0). It hasn't been tried in a live Home Assistant yet. See [docs/HANDOFF.md](docs/HANDOFF.md) for where things stand and [docs/PLAN.md](docs/PLAN.md) for the full design.

## Install (for trying it)

1. Copy `dist/heat-pump-history-card.js` to `/config/www/cards/ashp/`.
2. Add it as a resource: `/local/cards/ashp/heat-pump-history-card.js?v=0.1` (JavaScript module).
3. Add the card:

```yaml
type: custom:heat-pump-history-card
# all optional:
hours: 12                         # the zoom it opens on the first time
graphs: [water, room, outside]    # also: power, cop, tank, flow_rate, compressor
lane: bar                         # or: power
entities:
  room: sensor.lounge_temperature # swap any sensor (defaults in src/01-config.js)
```

## Moving around

| Phone | Computer |
|---|---|
| Drag sideways to move, pinch to zoom, tap to inspect, then drag the time pill | Hover to inspect (click to pin), drag to move, Ctrl/⌘ + scroll to zoom, Shift + scroll to move |

Everywhere: the zoom chips (3h–7d), ‹ › to step a window at a time, **Now** to return to live, and the day row to jump to a day. Tap the title for a date.

## Develop

```bash
npm test            # node tests (uses TZ=Europe/London)
npm run build       # src/ → dist/heat-pump-history-card.js
npm run prototype   # one self-contained demo page → dist/prototype.html
```

There are no dependencies. Playwright is only used, optionally, for screenshots.
