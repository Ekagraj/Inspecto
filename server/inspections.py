"""Condition-report inspections (move-in / move-out), kept as plain files:
data/inspections/<id>/inspection.json + one JPEG per photo. Nothing leaves the laptop.

A move-out inspection names a move-in one as its `baseline`. A move-out photo can name the
move-in photo it retakes (`pair`); its problems are then marked existing / new by compare.py.
Dates are stamped here, by the server clock, not taken from the phone or the page.

Self-check: uv run python -m server.inspections
"""
import base64, io, json, pathlib, re, time, uuid
from PIL import Image, ImageOps

from .compare import compare

ROOT = pathlib.Path(__file__).parent.parent / "data" / "inspections"
ID = re.compile(r"^[0-9a-f]{12}$")
KINDS = ("move-in", "move-out")


class Refused(ValueError):
    """Bad input from the page; the API turns it into a 400."""


def _dir(root, ident):
    if not ID.match(ident or ""):  # ids become folder names: never trust them
        raise Refused("unknown id")
    return root / ident


def load(ident, root=ROOT):
    path = _dir(root, ident) / "inspection.json"
    if not path.exists():
        raise Refused("no such inspection")
    return json.loads(path.read_text())


def _save(doc, root):
    path = _dir(root, doc["id"]) / "inspection.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, indent=1))
    tmp.replace(path)  # never leave a half-written record
    return doc


def listing(root=ROOT):
    docs = [json.loads(p.read_text()) for p in sorted(root.glob("*/inspection.json"))] if root.exists() else []
    return [{k: d[k] for k in ("id", "name", "kind", "baseline", "created")} | {"photos": len(d["photos"])} for d in sorted(docs, key=lambda d: d["created"], reverse=True)]


def create(name, kind, baseline=None, root=ROOT):
    name = (name or "").strip()
    if not name or len(name) > 80 or kind not in KINDS:
        raise Refused("an inspection needs a name and a kind (move-in or move-out)")
    if kind == "move-out":
        if load(baseline, root)["kind"] != "move-in":
            raise Refused("a move-out inspection is compared against a move-in one")
    elif baseline:
        raise Refused("only a move-out inspection has a baseline")
    return _save({"id": uuid.uuid4().hex[:12], "name": name, "kind": kind, "baseline": baseline, "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "photos": []}, root)


def merge_boxes(dets):
    """The detector often boxes one stain several times; overlapping boxes of one type are one problem.
    Same rule as merge() in web/src/photo.js."""
    area = lambda b: max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    out = []
    for d in sorted(dets, key=lambda d: -area(d["box"])):
        big = next((o for o in out if o["label"] == d["label"] and area([max(o["box"][0], d["box"][0]), max(o["box"][1], d["box"][1]),
                                                                        min(o["box"][2], d["box"][2]), min(o["box"][3], d["box"][3])]) > 0.5 * area(d["box"])), None)
        if big is None:
            out.append({**d, "box": list(d["box"])})
            continue
        big["box"] = [min(big["box"][0], d["box"][0]), min(big["box"][1], d["box"][1]), max(big["box"][2], d["box"][2]), max(big["box"][3], d["box"][3])]
        big["score"] = max(big["score"], d["score"])
    return out


def photo_path(ident, photo_id, root=ROOT):
    path = _dir(root, ident) / f"{photo_id}.jpg"
    if not ID.match(photo_id or "") or not path.exists():
        raise Refused("no such photo")
    return path


def add_photo(ident, room, image_data_url, predict, width_m=1.0, pair=None, root=ROOT):
    """Save one photo, find its problems, and (move-out, paired) say which are new. `predict`: PIL image -> detections."""
    doc = load(ident, root)
    room = (room or "").strip()
    if not room or len(room) > 40:
        raise Refused("a photo needs a room name")
    if not 0.2 <= float(width_m) <= 10:
        raise Refused("width must be between 0.2 and 10 metres")
    try:
        image = Image.open(io.BytesIO(base64.b64decode(image_data_url.split(",", 1)[-1])))
        image = ImageOps.exif_transpose(image).convert("RGB")  # phone photos carry their rotation as a tag
    except Exception:
        raise Refused("image must be a base64 data URL")
    image.thumbnail((1600, 1600))
    photo = {"id": uuid.uuid4().hex[:12], "room": room, "addedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "widthM": float(width_m),
             "aspect": image.width / image.height, "pair": None, "aligned": None, "detections": merge_boxes(predict(image))}
    if pair:
        if not doc["baseline"]:
            raise Refused("only a move-out photo can be paired with a move-in photo")
        before = next((p for p in load(doc["baseline"], root)["photos"] if p["id"] == pair), None)
        if before is None:
            raise Refused("the paired move-in photo does not exist")
        result = compare(Image.open(photo_path(doc["baseline"], pair, root)), before["detections"], image, photo["detections"])
        photo["pair"], photo["aligned"] = pair, result["aligned"]
        for d, r in zip(photo["detections"], result["results"]):
            d.update(r)
    elif doc["baseline"]:  # a move-out photo of a wall nobody photographed at move-in
        for d in photo["detections"]:
            d.update({"status": "new", "sure": False, "match": None, "why": "There is no move-in photo of this wall to compare with."})
    image.save(_dir(root, ident) / f"{photo['id']}.jpg", "JPEG", quality=88)
    doc["photos"].append(photo)
    _save(doc, root)
    return photo


def correct(ident, photo_id, changes, root=ROOT):
    """A person's corrections win over the model: {"widthM"?, "detections"?: {index: {"label"?, "status"?, "removed"?}}}"""
    doc = load(ident, root)
    photo = next((p for p in doc["photos"] if p["id"] == photo_id), None)
    if photo is None:
        raise Refused("no such photo")
    if "widthM" in changes:
        if not 0.2 <= float(changes["widthM"]) <= 10:
            raise Refused("width must be between 0.2 and 10 metres")
        photo["widthM"] = float(changes["widthM"])
    for index, change in (changes.get("detections") or {}).items():
        if not str(index).isdigit() or int(index) >= len(photo["detections"]):
            raise Refused("no such problem in this photo")
        d = photo["detections"][int(index)]
        if "label" in change:
            if not re.fullmatch(r"[a-z_]{2,30}", str(change["label"])):
                raise Refused("unknown problem type")
            d.update({"label": change["label"], "corrected": True})  # corrected photos are future training data
        if "status" in change:
            if change["status"] not in ("new", "existing"):
                raise Refused("status is new or existing")
            d.update({"status": change["status"], "sure": True, "why": "Confirmed by a person."})
        if "removed" in change:
            d["removed"] = bool(change["removed"])  # kept in the record, left out of totals
    _save(doc, root)
    return photo


def _selfcheck():
    import tempfile
    root = pathlib.Path(tempfile.mkdtemp())
    wall = next((pathlib.Path(__file__).parent.parent / "data" / "test").glob("peeling_paint-*.jpg"))
    buf = io.BytesIO()
    Image.open(wall).convert("RGB").resize((1000, 750)).save(buf, "JPEG")
    url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    old = {"label": "peeling_paint", "score": 0.9, "box": [0.30, 0.30, 0.55, 0.60]}
    hole = {"label": "hole", "score": 0.8, "box": [0.70, 0.70, 0.80, 0.80]}

    move_in = create("Flat 2B", "move-in", root=root)
    first = add_photo(move_in["id"], "Living room", url, lambda im: [old, {**old, "score": 0.5, "box": [0.32, 0.32, 0.5, 0.5]}], root=root)
    assert len(first["detections"]) == 1 and "status" not in first["detections"][0], "duplicates merge; move-in photos have no status"
    move_out = create("Flat 2B", "move-out", baseline=move_in["id"], root=root)
    second = add_photo(move_out["id"], "Living room", url, lambda im: [old, hole], pair=first["id"], root=root)
    assert second["aligned"] and [d["status"] for d in second["detections"]] == ["existing", "new"], second
    loose = add_photo(move_out["id"], "Hall", url, lambda im: [hole], root=root)
    assert (loose["detections"][0]["status"], loose["detections"][0]["sure"]) == ("new", False), "no move-in photo: new, but unsure"
    fixed = correct(move_out["id"], second["id"], {"widthM": 2, "detections": {"1": {"label": "scuff", "status": "existing"}}}, root=root)
    assert fixed["widthM"] == 2 and fixed["detections"][1]["label"] == "scuff" and fixed["detections"][1]["corrected"] and fixed["detections"][1]["sure"]
    assert load(move_out["id"], root)["photos"][0]["detections"][1]["status"] == "existing", "corrections are saved"
    assert {d["kind"]: d["photos"] for d in listing(root)} == {"move-out": 2, "move-in": 1}  # same-second order is arbitrary
    assert photo_path(move_out["id"], second["id"], root).stat().st_size > 10000
    for bad in (lambda: load("../../etc", root), lambda: create("x", "move-out", baseline=move_out["id"], root=root), lambda: create("", "move-in", root=root),
                lambda: add_photo(move_in["id"], "Hall", "not an image", lambda im: [], root=root), lambda: add_photo(move_in["id"], "Hall", url, lambda im: [], pair=first["id"], root=root),
                lambda: photo_path(move_in["id"], "../inspection", root), lambda: correct(move_out["id"], second["id"], {"detections": {"9": {"status": "new"}}}, root=root)):
        try:
            bad()
        except Refused:
            continue
        raise AssertionError("bad input was accepted")
    print("inspections: self-check passed")


if __name__ == "__main__":
    _selfcheck()
