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

## Product direction (an idea, not agreed: discuss with the owner before building)

The owner asked which missing feature would make this a real business. Suggestion given:
**move-in / move-out condition reports for rentals.** Photograph each room when a tenant
moves in and again when they move out; the app finds the new damage, prices it, and produces
a dated before / after report both sides can keep. Why this one: what the model is good at
(scuffs, holes, stains, peeling paint, with a repair price) is exactly deposit-dispute
damage, it is needed at every tenancy change rather than once, and it does not pretend to
replace a licensed home inspection. What it would need beyond today's app: use from a phone
(camera capture), a "before" set to compare against, a dated shareable PDF, and honest
accuracy numbers (item 1 above). Unvalidated: the owner should ask a few landlords or
property managers first. A $0 first step: make the photo page usable from a phone on the
home Wi-Fi and add the before / after comparison locally.
