#!/bin/sh
set -eu
# core.hooksPath is shared by worktrees. Anchor it to the main checkout.
common=$(git rev-parse --path-format=absolute --git-common-dir)
case "$common" in
  */.git) root=${common%/.git} ;;
  *) echo 'Refusing: expected a main checkout with a .git directory' >&2; exit 1 ;;
esac
url=$(git remote get-url origin)
case "$url" in
  https://github.com/ethanashi/omerta-bio.git|https://github.com/ethanashi/omerta-bio|git@github.com:ethanashi/omerta-bio.git) ;;
  *) echo 'Refusing: hooks may be installed only in ethanashi/omerta-bio' >&2; exit 1 ;;
esac
old=$(git config --get core.hooksPath || true)
new="$root/scripts/ci"
case "$old" in
  ""|"$new"|"$HOME/projects/omerta-bio-wt/ci/scripts/ci") ;;
  *) echo "Existing hooksPath must be integrated first: $old" >&2; exit 1 ;;
esac
[ -f "$new/pre-push" ] || { echo 'Refusing: main checkout CI hook is missing' >&2; exit 1; }
git config --local core.hooksPath "$new"
printf 'Installed development pre-push hook at %s (shared by its worktrees)\n' "$new"
