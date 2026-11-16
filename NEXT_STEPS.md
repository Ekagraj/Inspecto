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
| 5c. Photo on a wall of the 3D home | Sonnet | medium | done (by Fable) |
| 5d. More real photos and more defect types, then retrain | Fable | high | **in progress**: data being collected, NOT trained yet (see step 5d) |
| 5e. Repair cost by location | Sonnet | medium | three-level test done on the photo page (see step 5e) |
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
    cd web && node tests/wallphoto.mjs <outDir>      # real photo hung on a wall with P, analyzed, pinned

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

### Step 5c: photo on a wall of the 3D home — done

Photo page: "Place on a wall in the 3D home" saves `{image, widthM, aspect}` to
`inspecto.wallphoto.v1` (`store.js`) and opens `/`. In the home, `P` hangs it where the
crosshair meets a clear wall (`src/wallphoto.js`), `P` again moves it, "Remove your photo"
takes it down. Placement survives a reload. Findings inside the photo get `source: 'photo'`
("from your photo" in the card and report) and are dropped when the photo moves or goes.
`tests/wallphoto.mjs` passes: a real water-stain photo, 1 m wide, was pinned at 0.99 x 0.70 m.
Known limits: the photo is not clamped sideways (it can overhang a corner or a door), and it
must fill most of the view to be detected (the capture is only 768 px wide).
`/api/jpeg` now converts anything macOS can read (HEIC, ProRAW .DNG, TIFF), up to 100 MB.
The owner said AirDrop gives ".DAV" files: not a photo format; probably .HEIC or .DNG. DNG
itself is untested (no sample). Ask for the exact file name if one fails.

### Step 5d (proposed): more real photos and more defect types

The owner's first real photo (a wall at a university in New York) showed the gap: a
horizontal scrape with chipped paint, probably from chair backs, was found in the right place
but called "water stain" at 52%. The model has no class for scuffs / impact damage, and only
42 seepage, 49 peeling-paint and 37 mold training photos against 1,941 cracks. Plan:
1. Search for permissively licensed (CC BY / CC0 / MIT) datasets of water stains, mold,
   peeling paint, and scuffs / dents / holes in drywall. Ask before any download over 2 GB or
   any account. Report what exists before training.
2. Add a "scuff / chipped paint" class (new row in `costs.json`, new label in the model).
3. Let the owner correct a wrong label on the photo page and save the photo + box + corrected
   label to a local folder, so their own photos become training data.
4. `sh ml/retrain.sh`, then step 7's evaluation on real photos per class.

Status 2026-11-16 evening. The owner asked: collect the data, do NOT train (the laptop was
about to be switched off; they start training themselves later).
- `python3 ml/get_more_data.py` downloads into `data/extra/` and can be re-run: it skips
  files it already has. Run it again first, the earlier run was cut short and only read the
  first 50 files of each Commons category (now fixed).
  - `data/extra/commons/<class>/`: Wikimedia Commons photos of peeling paint, mold and water
    damage, CC0 / public domain / CC BY only (`attribution.csv`; share-alike files are listed
    in `skipped.csv` and not downloaded, about two thirds of what exists). Class per image,
    NO boxes. The "Water damage" subcategories are noisy (ships, floods): look before using.
  - `data/extra/paint_defects/`: Roboflow "Paint Defects", CC BY 4.0, 743 images with COCO
    boxes, mostly building exteriors. Classes: Spalling 1026, Crack 742, Paint_defect 453,
    Dirt 256, Delamination 202 boxes (train split).
- Still to do before training: (a) look at samples and map Paint_defect / Delamination ->
  `peeling_paint`, Crack -> `crack`, drop the rest; (b) box the Commons photos by running the
  current detector at a low threshold and keeping the image's own class; (c) add both to
  `ml/combine.py` sources. None of this is written yet.
- Searched and rejected: BD3 (about 4,000 photos with stain and peeling classes; no licence
  stated, Kaggle account), Kasbah of Algiers set (224 px, no boxes), RF100 wall-damage
  (classes are rotation levels). No free set with scuffs / chipped paint was found.
- Best source not yet used: Roboflow Universe building-defect sets (CC BY 4.0, boxes). Needs
  a free account and API key; the owner offered to sign up. Ask for the key as a file path.

### Step 5e: repair cost by location — three-level test done

Photo page only. "Where is this wall?": a search box and "Use my current location" (nearest
of the three areas; nothing is sent anywhere). One location applies to all photos, because
shared photos carry no GPS. `costOf(label, severity, factor)`; factor = local mean hourly
wage of painters / US mean, BLS OEWS May 2025, fetched from the BLS public API
(`api.bls.gov/publicAPI/v1/timeseries/data/`, series `OEUM00<area>00000047214103`):
US 26.64 | New York metro (35620) 33.62 = +26% | Trenton-Princeton NJ (45940) 30.99 = +16% |
Scranton-Wilkes-Barre PA (42540) 24.41 = -8%. Numbers live in `costs.json` ("areas").
Not done: the 3D home and its report still use US-average prices; only three areas;
wages are only the labour part of a price (the page says so). Never invent multipliers.

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
