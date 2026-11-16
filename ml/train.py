"""Fine-tune RF-DETR Nano on the defect data. Usage: uv run ml/train.py --data data/combined --epochs 12"""
import argparse, os
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
# Cap GPU memory so training fails fast instead of swapping a 16 GB laptop.
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.7")
os.environ.setdefault("PYTORCH_MPS_LOW_WATERMARK_RATIO", "0.5")
from rfdetr import RFDETRNano

if __name__ == "__main__":  # DataLoader workers re-import this file on macOS
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/combined")
    ap.add_argument("--out", default="models/run")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--weights", default=None, help="checkpoint to continue from")
    a = ap.parse_args()

    model = RFDETRNano(**({"pretrain_weights": a.weights} if a.weights else {}))
    model.train(dataset_dir=a.data, epochs=a.epochs, batch_size=a.batch, grad_accum_steps=16 // a.batch,
                lr=1e-4, output_dir=a.out, tensorboard=False, num_workers=0,
                multi_scale=False, expanded_scales=False)
