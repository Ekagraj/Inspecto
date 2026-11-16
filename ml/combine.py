"""Merge the real dataset, the rendered synthetic views and the prepared extra photos
(ml/prep_extra.py, if present) into data/combined (COCO, symlinked images)."""
import json, os, pathlib, shutil
from classes import CLASSES

DATA = pathlib.Path(__file__).parent.parent / "data"
OUT = DATA / "combined"
shutil.rmtree(OUT, ignore_errors=True)
SOURCES = {"train": ["train", "synth/train", "extra/ready/train"], "valid": ["valid", "synth/valid", "extra/ready/valid"], "test": ["test"]}
for split, sources in SOURCES.items():
    out = {"images": [], "annotations": [], "categories": [{"id": i, "name": n, "supercategory": "defect"} for i, n in enumerate(CLASSES)]}
    (OUT / split).mkdir(parents=True)
    for src in sources:
        if not (DATA / src / "_annotations.coco.json").exists():
            print("  (no", src, "- skipped)")
            continue
        coco = json.loads((DATA / src / "_annotations.coco.json").read_text())
        cat = {c["id"]: CLASSES.index(c["name"]) for c in coco["categories"] if c["name"] in CLASSES}  # sources number classes differently
        ids = {}
        for im in coco["images"]:
            ids[im["id"]] = len(out["images"])
            os.symlink((DATA / src / im["file_name"]).resolve(), OUT / split / im["file_name"])
            out["images"].append({**im, "id": ids[im["id"]]})
        for a in coco["annotations"]:
            out["annotations"].append({**a, "id": len(out["annotations"]), "image_id": ids[a["image_id"]], "category_id": cat[a["category_id"]]})
    (OUT / split / "_annotations.coco.json").write_text(json.dumps(out))
    print(split, len(out["images"]), "images", len(out["annotations"]), "boxes")
