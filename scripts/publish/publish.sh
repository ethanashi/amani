#!/bin/sh
# Publish a snapshot of a git ref to the Amani repository.
#
#   scripts/publish/publish.sh <git-ref> [--dry-run] [--allow-cleanup-findings]
#
# 1. git-archive the ref from the development repository into a staging directory.
# 2. Apply scripts/publish/exclude.txt and run scripts/publish/audit.mjs on the result.
# 3. Commit the tree as ONE snapshot commit on top of the clone's history, authored with the
#    GitHub no-reply identity (no personal email ships), and push to main. History is never
#    rewritten; there is no force-push.
#
# Blocking audit classes (secrets, personal email, oversized files, third-party licence gaps,
# sealed leakage) always stop the publish. The "cleanup" classes (absolute home paths and names of
# other private projects) stop it too unless --allow-cleanup-findings is given, and that flag is
# only honoured while the target repository is PRIVATE. The script never changes visibility.
set -eu

REPO_SLUG=${AMANI_REPO_SLUG:-ethanashi/amani}
DEV_REPO=${AMANI_DEV_REPO:-$HOME/projects/omerta-bio}
PUBLISH_ROOT=${AMANI_PUBLISH_ROOT:-$HOME/projects/omerta-bio-wt/_publish}
CLONE=$PUBLISH_ROOT/amani-clone
AUTHOR_NAME='Ethan Ashihundu'
AUTHOR_EMAIL='76891525+ethanashi@users.noreply.github.com'
NODE_BIN=${AMANI_NODE_BIN:-/opt/homebrew/opt/node@24/bin}

ref=''; dry=0; allow=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --allow-cleanup-findings) allow=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 64 ;;
    *) [ -z "$ref" ] || { echo 'only one git ref is allowed' >&2; exit 64; }; ref=$arg ;;
  esac
done
[ -n "$ref" ] || { echo 'usage: publish.sh <git-ref> [--dry-run] [--allow-cleanup-findings]' >&2; exit 64; }

PATH=$NODE_BIN:$PATH
export PATH
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo 'Node 24 is required' >&2; exit 69; }

commit=$(git -C "$DEV_REPO" rev-parse --verify "$ref^{commit}")
# Gate before export, audit, cloning or any network operation, including dry runs.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$SCRIPT_DIR/../ci/receipt.py" "$DEV_REPO" "$commit" full
short=$(git -C "$DEV_REPO" rev-parse --short=8 "$commit")
mkdir -p "$PUBLISH_ROOT"
STAGE=$(mktemp -d "$PUBLISH_ROOT/stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT INT TERM

echo "== export $ref ($short)"
git -C "$DEV_REPO" archive "$commit" | tar -x -C "$STAGE"
[ -f "$STAGE/scripts/publish/exclude.txt" ] || { echo 'ref has no scripts/publish/exclude.txt' >&2; exit 65; }

echo '== apply exclusions'
node "$STAGE/scripts/publish/apply-exclusions.mjs" "$STAGE" "$STAGE/scripts/publish/exclude.txt" | tail -n 40

echo '== audit'
report=$PUBLISH_ROOT/last-audit.json
set +e
node "$STAGE/scripts/publish/audit.mjs" "$STAGE" --json "$report"
audit_status=$?
set -e
if [ "$audit_status" -ne 0 ]; then
  blocking=$(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const cleanup = ["home-path", "private-project-name"];
    const n = Object.entries(r.counts).filter(([k]) => !cleanup.includes(k)).reduce((a, [, v]) => a + v, 0);
    process.stdout.write(String(n + (r.leakageHook.status === "error" ? 1 : 0)));
  ' "$report")
  if [ "$blocking" -ne 0 ]; then
    echo "STOP: $blocking blocking audit finding(s). See $report" >&2
    exit 1
  fi
  [ "$allow" -eq 1 ] || { echo 'STOP: cleanup-class audit findings remain (pass --allow-cleanup-findings for a private preview).' >&2; exit 1; }
fi

if [ "$dry" -eq 1 ]; then echo '== dry run: nothing pushed'; exit 0; fi

echo "== check $REPO_SLUG visibility"
visibility=$(gh repo view "$REPO_SLUG" --json visibility --jq .visibility)
if [ "$visibility" != PRIVATE ] && [ "$allow" -eq 1 ]; then
  echo "STOP: $REPO_SLUG is $visibility; --allow-cleanup-findings only applies to a PRIVATE repository." >&2
  exit 1
fi

if [ ! -d "$CLONE/.git" ]; then gh repo clone "$REPO_SLUG" "$CLONE"; fi
git -C "$CLONE" fetch --quiet origin
if git -C "$CLONE" rev-parse --verify --quiet origin/main >/dev/null; then
  git -C "$CLONE" checkout --quiet -B main origin/main
else
  git -C "$CLONE" checkout --quiet -B main
fi

echo '== replace clone contents with the snapshot'
find "$CLONE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
(cd "$STAGE" && tar -cf - .) | (cd "$CLONE" && tar -xf -)
# -f: the snapshot is exactly the archive minus the exclusions, even for tracked files that the
# tree's own .gitignore would otherwise drop silently.
git -C "$CLONE" add -A -f
if git -C "$CLONE" diff --cached --quiet; then
  # Nothing new to commit. If an earlier run committed this tree but the push failed, push it now.
  if git -C "$CLONE" rev-parse --verify --quiet origin/main >/dev/null \
    && [ "$(git -C "$CLONE" rev-parse HEAD)" = "$(git -C "$CLONE" rev-parse origin/main)" ]; then
    echo 'snapshot is identical to main: nothing to commit'; exit 0
  fi
  echo 'snapshot already committed locally but not pushed: pushing it'
else
  msg=$(mktemp "$PUBLISH_ROOT/msg.XXXXXX")
  {
    echo "Snapshot of $ref"
    echo
    echo "Source ref: $ref"
    echo "Source commit: $commit"
    echo
    echo 'Squashed export of the development repository after the exclusions in'
    echo 'scripts/publish/exclude.txt and a passing audit (scripts/publish/audit.mjs).'
  } > "$msg"
  GIT_AUTHOR_NAME=$AUTHOR_NAME GIT_AUTHOR_EMAIL=$AUTHOR_EMAIL GIT_COMMITTER_NAME=$AUTHOR_NAME GIT_COMMITTER_EMAIL=$AUTHOR_EMAIL \
    git -C "$CLONE" -c commit.gpgsign=false commit --quiet -F "$msg"
  rm -f "$msg"
fi
# A large snapshot over a slow link can be cut off with HTTP 408. If the plain push fails, upload the
# objects in small pieces as temporary tags, push the branch (now a tiny pack) and remove the tags.
if ! git -C "$CLONE" -c http.version=HTTP/1.1 push origin main; then
  echo 'push failed; retrying with chunked object upload'
  python3 "$STAGE/scripts/publish/push-chunked.py" upload "$CLONE"
  git -C "$CLONE" -c http.version=HTTP/1.1 push origin main
  python3 "$STAGE/scripts/publish/push-chunked.py" cleanup "$CLONE"
fi
echo "== pushed $(git -C "$CLONE" rev-parse --short=8 HEAD) from $ref ($short)"
