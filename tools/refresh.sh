#!/bin/sh
# Incremental GitLab refresh (cron): 0 8-20 * * 1-5 /path/to/tools/refresh.sh
cd "$(dirname "$0")/.." && python3 fetch_gitlab.py >> refresh.log 2>&1
