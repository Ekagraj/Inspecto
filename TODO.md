# To do

The ordered list of what is left. Read `ARCHITECTURE.md` and `NEXT_STEPS.md` first: the
details, commands and the owner's rules are there. Tick items off here and keep the notes
in `NEXT_STEPS.md`. Last updated 2026-11-16.

## Right now

- [ ] **Continue the paused training.** It was started 2026-11-16 23:01 and paused by the
      owner at 23:40 with 1 of 6 rounds done (about 32 minutes a round). That round is kept
      in `models/resume.pth` (checked: it loads and detects). The app still runs the OLD
      5-type model, `models/detector.pth`. To continue, laptop plugged in and lid open:
      `nohup caffeinate -is sh ml/train_more.sh > train_more.log 2>&1 &`
      The script sees `models/resume.pth` and trains 5 more rounds from it, about 2.5 to
      3 hours. Training needs no Claude session and no terminal left open: once started it
      runs on its own. Do not start it twice.
- [ ] **After `train_more.log` says "train_more: done"**: restart the API, then
      `uv run ml/evaluate.py` and
      `uv run ml/evaluate.py --weights models/detector_before_extra.pth --tag before`, then
      `tests/detect-eval.mjs 3 20`, `tests/photo.mjs`, `tests/inspect.mjs`,
      `tests/wallphoto.mjs` and `tests/smoke.mjs`. Record the numbers in `NEXT_STEPS.md`.
      Before: precision 88%, recall 85% in the 3D home, 5 types.
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

## Your home from its floor plan and photos (agreed with the owner 2026-11-17)

The 3D home must be the owner's real home, built by the app, not the fixed apartment in
`house.js`. Hanging a photo on a wall (`wallphoto.js`) was a misunderstanding of what they wanted.
The owner will not trace or draw: at most they name photos and confirm. Design: the floor plan
gives the shape (it has the lengths); photos give the look. Real photos are listing-style wide
shots from a corner or doorway (2 to 3 walls, ceiling and floor in each, 1 to 4 per room), not one
per wall. Floors and ceilings get default materials. Room by room, the user checks each result.
Test material: a Zillow listing (two plans, 19 photos) in `floor/`, git-ignored: never commit it.
Free tools only, each under 500 MB; heavy work on the server so the page stays fast.

1. [x] **Plan -> walkable 3D shell** (2026-11-17). `server/floorplan.py`, `POST /api/floorplan`,
       `/home.html` (`src/home.js`), `tests/home.mjs`. On both listing plans: scale from 5/5 and
       7/8 written lengths, every real door and window found, stairs found. Known issues:
       a few false openings (open floor between a counter and a wall, a counter edge);
       room names only partly read (5 of 9); which end of the stairs is up is not read and stairs
       are not climbable; glass sliding doors count as windows (not walkable); the two floors are
       separate; nothing is saved yet; 8 ft ceilings assumed.
1b. [~] **Make plan reading perfect for this one style first** (owner's call, 2026-11-17), before
       other styles. No free source of real listing plans in bulk (listing sites forbid scraping,
       Wikimedia has none), so `ml/make_plans.py` draws random plans in the magicplan / Sensopia
       style with their true answer, and `ml/eval_plans.py` grades the reader:
       `uv run ml/make_plans.py --n 100 --out data/plans_synth100 --seed 2`
       `uv run ml/eval_plans.py data/plans_synth100` (about 2 minutes).
       Now: 89/100 plans perfect; scale within 1% on 96; 719/745 doors and windows (97%),
       none of the wrong kind; stairs 59/66. Left: (a) two plans where two of the three OCR
       readings make the same misread (25' read as 29' or 20') -- cross-check with room sizes;
       (b) two plans where tiny JPEG lengths cannot be read; (c) 7 stairs missed, 8 invented;
       (d) 15 invented doors. Always also run the two real plans (`floor/`, scale 0.01095).
       Other styles fail for now: metric lengths, walls drawn as two outlines, plans with only
       areas (`floor/download.*`).
2. [ ] **One simple room from its photos**: the front bedroom of the listing. For each photo find
       where the camera stood (vanishing points of the room's right angles, fit the plan's room box
       to the photo's lines; OpenCV, no AI), then paint each wall from the photo that sees it best.
3. [ ] **Check screen fixes**: tap an opening to make it door / window / glass door / not there;
       flip the stairs; save the home (`data/homes/<id>/`, same pattern as inspections).
4. [ ] Hard cases: the open kitchen (cabinets cover walls), stairs joining the two floors.
5. [ ] Later, only if the owner asks: cloud storage for photos (free tiers exist, but it breaks
       the stay-free, no-hosting rule).

## Small known issues

- Photos in the 3D home (improved 2026-11-16): several can hang at once, they can be added in
  place ("Add a wall photo" button or drag and drop), resized with `[` and `]`, and are slid
  back onto their piece of wall. Left: a photo wider than its wall piece is only centred, a
  photo above a door or beside a window can still overhang the opening, and the 3D view was
  only tested in software rendering while training ran (not for smoothness on the real GPU:
  run `node tests/perf.mjs "?fx=auto"` after training).
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
