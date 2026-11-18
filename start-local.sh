#!/bin/sh
# Life Way from local clones: repos/ → data → browser. Photos go to photos/.
cd "$(dirname "$0")" && exec python3 fetch_local.py "$@"
