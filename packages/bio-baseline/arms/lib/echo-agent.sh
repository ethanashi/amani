#!/usr/bin/env bash
# Trivial stand-in agent for dry runs and tests. Calls no model and needs no network.
# It proves the runner plumbing: fresh workdir, inputs present, env activates, outputs collected.
#   ECHO_AGENT_MODE=full (default)  check R + Python from ./env.sh, write deliverables
#   ECHO_AGENT_MODE=fast            write deliverables only (no env check; for tests)
#   ECHO_AGENT_MODE=fail            write deliverables, then exit 3
#   ECHO_AGENT_MODE=hang            print a marker, then block until killed (timeout/cancel tests)
#   ECHO_AGENT_MODE=orphan          leave a detached process (own session, cwd in the workdir) behind
set -u
mode="${ECHO_AGENT_MODE:-full}"
printf '{"type":"system","subtype":"init","model":"echo-agent","tools":["Bash"],"mcp_servers":[],"cwd":"%s"}\n' "$PWD"
printf 'prompt: %s\n' "${1:-}" >&2
ls -la . data >&2
if [ ! -f TASK.md ] || [ ! -f ENVIRONMENT.md ] || [ ! -f env.sh ]; then
  echo "inputs missing" >&2
  exit 2
fi
if [ "$mode" = family ]; then
  # Two children outside scratch: one in the agent group, one in another group
  # of the same session. Pipes acknowledge each boundary without timer guesses.
  exec python3 -c 'import os, signal
for separate in (False, True):
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(r)
        os.chdir("/")
        if separate: os.setpgid(0, 0)
        os.write(w, b"R"); os.close(w)
        signal.pause()
        os._exit(0)
    os.close(w); os.read(r, 1); os.close(r)
    print("FAMILY_PID=" + str(pid), file=__import__("sys").stderr, flush=True)
print("ECHO_AGENT_READY", file=__import__("sys").stderr, flush=True)
signal.pause()'
fi
if [ "$mode" = hang ]; then
  # Block without a timer: wait on a FIFO nobody writes to. The runner kills the group.
  fifo="$PWD/.hang.fifo"
  mkfifo "$fifo"
  echo "ECHO_AGENT_READY" >&2
  read -r _ < "$fifo"
  exit 0
fi
if [ "$mode" = orphan ]; then
  # A child that escapes the process group (setsid) and blocks on a FIFO. Neither its command
  # line nor its environment (TMPDIR dropped) mentions the temp dir; only its cwd is inside it.
  # The agent waits (FIFO handshake, no timer) until the child has left the process group.
  mkfifo .orphan.fifo .orphan.ready
  env -u TMPDIR python3 -c 'import os; os.setsid(); open(".orphan.ready", "w").write("ok\n"); open(".orphan.fifo").read()' \
    </dev/null >/dev/null 2>&1 &
  read -r _ < .orphan.ready
fi
mkdir -p code outputs
if [ "$mode" = full ]; then
  # shellcheck disable=SC1091
  source ./env.sh
  Rscript -e 'suppressPackageStartupMessages(library(survival)); cat("R ok", R.version.string, "\n")' >&2 || exit 4
  python -c 'import lifelines, sys; print("python ok", sys.version.split()[0], "lifelines", lifelines.__version__)' >&2 || exit 4
fi
cat > code/count.py <<'PY'
import json
with open("data/expression_mrna.tsv") as fh:
    header = fh.readline().rstrip("\n").split("\t")
with open("data/clinical_patient.tsv") as fh:
    n_pat = sum(1 for _ in fh) - 1
with open("outputs/counts.json", "w") as fh:
    json.dump({"expression_samples": len(header) - 2, "clinical_patients": n_pat}, fh)
PY
cat > run_all.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
source ./env.sh
mkdir -p outputs
python3 code/count.py
python3 - <<'PY'
import json
c = json.load(open("outputs/counts.json"))
json.dump({"dry_run": True, "counts": c}, open("results.json", "w"), indent=2)
PY
SH
bash run_all.sh >&2 || exit 4
printf '# Dry run\n\nEcho agent: no analysis was performed.\n' > REPORT.md
if [ "$mode" = fail ]; then exit 3; fi
printf '{"type":"result","subtype":"success","is_error":false,"result":"echo agent finished","num_turns":1}\n'
