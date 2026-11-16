# Next steps

Read ARCHITECTURE.md first. Follow its decisions unless something is broken.
Rules from the owner: stay free ($0), ask before any account, payment or download
over 2 GB, permissive licenses only (MIT / Apache 2.0 / BSD), be token-efficient,
commit and update this file after every step.

## Model plan

| Step | Model | Effort | Status |
|---|---|---|---|
| 1. Machine check and architecture plan | Fable | high | done |
| 2. Load scene with walk controls | Fable | medium | done |
| 3. Defect detection pipeline | Fable | medium | done (final weights still training) |
| 4. Pinning findings in 3D | Fable | high | **next** |
| 5. Report page | Sonnet | medium | |
| 6. Training game mode | Sonnet | medium | |
| 7. Evaluation script | Sonnet | medium | |
| 8. README and final graphify run | Sonnet | low | |

Handoffs: before step 4 ask for `/effort high`; after step 4 hand off to Sonnet at
medium; before step 8 ask for `/effort low`. Format:
"HANDOFF: run /model <model> and /effort <level>, then say 'continue from NEXT_STEPS.md'."
Escalation: same problem unfixed after 2 attempts -> write it here (what was tried,
the error, best guess) and ask the owner to switch to Fable at high effort.

## Done

- Step 1: machine checked, plan written (ARCHITECTURE.md), git repo started.
- Step 2: `web/` Vite app. `house.js` builds the 5-room apartment (exports `ROOMS`, `WINDOWS`, `roomAt(x,z)`, `describeHit(point, normal)`, `buildHouse(scene)` -> `{surfaces, occluders, colliders, ready}`). `walk.js` has look/WASD/collision. `window.inspecto = {app, teleport(x,z,yaw,pitch), ready}`. Smoke test passes headless.

- Step 3: data in `data/` (`uv run ml/get_data.py`), decals (`ml/make_decals.py` -> `web/public/decals`), `web/src/defects.js` (`plantDefects`, `visibleBoxes`, `randomPose`), `web/src/detect.js` (`capture`, `detect`), Analyze button + Space key in `main.js` (fires `inspecto:detections` with `{dets, shot}`; `shot.camera` is the frozen camera), server (`server/app.py`, `server/detector.py`), rendered training views (`web/tests/synth.mjs` -> `data/synth`), `ml/combine.py` -> `data/combined`, `ml/train.py`.

## Training status (check first)

A 5-epoch run on real + rendered views was started 2026-11-16 12:01 in the background
(`models/run`, log `train.log`, about 18 min per epoch). `models/detector.pth` is
currently the 1-epoch real-only trial checkpoint, which finds nothing in rendered views.
When `models/run/checkpoint_best_total.pth` exists and `pgrep -f ml/train.py` is empty:

    cp models/run/checkpoint_best_total.pth models/detector.pth
    # restart the server, then: cd web && node tests/smoke.mjs <outDir>   (must print detections)

If in-app recall is still poor: train more epochs with
`uv run ml/train.py --weights models/run/checkpoint_best_total.pth --epochs 4 --out models/run2`.
Training memory: batch 4 holds about 5 GB. Never raise the batch size or worker count
(a batch-8 run hit 12 GB and pushed the laptop into swap).

## Exact next step: step 4 (pin findings in 3D)

Follow "Pinning" in ARCHITECTURE.md. New file `web/src/pins.js`, listening to
`inspecto:detections`. While the detector is still training, test with ground-truth
boxes: `visibleBoxes(shot.camera, app.planted, house.occluders)` gives boxes in the same
format as detections. Add `web/src/costs.json` + `costs.js` (severity and cost range)
and `store.js` (localStorage `inspecto.findings.v1`), since the detail card shows cost.

Run: `uv run uvicorn server.app:app --port 8000` and `npm --prefix web run dev`.
Test: `cd web && node tests/smoke.mjs <outDir>` (needs both running).

## Known issues

- Context7 MCP, Playwright MCP, frontend-design plugin and `graphify` were not
  available in the step-1 session. Fallbacks are in ARCHITECTURE.md. Step 8 needs
  `graphify`: if it is still missing, ask the owner how they installed it.
- "Damaged tile" has no free labeled data; it is derived from crack + tile surface.
- `llama3.2:3b` is 2.0 GB, exactly at the ask-first limit, not over it.
