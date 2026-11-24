#!/bin/sh
# Train the detector on everything: real photos, rendered views and the extra photos prepared by
# ml/prep_extra.py (7 classes: scuff and hole are new). Run from the repo root, laptop plugged in
# and lid open; caffeinate keeps it awake. No terminal needs to stay open:
#   nohup caffeinate -is sh ml/train_more.sh > train_more.log 2>&1 &
# A full run is 6 rounds, about 3 to 3.5 hours on an M3. The app lags while it runs.
#
# Paused runs continue: if models/resume.pth exists (a copy of models/run3/checkpoint_best_ema.pth
# from a stopped run), training starts from it for EPOCHS more rounds (default 5: one of six was
# done when the run was paused on 2026-11-16). To pause: pkill -f ml/train_more.sh; pkill -f ml/train.py
# then: cp models/run3/checkpoint_best_ema.pth models/resume.pth   and set EPOCHS to what is left.
set -e
cd "$(dirname "$0")/.."

# Never run two trainings at once (a second one pushed this laptop into swap).
while pgrep -f "ml/train.py" > /dev/null; do sleep 30; done

# Keep the 5-class model so it can be put back: cp models/detector_before_extra.pth models/detector.pth
[ -f models/detector_before_extra.pth ] || cp models/detector.pth models/detector_before_extra.pth

START=models/detector_before_extra.pth
ROUNDS=${EPOCHS:-6}
if [ -f models/resume.pth ]; then
  START=models/resume.pth
  ROUNDS=${EPOCHS:-5}
  echo "train_more: continuing a paused run from models/resume.pth for $ROUNDS more rounds"
fi

uv run ml/combine.py
uv run ml/train.py --data data/combined --weights "$START" --epochs "$ROUNDS" --out models/run3
cp models/run3/checkpoint_best_total.pth models/detector.pth
[ -f models/resume.pth ] && mv models/resume.pth models/resume_used.pth  # so the next full run starts clean
echo "train_more: done, models/detector.pth updated. Restart the API server to load it."
