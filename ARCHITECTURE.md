# AI Home Inspector — Architecture

Walk a 3D home in the browser, let a local AI flag visible defects, pin them in 3D,
and get a repair-cost report. Second mode: a 10-minute training game with planted
defects and an AI "client". Everything runs locally and costs $0.

## Machine (checked 2026-11-16)

| Item | Value | Consequence |
|---|---|---|
| OS / CPU | macOS 26.5, Apple M3 (arm64, 8 cores) | PyTorch uses the `mps` GPU backend |
| RAM | 16 GB | Small models only (detector ~30M params, LLM ≤ 3B) |
| Free disk | 47 GB | No constraint |
| Python | 3.14 system, `uv` 0.9.5 | Use `uv` with **Python 3.12** (torch wheels) |
| Node | 25.2.1, npm 11 | Vite works |
| Ollama | not installed | `brew install ollama` in step 6 (free, no account) |
| Playwright | Chromium already in cache | Use the `playwright` npm package from scripts |

Tools named in the brief but **not loaded** in the step-1 session: Context7 MCP,
Playwright MCP, frontend-design plugin, `graphify` CLI. Fallbacks: read library docs
with WebFetch (official docs / raw GitHub README), drive the browser with a small
Playwright node script (`web/tests/smoke.mjs`), design the UI by hand. If a later
session does have these tools, use them instead.

## Decisions

1. **Frontend: Vite + vanilla JS (ES modules) + three.js.** No UI framework: the UI
   is a HUD, two panels and a report page. Three HTML entry points: `index.html`
   (inspection + game), `report.html` and `photo.html` (check real wall photos).
2. **Home scene: generated procedurally**, not scanned. A floor plan in data
   (5 rooms: living room, kitchen, hallway, bedroom, bathroom, about 10 × 8 m) is
   built into box walls, floors and ceilings, textured with CC0 Poly Haven materials
   and furnished with a few CC0 Poly Haven glTF models. Why: no account or large
   download, legal, tiny, and it gives exact geometry for collision, raycasting,
   room lookup (`roomAt(point)`) and surface material (`tile`, `plaster`, `wood`).
   Scans and Gaussian splats were rejected: no clean collision or surface data, and
   planting defects into them is hard.
3. **Defect detection: RF-DETR Nano fine-tuned locally** (`rfdetr` 1.12, Apache 2.0,
   30M params, 384 px, runs on MPS) behind a small FastAPI server.
   Rejected: Ultralytics YOLO (AGPL-3.0, not permissive); a vision LLM through
   Ollama (needs a 3–6 GB download, 10–40 s per view, weak boxes); paid or
   account-bound APIs.
4. **Defect data: `senthilsk/crack_detection_dataset` on Hugging Face** (46 MB,
   not gated, no account). It is a mirror of the Roboflow Universe set
   `objectdetection-qxiqx/detr_crack_dataset` (CC BY 4.0): 2,263 train / 462 valid /
   225 test images with boxes for `crack`, `mold`, `peeling_paint`,
   `stairstep_crack`, `water_seepage`. SDNET2018 (about 500 MB, direct download) is
   an optional crack-only cross-check in step 7.
5. **App labels.** `water_seepage` is shown as "Water stain / seepage".
   "Damaged tile" has no free labeled data, so it is **derived**: a `crack` or
   `stairstep_crack` whose 3D pin lands on a surface with material `tile` is
   relabeled `damaged_tile`. It is not evaluated separately; the README must say so.
6. **Planting defects: flat decal quads.** `ml/make_decals.py` cuts labeled boxes
   out of **train-split** images only (the test split stays clean for evaluation),
   tone-matches them and feathers the edges into alpha PNGs. `web/src/defects.js`
   places them 2 mm off a wall or ceiling with a seeded RNG. Inspection mode uses a
   fixed seed (the home's "real" condition); the game uses a random seed.
7. **AI client: Ollama `llama3.2:3b`** (2.0 GB, at the limit but not over it) called
   from the server, with JSON-schema output. If Ollama is not running, the server
   falls back to a scripted question bank and keyword grading, so the game always
   works.
8. **Repair costs: hand-built table** `web/src/costs.json`, low/high USD per label
   and severity (`minor`, `moderate`, `major`), labeled as rough estimates.
   Severity comes from the real-world size measured by raycasting. Offer adjustment
   = sum of low to sum of high, headline = midpoint rounded to $50, with an optional
   asking-price input.
9. **Persistence: `localStorage`** (`inspecto.findings.v1`, `inspecto.game.v1`).
   No database.
10. **Python env: one `uv` project at the repo root** (`pyproject.toml`,
    Python 3.12). Weights and data are gitignored (`models/`, `data/`).

## Look and feel (added in step 4, at the owner's request for a striking UI)

- **Design system** in `web/src/style.css`: ink glass panels (`.panel`) with amber crop-mark
  corners (`.ticks`), Instrument Serif for headlines and big numbers, Geist Mono micro-labels
  (`.label`), Geist for body text, one amber accent, severity colours amber / orange / red
  (`SEVERITY_COLOR` in `pins.js`, `.sev` chip). `report.html` and the game UI must reuse these
  tokens and classes instead of inventing new ones.
- **Start screen**: editorial headline over a slow camera orbit of the living room. Mode cards
  are `button.mode`; the training card `#enter-game` exists but is `hidden` until step 6.
- **HUD**: wordmark + room (top left), findings summary linking to the report (top right),
  floor-plan minimap with pins (`minimap.js`, bottom left), Analyze dock (bottom centre),
  scan sweep while analyzing (`body.scanning`), bracketed detection boxes, pin pop-in.
- **Post-processing** (`fx.js`): bloom on windows and lamps, neutral tone mapping, vignette
  and grain. Display only; `capture()` always renders the plain scene for the detector. Off
  under automation unless `?fx=1`. A quality governor in `main.js` (`LEVELS`, `govern`) steps
  resolution and post-processing down when the frame rate drops under 40 fps.

## Realism: baked lighting (step 7b)

Runtime GI and ambient occlusion were too slow on the M3 (5 fps at retina resolution), so
all lighting is baked and costs nothing per frame.

- **Real openings.** Windows are holes in the exterior walls with frames, a sill and a glass
  pane; a CC0 park HDRI (`public/textures/sky_2k.hdr`) is the background and the reflection
  environment. Trim (baseboards, door and window casings) and rugs are ordinary scene objects.
- **`web/src/bake.js`** is a small CPU lightmapper (three-mesh-bvh for ray casting, MIT), run
  by `node tests/bake.mjs 96 3` (about 8 minutes). It computes direct light (sun, sky through
  the window openings, ceiling lamps, all with shadow rays) and then three gather passes for
  bounced light and soft ambient occlusion. Light colours and strengths are the constants at
  the top of the file; the sun direction is `SUN_DIR` in `house.js`.
- **Two outputs in `web/public/bake/`** (committed):
  `lightmap.png` is an atlas for walls, floors and ceilings (4 cm texels, sRGB-encoded,
  light / `LIGHT_SCALE`). Those surfaces use `MeshBasicMaterial` with `lightMap` on `uv1`, so
  they show albedo x baked light and ignore realtime lights. `house.js` packs the atlas
  deterministically (`allocFace`), so the bake and the runtime agree without a layout file.
  `props.bin` holds one RGB float per vertex for every other mesh ("props": furniture, trim,
  fixtures, rugs) in `house.props` order. Props keep their PBR materials, lit only by a white
  `AmbientLight` multiplied by those vertex colours, plus environment reflections.
- **Rebake after any change** to wall/floor geometry, furniture, trim or light settings. If
  `props.bin` does not match the scene, props fall back to flat ambient and the console warns.
- **Then retrain.** The detector must see the home as it looks: `sh ml/retrain.sh` re-renders
  the training views, merges them with the real photos and continues training.
- Defects stay visible: decals multiply over the baked wall, and nothing may be placed over a
  spot where a defect can be planted (the planting check rejects spots behind casings, trim
  or furniture).

## Layout

```
web/
  index.html  report.html  photo.html  vite.config.js   (dev proxy /api -> :8000)
  src/main.js      boot, mode switch, HUD
  src/house.js     floor plan data + builder, roomAt(), surfaces list
  src/walk.js      pointer-lock look, WASD, circle-vs-wall collision
  src/defects.js   seeded planting of decal quads
  src/detect.js    capture view, POST /api/detect
  src/pins.js      boxes -> 3D pins (raycast), dedupe, picking
  src/minimap.js   floor-plan minimap
  src/fx.js        display-only post-processing
  src/bake.js      offline light bake (dev tool)
  src/costs.js     costs.json lookup, severity, totals
  src/store.js     localStorage
  src/report.js    report page
  src/photo.js     real-photo check: upload, detect, merge duplicate boxes, verdict, running total
  src/dom.js       h() DOM helper shared by report and photo pages
  src/game.js      timer, flagging, client chat, scoring
  public/decals/   *.png + decals.json
  public/textures/ public/models/   CC0 Poly Haven assets
  tests/smoke.mjs  rooms, collision, one real detection
  tests/pins.mjs   pinning accuracy vs ground truth, card, removal, persistence
  tests/detect-eval.mjs  in-app detector precision/recall vs ground truth
  tests/shots.mjs  screenshots with post-processing (README)
  tests/synth.mjs  renders labeled training views
  tests/bake.mjs   runs the light bake, writes public/bake/
  tests/look.mjs   real-GPU screenshots of fixed views
  tests/perf.mjs   real-GPU frame rate
server/app.py      FastAPI: /api/health, /api/detect, /api/client/*
server/detector.py RF-DETR checkpoint loader + predict
server/client.py   Ollama chat + scripted fallback
ml/get_data.py  ml/train.py  ml/make_decals.py  ml/combine.py  ml/retrain.sh  ml/evaluate.py
models/ data/      gitignored
results/           evaluation table (CSV + MD) and chart (PNG), committed
```

Run: `uv run uvicorn server.app:app --port 8000` and `npm --prefix web run dev`.

## Contracts

```
POST /api/jpeg    raw HEIC bytes -> JPEG (macOS `sips`; iPhone photos in non-Safari browsers)
POST /api/detect  {image: "<jpeg data URL>"}
  -> {detections: [{label, score, box: [x1,y1,x2,y2]}], ms}     box is 0..1, y down
POST /api/client/question {room, found: [label...], asked: [topic...]}
  -> {question, topic, source: "ollama"|"scripted"}
POST /api/client/grade {question, topic, answer}
  -> {points: 0|1|2, reply, source}
GET  /api/health -> {detector: bool, ollama: bool}
```

```js
// Finding (inspection) — also what the report reads
{id, label, score, room, surface: 'wall'|'ceiling'|'floor', material,
 pos: [x,y,z], normal: [x,y,z], sizeM: [w,h], areaM2, severity,
 cost: {low, high}, thumb: '<data URL crop>', ts}
// Planted defect (ground truth)
{id, label, room, surface, pos, normal, size: [w,h], decal}
```

Debug hooks for tests: `window.inspecto = {app, pins, teleport(x, z, yaw, pitch), analyze(),
analyzeTruth(), replant(seed, count), planted(), randomPose(rand), evalShot(rand), rng(seed)}`.
`analyze()` resolves to `{dets, added, merged, ignored}`.

## Key algorithms

**Capture.** Render one frame, then read the canvas in the same tick
(`toBlob`, JPEG, max 960 px wide). Snapshot the camera (clone with matrices) at
that moment; detection is async and the player may move.

**Pinning (step 4).** For each box, with the snapshot camera:
1. Cast 5 rays (center + 4 points inset 25%) at the house surfaces; furniture
   occludes. The surface with the most hits wins.
2. Position = center hit if it is on the winning surface, else the mean of the
   hits on it. Normal = that face's normal.
3. Size = intersect the 4 box-corner rays with the winning surface's **plane**
   (not the mesh, so corners that run off the wall still measure), giving width
   and height in metres. Clamp to the surface size.
4. Room = `roomAt(pos + normal * 0.05)`. Material from the surface's `userData`.
5. Severity: area < 0.1 m² minor, < 0.5 moderate, else major. Cracks use the
   longest side: < 0.3 m, < 1 m, else major.
6. Dedupe: same label within `max(0.4 m, half its size)` of an existing pin
   updates that pin if the new score is higher.
7. Marker = camera-facing sprite 3 cm off the surface plus an outline quad of the
   measured size. Click (or `E` at the crosshair) opens the detail card: crop,
   label, confidence, room, size, severity, cost range, "not a defect" (remove).

**Domain gap.** The detector trains on real photos but runs on rendered views.
After the first training run, test on about 10 rendered views with planted
defects. If recall there is under about 70%, add synthetic composites (train-split
crops pasted on wall-coloured backgrounds, labels known) and fine-tune a few more
epochs. Evaluation in step 7 stays on the untouched real test split.

**Game.** 8 planted defects, 10:00 timer. `F` flags the crosshair point, then the
player picks the type. Within 0.6 m of a planted defect: right type +100, wrong
type +40; nothing there −25. "AI scan" (the real detector) is limited to 3 uses and
shows boxes for 5 s. The client asks up to 5 questions (first entry to a room, or
every 90 s); answers are graded 0/25/50. End screen: found, missed (revealed with
pins), false flags, client score, total, grade.

**Evaluation.** Run the detector on the 225-image test split. Match predictions
to ground truth greedily at IoU ≥ 0.5 per class at the app's score threshold.
Report precision, recall, F1 and support per class, plus AP50. Save
`results/eval.csv`, `results/eval.md`, `results/eval.png`.

## Licenses (keep this list current; README credits come from it)

| Thing | License |
|---|---|
| three.js, three-mesh-bvh, Vite, FastAPI, Playwright | MIT / Apache 2.0 |
| rfdetr + RF-DETR Nano weights, PyTorch, torchvision, Pillow, matplotlib, uvicorn | Apache 2.0 / BSD / HPND |
| Ollama (MIT), Llama 3.2 3B weights | Llama 3.2 Community License (weights, not code) |
| Defect images | CC BY 4.0 (Roboflow Universe `detr_crack_dataset`) |
| Textures, furniture and sky HDRI (`ballawley_park`) | CC0 (Poly Haven) |
