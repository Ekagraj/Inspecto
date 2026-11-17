"""Before / after comparison for condition reports: which problems in the move-out photo were
already in the move-in photo of the same wall?

The two photos are never framed identically, so they are first lined up from their shared
detail (ORB features + a RANSAC homography). A textured or marked wall lines up well; a plain
painted wall often has too little detail, and then only a rough same-place guess is possible.
Every answer says how it was reached, so the page can ask a person to confirm the weak ones.

Self-check: uv run python -m server.compare
"""
import numpy as np

try:  # OpenCV arrives with rfdetr; the fallback below still works without it
    import cv2
except ImportError:
    cv2 = None

SIDE = 960  # photos are compared at this size


def _gray(image):
    g = np.asarray(image.convert("L"))
    k = SIDE / max(g.shape)
    return cv2.resize(g, (round(g.shape[1] * k), round(g.shape[0] * k)), interpolation=cv2.INTER_AREA) if k < 1 else g


def align(before, after):
    """-> 3x3 matrix taking a point of the after photo (0..1) to the before photo (0..1), or None."""
    if cv2 is None:
        return None
    a, b = _gray(after), _gray(before)
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 40 or len(kb) < 40:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db, k=2)
    good = [m for m, *rest in pairs if rest and m.distance < 0.75 * rest[0].distance]
    if len(good) < 30:
        return None
    src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    h, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if h is None or mask.sum() < 25 or mask.sum() < 0.3 * len(good):
        return None
    to_px = lambda g: np.diag([g.shape[1], g.shape[0], 1.0])
    m = np.linalg.inv(to_px(b)) @ h @ to_px(a)
    # A believable match keeps the photo a sensible, unflipped shape.
    quad = _points(m, [[0, 0], [1, 0], [1, 1], [0, 1]])
    area = 0.5 * sum(quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1] for i in range(4))
    return m if 0.15 < area < 6 else None


def _points(m, pts):
    p = np.c_[np.asarray(pts, float), np.ones(len(pts))] @ m.T
    return (p[:, :2] / p[:, 2:3]).tolist()


def _map_box(m, box):
    x1, y1, x2, y2 = box
    q = _points(m, [[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return [min(p[0] for p in q), min(p[1] for p in q), max(p[0] for p in q), max(p[1] for p in q)]


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _shared(a, b):
    """How much of the smaller box lies inside the other (0..1). Kinder than IoU to boxes of different size."""
    inter = _area([max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])])
    return inter / max(1e-9, min(_area(a), _area(b)))


def compare(before_image, before_dets, after_image, after_dets):
    """-> {"aligned": bool, "results": one per after detection, in order:
            {"status": "existing" | "new", "sure": bool, "match": index into before_dets or None, "why": str}}"""
    m = align(before_image, after_image)
    results = []
    for d in after_dets:
        if m is not None:
            box = _map_box(m, d["box"])
            score, i = max(((_shared(box, b["box"]), i) for i, b in enumerate(before_dets)), default=(0.0, None))
            in_view = _area([max(box[0], 0), max(box[1], 0), min(box[2], 1), min(box[3], 1)]) / max(1e-9, _area(box))
            if score >= 0.5 and _area(box) >= 3 * _area(before_dets[i]["box"]):
                # A big new stain around an old nail hole must not pass as "already there".
                results.append({"status": "new", "sure": False, "match": i, "why": "A problem was already here at move-in, but it is now much larger. Check whether it has grown or something new has happened."})
            elif score >= 0.5:
                results.append({"status": "existing", "sure": True, "match": i, "why": "Same spot as a problem in the move-in photo."})
            elif in_view < 0.5:
                results.append({"status": "new", "sure": False, "match": None, "why": "This part of the wall is outside the move-in photo, so it cannot be compared."})
            else:
                results.append({"status": "new", "sure": True, "match": None, "why": "The move-in photo shows this spot without a problem."})
            continue
        # Photos could not be lined up: guess from the same kind of problem in a similar place and size.
        cx, cy = (d["box"][0] + d["box"][2]) / 2, (d["box"][1] + d["box"][3]) / 2
        near = [i for i, b in enumerate(before_dets)
                if b["label"] == d["label"] and abs((b["box"][0] + b["box"][2]) / 2 - cx) < 0.25 and abs((b["box"][1] + b["box"][3]) / 2 - cy) < 0.25
                and 1 / 3 < _area(b["box"]) / max(1e-9, _area(d["box"])) < 3]
        if near:
            results.append({"status": "existing", "sure": False, "match": near[0], "why": "A similar problem is in a similar place in the move-in photo. The photos could not be lined up, so please check."})
        else:
            results.append({"status": "new", "sure": False, "match": None, "why": "Nothing similar in the move-in photo. The photos could not be lined up, so please check."})
    return {"aligned": m is not None, "results": results}


def _selfcheck():
    """A real textured wall re-photographed from a shifted angle with one new mark, then a plain wall."""
    import pathlib
    from PIL import Image, ImageDraw
    photo = next((pathlib.Path(__file__).parent.parent / "data" / "test").glob("peeling_paint-*.jpg"))
    before = Image.open(photo).convert("RGB").resize((1000, 750))
    old = {"label": "peeling_paint", "score": 0.9, "box": [0.30, 0.30, 0.55, 0.60]}

    w, h = before.size
    warp = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), np.float32([[40, 25], [w - 70, 5], [w - 20, h - 30], [15, h - 60]]))
    shot = cv2.convertScaleAbs(cv2.warpPerspective(np.asarray(before), warp, (w, h), borderMode=cv2.BORDER_REFLECT), alpha=0.9, beta=12)
    after = Image.fromarray(shot)
    ImageDraw.Draw(after).ellipse([760, 520, 860, 600], fill=(40, 30, 25))  # the new damage
    to_after = np.diag([1 / w, 1 / h, 1]) @ warp @ np.diag([w, h, 1])
    same = {"label": "water_seepage", "score": 0.6, "box": _map_box(to_after, old["box"])}  # the detector may rename it
    new = {"label": "hole", "score": 0.8, "box": [0.76, 0.69, 0.86, 0.80]}

    r = compare(before, [old], after, [same, new])
    assert r["aligned"], "a textured wall must line up"
    assert (r["results"][0]["status"], r["results"][0]["sure"], r["results"][0]["match"]) == ("existing", True, 0), r["results"][0]
    assert (r["results"][1]["status"], r["results"][1]["sure"]) == ("new", True), r["results"][1]
    assert compare(before, [], after, [same])["results"][0]["status"] == "new", "no move-in problem there means new"
    tiny = {"label": "hole", "score": 0.9, "box": [0.41, 0.43, 0.45, 0.47]}
    grown = compare(before, [tiny], after, [same])["results"][0]
    assert (grown["status"], grown["sure"], grown["match"]) == ("new", False, 0), "a much larger problem over a small old one is new, and a person must look"

    plain = Image.new("RGB", (800, 600), (236, 232, 222))
    r = compare(plain, [old], plain, [{**old, "box": [0.33, 0.28, 0.60, 0.62]}, new])
    assert not r["aligned"], "a plain wall cannot be lined up"
    assert [(x["status"], x["sure"]) for x in r["results"]] == [("existing", False), ("new", False)], r["results"]
    unrelated = Image.open(next((pathlib.Path(__file__).parent.parent / "data" / "test").glob("istockphoto-1215728829*.jpg")))
    assert not compare(before, [old], unrelated, [new])["aligned"], "two different walls must not line up"
    print("compare: self-check passed")


if __name__ == "__main__":
    _selfcheck()
