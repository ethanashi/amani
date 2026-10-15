#!/usr/bin/env bash
# Run the deterministic reference (arm D) on the clean data (the answer) and on the arm-facing
# flawed copy (what an analyst who misses the planted flaw would get), twice each for clean, and
# record output hashes. Usage, from packages/bio-baseline:
#   bash reference/run_reference.sh [dataset-root] [draws]
#
# Seal-aware: if the clean data has been sealed at rest (clean/*.tsv.enc), it is decrypted into a
# throwaway dir with the sealing key for the run and removed afterwards (the arm copy stays
# plaintext -- the arm needs it). This writes PLAINTEXT reference outputs; seal them afterwards with
#   python arms/lib/seal.py seal reference/output/clean/summary.json reference/output/clean/draws.tsv \
#          reference/output/arm/summary.json reference/output/arm/draws.tsv reference/output/run.log
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ "${BIO_OPERATION:-}" != grading ]; then
  exec python3 "$PKG/arms/lib/operation.py" grading -- bash "$0" "$@"
fi
GRADING_ROOT="$(python3 -c "import sys; sys.path.insert(0, '$PKG/arms/lib'); import operation; print(operation.root())")"
RUN_TMP="$(mktemp -d "$GRADING_ROOT/reference.XXXXXX")"
trap 'rm -rf "$RUN_TMP"' EXIT
ROOT="${1:-$HOME/.omerta-bio/datasets/metabric}"
DRAWS="${2:-1000}"
OUT="$RUN_TMP/output"
mkdir -p "$OUT/clean" "$OUT/arm"
cd "$PKG"

# Resolve a plaintext clean dir (clean/ itself, or a temp decrypt of the sealed data).
CLEAN_TMP=""
if [ -f "$ROOT/clean/clinical_patient.tsv" ]; then
  CLEAN="$ROOT/clean"
else
  CLEAN_TMP="$(mktemp -d "$RUN_TMP/biobase-clean.XXXXXX")"
  for f in clinical_patient.tsv clinical_sample.tsv clinical_attributes.tsv expression_mrna.tsv; do
    python3 "$PKG/arms/lib/seal.py" open-to "$ROOT/clean/$f.enc" "$CLEAN_TMP/$f" >/dev/null
  done
  CLEAN="$CLEAN_TMP"
fi
SECOND="$(mktemp -d "$RUN_TMP/biobase-ref.XXXXXX")"


run() { pixi run --frozen Rscript reference/venet_reference.R --data "$1" --out "$2" --draws "$DRAWS"; }
{
  echo "# reference run, draws=$DRAWS"
  pixi run --frozen Rscript -e 'cat(R.version.string, "| survival", as.character(packageVersion("survival")), "| data.table", as.character(packageVersion("data.table")), "\n"); cat(sessionInfo()$BLAS, "\n")' | sed "s#$PKG#<pkg>#g"
  echo "## clean"
  t0=$SECONDS; run "$CLEAN" "$OUT/clean" 2>&1; echo "(wall ~$((SECONDS - t0)) s)"
  echo "## arm (flawed copy)"
  t0=$SECONDS; run "$ROOT/arm" "$OUT/arm" 2>&1; echo "(wall ~$((SECONDS - t0)) s)"
} > "$OUT/run.log"
# Determinism check: a second clean run must be byte-identical.
run "$CLEAN" "$SECOND" > /dev/null
(cd "$OUT" && shasum -a 256 clean/summary.json clean/draws.tsv arm/summary.json arm/draws.tsv) > "$OUT/HASHES.txt"
if cmp -s "$OUT/clean/summary.json" "$SECOND/summary.json" && cmp -s "$OUT/clean/draws.tsv" "$SECOND/draws.tsv"; then
  echo "second clean run: byte-identical" >> "$OUT/HASHES.txt"
else
  echo "second clean run: DIFFERENT (nondeterminism)" >> "$OUT/HASHES.txt"
  exit 1
fi
{
  echo "inputs:"
  (cd "$CLEAN" && shasum -a 256 clinical_patient.tsv clinical_sample.tsv clinical_attributes.tsv expression_mrna.tsv | sed 's#\( \)#\1clean/#2')
  (cd "$ROOT" && shasum -a 256 arm/*.tsv)
} >> "$OUT/HASHES.txt"
# Persist only ciphertext; never emit reference numbers to terminal/session transcripts.
for f in clean/summary.json clean/draws.tsv arm/summary.json arm/draws.tsv run.log; do
  python3 arms/lib/seal.py seal "$OUT/$f" >/dev/null
  cp "$OUT/$f.enc" "$OUT/$f.enc.sha256" "$PKG/reference/output/$(dirname "$f")/"
done
cp "$OUT/HASHES.txt" "$PKG/reference/output/HASHES.txt"
echo 'Reference complete; encrypted artifacts saved.'
