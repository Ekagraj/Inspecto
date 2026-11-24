"""Grade server/floorplan.py on plans whose true answer is known (ml/make_plans.py).

  uv run ml/eval_plans.py data/plans_synth [--show 3]

Per plan: scale error, doors and windows found / missed / invented, wrong kind, stairs.
An opening counts as found when a read one runs the same way, sits on the same wall line
(centres within 0.25 m across) and covers at least half of the true one along the wall.
"""
import argparse, json, pathlib, sys

import cv2

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from server.floorplan import read_plan


def same(t, r):
    a = 0 if t["alongX"] else 1  # along-wall axis index in [x0, z0, x1, z1]
    c = 1 - a
    if t["alongX"] != r["alongX"]:
        return False
    tc, rc = (t["box"][c] + t["box"][c + 2]) / 2, (r["box"][c] + r["box"][c + 2]) / 2
    overlap = min(t["box"][a + 2], r["box"][a + 2]) - max(t["box"][a], r["box"][a])
    return abs(tc - rc) < 0.25 and overlap >= 0.5 * (t["box"][a + 2] - t["box"][a])


def iou(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - w * h)


def grade(truth, shell):
    """-> dict of counts for one plan."""
    s = {"scale_ok": 0, "found": 0, "missed": 0, "invented": 0, "wrong_kind": 0,
         "stairs_found": 0, "stairs_missed": 0, "stairs_invented": 0, "notes": []}
    if shell is None:
        s["missed"] = len(truth["openings"])
        s["stairs_missed"] = len(truth["stairs"])
        return s
    err = abs(shell["metresPerPixel"] - truth["metresPerPixel"]) / truth["metresPerPixel"]
    s["scale_ok"] = int(err < 0.01)
    if err >= 0.01:
        s["notes"].append(f"scale off by {err:.1%}")
    free = list(shell["openings"])
    for t in truth["openings"]:
        hit = next((r for r in free if same(t, r)), None)
        if hit is None:
            s["missed"] += 1
            s["notes"].append(f"missed {t['kind']} at {t['box']}")
            continue
        free.remove(hit)
        s["found"] += 1
        if hit["kind"] != t["kind"]:
            s["wrong_kind"] += 1
            s["notes"].append(f"{t['kind']} read as {hit['kind']} at {t['box']}")
    s["invented"] = len(free)
    s["notes"] += [f"invented {r['kind']} at {r['box']}" for r in free]
    rs = list(shell["stairs"])
    for t in truth["stairs"]:
        hit = next((r for r in rs if iou(t["box"], r["box"]) > 0.5), None)
        if hit:
            rs.remove(hit)
            s["stairs_found"] += 1
        else:
            s["stairs_missed"] += 1
            s["notes"].append(f"missed stairs at {t['box']}")
    s["stairs_invented"] = len(rs)
    return s


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--show", type=int, default=5, help="print the notes of this many failing plans")
    a = ap.parse_args()
    total, failing = {}, []
    plans = sorted(p for p in pathlib.Path(a.folder).glob("plan_*.json"))
    for p in plans:
        truth = json.loads(p.read_text())
        img = next(p.parent.glob(p.stem + ".[pj][np]g"))
        try:
            shell = read_plan(cv2.imread(str(img), cv2.IMREAD_GRAYSCALE))
        except ValueError as e:
            shell = None
            print(f"{p.stem}: {e}")
        s = grade(truth, shell)
        if shell is None:
            s["notes"].insert(0, "could not be read")
        for k, v in s.items():
            if k != "notes":
                total[k] = total.get(k, 0) + v
        if s["notes"]:
            failing.append((p.stem, s["notes"]))
    n, t = len(plans), total
    opened = t["found"] + t["missed"]
    print(f"\n{n} plans. Scale within 1%: {t['scale_ok']}/{n}.")
    print(f"Openings: found {t['found']}/{opened} ({t['found'] / max(opened, 1):.0%}), invented {t['invented']}, wrong kind {t['wrong_kind']}.")
    print(f"Stairs: found {t['stairs_found']}/{t['stairs_found'] + t['stairs_missed']}, invented {t['stairs_invented']}.")
    print(f"Perfect plans: {n - len(failing)}/{n}.")
    for name, notes in failing[: a.show]:
        print(f"\n{name}:\n  " + "\n  ".join(notes[:8]))
