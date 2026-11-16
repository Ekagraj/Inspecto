"""Collect extra real photos for the thin classes into data/extra/. Downloads only; no training.

  uv run ml/get_more_data.py

1. paint_defects: Roboflow "Paint Defects" (CC BY 4.0), mirrored on Hugging Face, COCO boxes.
2. commons: Wikimedia Commons photos of peeling paint, mold and water damage. Only CC0, public
   domain and CC BY files are kept (CC BY-SA is share-alike, so it is listed in skipped.csv and
   not downloaded). These have a class per image but NO boxes yet: see ml/label_extra.py notes
   in NEXT_STEPS.md. Every kept file is credited in attribution.csv (CC BY requires it).
"""
import csv, html, json, pathlib, re, time, urllib.error, urllib.parse, urllib.request

OUT = pathlib.Path(__file__).parent.parent / "data" / "extra"
UA = {"User-Agent": "InspectoDatasetBuilder/0.1 (local research script)"}
HF = "https://huggingface.co/datasets/imaadd05/paint-defects-roboflow-main/resolve/main/"
HF_API = "https://huggingface.co/api/datasets/imaadd05/paint-defects-roboflow-main/tree/main/"
# Commons category -> our class. Subcategories one level down are included.
CATEGORIES = {"Peeling paint": "peeling_paint", "Peeling paint in Ukraine": "peeling_paint",
              "Mold on buildings": "mold", "Water damage": "water_seepage"}
PERMISSIVE = re.compile(r"^(cc0|public domain|pd\b|cc by \d|cc-by-\d)", re.I)


def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or i == tries - 1:
                raise
            time.sleep(10 * (i + 1))  # be polite when throttled


def paint_defects():
    for split in ("train", "valid", "test"):
        d = OUT / "paint_defects" / split
        d.mkdir(parents=True, exist_ok=True)
        files = json.loads(get(HF_API + split + "?limit=1000"))
        for f in files:
            name = f["path"].split("/")[-1]
            if not (d / name).exists():
                (d / name).write_bytes(get(HF + urllib.parse.quote(f["path"])))
        print("paint_defects", split, len(files) - 1, "images", flush=True)


def commons_api(**params):
    time.sleep(1.5)
    q = urllib.parse.urlencode({"action": "query", "format": "json", **params})
    return json.loads(get("https://commons.wikimedia.org/w/api.php?" + q))


def commons_files(cat):
    """Every file page in a category, 50 at a time (the API pages its answers)."""
    more = {}
    while more is not None:
        r = commons_api(generator="categorymembers", gcmtitle=cat, gcmtype="file", gcmlimit=50,
                        prop="imageinfo", iiprop="url|mime|extmetadata", iiurlwidth=1280, **more)
        yield from r.get("query", {}).get("pages", {}).values()
        more = r.get("continue")


def commons():
    root = OUT / "commons"
    root.mkdir(parents=True, exist_ok=True)
    kept, skipped, seen = [], [], set()
    for top, label in CATEGORIES.items():
        subs = [m["title"] for m in commons_api(list="categorymembers", cmtitle="Category:" + top, cmtype="subcat", cmlimit=50).get("query", {}).get("categorymembers", [])]
        for cat in ["Category:" + top, *subs]:
            for p in commons_files(cat):
                info = (p.get("imageinfo") or [{}])[0]
                meta = {k: html.unescape(re.sub(r"<[^>]+>", "", str(v.get("value", "")))).strip() for k, v in info.get("extmetadata", {}).items()}
                if p["pageid"] in seen or info.get("mime") != "image/jpeg":
                    continue
                seen.add(p["pageid"])
                row = {"file": f"{label}/{p['pageid']}.jpg", "class": label, "category": cat, "title": p["title"], "author": meta.get("Artist", "")[:200],
                       "license": meta.get("LicenseShortName", ""), "license_url": meta.get("LicenseUrl", ""), "source": info.get("descriptionurl", "")}
                if not PERMISSIVE.match(row["license"]):
                    skipped.append(row)
                    continue
                dest = root / row["file"]
                dest.parent.mkdir(exist_ok=True)
                if not dest.exists():
                    time.sleep(1.0)
                    try:
                        dest.write_bytes(get(info.get("thumburl") or info["url"]))
                    except Exception as e:  # one bad file must not stop the run
                        print("  failed", p["title"], e, flush=True)
                        continue
                kept.append(row)
            print("commons", cat, "kept so far", len(kept), "skipped (share-alike or unclear)", len(skipped), flush=True)
    for name, rows in (("attribution.csv", kept), ("skipped.csv", skipped)):
        with open(root / name, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["file", "class", "category", "title", "author", "license", "license_url", "source"])
            w.writeheader()
            w.writerows(rows)
    print("commons done:", len(kept), "kept,", len(skipped), "skipped", flush=True)


if __name__ == "__main__":
    commons()
    paint_defects()
    print("extra data: done", flush=True)
