#!/bin/sh
# Train the detector on everything: real photos, rendered views and the extra photos prepared by
# ml/prep_extra.py (7 classes: scuff and hole are new). Run from the repo root, laptop plugged in
# and lid open; caffeinate keeps it awake:
#   nohup caffeinate -is sh ml/train_more.sh > train_more.log 2>&1 &
# About 3 to 3.5 hours on an M3 (6 rounds over about 6,000 photos). The app lags while it runs.
set -e
cd "$(dirname "$0")/.."

# Never run two trainings at once (a second one pushed this laptop into swap).
while pgrep -f "ml/train.py" > /dev/null; do sleep 30; done

# Keep the 5-class model so it can be put back: cp models/detector_before_extra.pth models/detector.pth
[ -f models/detector_before_extra.pth ] || cp models/detector.pth models/detector_before_extra.pth

uv run ml/combine.py
uv run ml/train.py --data data/combined --weights models/detector_before_extra.pth --epochs 6 --out models/run3
cp models/run3/checkpoint_best_total.pth models/detector.pth
echo "train_more: done, models/detector.pth updated. Restart the API server to load it."
