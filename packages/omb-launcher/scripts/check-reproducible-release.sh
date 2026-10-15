#!/bin/sh
# Expensive owner-side audit: build twice from the same checkout and compare
# the complete sealed manifest hashes. Both builds use normal local caches.
set -eu
[ "$(/usr/bin/id -u)" -ne 0 ] || exit 77
script=$(/usr/bin/dirname "$0")
package=$(cd "$script/.." && /bin/pwd)
scratch=$package/.scratch
/bin/mkdir -p "$scratch"
first=$scratch/repro-first-$$
second=$scratch/repro-second-$$
cleanup() { /usr/bin/python3 -c 'import shutil,sys; [shutil.rmtree(p,ignore_errors=True) for p in sys.argv[1:]]' "$first" "$second"; }
trap cleanup EXIT HUP INT TERM
/bin/mkdir "$first" "$second"
/bin/sh "$script/build-release.sh" "$first"
/bin/sh "$script/build-release.sh" "$second"
one=$(/usr/bin/shasum -a 256 "$first/MANIFEST")
two=$(/usr/bin/shasum -a 256 "$second/MANIFEST")
set -- $one; first_hash=$1
set -- $two; second_hash=$1
[ "$first_hash" = "$second_hash" ] || { echo 'Release rebuilds differ.' >&2; exit 1; }
echo "$first_hash"
