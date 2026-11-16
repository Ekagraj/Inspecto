#!/bin/sh
# Retrain the detector for the home's current look, unattended. Run from the repo root:
#   nohup sh ml/retrain.sh > retrain.log 2>&1 &
# Needs the dev server on :5173. Takes about 1.5 hours on an M3; the app lags while it runs.
set -e
cd "$(dirname "$0")/.."

# Never run two trainings at once (a second one pushed this laptop into swap).
while pgrep -f "ml/train.py" > /dev/null; do sleep 30; done

# Start from the best weights so far.
START=models/detector.pth
[ -f models/run/checkpoint_best_total.pth ] && START=models/run/checkpoint_best_total.pth
cp "$START" models/retrain_start.pth

# Fresh labeled views of the home as it looks now (same file names, so old ones are replaced).
(cd web && node tests/synth.mjs ../data/synth/train 1000 150 8 && node tests/synth.mjs ../data/synth/valid 5000 20 8)
uv run ml/combine.py
uv run ml/train.py --data data/combined --weights models/retrain_start.pth --epochs 4 --out models/run2
cp models/run2/checkpoint_best_total.pth models/detector.pth
echo "retrain: done, models/detector.pth updated. Restart the API server to load it."
