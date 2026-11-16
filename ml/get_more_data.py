"""Collect extra real photos for the thin classes into data/extra/. Downloads only; no training.

  uv run ml/get_more_data.py

Wikimedia Commons photos of peeling paint and mold. Only CC0, public domain and CC BY files
are kept (CC BY-SA is share-alike, so it is listed in skipped.csv and not downloaded). These
have a class per image but NO boxes yet: see step 5d in NEXT_STEPS.md. Every kept file is
credited in attribution.csv (CC BY requires it). Safe to re-run: existing files are skipped.

Tried and dropped: the Hugging Face mirror of Roboflow "Paint Defects". It is street views of
whole buildings (graffiti, tiny marks), some from Street View and stock sites, so neither the
content nor the licence claim fits.
"""
import csv, html, json, pathlib, re, time, urllib.error, urllib.parse, urllib.request

OUT = pathlib.Path(__file__).parent.parent / "data" / "extra"
UA = {"User-Agent": "InspectoDatasetBuilder/0.1 (local research script)"}
# Commons category -> our class. Subcategories one level down are included.
# "Water damage" was tried and dropped: its subcategories are mostly ships and floods.
CATEGORIES = {"Peeling paint": "peeling_paint", "Peeling paint in Ukraine": "peeling_paint", "Mold on buildings": "mold"}
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


def commons_api(**params):
    time.sleep(1.5)
    q = urllib.parse.urlencode({"action": "query", "format": "json", **params})
    return json.loads(get("https://commons.wikimedia.org/w/api.php?" + q))


def commons_files(cat):
    """Every file page in a category, 50 at a time (the API pages its answers)."""
    more = {}
    while more is not None:
        r = commons_api(generator="categorymembers", gcmtitle=cat, gcmtype="file", gcmlimit=50,
                        prop="imageinfo", iiprop="url|mime|extmetadata", iiurlwidth=960, **more)
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
                    time.sleep(2.0)  # Wikimedia throttles faster downloads
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
    print("extra data: done", flush=True)
