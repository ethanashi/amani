#!/bin/sh
# Coordinator/owner invocation only; this script intentionally invokes sudo -n.
set -eu
[ "$#" = 1 ] || { echo 'Usage: verify-install.sh <expected-manifest-sha256>' >&2; exit 64; }
[ "$(/usr/bin/id -u)" != 0 ] || exit 77
case "$1" in *[!a-f0-9]*|'') exit 64;; esac
[ "${#1}" = 64 ] || exit 64
release=/usr/local/libexec/omb/current
# Execute the version being verified, never an owner-writable Homebrew Node.
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/var/empty LANG=C \
  "$release/bin/node" "$release/omb-verify.mjs" "$1"
