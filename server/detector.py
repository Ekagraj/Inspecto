"""RF-DETR Nano defect detector (fine-tuned checkpoint in models/detector.pth)."""
import os, pathlib
import numpy as np
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

WEIGHTS = pathlib.Path(__file__).parent.parent / "models" / "detector.pth"
# Same order as ml/classes.py. Weights trained before scuff and hole existed only ever answer 0-4.
LABELS = ["crack", "mold", "peeling_paint", "stairstep_crack", "water_seepage", "scuff", "hole"]
THRESHOLD = 0.4


class Detector:
    def __init__(self, weights=WEIGHTS):
        from rfdetr import RFDETRNano
        self.model = RFDETRNano(pretrain_weights=str(weights))  # class count comes from the checkpoint (5 or 7)

    def predict(self, image, threshold=THRESHOLD):
        """PIL image -> [{label, score, box: [x1, y1, x2, y2] in 0..1}]"""
        det = self.model.predict(image.convert("RGB"), threshold=threshold)
        w, h = image.size
        return [
            {"label": LABELS[int(c)], "score": round(float(s), 3),
             "box": [float(x1) / w, float(y1) / h, float(x2) / w, float(y2) / h]}
            for (x1, y1, x2, y2), s, c in zip(det.xyxy, det.confidence, det.class_id)
            if 0 <= int(c) < len(LABELS)
        ]


# ONNX export (ml/export_onnx.py). This is the reference for web/src/detect-worker.js: same steps, same order.
SIZE, MEAN, STD = 384, (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def resize_bilinear(x, size=SIZE):
    """HWC float -> size x size, as torch interpolate(bilinear, align_corners=False, antialias=False)."""
    def axis(n):
        src = np.maximum((np.arange(size) + 0.5) * (n / size) - 0.5, 0)
        i0 = src.astype(np.int64)
        return i0, np.minimum(i0 + 1, n - 1), (src - i0).astype(np.float32)
    y0, y1, wy = axis(x.shape[0])
    x0, x1, wx = axis(x.shape[1])
    top = x[y0][:, x0] * (1 - wx)[None, :, None] + x[y0][:, x1] * wx[None, :, None]
    bot = x[y1][:, x0] * (1 - wx)[None, :, None] + x[y1][:, x1] * wx[None, :, None]
    return top * (1 - wy)[:, None, None] + bot * wy[:, None, None]


def preprocess(image):
    """PIL image -> (1, 3, 384, 384) float32: RGB / 255, bilinear resize, ImageNet mean/std."""
    x = resize_bilinear(np.asarray(image.convert("RGB"), dtype=np.float32) / 255)
    return ((x - MEAN) / STD).astype(np.float32).transpose(2, 0, 1)[None]


def postprocess(boxes, logits, threshold):
    """dets (300, 4) cxcywh 0..1 and labels (300, 8) logits -> detections, as RF-DETR's PostProcess:
    sigmoid, top 300 of all query/class pairs (the 8th column is 'no object'), keep score > threshold."""
    prob = 1 / (1 + np.exp(-logits.astype(np.float64).ravel()))
    top = np.argsort(-prob, kind="stable")[:300]
    out = []
    for k in top:
        q, c = divmod(int(k), logits.shape[1])
        if prob[k] <= threshold:
            break
        if c >= len(LABELS):
            continue
        cx, cy, w, h = boxes[q].astype(np.float64)
        out.append({"label": LABELS[c], "score": round(float(prob[k]), 3),
                    "box": [float(np.clip(v, 0, 1)) for v in (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)]})
    return out


class OnnxDetector:
    def __init__(self, path):
        import onnxruntime as ort
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    def predict(self, image, threshold=THRESHOLD):
        boxes, logits = self.session.run(["dets", "labels"], {"input": preprocess(image)})
        return postprocess(boxes[0], logits[0], threshold)
