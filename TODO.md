# To do

The ordered list of what is left. Read `ARCHITECTURE.md` and `NEXT_STEPS.md` first: the
details, commands and the owner's rules are there. Tick items off here and keep the notes
in `NEXT_STEPS.md`. Last updated 2026-11-16.

## Right now

- [ ] **Owner starts the training** (laptop plugged in, lid open, about 3 to 3.5 hours):
      `nohup caffeinate -is sh ml/train_more.sh > train_more.log 2>&1 &`
- [ ] **After `train_more.log` says "train_more: done"**: restart the API, then run
      `tests/detect-eval.mjs 3 20`, `tests/photo.mjs`, `tests/wallphoto.mjs` and
      `tests/smoke.mjs`. Record the numbers in `NEXT_STEPS.md`. Before: precision 88%,
      recall 85% in the 3D home, 5 types.
- [ ] **Re-test the owner's own photo**: a scrape with chipped paint on a wall, which the old
      model called "water stain" at 52%. Ask the owner to add it on the photo page. The right
      answer is "Scuff / scrape" or "Peeling paint".
- [ ] If the new model is worse, put the old one back (command is in `ml/train_more.sh`).
- [ ] **Owner: regenerate the Roboflow API key** (it was pasted in chat) and put the new one
      in `.roboflow_key`.
- [ ] **Owner decides**: delete the two old training runs, `models/run` and `models/run2`
      (1.6 GB, not needed by the app)?

## Next, in this order

The owner's goal is real photos of real walls, so the order follows that.

1. [ ] **Evaluation on real photos.** The script is written and trial-run
       (`uv run ml/evaluate.py`, writes `results/eval.md`, `.csv`, `.png`). STILL TO DO: run
       it on the new model once training ends, and once on the old one for comparison:
       `uv run ml/evaluate.py --weights models/detector_before_extra.pth --tag before`.
       On a 12-photo trial the old model found none of the scuffs or holes.
2. [x] **Correct a wrong label.** Done on the condition-reports page (`/inspect.html`): a
       type dropdown per problem, "It is new / It was already there", "Not damage". Saved on
       the laptop with `corrected: true`. STILL TO DO: a script that turns corrected
       inspection photos (`data/inspections/*/`) into training data. The quick photo page
       (`/photo.html`) still has no correction; it links to the reports page instead.
3. [x] **Printable report for real photos.** Done as the print layout of an inspection
       (`Print / save PDF`). The quick photo page has no report of its own.
4. [x] **Location pricing in the 3D home and its report.** Done (`localized` in `costs.js`).
       STILL TO DO: more than three areas (full BLS metro table needs each area's code,
       name and position), search by ZIP. Never invent multipliers.
5. [ ] **Better repair prices.** The cost table (`web/src/costs.json`) is rough hand-built
       estimates, including the two new rows (scuff, hole). Find a source that allows reuse.
       This is the weakest part for real-world use. Not started: no reusable source found.
6. [x] **README.** Written (`README.md`): what it does, run, test, train, credits. It points
       to `results/eval.md` for accuracy instead of quoting numbers; fill that in (item 1).
7. [ ] **Training game mode** (step 6). The largest piece and the least related to real
       photos. Ask the owner whether to build it or drop it. Not started.

## Small known issues

- A photo hung in the 3D home is not kept inside the wall sideways (can overhang a corner).
- Size on the photo page depends on the width the user types; there is no automatic scale.
- Thin diagonal defects on ceilings measure too large in the 3D home.
- ProRAW `.DNG` photos are untested (no sample). HEIC and TIFF are tested.
- Frame rate was not re-measured after the realism pass (`node tests/perf.mjs "?fx=auto"`).
- "Damaged tile" is inferred from a crack on a tiled surface, not detected.

## New feature (agreed by the owner 2026-11-16): move-in / move-out condition reports

The owner wants this built and may rebrand the whole app around it if it works. Do not
rename or rebrand anything yet: build it, let the owner try it, then ask.

**What it is.** Photograph each room when a tenant moves in and again when they move out.
The app finds the new damage, prices the repair, and produces a dated before / after report
that landlord and tenant can both keep.

**Why this one.** What the model is good at (scuffs, holes, stains, peeling paint, with a
repair price) is exactly deposit-dispute damage; it is needed at every tenancy change rather
than once; and it does not pretend to replace a licensed home inspection.

**Already built (2026-11-16, by Fable): the hard parts, server side. No page uses them yet.**
- `server/compare.py`: lines up a move-out photo with the move-in photo of the same wall
  (ORB features + homography) and marks each move-out problem `existing` or `new`, with
  `sure` and a plain-English `why`. When the wall is too plain to line up it falls back to
  "similar problem in a similar place" and sets `sure: false`, which the page must show as
  "please check". Self-check: `uv run python -m server.compare`.
- `server/inspections.py`: inspections as files in `data/inspections/<id>/` (JSON + JPEGs,
  git-ignored), dates stamped by the server, a person's corrections saved (`corrected: true`
  on a re-labelled problem: those photos are future training data). Self-check:
  `uv run python -m server.inspections`.
- API (in `server/app.py`, smoke-tested with the real detector):
  `GET /api/inspections` | `POST /api/inspections {name, kind: "move-in"|"move-out", baseline?}` |
  `GET /api/inspections/{id}` | `POST /api/inspections/{id}/photos {room, image, widthM?, pair?}` |
  `PATCH /api/inspections/{id}/photos/{photoId} {widthM?, detections?: {"<index>": {label?, status?, removed?}}}` |
  `GET /api/inspections/{id}/photos/{photoId}.jpg`. Bad input answers 400 with `detail`.
  A photo is `{id, room, addedAt, widthM, aspect, pair, aligned, detections: [{label, score,
  box, status?, sure?, match?, why?, corrected?, removed?}]}`; `match` indexes the paired
  move-in photo's detections.
- Checked on the owner's own plain-wall photo: it lined up under a simulated change of
  viewpoint. NOT checked: a genuine re-take weeks later in different light. Test that with
  the owner (two photos of one wall, a day apart) before trusting `sure: true`.

**The page is built too (2026-11-16): `/inspect.html`, `src/inspect.js`, `src/inspect.css`,
shared helpers in `src/photokit.js`, test `tests/inspect.mjs` (14 checks, passes; it creates
two "TEST ..." inspections and deletes exactly those). The start screen has a fourth card.**

1. [x] **Phone, at $0.** `npm --prefix web run dev:phone` serves the app to the home Wi-Fi;
       the file inputs open the phone camera. Layout checked at 390 px wide in the test.
       NOT tried on a real phone: ask the owner to try it. Known limits: "Use my current
       location" is blocked there (needs a secure connection), and `capture` means the phone
       offers the camera only, not the photo library.
2. [x] **Inspection page.** List, create a move-in, "Start the move-out" from it, rooms,
       dated photos with boxes, type, size and price.
3. [x] **Before / after.** Move-in photo beside "Retake this view"; each problem tagged
       New / Was already there, with "Please check" and the reason when unsure; type
       dropdown, confirm buttons, "Not damage". Only new, not struck-out damage is charged.
4. [x] **The condition report.** The page's print layout (`Print / save PDF`): name, both
       dates, the location used, before and after side by side, totals, notice.
5. [ ] **Owner tries it on a real room**, then decide the rebrand. Things to watch and
       report back: does a real retake a day later line up (the "Please check" rate), are the
       prices believable, is anything missing from the printed report (signatures? address?).
6. [ ] Not built: deleting an inspection or a photo (the owner is wary of deletes; add it
       only with a confirm step), renaming, and more than one photo per retake view works but
       is untested.

**Open points to raise with the owner, not to decide alone.**
- Unvalidated demand: suggest they ask a few landlords or property managers how they handle
  move-out damage now and whether they would pay for this.
- A real product needs hosting and accounts, which breaks the stay-free rule. Steps 1 to 4
  avoid that on purpose; anything beyond them needs the owner's say-so.
- Repair prices are still rough estimates (item 5 above). A report used in a deposit dispute
  makes that weakness matter more.
- The 3D home becomes a demo rather than the product. Keep it unless the owner says otherwise.
