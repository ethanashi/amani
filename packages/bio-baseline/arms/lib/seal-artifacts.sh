#!/usr/bin/env bash
# Encrypt (or decrypt) the answer-bearing artifacts at rest with the sealing key.
#
#   bash arms/lib/seal-artifacts.sh seal    [dataset-root]   # plaintext -> <name>.enc, remove plaintext
#   bash arms/lib/seal-artifacts.sh unseal  [dataset-root]   # <name>.enc -> plaintext (for a re-run/review)
#   bash arms/lib/seal-artifacts.sh status  [dataset-root]
#
# Sealed: task/SEALED-ANSWER.md, reference/output/{clean,arm}/{summary.json,draws.tsv},
# reference/output/run.log, and the clean data store (clean/*.tsv). The arm-facing copy stays
# plaintext (the arm needs it). The key lives at ~/.omerta-bio/keys/sealing.key (mode 0400),
# outside any path an arm can read. HASHES.txt stays plaintext (integrity info, not the answer).
set -euo pipefail
PKG="$(cd "$(dirname "$0")/../.." && pwd -P)"
PY="${ARM_PYTHON:-python3}"
ACTION="${1:-status}"
ROOT="${2:-$HOME/.omerta-bio/datasets/metabric}"
SEAL="$PKG/arms/lib/seal.py"

artifacts=(
  "$PKG/task/SEALED-ANSWER.md"
  "$PKG/reference/output/clean/summary.json"
  "$PKG/reference/output/clean/draws.tsv"
  "$PKG/reference/output/arm/summary.json"
  "$PKG/reference/output/arm/draws.tsv"
  "$PKG/reference/output/run.log"
  "$ROOT/clean/clinical_patient.tsv"
  "$ROOT/clean/clinical_sample.tsv"
  "$ROOT/clean/clinical_attributes.tsv"
  "$ROOT/clean/expression_mrna.tsv"
)

case "$ACTION" in
  seal)
    "$PY" "$SEAL" init >/dev/null
    for a in "${artifacts[@]}"; do
      if [ -f "$a" ]; then "$PY" "$SEAL" seal "$a" >/dev/null && echo "sealed   $a";
      elif [ -f "$a.enc" ]; then echo "already  $a.enc";
      else echo "missing  $a" >&2; fi
    done ;;
  unseal)
    for a in "${artifacts[@]}"; do
      if [ -f "$a.enc" ]; then "$PY" "$SEAL" open-to "$a.enc" "$a" >/dev/null && rm -f "$a.enc" "$a.enc.sha256" && echo "unsealed $a";
      elif [ -f "$a" ]; then echo "plain    $a";
      else echo "missing  $a" >&2; fi
    done ;;
  status)
    for a in "${artifacts[@]}"; do "$PY" "$SEAL" status "$a"; done ;;
  *)
    echo "usage: $0 {seal|unseal|status} [dataset-root]" >&2; exit 2 ;;
esac
