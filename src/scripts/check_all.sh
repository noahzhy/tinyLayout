#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONPATH="$(pwd)/src${PYTHONPATH:+:$PYTHONPATH}"
python -m pytest -q
python -m structmap_jepa.training.smoke --config configs/smoke.yaml --steps 3 --output runs/smoke
python -m structmap_jepa.graph.demo --output runs/graph_demo
python -m structmap_jepa.data.manifest examples/window_manifest.json
