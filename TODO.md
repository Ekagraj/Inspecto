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

1. [ ] **Evaluation on real photos** (step 7 in `NEXT_STEPS.md`). Per-type precision and
       recall on photos the model never saw: `data/test` plus the unused `test` split of each
       Roboflow set in `data/extra/roboflow/`. The in-home numbers flatter the model.
2. [ ] **Correct a wrong label on the photo page.** A dropdown per problem to change its type
       (price updates), and save photo + box + corrected type to a local folder so the
       owner's photos become training data. Best source for scuffs and holes, which are thin
       (about 380 photos).
3. [ ] **Report for the photo page.** Printable, grouped by photo, with the total and the
       offer calculation the 3D home's report already has. Reuse `report.js` pieces.
4. [ ] **Location pricing everywhere.** Now: photo page only, three test areas (New York
       metro, Trenton-Princeton, Scranton-Wilkes-Barre), wages only. Add it to the 3D home
       and its report, load the full BLS metro table, search by city or ZIP. Never invent
       multipliers.
5. [ ] **Better repair prices.** The cost table (`web/src/costs.json`) is rough hand-built
       estimates, including the two new rows (scuff, hole). Find a source that allows reuse.
       This is the weakest part for real-world use.
6. [ ] **README** (step 8): install, run, test, and the credits the CC BY photo licences
       require (list in `ARCHITECTURE.md`, "Licenses"). Needed before sharing the project.
7. [ ] **Training game mode** (step 6). The largest piece and the least related to real
       photos. Ask the owner whether to build it or drop it.

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

**What is left is the page (steps 1 to 5).** It should follow items 1 to 3 above: it needs
honest accuracy numbers, and it replaces the browser-storage photo page rather than adding a
third way to do the same thing (label correction and the report can be built here directly
on the API instead of on `photo.js`; ask the owner if unsure). Each step usable on its own:

1. [ ] **Use it from a phone, at $0.** Serve the page to a phone on the home Wi-Fi (Vite
       `server.host: true`; the `/api` proxy keeps working, the API stays on the laptop) and
       add `capture="environment"` to the file input. Check the layout at phone width.
       Gotcha: on `http://192.168...` the browser blocks live camera preview and
       "Use my current location" (both need HTTPS or localhost). A plain file input with
       `capture` still opens the camera, so use that; location must be typed on the phone.
2. [ ] **Inspection page** (`web/inspect.html` + `src/inspect.js`, reuse `dom.js`,
       `report.css`, `photo.css`, the location control and `costOf`). List inspections,
       create one, pick or type a room, add photos (reuse `decode` / `toJpeg` from
       `photo.js`: export them), show each photo with boxes, type, size, price, date.
3. [ ] **Before / after.** In a move-out inspection show the move-in photos room by room,
       each with "Retake this view" (sends `pair`). Show the two photos side by side, each
       problem tagged "New" or "Was already there"; when `sure` is false show the `why` and
       two buttons to confirm (PATCH `status`). Add a type dropdown per problem (PATCH
       `label`) and "Not damage" (PATCH `removed`). Totals count only new, not removed.
4. [ ] **The condition report.** Printable / PDF: property, both dates, per room the before
       and after photos side by side, new damage with type, size and repair price, the total,
       the location used for pricing, and the "visual triage, rough estimates" notice.
5. [ ] **Ask the owner about the rebrand** once they have tried steps 1 to 4 on a real room.

**Open points to raise with the owner, not to decide alone.**
- Unvalidated demand: suggest they ask a few landlords or property managers how they handle
  move-out damage now and whether they would pay for this.
- A real product needs hosting and accounts, which breaks the stay-free rule. Steps 1 to 4
  avoid that on purpose; anything beyond them needs the owner's say-so.
- Repair prices are still rough estimates (item 5 above). A report used in a deposit dispute
  makes that weakness matter more.
- The 3D home becomes a demo rather than the product. Keep it unless the owner says otherwise.
