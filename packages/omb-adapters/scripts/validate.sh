#!/usr/bin/env bash
# Run from repository root, under quiet-tests.py --wait. Limit nested BLAS threads.
set -u
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
validation_status=0
workers=${VALIDATION_WORKERS:-6}
case "$workers" in *[!0-9]*|'') exit 2 ;; esac
if [ "${VALIDATE_PACKAGE:-0}" = 1 ]; then
  pnpm exec vitest run packages/omb-adapters --maxWorkers=4 > packages/omb-adapters/package-review-test.log 2>&1 || exit 1
fi
for pass in ${VALIDATION_PASSES:-1 2}; do
  case "$pass" in *[!0-9]*|'') exit 2 ;; esac
  pnpm typecheck > "packages/omb-adapters/typecheck-$pass.log" 2>&1
  check=$?
  pnpm test --maxWorkers="$workers" > "packages/omb-adapters/repo-test-$pass.log" 2>&1
  suite=$?
  printf 'pass %s: typecheck=%s test=%s\n' "$pass" "$check" "$suite"
  if [[ "$check" != 0 || "$suite" != 0 ]]; then validation_status=1; fi
done
exit "$validation_status"
