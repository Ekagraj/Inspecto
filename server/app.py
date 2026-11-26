"""Local API for the AI Home Inspector. Run: uv run uvicorn server.app:app --port 8000"""
import base64, io, os, subprocess, tempfile, time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from pydantic import BaseModel

from . import inspections
from .detector import Detector, OnnxDetector, WEIGHTS

app = FastAPI(title="AI Home Inspector")
_detector = None


@app.exception_handler(inspections.Refused)
def refused(_, error):
    return JSONResponse({"detail": str(error)}, status_code=400)


def detector():
    global _detector
    if _detector is None:
        if not WEIGHTS.exists():
            raise HTTPException(503, "No detector weights. Run: uv run ml/train.py (see README)")
        onnx = os.environ.get("INSPECTO_ONNX")  # e.g. models/onnx/detector-fp16.onnx, to test the browser build's model
        _detector = OnnxDetector(onnx) if onnx else Detector()
    return _detector


class DetectIn(BaseModel):
    image: str  # JPEG/PNG data URL


@app.get("/api/health")
def health():
    return {"detector": WEIGHTS.exists()}


def decode_image(data_url):
    """Data URL -> PIL image, refusing what is not an image or is too large to process."""
    try:
        image = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[-1])))
        image.load()
    except Exception:
        raise HTTPException(400, "image must be a base64 data URL")
    if image.width * image.height > 4096 * 4096:
        raise HTTPException(413, "image too large")
    return image


@app.post("/api/detect")
def detect(body: DetectIn):
    image = decode_image(body.image)
    t = time.time()
    return {"detections": detector().predict(image), "ms": round((time.time() - t) * 1000)}


@app.post("/api/floorplan")
def read_floorplan(body: DetectIn):
    """A floor plan picture -> the home's shell in metres (walls, doors, windows, stairs, room names)."""
    import numpy as np
    from . import floorplan
    gray = np.array(decode_image(body.image).convert("L"))
    try:
        return floorplan.read_plan(gray)
    except ValueError as e:  # no readable lengths: not a plan, or a style this reader does not know
        raise HTTPException(400, str(e))
    except RuntimeError as e:  # Tesseract missing
        raise HTTPException(503, str(e))


# --- Condition reports: move-in / move-out inspections (storage and rules in inspections.py) ---
class InspectionIn(BaseModel):
    name: str
    kind: str  # "move-in" | "move-out"
    baseline: str | None = None  # move-out only: the move-in inspection it is compared with


class PhotoIn(BaseModel):
    room: str
    image: str  # data URL
    widthM: float = 1.0
    pair: str | None = None  # the move-in photo this one retakes


@app.get("/api/inspections")
def inspection_list():
    return inspections.listing()


@app.post("/api/inspections")
def inspection_create(body: InspectionIn):
    return inspections.create(body.name, body.kind, body.baseline)


@app.get("/api/inspections/{ident}")
def inspection_get(ident: str):
    return inspections.load(ident)


@app.post("/api/inspections/{ident}/photos")
def inspection_add_photo(ident: str, body: PhotoIn):
    return inspections.add_photo(ident, body.room, body.image, detector().predict, body.widthM, body.pair)


@app.patch("/api/inspections/{ident}/photos/{photo_id}")
def inspection_correct(ident: str, photo_id: str, changes: dict):
    return inspections.correct(ident, photo_id, changes)


@app.get("/api/inspections/{ident}/photos/{photo_id}.jpg")
def inspection_photo(ident: str, photo_id: str):
    return FileResponse(inspections.photo_path(ident, photo_id), media_type="image/jpeg")


@app.post("/api/jpeg")
async def to_jpeg(request: Request):
    """Any image macOS can read (iPhone HEIC, ProRAW .DNG, TIFF) -> JPEG, for browsers that cannot."""
    data = await request.body()
    if len(data) > 100 * 1024 * 1024:  # a 48 MP ProRAW file is about 75 MB
        raise HTTPException(413, "image too large")
    # shortcut: sips ships with macOS only; use pillow-heif if this ever runs on another system.
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d, "in"), Path(d, "out.jpg")  # sips reads the type from the content
        src.write_bytes(data)
        try:
            subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "1600", str(src), "--out", str(out)],
                           check=True, capture_output=True, timeout=60)
            return Response(out.read_bytes(), media_type="image/jpeg")
        except Exception:
            raise HTTPException(400, "could not convert this image")
