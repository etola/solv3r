#!/bin/bash
# Assembles the Hugging Face Space folder: the app, its static files, the solv3r package (the Space runs this
# tree's library, not a pip install), the example data and the Space's README and requirements.
# usage: bash demo/make_space.sh OUT_DIR
set -e
OUT=${1:?usage: make_space.sh OUT_DIR}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
cp "$HERE/app.py" "$HERE/engine.py" "$OUT/"
cp -r "$HERE/static" "$OUT/"
rm -rf "$OUT/solv3r"
cp -r "$HERE/../solv3r" "$OUT/"
find "$OUT/solv3r" -name __pycache__ -prune -exec rm -rf {} +
mkdir -p "$OUT/examples"
cp -r "$HERE/../examples/data/park" "$HERE/../examples/data/desk" "$OUT/examples/"
cp "$HERE/space/README.md" "$HERE/space/requirements.txt" "$OUT/"
echo "Space folder: $OUT ($(du -sh "$OUT" | cut -f1))"
