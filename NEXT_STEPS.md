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
| 5. Report page | Sonnet | medium | done |
| 5b. Check a real photo | Sonnet | medium | done (by Fable) |
| 5c. Photo on a wall of the 3D home | Sonnet | medium | **next** (ask the owner first: they may prefer step 5d) |
| 5d. More real stain photos, then retrain | Fable | high | proposed, not started |
| 6. Training game mode | Sonnet | medium | |
| 7. Evaluation script | Sonnet | medium | |
| 7b. Realism pass + detector retrain | Fable | high | done (numbers in "Training status") |
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
    cd web && node tests/report.mjs <outDir>         # report page: totals, offer maths, print, clearing
    cd web && node tests/photo.mjs <outDir>          # photo page: real photos, HEIC, totals, errors

Both servers may still be running from the previous session (`curl -s localhost:8000/api/health`).
Tests run headless with software rendering at about 3 fps, so use generous timeouts.
Look at screenshots (Read the PNG) after every UI change.

## Training status: done

The detector was retrained for the new look (step 7b). `sh ml/retrain.sh` finished
2026-11-16 14:59 (4 epochs into `models/run2`, best EMA metric 0.62), `models/detector.pth`
is the new model and the API was restarted with it.

In-app numbers, `node tests/detect-eval.mjs 3 20` (put these in README and `results/eval.md`;
these views reuse training decals, so they flatter the model):

| Class | Precision | Recall |
|---|---|---|
| crack | 100% | 92% |
| mold | 93% | 82% |
| peeling_paint | 60% | 100% |
| stairstep_crack | 100% | 89% |
| water_seepage | 93% | 74% |
| **all** | **88%** | **85%** (91% of 67 located ignoring the label) |

Before the retrain (old look, mid-run weights): precision 70%, recall 65%. Weak spot now:
`peeling_paint` is over-called (6 false positives); probably the same mix-up with
`water_seepage` as before (it has 5 misses), but that was not confirmed.
To retrain again (only if geometry, furniture or lights change): rebake, then
`nohup sh ml/retrain.sh > retrain.log 2>&1 &` (about 1.5 hours). While it renders (until
`retrain.log` shows the "160 images" line) do not edit `web/src` or `web/public`: Vite
reloads the page and the render script dies.
Training memory: batch 4 holds about 5 GB. Never raise the batch size or worker count
(a batch-8 run hit 12 GB and pushed the laptop into swap). Never run two trainings at once.

## Done

- Step 1: machine checked, plan written, git repo started.
- Step 2: `web/` Vite app, procedural 5-room apartment (`house.js`), walk controls (`walk.js`).
- Step 3: data (`ml/get_data.py`), decals (`ml/make_decals.py`), planting (`defects.js`),
  capture + detect (`detect.js`), server (`server/`), rendered training views
  (`web/tests/synth.mjs`), `ml/combine.py`, `ml/train.py`.
- Step 5: `report.js` + `report.css` (grouped findings, totals, offer adjustment, print CSS,
  two-click clear). `tests/report.mjs` passes (12 checks); screen and print screenshots checked.
  `SEVERITY_COLOR` now lives in `costs.js`, so the report bundle no longer pulls in three.js.
- Step 4: `pins.js` (raycast pinning, dedupe, picking), `costs.json` + `costs.js`, `store.js`,
  detail card, minimap, post-processing, new visual design. Pin test: median position error
  1.7 cm, no duplicates, no wrong rooms across 6 random homes.

## Step 5b: check real photos — done

`web/photo.html` + `src/photo.js` + `src/photo.css`, linked from the start screen ("03 — Your
photos") and the report. The owner's words: "give an image of the real wall, the app says if
it is a real stain issue or a small fix, and keeps adding the price as new pics are added".

- Add photos by file picker or drop. Each is shrunk to 1280 px and sent to `/api/detect`.
  iPhone HEIC files are converted by the new `POST /api/jpeg` (macOS `sips`), because only
  Safari reads HEIC. A 12 MP HEIC is part of the test.
- Overlapping boxes of the same type are merged (`merge`), so one stain is priced once.
- Verdict per problem: small fix / needs repair / serious issue = `severityOf` on the real
  size, which is box size x "width of the area in this photo" (per-photo input, default 1 m).
  The verdict is size + defect type from `costs.json`; it is NOT learned from the image.
- Running total (hero) over all photos, saved in `localStorage` key `inspecto.photos.v1`
  (800 px thumbnails; about 35 photos fit). Remove per photo.
- `tests/photo.mjs` passes (15 checks) on three `data/test` photos: all three were detected.

Limits to tell the owner: the real training photos are 1,941 crack, 248 stairstep crack,
49 peeling paint, 42 water seepage, 37 mold images, so stains are thinly covered and the
real test set has only 5 seepage and 4 mold photos (too few to trust a score). Not tested
with a genuine iPhone file (orientation of portrait HEICs is the thing to watch).

### Step 5d (proposed): more real stain photos

The owner's stated goal is a model built on real stain images. Options, in order: find more
permissively licensed water-stain / mold photos (ask before any download over 2 GB or any
account), add the owner's own iPhone photos with boxes, then `sh ml/retrain.sh`.

## Exact next step: step 5c (confirm with the owner)

### Step 5c: put the photo on a wall of the 3D home (owner's idea, build after 5b)

Lets the owner test real wall photos inside the home, with real measurements.

- On the photo page: a "Width of the photographed area (m)" input (default 2) and a button
  "Place on a wall in the home". Save `{image (JPEG data URL, max 1280 px), widthM, aspect}`
  to `localStorage` key `inspecto.wallphoto.v1` (one photo at a time is enough; wrap in
  try/catch for quota) and go to `/`.
- In the app (inspection mode): if a saved photo exists, show a chip "Aim at a wall and press
  P to place your photo". On `P`, raycast from the crosshair against `house.surfaces` (walls
  only, `|normal.y| < 0.5`), then add a quad of `widthM x widthM / aspect` 3 mm off the wall,
  centred on the hit, clamped to stay between floor and ceiling. Use `MeshBasicMaterial`
  with the photo as `map` (unlit: a photo carries its own lighting). `P` again moves it;
  a "Remove photo" button deletes it and its storage key.
- Do NOT add the quad to `house.surfaces` or `house.occluders`: pin rays must pass through
  it and land on the wall behind, which is what makes room, surface and size work unchanged.
- Analyze, pins, sizes, costs and the report then work as they are. Mark findings whose pin
  lies inside the photo quad with `source: 'photo'` and label them "from your photo" in the
  detail card and the report.
- Test: place a `data/test` image on a living-room wall via a `window.inspecto` hook, analyze
  from 1.5 m straight on, expect at least one pinned finding with a plausible size. Screenshot.
- Say on the page: this checks your wall, not your room layout; measurements depend on the
  width you enter; straight-on photos work best.

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

## Step 7b: realism pass — done

See "Realism: baked lighting" in ARCHITECTURE.md. Summary: real window openings with a park
HDRI outside, lighting baked by `web/src/bake.js` into `web/public/bake/`, trim and rugs are
real scene objects, the heavy ambient-occlusion pass is gone. Pin test passes on the new house
(median error 2.6 cm, no duplicates). `tests/look.mjs` takes real-GPU screenshots.
Left undone on purpose (usage): floors are matte (no reflections), a faint mottling remains
on some walls, the kitchen and bathroom are sparsely furnished, and frame rate was not
re-measured after the change (`node tests/perf.mjs "?fx=auto"` once training is over).
If you change geometry, furniture or lights: rebake (`node tests/bake.mjs 96 3`), then retrain.

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
- Stale files that can be ignored: `models/smoke` (trial run), `models_smoke.log`, `synth.log`,
  `bake.log`, `web/public/textures/*` unused by `house.js`.
- `tests/shots.mjs` (README screenshots) runs in software rendering; prefer the real-GPU
  launch options from `tests/look.mjs` for final screenshots.
