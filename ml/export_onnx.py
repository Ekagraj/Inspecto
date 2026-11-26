"""Export models/detector.pth to ONNX for in-browser detection (web/src/detect-worker.js).

  uv run --group export ml/export_onnx.py        # -> models/onnx/detector-fp32.onnx and detector-fp16.onnx

Input: "input" (1, 3, 384, 384) float32, RGB / 255, bilinear resize without antialiasing, ImageNet
mean/std. Outputs: "dets" (1, 300, 4) cx, cy, w, h in 0..1 and "labels" (1, 300, 8) logits (7 classes
plus 'no object'). Pre- and post-processing: server/detector.py preprocess / postprocess.

The fp16 build halves the download. Inputs and outputs stay float32, so callers do not change, and
GridSample stays float32 because onnxruntime-web's fp16 GridSample on WebGPU returns wrong boxes.
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

    import onnx
    from onnxruntime.transformers import float16  # onnxconverter-common's copy left the first Conv's input in float32
    fp16 = OUT / "detector-fp16.onnx"
    model = float16.convert_float_to_float16(onnx.load(fp32), keep_io_types=True,
                                             op_block_list=float16.DEFAULT_OP_BLOCK_LIST + ["GridSample"])
    onnx.save(model, fp16)
    typed = onnx.shape_inference.infer_shapes(model)
    dtype = {v.name: v.type.tensor_type.elem_type for v in typed.graph.value_info}
    grid = [n for n in typed.graph.node if n.op_type == "GridSample"]
    assert grid and all(dtype[i] == onnx.TensorProto.FLOAT for n in grid for i in n.input), "GridSample must stay float32"
    print(f"{fp16} {fp16.stat().st_size / 1e6:.1f} MB, {len(grid)} GridSample nodes checked float32")
