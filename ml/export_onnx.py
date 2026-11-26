"""Export models/detector.pth to ONNX for in-browser detection (web/src/detect-worker.js).

  uv run --group export ml/export_onnx.py        # -> models/onnx/detector-fp32.onnx

Input: "input" (1, 3, 384, 384) float32, RGB / 255, bilinear resize without antialiasing, ImageNet
mean/std. Outputs: "dets" (1, 300, 4) cx, cy, w, h in 0..1 and "labels" (1, 300, 8) logits (7 classes
plus 'no object'). Pre- and post-processing: server/detector.py preprocess / postprocess.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent
OUT = ROOT / "models" / "onnx"

if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    from rfdetr import RFDETRNano
    from server.detector import SIZE, WEIGHTS
    OUT.mkdir(parents=True, exist_ok=True)
    path = RFDETRNano(pretrain_weights=str(WEIGHTS)).export(output_dir=str(OUT), shape=(SIZE, SIZE), opset_version=17, verbose=False)
    fp32 = OUT / "detector-fp32.onnx"
    pathlib.Path(path).replace(fp32)
    print(f"{fp32} {fp32.stat().st_size / 1e6:.1f} MB")
