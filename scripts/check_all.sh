#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TINYLAYOUT_PY="${TINYLAYOUT_PY:-python3}"
npm test
npm run build
"$TINYLAYOUT_PY" -m unittest discover -s tests -p 'test_*.py' -v
