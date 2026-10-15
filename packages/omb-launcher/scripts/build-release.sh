#!/bin/sh
# Owner-side only. All mutable build/cache files remain under explicit staging.
set -eu
[ "$(/usr/bin/id -u)" -ne 0 ] || { echo 'Build as owner, never root.' >&2; exit 77; }
[ "$#" -eq 1 ] || { echo 'Usage: build-release.sh /absolute/new/staging-directory' >&2; exit 64; }
case "$1" in /*) ;; *) exit 64;; esac
script=$(/usr/bin/dirname "$0")
exec /usr/bin/python3 -I "$script/build_release.py" "$1"
