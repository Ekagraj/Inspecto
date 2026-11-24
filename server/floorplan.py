"""Read a floor plan image (listing-style: thick black walls, lengths written in feet and inches)
into a home shell: wall outlines, door and window openings, room names, all in metres.
No AI: OpenCV for the drawing, Tesseract (brew install tesseract) for the written lengths.
Self-check: uv run python -m server.floorplan [plan.png ...]
"""
import re, shutil, subprocess

import cv2
import numpy as np

MAX_OPENING_M = 3.2  # widest gap in a wall still read as one door or window
MIN_OPENING_M = 0.5  # narrower gaps are drawing noise, not doors
MAX_DOOR_M = 1.9  # an empty gap wider than this is open floor, not a doorway (windows may be wider)


def wall_mask(gray):
    """Thick dark strokes only: walls survive, text, arcs, stairs and furniture outlines do not."""
    dark = (gray < 90).astype(np.uint8)
    mask = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    h, w = gray.shape
    keep = [i for i in range(1, n) if stats[i, 0] > 0 and stats[i, 1] > 0 and  # page frame touches the edge
            stats[i, 0] + stats[i, 2] < w and stats[i, 1] + stats[i, 3] < h]
    if not keep:
        return np.zeros_like(mask)
    big = max(stats[i, 4] for i in keep)
    main = [i for i in keep if stats[i, 4] >= 0.1 * big]  # doors split the walls into several large pieces
    x, y = min(stats[i, 0] for i in main), min(stats[i, 1] for i in main)
    bw = max(stats[i, 0] + stats[i, 2] for i in main) - x
    bh = max(stats[i, 1] + stats[i, 3] for i in main) - y
    pad = 0.05 * max(bw, bh)  # wall stubs near the building, not the scale bar or the legend
    keep = [i for i in keep if stats[i, 0] >= x - pad and stats[i, 1] >= y - pad and
            stats[i, 0] + stats[i, 2] <= x + bw + pad and stats[i, 1] + stats[i, 3] <= y + bh + pad]
    return np.isin(lab, keep).astype(np.uint8)


def wall_thickness(mask):
    """Thickest wall in pixels (the exterior walls)."""
    d = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
    return float(np.percentile(d[d > 0], 95) * 2) if d.any() else 0.0  # 95th: corners make blobs thicker than any wall


def wall_run_lengths(mask):
    """For every wall pixel, how long its run of wall is along the row (axis 1) -> int array."""
    out = np.zeros(mask.shape, np.int32)
    for i, row in enumerate(mask.astype(bool)):
        for a, b in runs(row):
            out[i, a:b] = b - a
    return out


def gap_runs(mask, thick, min_px, max_px):
    """Vertical gaps: in each column, the empty stretch between two pieces of wall, kept when it is
    door- or window-long and at least one side is a wall running the same way (narrow across, not a
    perpendicular wall seen side-on; a door beside a corner has one end of each) -> [(x, y0, y1)]."""
    width = wall_run_lengths(mask)
    found = []
    for x in range(mask.shape[1]):
        walls = runs(mask[:, x].astype(bool))
        for (a1, b1), (a2, b2) in zip(walls, walls[1:]):
            if not min_px <= a2 - b1 <= max_px:
                continue
            above = b1 - a1 >= 6 and width[b1 - 6, x] <= 1.5 * thick
            below = b2 - a2 >= 6 and width[a2 + 5, x] <= 1.5 * thick
            if above or below:
                found.append((x, int(b1), int(a2)))
    return found


def group_gaps(gaps):
    """Column gaps side by side with the same ends (within 3 px) are one opening -> [(x0, x1, y0, y1)]."""
    groups = []
    for x, y0, y1 in sorted(gaps):
        for g in groups:
            if g[1] == x and abs(g[2] - y0) <= 3 and abs(g[3] - y1) <= 3:
                g[1] = x + 1
                break
        else:
            groups.append([x, x + 1, y0, y1])
    return groups


def openings(mask, gray, mpp):
    """Gaps in the walls -> [{x0, y0, x1, y1, horizontal, kind}] in pixels. kind 'window' when thin lines are
    drawn across the gap (windows and sliding glass doors), else 'door' (a door, or an open doorway)."""
    thick = wall_thickness(mask)
    found = []
    for horizontal in (False, True):
        m = mask.T.copy() if horizontal else mask
        for a0, a1, b0, b1 in group_gaps(gap_runs(m, thick, MIN_OPENING_M / mpp, MAX_OPENING_M / mpp)):
            across, along = a1 - a0, b1 - b0
            if not 0.3 * thick <= across <= 1.3 * thick:
                continue  # a sliver beside a wall, or wider than any wall
            x0, x1, y0, y1 = (b0, b1, a0, a1) if horizontal else (a0, a1, b0, b1)
            # a window's lines run the whole gap along the wall, inside it; a door's swing only touches part of
            # it, and a line along the wall's face (stairs, a counter) sits on the gap's edge, not inside
            band = (gray[y0 + 1:y1 - 1, x0:x1] if horizontal else gray[y0:y1, x0 + 1:x1 - 1]) < 200
            window = bool(band.size) and (band.mean(axis=1) if horizontal else band.mean(axis=0)).max() > 0.8
            if not window and along > MAX_DOOR_M / mpp:
                continue  # nothing drawn and wider than any doorway: open floor between two walls
            found.append({"x0": int(x0), "y0": int(y0), "x1": int(x1), "y1": int(y1),
                          "horizontal": horizontal, "kind": "window" if window else "door"})
    return found


FT_IN = re.compile(r"(\d{1,2})['’′]\s*(?:(\d{1,2})(?![\d/]))?\s*(\d/\d)?")  # inches never eat a fraction's numerator


def parse_length(text):
    """'18' 1/4"' -> metres, or None. Feet must be written; inches and a fraction are optional."""
    m = FT_IN.search(text.replace(" ", " "))
    if not m:
        return None
    feet, inches, frac = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if inches >= 12:
        return None
    if frac:
        a, b = frac.split("/")
        inches += int(a) / int(b) if int(b) else 0
    return (feet * 12 + inches) * 0.0254


def tesseract(img, psm, extra=()):
    """Run the Tesseract command line on a grayscale image -> its TSV or text output."""
    if not shutil.which("tesseract"):
        raise RuntimeError("Tesseract is not installed: brew install tesseract")
    ok, png = cv2.imencode(".png", img)
    return subprocess.run(["tesseract", "stdin", "stdout", "--psm", str(psm), *extra],
                          input=png.tobytes(), capture_output=True, timeout=60).stdout.decode()


def read_words(gray):
    """Horizontal text lines on the plan (room names and sizes) -> [(text, x0, y0, x1, y1)]."""
    big = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)  # small listing text reads better
    lines = {}
    for row in tesseract(big, 11, ["tsv"]).splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or not c[11].strip() or float(c[10]) < 30:
            continue
        key = (c[2], c[3], c[4])  # block, paragraph, line: join the words of one label
        x, y, w, h = (int(v) / 2 for v in c[6:10])
        t, x0, y0, x1, y1 = lines.get(key, ("", 1e9, 1e9, -1, -1))
        lines[key] = ((t + " " + c[11]).strip(), min(x0, x), min(y0, y), max(x1, x + w), max(y1, y + h))
    return [(t.replace("°", "'"), *box) for t, *box in lines.values()]


def runs(flags, min_len=1):
    """[(start, end)] of consecutive True values at least min_len long."""
    d = np.diff(np.concatenate(([0], flags.astype(np.int8), [0])))
    return [(a, b) for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]) if b - a >= min_len]


def read_label(crop):
    """A small picture of one written length -> its text, e.g. 10' 2 1/2", or '' when unsure. Read three ways
    (greyscale at two sizes, black and white); each way misreads different digits (a 5 as 0 or 9), so a length
    is kept only when two readings agree."""
    reads = []
    for height, bw in ((100, False), (60, False), (100, True)):
        big = cv2.resize(crop, None, fx=height / crop.shape[0], fy=height / crop.shape[0], interpolation=cv2.INTER_CUBIC)
        if bw:
            big = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        big = cv2.copyMakeBorder(big, 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255)
        text = tesseract(big, 7, ["-c", "tessedit_char_whitelist=0123456789'\"/ °"]).strip().replace("°", "'")
        m = parse_length(text)
        if m:
            reads.append((m, text))
    for m, text in reads:
        if sum(abs(m - o) < 0.005 for o, _ in reads) >= 2:
            return text
    return ""


def dimensions(gray, wall):
    """Horizontal dimensions '|--- 10' 2 1/2" ---|' -> [(length in pixels, text)]. Each end is marked by a
    thin extension line running off towards the wall; the text sits in the one gap of the line between.
    Turn the plan a quarter (clockwise) to read the vertical ones."""
    thin = ((gray < 215) & (wall == 0)).astype(np.uint8)  # dimension lines can be light grey
    line = cv2.morphologyEx(thin, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1)))
    found = []
    for y0, y1 in runs(line.sum(axis=1) > 40):
        y = (y0 + y1) // 2
        if y < 14 or y > gray.shape[0] - 14:
            continue
        on = cv2.dilate(line[y - 1:y + 2].max(axis=0)[None], np.ones((1, 5), np.uint8))[0] > 0
        ext = (thin[y + 3:y + 13].sum(axis=0) >= 6) | (thin[y - 12:y - 2].sum(axis=0) >= 6)
        marks = [(a + b) // 2 for a, b in runs(on & ext)]
        if len(marks) < 2:
            continue
        for g0, g1 in runs(~on[marks[0]:marks[-1]], 12):
            g0, g1 = g0 + marks[0], g1 + marks[0]
            c = (g0 + g1) / 2
            # the label sits in the middle of its line: take the nearest pair of ends that centres it,
            # skipping marks made by whatever crosses the line (a door's swing, another extension line)
            pairs = [(a, b) for a in marks if a < g0 for b in marks if b > g1
                     if abs(c - (a + b) / 2) <= 0.03 * (b - a) + 3 and on[a:b].sum() >= 0.5 * (b - a - (g1 - g0))]
            if not pairs:
                continue
            a, b = min(pairs, key=lambda p: p[1] - p[0])
            half = max(11, int(0.2 * (g1 - g0)))  # label height follows its width
            crop = gray[max(y - half, 0):y + half + 1, max(g0 - 2, 0):g1 + 2]
            found.append((int(b - a), read_label(crop)))
    return found


def scale(gray, wall):
    """Metres per pixel from the written lengths -> (metres per pixel or None, how many lengths agree
    within 3%, how many were read). One misread length must not win: each reading is checked against
    the drawing (walls 8 to 50 cm thick, a home 2.5 to 60 m across) and the one most others agree with is kept."""
    found = []
    for img, w in ((gray, wall), (cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE), cv2.rotate(wall, cv2.ROTATE_90_CLOCKWISE))):
        for px, text in dimensions(img, w):
            m = parse_length(text)
            if m and m > 0.3:
                found.append(m / px)
    thick = wall_thickness(wall)
    ys, xs = np.nonzero(wall)
    span = (min(np.ptp(xs), np.ptp(ys)), max(np.ptp(xs), np.ptp(ys))) if len(xs) else (0, 0)
    sane = [f for f in found if 0.08 <= thick * f <= 0.5 and span[0] * f >= 2.5 and span[1] * f <= 60]
    if not sane:
        return None, 0, len(found)
    agree = lambda s: [f for f in sane if abs(f - s) / s < 0.03]
    best = max(sane, key=lambda s: (len(agree(s)), -abs(s - np.median(sane))))
    s = float(np.median(agree(best)))
    return s, len(agree(s)), len(found)


def rooms(words):
    """Room labels: a name line followed by a size line ('Bedroom' / '17' 2" x 12' 1"')."""
    sizes = [w for w in words if ("x" in w[0].lower() or "×" in w[0]) and FT_IN.search(w[0])]
    out = []
    for s in sizes:
        above = [w for w in words if w is not s and 0 < s[2] - w[4] < 2 * (s[4] - s[2])
                 and abs((w[1] + w[3]) / 2 - (s[1] + s[3]) / 2) < (s[3] - s[1])]
        name = min(above, key=lambda w: s[2] - w[4])[0] if above else "Room"
        parts = re.split(r"\s*[x×]\s*", s[0], maxsplit=1)
        dims = [parse_length(p) for p in parts] if len(parts) == 2 else []
        out.append({"name": name, "size": dims if all(dims) and dims else None,
                    "at": [(s[1] + s[3]) / 2, s[2]]})
    return out


def rectangles(mask, tol=1):
    """Wall pixels as axis-aligned rectangles [(x0, y0, x1, y1)]: each row's runs, stacked while they keep
    the same ends. shortcut: a slanted wall becomes a staircase of thin boxes; fit lines if plans have them."""
    out, open_ = [], {}  # first row's (a, b) -> start row
    for y, row in enumerate(mask.astype(bool)):
        nxt = {}
        for a, b in runs(row):
            key = next((k for k in open_ if abs(k[0] - a) <= tol and abs(k[1] - b) <= tol), None)
            nxt[key or (a, b)] = open_.pop(key) if key else y
        out += [(a, y0, b, y) for (a, b), y0 in open_.items()]
        open_ = nxt
    out += [(a, y0, b, mask.shape[0]) for (a, b), y0 in open_.items()]
    return [tuple(int(v) for v in r) for r in out]


def stairs(gray, mask, mpp):
    """Stairs: five or more evenly spaced parallel lines of the same length (the treads)
    -> [(x0, y0, x1, y1, climbs_along_x)] in pixels. A flight climbs along its long side (plans differ in
    how they draw treads). Which end is up is not read (the arrow is ignored)."""
    thin = ((gray < 200) & (mask == 0)).astype(np.uint8)
    found = []
    for along_x in (False, True):  # treads drawn across x climb along y, and the other way round
        img = thin.T.copy() if along_x else thin
        tread = cv2.morphologyEx(img, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(int(0.6 / mpp), 3), 1)))
        lines = []  # (row, a, b) one per drawn line
        for r0, r1 in runs(tread.any(axis=1)):
            for a, b in runs(tread[r0:r1].any(axis=0)):
                lines.append(((r0 + r1) // 2, a, b))
        lines.sort()
        used = set()
        for i, (y, a, b) in enumerate(lines):
            if i in used:
                continue
            stack = [i]
            for j in range(i + 1, len(lines)):
                yj, aj, bj = lines[j]
                last = lines[stack[-1]][0]
                if abs(aj - a) <= 4 and abs(bj - b) <= 4 and 0.08 / mpp <= yj - last <= 0.4 / mpp:
                    if len(stack) < 2 or abs((yj - last) - (lines[stack[1]][0] - y)) <= 0.3 * (lines[stack[1]][0] - y):
                        stack.append(j)
            if len(stack) >= 5:
                used.update(stack)
                y0, y1 = y, lines[stack[-1]][0]
                x0, y0, x1, y1 = (int(v) for v in ((y0, a, y1, b) if along_x else (a, y0, b, y1)))
                overlap = lambda f: max(0, min(x1, f[2]) - max(x0, f[0])) * max(0, min(y1, f[3]) - max(y0, f[1]))
                if not any(overlap(f) > 0.5 * (x1 - x0) * (y1 - y0) for f in found):  # one flight seen twice
                    found.append((x0, y0, x1, y1, x1 - x0 > y1 - y0))
    return found


def read_plan(gray, words=None, mpp=None):
    """Grayscale plan -> shell in metres, x east, z south, origin at the plan's top-left wall corner.
    words and mpp (metres per pixel) are read from the plan unless given."""
    mask = wall_mask(gray)
    words = read_words(gray) if words is None else words
    agree = read = 0
    if mpp is None:
        mpp, agree, read = scale(gray, mask)
    if not mpp:
        raise ValueError("No written lengths could be read on this plan")
    ys, xs = np.nonzero(mask)
    ox, oy = int(xs.min()), int(ys.min())
    m = lambda pts: [[round((x - ox) * mpp, 3), round((y - oy) * mpp, 3)] for x, y in pts]
    gaps = openings(mask, gray, mpp)
    box = lambda x0, y0, x1, y1: [round((x0 - ox) * mpp, 3), round((y0 - oy) * mpp, 3), round((x1 - ox) * mpp, 3), round((y1 - oy) * mpp, 3)]
    return {
        "metresPerPixel": mpp, "lengthsRead": read, "lengthsAgreeing": agree, "origin": [ox, oy],
        "walls": [box(*r) for r in rectangles(mask) if (r[2] - r[0]) * (r[3] - r[1]) >= 4],  # [x0, z0, x1, z1]
        "openings": [{"kind": g["kind"], "alongX": g["horizontal"], "box": box(g["x0"], g["y0"], g["x1"], g["y1"])} for g in gaps],
        "stairs": [{"box": box(*r[:4]), "climbsAlongX": r[4]} for r in stairs(gray, mask, mpp)],
        "rooms": [{**r, "at": m([r["at"]])[0]} for r in rooms(words)],
        "size": [round(float(xs.max() - ox) * mpp, 3), round(float(ys.max() - oy) * mpp, 3)],
    }


def selfcheck():
    g = np.full((400, 600), 255, np.uint8)
    cv2.rectangle(g, (50, 50), (550, 350), 0, 12)  # 500 px wide room, walls 12 px
    g[44:57, 150:230] = 255  # door gap in the top wall
    g[344:357, 300:400] = 255
    cv2.line(g, (300, 348), (400, 348), 0, 1)  # window: thin lines across the gap
    cv2.line(g, (300, 352), (400, 352), 0, 1)
    cv2.putText(g, "Bedroom", (200, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 2)  # text must not become a wall
    mask = wall_mask(g)
    assert mask[200, 210] == 0 and mask[50, 100] == 1, "text dropped, wall kept"
    kinds = sorted(o["kind"] for o in openings(mask, g, 0.01))
    assert kinds == ["door", "window"], kinds
    assert abs(parse_length("18' 1/4\"") - (216.25 * 0.0254)) < 1e-9
    assert abs(parse_length("10' 2 1/2\"") - (122.5 * 0.0254)) < 1e-9
    assert parse_length("Bedroom") is None
    shell = read_plan(g, words=[("Bedroom", 200, 185, 300, 200), ("10' x 8' 6\"", 200, 205, 300, 218)], mpp=0.01)
    r = shell["rooms"]
    assert len(r) == 1 and r[0]["name"] == "Bedroom" and r[0]["at"] == [2.06, 1.61], r  # origin = wall's outer corner (44, 44)
    assert np.allclose(r[0]["size"], [3.048, 2.5908]), r
    assert len(shell["openings"]) == 2 and abs(shell["size"][0] - 5.12) < 0.02, shell["size"]
    filled = np.zeros_like(mask)
    for x0, y0, x1, y1 in rectangles(mask):
        filled[y0:y1, x0:x1] = 1
    assert (filled != mask).sum() < 0.02 * mask.sum(), "rectangles cover the walls (1 px tolerance per row)"
    for i in range(6):  # six treads 25 px apart, 80 px wide
        cv2.line(g, (100, 100 + 25 * i), (180, 100 + 25 * i), 0, 1)
    st = stairs(g, wall_mask(g), 0.01)
    assert len(st) == 1 and np.allclose(st[0][:4], (100, 100, 181, 225), atol=1) and st[0][4] is False, st
    print("floorplan self-check passed")


if __name__ == "__main__":
    import json, sys
    selfcheck()
    for path in sys.argv[1:]:
        gray = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        shell = read_plan(gray)
        print(path, json.dumps({k: shell[k] for k in ("metresPerPixel", "lengthsRead", "lengthsAgreeing", "size")}),
              len(shell["walls"]), "wall boxes,", len(shell["stairs"]), "stairs,", [o["kind"] for o in shell["openings"]], [r["name"] for r in shell["rooms"]])
