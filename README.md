# Inspecto

Photograph a wall, and a vision model running in your own browser finds the damage (cracks,
mold, water stains, peeling paint, scuffs, holes), measures it and prices the repair. Nothing
is uploaded and nothing costs money.

**It is visual triage, not a licensed inspection.** It can miss damage and name it wrongly,
it cannot see behind walls, and its repair prices are rough estimates, not quotes.

**Live demo:** https://inspecto-tau.vercel.app. The 3D home (Analyze this view) and Check a photo
work there with no server: the detector runs in your browser, and your photos never leave it.
The first time you press Analyze or add a photo, the browser downloads the model once (54 MB)
and keeps it, so later visits start at once. The site makes no other requests than its own
files and the web fonts.

Local only, because they need the Python server (see Run it): condition reports (saved
inspections and the before / after photo comparison, OpenCV), reading floor plans (Tesseract),
and HEIC photos in browsers other than Safari.

![Walking the demo apartment](docs/living.jpg)

![A water stain the detector found on a bedroom wall (92% confidence), pinned in 3D with its size and repair estimate](docs/finding.jpg)

*Both screenshots are from a real run: every pin was placed by the trained detector, not by hand.*

## What you can do with it

| Page | Address | What it is for |
|---|---|---|
| Condition reports | `/inspect.html` | Photograph each wall when a tenant moves in, retake the same views when they leave. New damage is marked and priced; you confirm or correct every item; print the result. |
| Check a photo | `/photo.html` | Drop in photos of a wall and get a verdict and a running repair total. |
| 3D home | `/` | Walk a demo apartment, press Space to analyze a view, pin what is found, read the report. A real photo can be hung on a wall with `P`. |
| Report | `/report.html` | The 3D home's findings by room, with a suggested offer adjustment. |

Prices can be set for a location (three test areas so far: New York City metro,
Trenton-Princeton NJ, Scranton-Wilkes-Barre PA). iPhone photos work, including HEIC (in
Safari, or anywhere with the local server).

## Run it

Needs macOS on Apple silicon, [uv](https://docs.astral.sh/uv/) and Node 20 or newer.

    uv sync                                          # Python side, once
    brew install tesseract                           # reads lengths on floor plans, once
    npm --prefix web install                         # web side, once
    uv run uvicorn server.app:app --port 8000        # the detector (first terminal)
    npm --prefix web run dev                         # the app (second terminal)

Then open http://localhost:5173. The server needs the trained model at `models/detector.pth`.
It is not in git: [download it from the release](https://github.com/Ekagraj/Inspecto/releases/download/model-v1/detector.pth)
(121 MB) and put it in `models/`, or train your own as below.

**From a phone on the same Wi-Fi:** start the app with `npm --prefix web run dev:phone`
instead and open the "Network" address it prints. Adding a photo opens the phone's camera.
"Use my current location" does not work this way (browsers only allow it on a secure
connection), so type the place instead. Anyone on that Wi-Fi can open the app while it runs.

## Test it

Both servers must be running. Tests drive a real browser and the real detector.

    cd web
    node tests/inspect.mjs out      # condition reports: move-in, move-out, corrections, print
    node tests/photo.mjs out        # photo page: real photos, HEIC, location pricing, errors
    node tests/report.mjs out       # 3D home report: totals, offer maths, location, print
    node tests/wallphoto.mjs out    # a real photo hung in the 3D home
    node tests/smoke.mjs out        # 3D home: rooms, collision, one real detection
    node tests/pins.mjs out         # 3D pinning accuracy
    node tests/detect-eval.mjs 3 20 # detector precision / recall inside the 3D home

    cd .. && uv run python -m server.compare && uv run python -m server.inspections

The live demo as visitors get it (production build, no server, Chrome and Safari's engine,
desktop and phone):

    cd web && npm run build && npx vite preview --port 4173 &
    node tests/live.mjs path/to/a/wall-photo.jpg

## How good is the detector?

| Test set | Precision | Recall |
|---|---|---|
| Rendered inspection views inside the 3D apartment (3 homes, 67 planted defects) | 90% | 81% |
| Real photos never seen in training (original dataset, 225 photos) | 95% | 89% |
| Harder real photos from eight other datasets (784 photos) | 61% | 31% |

All rows use the released model ([`detector.pth`](https://github.com/Ekagraj/Inspecto/releases/tag/model-v1), seven damage types). Confidence threshold 0.4, IoU 0.5. The first row flatters the model, because those views reuse
training images. The last row is the real gap: mold and water stains are often confused with
each other, and scuffs and holes have little training data.

To reproduce the real-photo rows, run `uv run ml/evaluate.py`. It writes a per-class
breakdown to `results/eval.md`.

## The detector in the browser

The same model also runs in the browser itself (onnxruntime-web in a Web Worker). The app uses
the **fp16 build** (54 MB; the fp32 build is 108 MB): same results within half a point, half the
download. GridSample nodes stay fp32.

- **Backend:** WebGPU on desktop Chrome and Edge (about 40 ms per photo). Safari and every phone
  use WASM (about 0.75 s per photo on an M3, 0.4 GB), because Safari's WebGPU held over 1 GB.
  WebGPU falls back to WASM if it fails.
- **Loading:** nothing is downloaded until the first Analyze or photo; then the model comes once,
  with its size on screen, and is kept in the browser's Cache API. Leaving the page frees it.
  Private browsing windows do not keep it.
- **Hosting:** the model is served by the site itself (Vercel has no per-file limit). It is not
  in git: `web/scripts/fetch-model.mjs` runs before every build and takes it from the
  [model-v1 release](https://github.com/Ekagraj/Inspecto/releases/tag/model-v1), checksum-checked.
  Vercel's Hobby plan includes 100 GB of transfer a month, about 1,850 first-time downloads.
- In dev (`npm run dev`) the app still uses the Python server when it is running.

Is the exported model the same detector? Precision / recall, threshold 0.4, IoU 0.5:

| Test set | PyTorch | ONNX fp32 | ONNX fp16 |
|---|---|---|---|
| Rendered 3D views (`detect-eval.mjs 3 20`) | 90% / 81% | 90% / 81% | 90% / 81% |
| Real photos, original (225) | 94.8% / 88.7% | 94.8% / 88.7% | 94.4% / 88.7% |
| Real photos, eight other datasets (784) | 61.4% / 30.9% | 61.4% / 30.9% | 61.2% / 30.7% |

The rendered-view row is the same in every build when the 3D views are rendered the same
way. Rendered by Chrome on a real GPU instead of headless Chromium's software renderer, all
three score 87% / 81%.

Box by box, on 20 test photos plus a portrait phone photo (EXIF orientation 6):

| Compared | Boxes | Paired | Unpaired | Worst score diff | Lowest IoU |
|---|---|---|---|---|---|
| ONNX fp32 vs PyTorch (Python) | 33 | 33 | 0 | 0.000 | 1.000 |
| ONNX fp16 vs PyTorch (Python) | 33 | 33 | 0 | 0.011 | 0.987 |
| Browser fp32 vs Python ONNX fp32, Chrome, WebGPU and WASM | 35 | 35 | 0 | 0.000 | 1.000 |
| Browser fp16 vs Python ONNX fp16, Chrome, WebGPU | 35 | 35 | 1 extra | 0.031 | 0.975 |
| Browser fp16 vs Python ONNX fp16, Chrome, WASM | 35 | 35 | 0 | 0.002 | 0.978 |
| Browser fp32 vs Python ONNX fp32, Safari engine (WebKit) | 35 | 34 | 1 + 2 extra | 0.074 | 0.895 |

The browser resizes the photo itself (plain bilinear, as the model was trained), not with the
canvas, and turns phone photos upright from their EXIF, as the Python side now does too. Its
model input matches Python's to 1e-6. WebKit decodes JPEGs with Apple's decoder, which differs
from the one Python and Chrome use by about a third of a grey level on average; that moved two
borderline boxes. Given the same pixels (PNG), WebKit matches exactly.

Reproduce (dev server running for the browser part):

    uv sync --group export
    uv run --group export ml/export_onnx.py                  # models/onnx/detector-fp32.onnx, -fp16.onnx
    uv run --group export ml/evaluate.py --tag torch         # then --onnx models/onnx/detector-fp32.onnx --tag fp32, and fp16
    uv run --group export ml/parity.py models/onnx/detector-fp32.onnx models/onnx/detector-fp16.onnx
    uv run --group export ml/parity.py --dump /tmp/ref16 models/onnx/detector-fp16.onnx
    node web/tests/browser-parity.mjs /tmp/ref16 chrome webgpu fp16

Speed and memory on an M3 MacBook (macOS 26, Chrome and Playwright's WebKit, median of 20
photos, model served locally, so a real first visit adds the download time):

| Browser | Backend | Build | Compile | First run | Per photo | Memory | After freeing |
|---|---|---|---|---|---|---|---|
| Chrome | WebGPU | fp16 | 0.6 s | 0.13 s | 42 ms | +0.4 to 0.7 GB | +27 MB |
| Chrome | WebGPU | fp32 | 0.6 s | 0.13 s | 53 ms | +0.6 GB | |
| Chrome | WASM | fp16 | 0.65 s | 0.81 s | 0.75 s | +0.33 to 0.37 GB | +9 MB |
| Chrome | WASM | fp32 | 0.5 s | 0.77 s | 0.71 s | +0.35 GB | |
| WebKit | WebGPU | fp16 | 0.8 s | 0.11 s | 51 ms | +1.2 to 1.7 GB | +0.8 to 1.1 GB |
| WebKit | WebGPU | fp32 | 0.8 s | 0.11 s | 65 ms | +1.3 to 1.4 GB | |
| WebKit | WASM | fp16 | 0.9 s | 0.80 s | 0.75 s | +0.43 GB | +58 MB |
| WebKit | WASM | fp32 | 0.7 s | 0.76 s | 0.70 s | +0.47 GB | |

"Per photo" includes decoding and resizing. Memory is every browser process, GPU included.
"After freeing" is after `freeDetector()`, which runs when the page is left. WebKit keeps most
WebGPU memory even then (releasing the session first did not reliably help). Detection runs in a
worker, so the page keeps drawing frames meanwhile (longest gap 19 to 40 ms). Measured with
`node web/tests/detector-bench.mjs`.

## Train it

    uv run ml/get_data.py                # the original real photos (46 MB)
    python3 ml/get_roboflow.py           # eight more public sets (633 MB); needs a free
                                         # Roboflow API key in a file named .roboflow_key
    uv run ml/prep_extra.py              # map their classes onto ours, drop duplicates
    nohup caffeinate -is sh ml/train_more.sh > train_more.log 2>&1 &

Training takes about 3 to 3.5 hours on an M3, plugged in with the lid open. It keeps the
previous model as `models/detector_before_extra.pth`. Never run two trainings at once.

## How it works, briefly

- **Detector:** RF-DETR Nano, fine-tuned on real photos plus rendered views of the 3D home
  with real defect cut-outs on its walls. Seven classes (`ml/classes.py`).
- **Size and severity:** in the 3D home, from where the boxes land on the walls. On a photo,
  from the width you say the photo covers. Severity and price come from size and type
  (`web/src/costs.json`), not from the image.
- **Before / after:** the move-out photo is lined up with the move-in photo from their
  shared detail (`server/compare.py`). Plain walls often cannot be lined up; the app then
  says so and asks you to decide.
- **Local prices:** the cost table times the local mean wage of painters over the US mean.

`ARCHITECTURE.md` has the full design.

## Credits and licences

- Code: three.js, Vite, FastAPI, Playwright (MIT / Apache 2.0); RF-DETR and its weights,
  PyTorch, Pillow, OpenCV, matplotlib (Apache 2.0 / BSD / HPND).
- Training photos, all CC BY 4.0 from Roboflow Universe: `objectdetection-qxiqx/detr_crack_dataset`,
  `dommages/batch1-yprx8`, `dommages/batch2-eunzt`, `scipublic/wall-6bnve`,
  `peumalab/wall-defects`, `assuralabs/av-water-damage`,
  `elaas-workspace/wall-defect-7fdkt-jpjpa`, `jq3/building_defect`,
  `building-fault-detection-and-diagnostics/paint-damage-det`.
- Textures, furniture and sky in the 3D home: CC0, Poly Haven.
- Wage data for local prices: US Bureau of Labor Statistics, Occupational Employment and
  Wage Statistics, May 2025 (public domain).
