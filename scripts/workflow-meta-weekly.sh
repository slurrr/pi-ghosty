#!/usr/bin/env bash
set -euo pipefail

# Weekly cron-style wrapper for workflow meta analysis.
# Suggested cron (runs every Monday at 09:00):
# 0 9 * * 1 cd /home/poop/code/dev/pi-ghosty && ./scripts/workflow-meta-weekly.sh >> /home/poop/runs/pi-ghosty/data/workflow/meta-analysis/cron.log 2>&1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEWS_DIR="${1:-/home/poop/runs/pi-ghosty/data/workflow/reviews}"
OUT_DIR="/home/poop/runs/pi-ghosty/data/workflow/meta-analysis"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT_FILE="${OUT_DIR}/weekly-${TS}.txt"

mkdir -p "${OUT_DIR}"

echo "[workflow-meta-weekly] running at ${TS}" | tee "${OUT_FILE}"
echo "[workflow-meta-weekly] reviewsDir=${REVIEWS_DIR}" | tee -a "${OUT_FILE}"
node "${ROOT_DIR}/scripts/workflow-meta-analysis.mjs" "${REVIEWS_DIR}" | tee -a "${OUT_FILE}"
echo "[workflow-meta-weekly] wrote ${OUT_FILE}" | tee -a "${OUT_FILE}"
