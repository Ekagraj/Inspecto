"""Cut labeled defects out of the TRAIN split and turn them into multiply-blend decals.

A decal stores how much the defect darkens its surface (white = no change), faded to
white at the edges, so the app can multiply it over any wall colour and lighting.
The test split is never touched, so evaluation on it stays clean.
"""
import json, pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).parent.parent
SRC, OUT, PER_CLASS = ROOT / "data/train", ROOT / "web/public/decals", 30

coco = json.loads((SRC / "_annotations.coco.json").read_text())
names = {c["id"]: c["name"] for c in coco["categories"]}
images = {i["id"]: i for i in coco["images"]}
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.jpg"):
    old.unlink()

index = []
for cid, label in names.items():
    anns = sorted((a for a in coco["annotations"] if a["category_id"] == cid and min(a["bbox"][2:]) >= 60),
                  key=lambda a: -a["bbox"][2] * a["bbox"][3])[:PER_CLASS]
    for n, a in enumerate(anns):
        x, y, w, h = a["bbox"]
        crop = Image.open(SRC / images[a["image_id"]]["file_name"]).convert("RGB").crop((x, y, x + w, y + h))
        scale = min(512 / max(crop.size), max(1, 256 / max(crop.size)))
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.BICUBIC)
        px = np.asarray(crop, dtype=np.float32)
        ratio = np.clip(px / max(np.percentile(px, 80, axis=(0, 1)).max(), 1), 0, 1)
        H, W = ratio.shape[:2]
        edge = np.minimum.outer(np.minimum(np.arange(H), np.arange(H)[::-1]) / (0.2 * H),
                                np.minimum(np.arange(W), np.arange(W)[::-1]) / (0.2 * W)).clip(0, 1)
        fade = (edge * edge * (3 - 2 * edge))[..., None]
        out = 1 - fade * (1 - ratio)
        name = f"{label}_{n:02d}.jpg"
        Image.fromarray((out * 255).astype(np.uint8)).save(OUT / name, quality=90)
        index.append({"file": name, "label": label, "aspect": round(W / H, 3)})
    print(label, len(anns))
(OUT / "decals.json").write_text(json.dumps(index))
