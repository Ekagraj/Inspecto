"""Local API for the AI Home Inspector. Run: uv run uvicorn server.app:app --port 8000"""
import base64, io, time
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from .detector import Detector, WEIGHTS

app = FastAPI(title="AI Home Inspector")
_detector = None


def detector():
    global _detector
    if _detector is None:
        if not WEIGHTS.exists():
            raise HTTPException(503, "No detector weights. Run: uv run ml/train.py (see README)")
        _detector = Detector()
    return _detector


class DetectIn(BaseModel):
    image: str  # JPEG/PNG data URL


@app.get("/api/health")
def health():
    return {"detector": WEIGHTS.exists()}


@app.post("/api/detect")
def detect(body: DetectIn):
    try:
        image = Image.open(io.BytesIO(base64.b64decode(body.image.split(",", 1)[-1])))
        image.load()
    except Exception:
        raise HTTPException(400, "image must be a base64 data URL")
    if image.width * image.height > 4096 * 4096:
        raise HTTPException(413, "image too large")
    t = time.time()
    return {"detections": detector().predict(image), "ms": round((time.time() - t) * 1000)}
