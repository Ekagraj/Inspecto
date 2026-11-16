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
| 3. Defect detection pipeline | Fable | medium | **next** |
| 4. Pinning findings in 3D | Fable | high | |
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

## Exact next step: step 3 (detection pipeline)

See the notes below. Dev server: `npm --prefix web run dev`; test: `cd web && node tests/smoke.mjs <outDir>`.

## Notes for step 3

- Data: `hf download senthilsk/crack_detection_dataset --repo-type dataset`
  (zips in `data/`: train, valid, test). Check the annotation format inside the
  zips; RF-DETR wants `train/ valid/ test/` each with `_annotations.coco.json`.
- Training: `RFDETRNano().train(dataset_dir, epochs, batch_size=4,
  grad_accum_steps=4, lr=1e-4, output_dir="models/")`; best weights land in
  `checkpoint_best_total.pth`. Read the current rfdetr docs first
  (https://rfdetr.roboflow.com). Run training in the background and build the
  server and decals meanwhile. If MPS fails, set `PYTORCH_ENABLE_MPS_FALLBACK=1`,
  then fall back to CPU with fewer epochs.
- Step 3 must also produce decals and plant a fixed set in the home, otherwise
  there is nothing to detect.

## Known issues

- Context7 MCP, Playwright MCP, frontend-design plugin and `graphify` were not
  available in the step-1 session. Fallbacks are in ARCHITECTURE.md. Step 8 needs
  `graphify`: if it is still missing, ask the owner how they installed it.
- "Damaged tile" has no free labeled data; it is derived from crack + tile surface.
- `llama3.2:3b` is 2.0 GB, exactly at the ask-first limit, not over it.
