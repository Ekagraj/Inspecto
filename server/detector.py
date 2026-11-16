"""RF-DETR Nano defect detector (fine-tuned checkpoint in models/detector.pth)."""
import os, pathlib
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
