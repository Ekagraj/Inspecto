"""Merge the downloaded Roboflow sets (ml/get_roboflow.py) into one training-ready COCO set:
data/extra/ready/{train,valid}. No training happens here.

  uv run ml/prep_extra.py

- Their class names are mapped onto ours (ml/classes.py). An image holding any class we do not
  map (spalling, corrosion, ...) is left out whole, so nothing visible goes unlabeled.
- Photos already in our real train / valid / test data are left out (same-picture check), so
  the test set stays unseen.
- Common classes are capped per source so mold and cracks do not swamp the rare ones.
- Each source's own `test` split is not used: keep it for the evaluation step.
"""
import collections, json, os, pathlib, random, shutil
from PIL import Image
from classes import CLASSES

DATA = pathlib.Path(__file__).parent.parent / "data"
SRC, OUT = DATA / "extra" / "roboflow", DATA / "extra" / "ready"
MAP = {  # source folder -> {their class: ours}
    "dommages__batch1-yprx8__2": {"scuff": "scuff", "ripped paint": "peeling_paint", "hole": "hole", "dents": "hole", "water damage": "water_seepage", "crack": "crack"},
    "dommages__batch2-eunzt__5": {"scuff": "scuff", "ripped paint": "peeling_paint", "hole": "hole"},
    "scipublic__wall-6bnve__1": {"wall_crack": "crack", "wall_mold": "mold", "wall_stain": "water_seepage"},
    "peumalab__wall-defects__1": {"crack": "crack", "moisture": "water_seepage", "stain": "water_seepage", "mold": "mold"},
    "assuralabs__av-water-damage__1": {"mold": "mold", "damp": "water_seepage", "dampness": "water_seepage", "stain": "water_seepage", "crack": "crack"},
    "elaas-workspace__wall-defect-7fdkt-jpjpa__1": {"mould": "mold", "crack": "crack", "peeling_paint": "peeling_paint"},
    "jq3__building_defect__3": {"peeling": "peeling_paint", "mold": "mold", "crack": "crack"},
    "building-fault-detection-and-diagnostics__paint-damage-det__1": {"Paint-Damage": "peeling_paint"},
}
RARE_FIRST = ["scuff", "hole", "water_seepage", "peeling_paint", "mold", "crack"]  # an image counts as its rarest class
CAPS = {"train": {"mold": 250, "crack": 100}, "valid": {"mold": 60, "crack": 30}}  # per source
SOURCE_MAX = {"building-fault-detection-and-diagnostics__paint-damage-det__1": {"train": 300, "valid": 60}}  # much of it is outdoor metalwork


def dhash(path):
    """Difference hash: the same picture re-saved or resized gets the same value."""
    px = list(Image.open(path).convert("L").resize((17, 16)).getdata())
    return sum(1 << i for i in range(256) if px[i // 16 * 17 + i % 16] > px[i // 16 * 17 + i % 16 + 1])


if __name__ == "__main__":
    random.seed(7)
    seen = set()
    for split in ("train", "valid", "test"):  # our own real photos, the test set above all
        for f in (DATA / split).glob("*.jpg"):
            seen.add(dhash(f))
    print("our own photos hashed:", len(seen), flush=True)
    shutil.rmtree(OUT, ignore_errors=True)
    for split in ("train", "valid"):
        (OUT / split).mkdir(parents=True)
        out = {"images": [], "annotations": [], "categories": [{"id": i, "name": n, "supercategory": "defect"} for i, n in enumerate(CLASSES)]}
        stats = collections.Counter()
        for source, mapping in MAP.items():
            coco = json.loads((SRC / source / split / "_annotations.coco.json").read_text())
            names = {c["id"]: c["name"] for c in coco["categories"]}
            boxes = collections.defaultdict(list)
            for a in coco["annotations"]:
                boxes[a["image_id"]].append(a)
            images = [im for im in coco["images"] if boxes[im["id"]]]
            random.shuffle(images)
            taken = collections.Counter()
            for im in images:
                theirs = [names[a["category_id"]] for a in boxes[im["id"]]]
                if any(t not in mapping for t in theirs):
                    stats["left out: has an unmapped class"] += 1
                    continue
                primary = min((mapping[t] for t in theirs), key=RARE_FIRST.index)
                if taken[primary] >= CAPS[split].get(primary, 10**9) or sum(taken.values()) >= SOURCE_MAX.get(source, {}).get(split, 10**9):
                    stats["left out: over the cap"] += 1
                    continue
                path = SRC / source / split / im["file_name"]
                h = dhash(path)
                if h in seen:
                    stats["left out: already have this picture"] += 1
                    continue
                seen.add(h)
                kept = []
                for a in boxes[im["id"]]:
                    x, y, w, hh = a["bbox"]
                    x, y = max(0, x), max(0, y)
                    w, hh = min(w, im["width"] - x), min(hh, im["height"] - y)
                    if w >= 2 and hh >= 2:
                        kept.append({"category_id": CLASSES.index(mapping[names[a["category_id"]]]), "bbox": [x, y, w, hh], "area": w * hh, "segmentation": [], "iscrowd": 0})
                if not kept:
                    continue
                name = f"{source}__{im['file_name']}"
                os.symlink(path.resolve(), OUT / split / name)
                image_id = len(out["images"])
                out["images"].append({"id": image_id, "file_name": name, "width": im["width"], "height": im["height"]})
                for k in kept:
                    out["annotations"].append({"id": len(out["annotations"]), "image_id": image_id, **k})
                    stats[CLASSES[k["category_id"]] + " boxes"] += 1
                taken[primary] += 1
            print(f"  {split} {source}: {sum(taken.values())} images {dict(taken)}", flush=True)
        (OUT / split / "_annotations.coco.json").write_text(json.dumps(out))
        print(split, len(out["images"]), "images |", dict(sorted(stats.items())), flush=True)
