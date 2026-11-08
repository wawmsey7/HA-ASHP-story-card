# Notes for Claude

Read `docs/HANDOFF.md` first (status, decisions, the owner's requirements, next steps), then `docs/PLAN.md` (the approved design).

- **Edit `src/`, never `dist/`.** Rebuild with `npm run build` and commit both.
- **Run `npm test` after model or view changes.** Tests need `TZ=Europe/London`, which the npm script sets.
- **Keep `src/01-04` free of DOM code.** The tests load them in a node vm (`test/load.mjs`).
- **Check visually with the harness:** `python3 -m http.server 8765`, then `harness/index.html?fresh=1`. Use Playwright for screenshots and for scripted touch, via CDP `Input.dispatchTouchEvent`.
- **Hub truth only.** Never use `sensor.heating_period`. See HANDOFF → Data rules.
- **This repo is public.** Never commit hub IPs, usernames, passwords or tokens. The files in `reference/ha-config/` are redacted copies.
- **Writing style:** plain, user-facing words in the UI ("Satisfied", "Hot water", "Last 12 hours"). Times follow `hass.locale`.
