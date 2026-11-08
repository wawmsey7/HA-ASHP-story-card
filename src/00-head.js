/*
 * Heat pump history card for Home Assistant
 * -----------------------------------------
 * A timeline you read left to right: what the heat pump did, how hard it worked and why, with the flow
 * against its target, the room against its set temps, and the outside temperature on one shared time axis.
 *
 *   Top:       what it's doing now, in words, with the flow and its target.
 *   Time bar:  what's on screen in plain words ("Last 12 hours", "Yesterday", "Sat 18:00 – Sun 06:00"),
 *              Live or not, ‹ › to step a window at a time, Now to come back, and the zoom chips.
 *   Timeline:  sun bar and hours along the top, then the water, room and outside graphs (and any extra graphs
 *              you switch on), then the heat pump lane (a bar, or a strip as tall as the power it used).
 *   Day row:   the last 7 days with a box showing where you are; tap a day to see it, drag the box to move.
 *   Below:     anything worth a look, and the numbers for what's on screen.
 *
 * Moving through time:
 *   Phone:     drag sideways to move, pinch to zoom, tap to inspect a moment (drag the time pill to scrub).
 *   Computer:  hover to inspect (click to pin), drag to move, Ctrl/⌘ + scroll or a trackpad pinch to zoom,
 *              Shift + scroll or a sideways swipe to move. Keys: ← → inspect, Shift+← → move, + − zoom.
 *
 * Install: copy to /config/www/cards/ashp/heat-pump-history-card.js and add the resource
 *          /local/cards/ashp/heat-pump-history-card.js?v=0.1 (JavaScript module; raise the number on each update).
 * Use:     type: custom:heat-pump-history-card
 * Options (all optional):
 *   hours: 12             the zoom it opens on the first time (after that it remembers your choice)
 *   graphs: [water, room, outside]   which graphs to show, in order (also: power, cop, tank, flow_rate, compressor)
 *   lane: bar             the heat pump lane as a bar, or `power` for a strip as tall as the power used
 *   entities:             swap any sensor, e.g.  room: sensor.lounge_temperature
 *   scripts:              swap the scripts Tune uses
 */

const VERSION = '0.1.0';
