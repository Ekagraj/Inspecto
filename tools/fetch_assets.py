"""Download CC0 Poly Haven textures (1k diffuse) and glTF models (1k) into web/public."""
import json, os, urllib.request
UA = {"User-Agent": "home-viewer"}
TEX = ["laminate_floor_02", "floor_tiles_06", "long_white_tiles", "marble_tiles"]
MODELS = ["sofa_03", "modern_coffee_table_01", "dining_table", "dining_chair_02", "GothicBed_01",
          "painted_wooden_nightstand", "modern_wooden_cabinet", "potted_plant_04",
          "wooden_bookshelf_worn", "modern_arm_chair_01", "electric_stove"]
def get(url, dest=None):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
    if dest:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(data)
    return data
root = os.path.join(os.path.dirname(__file__), "..", "web", "public")
for t in TEX:
    f = json.loads(get(f"https://api.polyhaven.com/files/{t}"))
    n = len(get(f["Diffuse"]["1k"]["jpg"]["url"], f"{root}/textures/{t}.jpg"))
    print(t, n // 1024, "KB")
for m in MODELS:
    g = json.loads(get(f"https://api.polyhaven.com/files/{m}"))["gltf"]["1k"]["gltf"]
    n = len(get(g["url"], f"{root}/models/{m}/{m}.gltf"))
    for rel, inc in g.get("include", {}).items():
        n += len(get(inc["url"], f"{root}/models/{m}/{rel}"))
    print(m, n // 1024, "KB")
