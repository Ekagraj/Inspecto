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

**When.** After items 1 to 3 above: it needs honest accuracy numbers, label correction, and
it builds on the photo-page report. Build in this order, each step usable on its own:

1. [ ] **Use it from a phone, at $0.** Serve the photo page to a phone on the home Wi-Fi
       (Vite `server.host`, the API stays on the laptop) and add camera capture to the file
       input. Check the layout at phone width. Nothing is hosted and nothing costs money.
2. [ ] **Inspections with rooms.** A named inspection ("Flat 2B, move-in, 2026-11-16") that
       holds photos grouped by room, each stamped with the date and time it was added.
       Browser storage will be too small for many photos: decide where they live (a local
       folder through the API is the simple answer).
3. [ ] **Before / after comparison.** Open the move-in inspection, add the move-out photos
       room by room, and mark each move-out problem as "new" or "was already there" by
       matching against the move-in findings for that room. Start with the user confirming
       each match; automatic matching can come later.
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
