"""Merge the real dataset and the rendered synthetic views into data/combined (COCO, symlinked images)."""
import json, os, pathlib, shutil
DATA = pathlib.Path(__file__).parent.parent / "data"
OUT = DATA / "combined"
shutil.rmtree(OUT, ignore_errors=True)
for split, sources in {"train": ["train", "synth/train"], "valid": ["valid", "synth/valid"], "test": ["test"]}.items():
    out = {"images": [], "annotations": [], "categories": None}
    (OUT / split).mkdir(parents=True)
    for src in sources:
        coco = json.loads((DATA / src / "_annotations.coco.json").read_text())
        out["categories"] = out["categories"] or coco["categories"]
        assert [c["name"] for c in coco["categories"]] == [c["name"] for c in out["categories"]], "class order differs"
        ids = {}
        for im in coco["images"]:
            ids[im["id"]] = len(out["images"])
            os.symlink((DATA / src / im["file_name"]).resolve(), OUT / split / im["file_name"])
            out["images"].append({**im, "id": ids[im["id"]]})
        for a in coco["annotations"]:
            out["annotations"].append({**a, "id": len(out["annotations"]), "image_id": ids[a["image_id"]]})
    (OUT / split / "_annotations.coco.json").write_text(json.dumps(out))
    print(split, len(out["images"]), "images", len(out["annotations"]), "boxes")
