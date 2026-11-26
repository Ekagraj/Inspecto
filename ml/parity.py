"""Does an ONNX export find the same damage as the PyTorch model?

  uv run --group export ml/parity.py models/onnx/detector-fp32.onnx [more.onnx ...]

1. Raw boxes on 20 test photos (10 per set) at the app's threshold: each ONNX detection is paired
   with the PyTorch one of the same label it overlaps most. Reports pairs, unpaired boxes, the worst
   score difference and the lowest IoU of a pair.
2. The metrics table, read from results/eval_<tag>.csv written by ml/evaluate.py (tag "torch" for
   PyTorch, the ONNX file's stem minus "detector-" for each export).

  uv run --group export ml/parity.py --dump DIR models/onnx/detector-fp32.onnx

writes the reference for the browser check (web/tests/browser-parity.mjs) instead: the same 20 photos
plus a portrait phone-style photo (EXIF orientation 6), each with Python's ONNX boxes and its model
input tensor (<n>.f32, raw float32).
"""
import csv, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from ml.evaluate import iou, load_sets  # noqa: E402


def compare(ref, got):
    """-> (pairs, unpaired in ref, unpaired in got, max score diff, min IoU)"""
    free, pairs = list(ref), []
    for g in sorted(got, key=lambda d: -d["score"]):
        best = max((r for r in free if r["label"] == g["label"]), key=lambda r: iou(r["box"], g["box"]), default=None)
        if best is not None and iou(best["box"], g["box"]) >= 0.5:
            free.remove(best)
            pairs.append((best, g))
    return (len(pairs), len(free), len(got) - len(pairs), max((abs(r["score"] - g["score"]) for r, g in pairs), default=0.0),
            min((iou(r["box"], g["box"]) for r, g in pairs), default=1.0))


def dump(out, export, photos):
    """Reference boxes and input tensors for the browser check."""
    import json
    from PIL import Image
    from server.detector import OnnxDetector, preprocess
    out.mkdir(parents=True, exist_ok=True)
    # Portrait phone photo: the camera stores the picture sideways and EXIF orientation 6 says "turn 90° clockwise".
    src = Image.open(photos[0]).convert("RGB")
    upright = src.crop((0, 0, src.height * 3 // 4, src.height)).resize((1512, 2016), Image.BILINEAR)
    exif = Image.Exif()
    exif[0x0112] = 6
    upright.transpose(Image.ROTATE_90).save(out / "portrait_exif6.jpg", quality=92, exif=exif)
    upright.save(out / "portrait_upright.jpg", quality=92)
    photos = [*photos, out / "portrait_exif6.jpg", out / "portrait_upright.jpg"]
    model = OnnxDetector(export)
    ref = []
    for i, path in enumerate(photos):
        x = preprocess(Image.open(path))
        x.tofile(out / f"{i}.f32")
        ref.append({"path": str(pathlib.Path(path).resolve()), "tensor": f"{i}.f32", "dets": model.predict(Image.open(path))})
    (out / "ref.json").write_text(json.dumps(ref, indent=1))
    a, b = ref[-2]["dets"], ref[-1]["dets"]
    print(f"{len(photos)} photos -> {out}. Portrait EXIF 6 vs the same photo saved upright: {compare(b, a)[:3]} (pairs, only upright, only EXIF)")


if __name__ == "__main__":
    from PIL import Image
    from server.detector import Detector, OnnxDetector
    args = sys.argv[1:]
    sets = load_sets()
    photos = [p for items in sets.values() for p, _ in items[:10]]
    if args[:1] == ["--dump"]:
        dump(pathlib.Path(args[1]), pathlib.Path(args[2]), photos)
        sys.exit()
    exports = [pathlib.Path(p) for p in args]
    torch_model = Detector()
    print("## Raw boxes, 20 photos, threshold 0.4\n\n| Build | Boxes (PyTorch) | Paired | Only in PyTorch | Only in ONNX | Worst score diff | Lowest pair IoU |\n|---|---|---|---|---|---|---|")
    ref = [torch_model.predict(Image.open(p)) for p in photos]
    for path in exports:
        model = OnnxDetector(path)
        rows = [compare(r, model.predict(Image.open(p))) for p, r in zip(photos, ref)]
        print(f"| {path.name} | {sum(len(r) for r in ref)} | {sum(r[0] for r in rows)} | {sum(r[1] for r in rows)} | {sum(r[2] for r in rows)} | "
              f"{max(r[3] for r in rows):.3f} | {min(r[4] for r in rows):.3f} |")

    print("\n## Metrics (ml/evaluate.py), threshold 0.4, IoU 0.5\n\n| Build | Original: precision | recall | Extra: precision | recall |\n|---|---|---|---|---|")
    for tag in ["torch"] + [p.stem.removeprefix("detector-") for p in exports]:
        f = ROOT / "results" / f"eval_{tag}.csv"
        if not f.exists():
            print(f"| {tag} | not run: uv run --group export ml/evaluate.py --tag {tag} ... |")
            continue
        rows = {r["set"]: r for r in csv.DictReader(f.open()) if r["class"] == "ALL"}
        print(f"| {tag} | " + " | ".join(f"{float(rows[s][k]):.1%}" for s in ("original", "extra") for k in ("precision", "recall")) + " |")
