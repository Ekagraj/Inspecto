# Next steps

Read ARCHITECTURE.md first. Follow its decisions unless something is broken.
Rules from the owner: stay free ($0), ask before any account, payment or download
over 2 GB, permissive licenses only (MIT / Apache 2.0 / BSD), be token-efficient,
commit and update this file after every step.

## Model plan

| Step | Model | Effort | Status |
|---|---|---|---|
| 1. Machine check and architecture plan | Fable | high | done |
| 2. Load scene with walk controls | Fable | medium | **next** |
| 3. Defect detection pipeline | Fable | medium | |
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

## Exact next step: step 2 (scene + walk controls)

1. `npm create vite@latest web -- --template vanilla`, add `three`, and
   `playwright` as a dev dependency. Run `npx playwright install chromium` if the
   cached build does not match. Check the current three.js docs before coding
   (WebFetch on threejs.org docs; Context7 if it is available).
2. `web/src/house.js`: floor plan as data, builder for box walls with door gaps,
   floors, ceilings, lights. Export `surfaces` (meshes with
   `userData = {surface, material}`), `roomAt(point)`, wall rectangles for collision.
3. `web/src/walk.js`: PointerLockControls, WASD + shift, eye height 1.6 m,
   circle-vs-rectangle collision. Mouse-drag look when pointer lock is unavailable.
4. CC0 Poly Haven textures (1k JPG) and a few furniture models through
   `https://api.polyhaven.com/files/<asset>`; keep `web/public` under about 40 MB
   and commit it.
5. `window.inspecto.teleport()` hook, then `web/tests/smoke.mjs`: open the app
   headless, teleport to each room, screenshot, fail on console errors. Look at
   the screenshots before moving on.
6. Commit, update this file, continue to step 3 (same model and effort).

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
