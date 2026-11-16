"""Download public Roboflow Universe datasets (all CC BY 4.0, COCO boxes) into data/extra/roboflow/.

  python3 ml/get_roboflow.py

Needs a free Roboflow API key in .roboflow_key (git-ignored). Downloads only: it uses no
Roboflow credits and trains nothing. Safe to re-run: finished datasets are skipped.
Stops before the total would pass 2 GB (the owner's ask-first limit).
"""
import json, pathlib, sys, time, urllib.request, zipfile

ROOT = pathlib.Path(__file__).parent.parent
OUT = ROOT / "data" / "extra" / "roboflow"
KEY = (ROOT / ".roboflow_key").read_text().strip()
LIMIT = 2 * 1024**3
# workspace/project/version -> why we want it. Class mapping lives in ml/prep_extra.py.
DATASETS = {
    "dommages/batch1-yprx8/2": "scuff, hole, dents, ripped paint, water damage (interior walls)",
    "dommages/batch2-eunzt/5": "scuff, hole, ripped paint",
    "scipublic/wall-6bnve/1": "wall stain, mold, crack",
    "peumalab/wall-defects/1": "moisture, stain, mold, crack",
    "assuralabs/av-water-damage/1": "damp, stain, mold, crack",
    "elaas-workspace/wall-defect-7fdkt-jpjpa/1": "peeling paint, mould, crack",
    "jq3/building_defect/3": "peeling, mold, crack",
    "building-fault-detection-and-diagnostics/paint-damage-det/1": "paint damage",
}


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


total = sum(f.stat().st_size for f in OUT.rglob("*.zip")) if OUT.exists() else 0
for slug, why in DATASETS.items():
    name = slug.replace("/", "__")
    dest, zpath = OUT / name, OUT / f"{name}.zip"
    if (dest / "DONE").exists():
        print("have", slug, flush=True)
        continue
    link = None
    for _ in range(40):  # an export that was never made in COCO format is generated on request
        info = fetch_json(f"https://api.roboflow.com/{slug}/coco?api_key={KEY}")
        link = info.get("export", {}).get("link")
        if link:
            break
        time.sleep(5)
    if not link:
        print("SKIPPED (no export link):", slug, str(info)[:200], flush=True)
        continue
    req = urllib.request.urlopen(link, timeout=120)
    size = int(req.headers.get("Content-Length") or 0)
    if total + size > LIMIT:
        sys.exit(f"STOP: {slug} is {size / 1e6:.0f} MB and would take the total past 2 GB. Ask the owner.")
    OUT.mkdir(parents=True, exist_ok=True)
    with open(zpath, "wb") as f:
        while chunk := req.read(1 << 20):
            f.write(chunk)
    total += zpath.stat().st_size
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)
    (dest / "DONE").write_text(f"{slug}\nCC BY 4.0, Roboflow Universe\n{why}\n")
    print(f"got {slug}: {zpath.stat().st_size / 1e6:.0f} MB, {sum(1 for _ in dest.rglob('*.jpg'))} images, total {total / 1e6:.0f} MB", flush=True)
print("roboflow: done", flush=True)
