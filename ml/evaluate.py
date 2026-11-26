"""Score the detector on real photos it never trained on. Writes results/eval.{md,csv,png}.

  uv run ml/evaluate.py                    # the model in use, every test photo
  uv run ml/evaluate.py --limit 20         # quick check
  uv run ml/evaluate.py --weights models/detector_before_extra.pth --tag before
  uv run --group export ml/evaluate.py --onnx models/onnx/detector-fp32.onnx --tag onnx-fp32

Two test sets:
- "original": data/test, 225 photos from the first dataset (almost all cracks).
- "extra": the unused `test` split of each Roboflow set in data/extra/roboflow, with the same
  class mapping as training (ml/prep_extra.py). Photos whose picture is also in the training
  data are left out, but two of those sets were published with augmented copies, so scuff and
  hole numbers may still flatter the model.

Per class: precision, recall and F1 at the app's confidence threshold and IoU 0.5, plus AP50.
"""
import argparse, collections, csv, json, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
DATA = ROOT / "data"


def iou(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - w * h)


def match(preds, truth, same_label=True):
    """Greedy, most confident first; each true box is used once. -> ([(pred, hit truth or None)], missed truth)"""
    free, out = list(truth), []
    for p in sorted(preds, key=lambda p: -p["score"]):
        best = max((t for t in free if not same_label or t["label"] == p["label"]), key=lambda t: iou(p["box"], t["box"]), default=None)
        hit = best if best is not None and iou(p["box"], best["box"]) >= 0.5 else None
        if hit is not None:
            free.remove(hit)
        out.append((p, hit))
    return out, free


def ap50(scored, total):
    """Area under the precision-recall curve. scored: [(score, is_hit)] for one class."""
    tp = fp = 0
    points = []
    for _, hit in sorted(scored, key=lambda s: -s[0]):
        tp, fp = tp + hit, fp + (not hit)
        points.append((tp / total, tp / (tp + fp)))
    for i in range(len(points) - 2, -1, -1):  # precision can only fall as recall grows
        points[i] = (points[i][0], max(points[i][1], points[i + 1][1]))
    area, last = 0.0, 0.0
    for recall, precision in points:
        area, last = area + (recall - last) * precision, recall
    return area


def selfcheck():
    t = [{"label": "crack", "box": [0, 0, 0.5, 0.5]}, {"label": "mold", "box": [0.5, 0.5, 1, 1]}]
    p = [{"label": "crack", "score": 0.9, "box": [0, 0, 0.5, 0.45]}, {"label": "crack", "score": 0.8, "box": [0, 0, 0.5, 0.5]},
         {"label": "crack", "score": 0.7, "box": [0.5, 0.5, 1, 1]}]
    pairs, missed = match(p, t)
    assert [h is not None for _, h in pairs] == [True, False, False] and missed == [t[1]], "a true box must be matched once, by label"
    assert match(p, t, same_label=False)[1] == [], "ignoring labels, the mold box is located"
    assert abs(ap50([(0.9, True), (0.8, False), (0.7, True)], 2) - (0.5 * 1 + 0.5 * 2 / 3)) < 1e-9
    assert iou([0, 0, 1, 1], [0, 0, 1, 0.5]) == 0.5


def load_sets():
    """-> {set name: [(image path, [true boxes in 0..1])]}"""
    from ml.prep_extra import MAP, dhash
    sets = {"original": [], "extra": []}
    coco = json.loads((DATA / "test" / "_annotations.coco.json").read_text())
    names = {c["id"]: c["name"] for c in coco["categories"]}
    boxes = collections.defaultdict(list)
    for a in coco["annotations"]:
        boxes[a["image_id"]].append(a)

    def norm(im, anns, label):
        return [{"label": label(a), "box": [a["bbox"][0] / im["width"], a["bbox"][1] / im["height"],
                                            (a["bbox"][0] + a["bbox"][2]) / im["width"], (a["bbox"][1] + a["bbox"][3]) / im["height"]]} for a in anns]
    for im in coco["images"]:
        sets["original"].append((DATA / "test" / im["file_name"], norm(im, boxes[im["id"]], lambda a: names[a["category_id"]])))

    trained = {dhash(f.resolve()) for split in ("train", "valid") for f in (DATA / "combined" / split).glob("*.jpg")} if (DATA / "combined").exists() else set()
    for source, mapping in MAP.items():
        path = DATA / "extra" / "roboflow" / source / "test"
        if not (path / "_annotations.coco.json").exists():
            continue
        coco = json.loads((path / "_annotations.coco.json").read_text())
        names = {c["id"]: c["name"] for c in coco["categories"]}
        boxes = collections.defaultdict(list)
        for a in coco["annotations"]:
            boxes[a["image_id"]].append(a)
        for im in coco["images"]:
            anns = boxes[im["id"]]
            if not anns or any(names[a["category_id"]] not in mapping for a in anns) or dhash(path / im["file_name"]) in trained:
                continue
            sets["extra"].append((path / im["file_name"], norm(im, anns, lambda a: mapping[names[a["category_id"]]])))
    return sets


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(ROOT / "models" / "detector.pth"))
    ap.add_argument("--limit", type=int, default=0, help="only the first N photos of each set")
    ap.add_argument("--tag", default="", help="suffix for the output files, e.g. 'before'")
    ap.add_argument("--onnx", default="", help="score an ONNX export through onnxruntime instead of --weights")
    a = ap.parse_args()
    selfcheck()

    from PIL import Image
    from server.detector import Detector, OnnxDetector, LABELS, THRESHOLD
    detector = OnnxDetector(a.onnx) if a.onnx else Detector(a.weights)
    rows, notes = [], []
    for set_name, items in load_sets().items():
        items = items[: a.limit] if a.limit else items
        stat = {c: collections.Counter() for c in LABELS}
        scored = {c: [] for c in LABELS}
        mixups = collections.Counter()
        located = total = 0
        for i, (path, truth) in enumerate(items):
            preds = detector.predict(Image.open(path), threshold=0.05)
            for p, hit in match(preds, truth)[0]:  # every prediction, for AP50
                scored[p["label"]].append((p["score"], hit is not None))
            sure = [p for p in preds if p["score"] >= THRESHOLD]  # what the app would show
            pairs, missed = match(sure, truth)
            for p, hit in pairs:
                stat[p["label"]]["tp" if hit is not None else "fp"] += 1
            for t in truth:
                stat[t["label"]]["n"] += 1
            wrong = [p for p, hit in pairs if hit is None]
            for p, hit in match(wrong, missed, same_label=False)[0]:  # right place, wrong name
                if hit is not None:
                    mixups[(hit["label"], p["label"])] += 1
            located += len(truth) - len(match(sure, truth, same_label=False)[1])
            total += len(truth)
            if i % 100 == 99:
                print(f"  {set_name}: {i + 1}/{len(items)}", flush=True)
        for c in LABELS:
            n, tp, fp = stat[c]["n"], stat[c]["tp"], stat[c]["fp"]
            if not n and not fp:
                continue
            p, r = (tp / (tp + fp) if tp + fp else 0.0), (tp / n if n else 0.0)
            rows.append({"set": set_name, "class": c, "photos_boxes": n, "precision": p, "recall": r,
                         "f1": 2 * p * r / (p + r) if p + r else 0.0, "ap50": ap50(scored[c], n) if n else 0.0, "false_alarms": fp})
        tp, fp = sum(s["tp"] for s in stat.values()), sum(s["fp"] for s in stat.values())
        rows.append({"set": set_name, "class": "ALL", "photos_boxes": total, "precision": tp / (tp + fp) if tp + fp else 0.0, "recall": tp / total if total else 0.0,
                     "f1": 0.0, "ap50": 0.0, "false_alarms": fp})
        notes.append(f"**{set_name}**: {len(items)} photos, {total} true boxes. Found in the right place regardless of the name: "
                     f"{located / total:.0%}." + (" Most common mix-ups (true -> called): " + ", ".join(f"{t} -> {p} ({n})" for (t, p), n in mixups.most_common(4)) + "." if mixups else ""))

    out = ROOT / "results"
    out.mkdir(exist_ok=True)
    name = "eval" + (f"_{a.tag}" if a.tag else "")
    with open(out / f"{name}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()} for r in rows)
    md = [f"# Detector on real photos it never trained on\n\nWeights: `{pathlib.Path(a.onnx or a.weights).name}`. Confidence threshold {THRESHOLD}, IoU 0.5."
          + (f" Only the first {a.limit} photos of each set." if a.limit else "") + "\n"]
    for set_name in dict.fromkeys(r["set"] for r in rows):
        md += [f"\n## {set_name}\n", "| Class | True boxes | Precision | Recall | F1 | AP50 | False alarms |", "|---|---|---|---|---|---|---|"]
        for r in (r for r in rows if r["set"] == set_name):
            last = r["class"] == "ALL"
            md.append(f"| {'**all**' if last else r['class']} | {r['photos_boxes']} | {r['precision']:.0%} | {r['recall']:.0%} | "
                      f"{'' if last else format(r['f1'], '.0%')} | {'' if last else format(r['ap50'], '.0%')} | {r['false_alarms']} |")
    md += ["", *notes, "", "The `extra` scuff and hole photos come from sets published with augmented copies, so those two rows may flatter the model."]
    (out / f"{name}.md").write_text("\n".join(md) + "\n")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    sets = list(dict.fromkeys(r["set"] for r in rows))
    fig, axes = plt.subplots(1, len(sets), figsize=(6.5 * len(sets), 4.2), facecolor="#0b0f12", squeeze=False)
    for ax, set_name in zip(axes[0], sets):
        part = [r for r in rows if r["set"] == set_name and r["class"] != "ALL"]
        x = range(len(part))
        ax.bar([i - 0.2 for i in x], [r["precision"] for r in part], 0.4, color="#ffb224", label="Precision")
        ax.bar([i + 0.2 for i in x], [r["recall"] for r in part], 0.4, color="#ff7a2f", label="Recall")
        ax.set_xticks(list(x), [f"{r['class']}\n({r['photos_boxes']})" for r in part], color="#f3efe6", fontsize=8)
        ax.set_ylim(0, 1.05)
        ax.set_title(f"{set_name} test photos", color="#f3efe6")
        ax.set_facecolor("#0b0f12")
        ax.tick_params(colors="#a3acb2")
        for s in ax.spines.values():
            s.set_color("#3a4046")
        ax.legend(facecolor="#151b20", edgecolor="#3a4046", labelcolor="#f3efe6")
    fig.tight_layout()
    fig.savefig(out / f"{name}.png", dpi=140, facecolor="#0b0f12")
    print((out / f"{name}.md").read_text())
