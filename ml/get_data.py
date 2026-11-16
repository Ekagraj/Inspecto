"""Download the building-defect dataset (CC BY 4.0 Roboflow export, mirrored on Hugging Face) into data/."""
import pathlib, urllib.request, zipfile
BASE = "https://huggingface.co/datasets/senthilsk/crack_detection_dataset/resolve/main/data/"
data = pathlib.Path(__file__).parent.parent / "data"
for split in ("train", "valid", "test"):
    z = data / "zips" / f"{split}.zip"
    z.parent.mkdir(parents=True, exist_ok=True)
    if not z.exists():
        urllib.request.urlretrieve(BASE + f"{split}.zip", z)
    with zipfile.ZipFile(z) as f:
        f.extractall(data / split)
    print(split, sum(1 for _ in (data / split).rglob("*.jpg")), "images")
