"""Draw random apartment floor plans in the listing-app style (magicplan / Sensopia: thick black
walls, grey dimension lines with feet-and-inch labels, door arcs, thin-line windows, stairs, room
names with sizes), each with its true answer, to grade server/floorplan.py (ml/eval_plans.py).

  uv run ml/make_plans.py --n 5 --out data/plans_synth --seed 1

Writes plan_NNN.png (or .jpg) and plan_NNN.json: metres per pixel, size, openings and stairs as
boxes in metres from the building's outer top-left corner, which is where the reader puts its origin.
"""
import argparse, json, math, pathlib, random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc",
         "/System/Library/Fonts/Supplemental/Arial Narrow.ttf", "/System/Library/Fonts/HelveticaNeue.ttc"]
NAMES = ["Bedroom", "Bathroom", "Kitchen", "Living Room", "Hallway", "Dining Room", "Office", "Closet", "Laundry"]
GREY, INK = (120, 120, 120), (0, 0, 0)


def ft_in(m):
    """Metres -> listing-style feet and inches to the nearest quarter: 10' 2 1/2"."""
    q = round(m / 0.0254 * 4)
    feet, rest = divmod(q, 48)
    inches, quarter = divmod(rest, 4)
    frac = {0: "", 1: "1/4", 2: "1/2", 3: "3/4"}[quarter]
    inner = " ".join(p for p in (str(inches) if inches else "", frac) if p) or "0"
    return f"{feet}' {inner}\""


def split_rooms(rng, x0, z0, x1, z1, t, n):
    """Binary space partition of the inside into n rooms -> (rooms, interior walls as [x0, z0, x1, z1])."""
    rooms, walls = [(x0, z0, x1, z1)], []
    for _ in range(n - 1):
        rooms.sort(key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
        r = rooms.pop()
        w, d = r[2] - r[0], r[3] - r[1]
        if max(w, d) < 2.6:
            rooms.append(r)
            break
        if w >= d:
            s = r[0] + w * rng.uniform(0.35, 0.65)
            rooms += [(r[0], r[1], s - t / 2, r[3]), (s + t / 2, r[1], r[2], r[3])]
            walls.append([s - t / 2, r[1], s + t / 2, r[3]])
        else:
            s = r[1] + d * rng.uniform(0.35, 0.65)
            rooms += [(r[0], r[1], r[2], s - t / 2), (r[0], s + t / 2, r[2], r[3])]
            walls.append([r[0], s - t / 2, r[2], s + t / 2])
    return rooms, walls


def make(rng, out, i):
    ppm = rng.uniform(80, 110) * 2  # drawn at twice the size, then shrunk: anti-aliased like real exports
    W, D = rng.uniform(7, 11), rng.uniform(6, 9)
    te, ti = rng.uniform(0.18, 0.26), rng.uniform(0.09, 0.13)
    font = rng.choice(FONTS)
    fs = int(rng.uniform(0.15, 0.2) * ppm)
    f, fsmall = ImageFont.truetype(font, fs), ImageFont.truetype(font, int(fs * 0.85))
    panel = 0.28 * (W + 2.5) * ppm if rng.random() < 0.7 else 0  # address and legend column on the left
    bx, by = panel + 1.4 * ppm, 1.3 * ppm
    img = Image.new("RGB", (int(bx + (W + 1.6) * ppm), int(by + (D + 1.4) * ppm)), "white")
    g = ImageDraw.Draw(img)
    P = lambda x, z: (bx + x * ppm, by + z * ppm)
    rect = lambda b, fill: g.rectangle([*P(b[0], b[1]), *P(b[2], b[3])], fill=fill)

    rooms, inner = split_rooms(rng, te, te, W - te, D - te, ti, rng.randint(3, 6))
    outer = [[0, 0, W, te], [0, D - te, W, D], [0, 0, te, D], [W - te, 0, W, D]]
    for w in outer + inner:
        rect(w, INK)

    def junctions(w):
        """Where other walls meet this one, measured along it."""
        along_x = w[2] - w[0] > w[3] - w[1]
        length = (w[2] - w[0]) if along_x else (w[3] - w[1])
        pts = []
        for o in outer + inner:
            if o is w:
                continue
            if along_x and o[1] <= w[3] + 1e-6 and o[3] >= w[1] - 1e-6:
                pts += [o[0] - w[0], o[2] - w[0]]
            if not along_x and o[0] <= w[2] + 1e-6 and o[2] >= w[0] - 1e-6:
                pts += [o[1] - w[1], o[3] - w[1]]
        return along_x, [0, *sorted(p for p in pts if 0 < p < length), length]  # only walls meeting this one

    def place(w, width, taken):
        """A free stretch of wall `width` long, clear of junctions and other openings -> start along it."""
        along_x, pts = junctions(w)
        length = pts[-1]
        for _ in range(40):
            a = rng.uniform(0.15, length - width - 0.15)
            clear = all(not (a - 0.25 < p < a + width + 0.25) for p in pts[1:-1])
            apart = all(a + width + 0.25 <= s or a - 0.25 >= e for s, e in zip(taken[::2], taken[1::2]))  # no overlap at all
            if a > 0 and clear and apart:
                return along_x, a
        return along_x, None

    truth = {"openings": [], "stairs": []}
    used = {id(w): [] for w in outer + inner}

    def cut(w, kind, width):
        along_x, a = place(w, width, used[id(w)])
        if a is None:
            return
        used[id(w)] += [a, a + width]
        b = [w[0] + a, w[1], w[0] + a + width, w[3]] if along_x else [w[0], w[1] + a, w[2], w[1] + a + width]
        rect(b, "white")
        lw = max(1, int(ppm * 0.012))
        if kind == "window":  # two thin lines along the wall, closed at the ends
            for k in (1 / 3, 2 / 3):
                if along_x:
                    z = b[1] + (b[3] - b[1]) * k
                    g.line([P(b[0], z), P(b[2], z)], fill=(60, 60, 60), width=lw)
                else:
                    x = b[0] + (b[2] - b[0]) * k
                    g.line([P(x, b[1]), P(x, b[3])], fill=(60, 60, 60), width=lw)
            g.rectangle([*P(b[0], b[1]), *P(b[2], b[3])], outline=(60, 60, 60), width=lw)
        else:  # door leaf and its swing, into a random side
            side = rng.choice((-1, 1))
            if along_x:
                hx, hz = b[0], (b[1] if side < 0 else b[3])
                g.line([P(hx, hz), P(hx, hz + side * width)], fill=(60, 60, 60), width=lw)
                box = [*P(hx - width, hz - width), *P(hx + width, hz + width)]
                g.arc(box, 0 if side > 0 else 270, 90 if side > 0 else 360, fill=(60, 60, 60), width=lw)
            else:
                hx, hz = (b[0] if side < 0 else b[2]), b[1]
                g.line([P(hx, hz), P(hx + side * width, hz)], fill=(60, 60, 60), width=lw)
                box = [*P(hx - width, hz - width), *P(hx + width, hz + width)]
                g.arc(box, 0 if side > 0 else 90, 90 if side > 0 else 180, fill=(60, 60, 60), width=lw)
        truth["openings"].append({"kind": kind, "alongX": along_x, "box": [round(v, 3) for v in b]})

    for w in inner:
        cut(w, "door", rng.uniform(0.72, 0.92))
    cut(rng.choice(outer), "door", rng.uniform(0.85, 0.95))
    for _ in range(rng.randint(2, 5)):
        cut(rng.choice(outer), "window", rng.uniform(0.9, 2.6))

    if rng.random() < 0.6:  # a flight of stairs against a wall in the largest room
        r = max(rooms, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
        along_x = r[2] - r[0] > r[3] - r[1]
        L, B = min(3.2, 0.8 * max(r[2] - r[0], r[3] - r[1])), 0.9
        s = [r[0] + 0.3, r[1], r[0] + 0.3 + L, r[1] + B] if along_x else [r[0], r[1] + 0.3, r[0] + B, r[1] + 0.3 + L]
        g.rectangle([*P(s[0], s[1]), *P(s[2], s[3])], outline=(60, 60, 60), width=max(1, int(ppm * 0.012)))
        n = int(L / 0.25)
        for k in range(1, n):
            v = (s[0] if along_x else s[1]) + k * L / n
            g.line([P(v, s[1]), P(v, s[3])] if along_x else [P(s[0], v), P(s[2], v)], fill=(60, 60, 60), width=max(1, int(ppm * 0.01)))
        truth["stairs"].append({"box": [round(v, 3) for v in s], "climbsAlongX": along_x})

    for r in rooms:  # thin furniture outlines touching a wall: the reader must ignore them
        if rng.random() < 0.4 and r[2] - r[0] > 1.6:
            g.rectangle([*P(r[0] + 0.4, r[1]), *P(r[0] + 1.4, r[1] + 0.6)], outline=(90, 90, 90), width=max(1, int(ppm * 0.01)))

    for r, name in zip(rooms, rng.sample(NAMES, len(rooms))):  # name and size in the middle of each room
        cx, cz = P((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
        g.text((cx, cz - fs * 0.6), name, fill=(70, 70, 70), font=f, anchor="mm")
        g.text((cx, cz + fs * 0.6), f"{ft_in(r[2] - r[0])} × {ft_in(r[3] - r[1])}", fill=(70, 70, 70), font=fsmall, anchor="mm")

    def dimension(a, b, at, horizontal, tick_to):
        """Grey line from a to b (metres) with extension lines towards the wall and its length in the middle."""
        lw = max(1, int(ppm * 0.012))
        label = ft_in(b - a)
        tw = g.textlength(label, font=f) + fs * 0.8
        if horizontal:
            (x0, y), (x1, _) = P(a, at), P(b, at)
            ty = P(0, tick_to)[1]
            mid = (x0 + x1) / 2
            g.line([(x0, y), (mid - tw / 2, y)], fill=GREY, width=lw)
            g.line([(mid + tw / 2, y), (x1, y)], fill=GREY, width=lw)
            for x in (x0, x1):
                g.line([(x, y - fs * 0.35), (x, ty)], fill=GREY, width=lw)
            g.text((mid, y), label, fill=GREY, font=f, anchor="mm")
        else:
            (x, y0), (_, y1) = P(at, a), P(at, b)
            tx = P(tick_to, 0)[0]
            mid = (y0 + y1) / 2
            g.line([(x, y0), (x, mid - tw / 2)], fill=GREY, width=lw)
            g.line([(x, mid + tw / 2), (x, y1)], fill=GREY, width=lw)
            for y in (y0, y1):
                g.line([(x - fs * 0.35, y), (tx, y)], fill=GREY, width=lw)
            t = Image.new("L", (int(tw), int(fs * 1.4)), 0)
            ImageDraw.Draw(t).text((tw / 2, fs * 0.7), label, fill=255, font=f, anchor="mm")
            t = t.rotate(90, expand=True)
            img.paste(Image.new("RGB", t.size, GREY), (int(x - t.width / 2), int(mid - t.height / 2)), t)

    xs = sorted({0, W, *[round(w[0] + ti / 2, 3) for w in inner if w[3] - w[1] > w[2] - w[0] and w[1] < te + 0.01]})
    stops = [0, rng.choice(xs[1:-1]), W] if len(xs) > 2 and rng.random() < 0.6 else [0, W]
    for a, b in zip(stops, stops[1:]):
        dimension(a, b, -0.55, True, -0.08)
    dimension(0, D, -0.6, False, -0.08)
    if rng.random() < 0.5:
        dimension(0, W, D + 0.55, True, D + 0.08)

    if panel:  # info column and a scale bar, as listing exports have
        for k, line in enumerate(["123 Example Street,", "Unit #4B", "", "CREATED ON", "January 1, 2026"]):
            g.text((0.4 * ppm, by + k * fs * 1.4), line, fill=INK, font=f)
        for k in range(5):
            g.rectangle([0.4 * ppm + k * 0.3 * ppm, by + D * ppm, 0.4 * ppm + (k + 1) * 0.3 * ppm, by + D * ppm + 0.08 * ppm],
                        fill=INK if k % 2 == 0 else "white", outline=INK)
    if rng.random() < 0.5:  # the black page frame some exports have
        g.rectangle([0, 0, img.width - 1, img.height - 1], outline=INK, width=int(0.08 * ppm))

    k = rng.uniform(0.45, 0.6)  # shrink to listing size, maybe blur and compress
    img = img.resize((int(img.width * k), int(img.height * k)), Image.LANCZOS)
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    truth.update({"metresPerPixel": 1 / (ppm * k), "size": [round(W, 3), round(D, 3)], "rooms": len(rooms)})
    name = f"plan_{i:03d}"
    if rng.random() < 0.4:
        img.save(out / f"{name}.jpg", quality=rng.randint(70, 92))
    else:
        img.save(out / f"{name}.png")
    (out / f"{name}.json").write_text(json.dumps(truth, indent=1))
    assert ft_in(0.0254 * (12 * 10 + 2.5)) == "10' 2 1/2\"" and ft_in(0.0254 * 216.25) == "18' 1/4\""


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--out", default="data/plans_synth")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(a.seed)
    for i in range(a.n):
        make(rng, out, i)
    print(f"{a.n} plans in {out}")
