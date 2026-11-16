# Next steps

Read ARCHITECTURE.md first. Follow its decisions unless something is broken.

Owner's rules: stay free ($0); ask before any account, payment or download over 2 GB;
permissive licenses only (MIT / Apache 2.0 / BSD); be token-efficient; commit and update
this file after every step. The owner will not review anything: they only change the model
or effort and say "continue". No dangerous `rm`: delete only exact, named files you
generated yourself. Create files with the Write tool, not long shell heredocs.
The owner wants the UI to look striking: reuse the design system (see "Look and feel" in
ARCHITECTURE.md) on every new screen.

## Model plan

| Step | Model | Effort | Status |
|---|---|---|---|
| 1. Machine check and architecture plan | Fable | high | done |
| 2. Load scene with walk controls | Fable | medium | done |
| 3. Defect detection pipeline | Fable | medium | done (final weights: see "Training status") |
| 4. Pinning findings in 3D | Fable | high | done |
| 5. Report page | Sonnet | medium | **next** |
| 6. Training game mode | Sonnet | medium | |
| 7. Evaluation script | Sonnet | medium | |
| 8. README and final graphify run | Sonnet | low | |

Handoffs: before step 8 ask for `/effort low`. Format:
"HANDOFF: run /model <model> and /effort <level>, then say 'continue from NEXT_STEPS.md'."
Escalation: same problem unfixed after 2 attempts -> write it here (what was tried, the
error, best guess) and ask the owner to switch to Fable at high effort.

## How to run and test

    uv run uvicorn server.app:app --port 8000        # API (detector)
    npm --prefix web run dev                         # app on http://localhost:5173
    cd web && node tests/smoke.mjs <outDir>          # rooms, collision, one real detection
    cd web && node tests/pins.mjs <outDir>           # pinning accuracy, card, persistence
    cd web && node tests/detect-eval.mjs 3 20        # in-app detector precision/recall
    cd web && node tests/shots.mjs <outDir>          # screenshots with post-processing

Both servers may still be running from the previous session (`curl -s localhost:8000/api/health`).
Tests run headless with software rendering at about 3 fps, so use generous timeouts.
Look at screenshots (Read the PNG) after every UI change.

## Training status (do this first)

A 5-epoch run on real + rendered views started 2026-11-16 12:01 (`models/run`, log
`train.log`, about 18 min per epoch, should end around 13:35). Validation mAP50 so far:
0.44 (trial) -> 0.67 -> 0.73. `models/detector.pth` is currently a copy of the mid-run
`checkpoint_best_ema.pth`; with it the in-app check gave precision 70%, recall 65%
(78% located ignoring the label; `water_seepage` is often called `peeling_paint`).

When `pgrep -f ml/train.py` prints nothing and `models/run/checkpoint_best_total.pth` exists:

    cp models/run/checkpoint_best_total.pth models/detector.pth
    pkill -f "uvicorn server.app"; uv run uvicorn server.app:app --port 8000   # restart
    cd web && node tests/detect-eval.mjs 3 20      # record the numbers here and in README

If in-app recall is under about 60%, train on:
`uv run ml/train.py --weights models/run/checkpoint_best_total.pth --epochs 4 --out models/run2`.
Training memory: batch 4 holds about 5 GB. Never raise the batch size or worker count
(a batch-8 run hit 12 GB and pushed the laptop into swap). Do not run two trainings at once.

## Done

- Step 1: machine checked, plan written, git repo started.
- Step 2: `web/` Vite app, procedural 5-room apartment (`house.js`), walk controls (`walk.js`).
- Step 3: data (`ml/get_data.py`), decals (`ml/make_decals.py`), planting (`defects.js`),
  capture + detect (`detect.js`), server (`server/`), rendered training views
  (`web/tests/synth.mjs`), `ml/combine.py`, `ml/train.py`.
- Step 4: `pins.js` (raycast pinning, dedupe, picking), `costs.json` + `costs.js`, `store.js`,
  detail card, minimap, post-processing, new visual design. Pin test: median position error
  1.7 cm, no duplicates, no wrong rooms across 6 random homes.

## Exact next step: step 5 (report page)

`web/report.html` is an empty placeholder (already a Vite entry). Build `web/src/report.js`:

- Read findings with `loadFindings()` from `store.js` (shape in ARCHITECTURE.md; each has
  `n, label, roomName, surface, material, sizeM, areaM2, severity, score, cost{low,high}, thumb`).
- Group by room. Per room: subtotal range and a table or cards of findings (thumb, `#n`, name
  via `nameOf`, severity chip, size, confidence, cost range, `DEFECTS[label].cause/action`).
- Totals with `totals()` from `costs.js`: low to high, headline midpoint. Offer adjustment:
  an asking-price input; show suggested offer = asking minus midpoint, the low/high range,
  and the percentage. Flag `urgency: "urgent"` items and all `major` items as
  "get a specialist quote before offering".
- Clear disclaimer at the top and bottom: visual triage only, not a licensed inspection;
  costs are rough estimates (`COST_NOTE`); "damaged tile" is inferred from a crack on a tiled
  surface.
- Empty state when there are no findings, a "Back to the home" link, a Print button
  (add print CSS: white background, no glass), and "Start a new inspection" that clears the
  findings after a confirm.
- Build DOM with `textContent`, not `innerHTML` with stored data.
- Style: import `./style.css` for tokens, then add report styles (the page scrolls, so
  override `body { overflow: auto }`). Editorial layout: big serif total, mono labels,
  `.panel.ticks` cards. Screenshot it and check it looks finished.

## Notes for step 6 (training game)

- Start screen: un-hide `#enter-game` and wire it. Set `#mode` text to "Training".
- `replant(randomSeed, 8)` plants the round's defects; `app.planted` is the ground truth.
  Inspection pins must not leak into the game: create a second `createPins(app, {persist: false})`
  for game markers or hide the inspection pins (`pins.visible = false`) and restore
  `replant(7)` + visibility when leaving the game.
- Flag with `F`: raycast from the crosshair against `house.occluders` (see `locate` in
  `pins.js` for the pattern), then pick the defect type (keys 1-5). Scoring rules are in
  ARCHITECTURE.md ("Game"). "AI scan" = `detect()` on `capture(app)`, show boxes only, 3 uses.
- AI client: add `server/client.py` + `/api/client/question` and `/api/client/grade`
  (contract in ARCHITECTURE.md). Ollama is NOT installed: `brew install ollama`, then
  `ollama pull llama3.2:3b` (2.0 GB, at the ask-first limit but not over). Check the Ollama
  API docs before coding. The scripted fallback (question bank + keyword grading built from
  `costs.json` cause/action text) must work with Ollama stopped.
- Free-text answer box: `walk.enabled = false` while typing, and exit pointer lock.

## Notes for step 7 (evaluation)

`ml/evaluate.py`: run `server/detector.py`'s `Detector` on `data/test` (225 real images the
model never saw; decals came only from the train split). Per class: precision, recall, F1,
support at IoU 0.5 and the app threshold (0.4), plus AP50. Save `results/eval.csv`,
`results/eval.md`, `results/eval.png` (matplotlib bar chart in the app's colours). Also
paste the in-app numbers from `detect-eval.mjs` into `results/eval.md` and say clearly that
those views reuse training decals. SDNET2018 is optional.

## Known issues

- Context7 MCP, Playwright MCP, frontend-design plugin and `graphify` were not available.
  Fallbacks are in ARCHITECTURE.md. Step 8 needs `graphify`: if it is still missing, ask the
  owner how they installed it.
- "Damaged tile" has no free labeled data; it is derived from crack + tile surface.
- Pin size is measured from the screen box, so thin diagonal defects on ceilings read larger
  than they are (10% of pins were off by more than 90% in size in the pin test; median 10%).
- Performance: the owner reported heavy lag. Measured on the real GPU with
  `cd web && node tests/perf.mjs "?fx=auto"` while training was running: full effects at
  retina resolution 5 fps, effects at 1x 21 fps, plain 50 fps. `main.js` now has a quality
  governor (`LEVELS`, `govern`) that steps down when under 40 fps, so during training it
  settles on plain rendering. Re-measure after training ends; if effects still cannot hold
  40 fps, cheapen `fx.js` (drop MSAA samples or the AO pass) rather than removing the governor.
- Editing any file under `web/src` reloads the owner's open browser tab (Vite). Expected.
- Stale files that can be ignored: `models/smoke` (trial run), `models_smoke.log`, `synth.log`.
