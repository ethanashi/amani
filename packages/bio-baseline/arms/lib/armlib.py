#!/usr/bin/env python3
"""Helpers for the arm runners (standard library only, Python >= 3.9).

  armlib.py hash-tree DIR OUT            sha256 manifest of every regular file under DIR
  armlib.py collect WORK DEST LIMIT_MB   copy agent output (minus data/, env/, env.sh) to DEST
  armlib.py finish WORK RESULT LIMIT_MB  collect to RESULT/workdir, hash data/ again, print
                                         "true" if data/ differs from RESULT/inputs.sha256
  armlib.py final-claude TRANSCRIPT OUT  extract final result text + init info from stream-json
  armlib.py meta OUT key=value ...       write meta.json (values parsed as JSON when possible)
  armlib.py env-sh PIXI_TOML OUT          static activation script for a pixi env (see env_sh)
  armlib.py verify-task STAGE SHA256      refuse unless STAGE matches its manifest and the manifest
                                         bytes hash to SHA256 (bio-tasks staged task directory)
  armlib.py copy-task STAGE SHA256 WORK   verify, copy TASK.md + data/* into WORK, verify the copies
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

EXCLUDE_TOP = {"data", "env", "env.sh", ".pixi"}


def strict_json_loads(text: str):
    """Reject ambiguous objects at every depth, without echoing their contents."""
    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def nonfinite(_):
        raise ValueError("nonfinite JSON number")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=nonfinite)


def result_row_key(row, index):
    key = row.get("size", row.get("name", index)) if isinstance(row, dict) else index
    if isinstance(key, bool) or not isinstance(key, (str, int, float)):
        raise ValueError("invalid list row key (size/name)")
    # Numeric strings and numbers denote the same row, just as the old display paths did.
    try:
        numeric = float(key)
    except (ValueError, OverflowError):
        return str(key)
    if not math.isfinite(numeric):
        raise ValueError("nonfinite list row key")
    return str(int(numeric)) if numeric.is_integer() else str(numeric)


def validate_result_rows(value) -> None:
    """Validate before flattening, including rows containing only text or under extra."""
    if isinstance(value, dict):
        for child in value.values():
            validate_result_rows(child)
    elif isinstance(value, list):
        seen = set()
        for index, child in enumerate(value):
            key = result_row_key(child, index)
            if key in seen:
                raise ValueError("duplicate list row key (size/name)")
            seen.add(key)
            validate_result_rows(child)


RERUN_FILE_CAP = 1_000_000
RERUN_TOTAL_CAP = 20_000_000
RERUN_SOURCE_SUFFIXES = {".py", ".r", ".sh", ".jl", ".md", ".txt"}
RERUN_CONFIG_SUFFIXES = {".json", ".yaml", ".yml"}


def rerun_path_reason(rel: Path, *, directory=False, trusted_paths=()) -> str | None:
    """Closed copy policy. Trusted paths are supplied only by the host journal verifier."""
    if str(rel) in trusted_paths:
        return None
    if directory:
        if any(str(p).startswith(rel.as_posix() + "/") for p in trusted_paths):
            return None
        if rel.parts[0] != "code":
            return "not source directory"
        name = rel.name.lower()
        if (name.startswith(".") or "cache" in name or name in
                {"data", "datasets", "outputs", "output", "results", "intermediates"}):
            return "data/cache/output directory"
        return None
    if rel.as_posix() in {"run_all.sh", "env.sh"}:
        return None
    if len(rel.parts) < 2 or rel.parts[0] != "code":
        return "not re-run source"
    if "cache" in rel.name.lower() or rel.stem.lower() in {"data", "results", "output", "outputs"}:
        return "data/cache/output file"
    suffix = rel.suffix.lower()
    if suffix in RERUN_SOURCE_SUFFIXES:
        return None
    if suffix in RERUN_CONFIG_SUFFIXES:
        # JSON/YAML is configuration, not a saved result table. Use explicit config locations.
        config_names = {"config", "settings", "parameters", "params", "spec"}
        if (rel.stem.lower() in config_names or rel.stem.lower().endswith(".config") or
                any(p.lower() in {"config", "configs"} for p in rel.parts[1:-1])):
            return None
        return "JSON/YAML outside config allow-list"
    return "extension not allowed"


def copy_rerun_sources(work: Path, dest: Path, *, trusted_paths=()) -> dict:
    """Build a fresh source-only tree; no links, binaries, cached inputs or prior outputs.

    Collection remains an evidence archive. Only this separate tree is executable input.
    The journal-verified host preparation wrapper/spec is the sole extra allow-list.
    """
    dest.mkdir(parents=True, exist_ok=False)
    record = {"copied": [], "excluded": [], "file_cap_bytes": RERUN_FILE_CAP,
              "total_cap_bytes": RERUN_TOTAL_CAP}
    total = 0
    for dirpath, dirnames, filenames in os.walk(work, followlinks=False):
        base = Path(dirpath)
        for name in sorted(dirnames):
            src = base / name
            rel = src.relative_to(work)
            reason = "symlink" if src.is_symlink() else rerun_path_reason(
                rel, directory=True, trusted_paths=trusted_paths)
            if reason:
                dirnames.remove(name)
                record["excluded"].append({"path": rel.as_posix() + "/", "reason": reason})
        dirnames.sort()
        for name in sorted(filenames):
            src = base / name
            rel = src.relative_to(work)
            reason = "symlink" if src.is_symlink() else rerun_path_reason(rel, trusted_paths=trusted_paths)
            if not reason and (not src.is_file() or src.stat().st_nlink != 1):
                reason = "not a single-link regular file"
            if not reason and src.stat().st_size > RERUN_FILE_CAP:
                reason = "file size cap"
            content = b""
            if not reason:
                content = src.read_bytes()
                try:
                    content.decode("utf-8")
                    if b"\0" in content:
                        raise ValueError("binary")
                except (UnicodeDecodeError, ValueError):
                    reason = "not UTF-8 text"
            if not reason and total + len(content) > RERUN_TOTAL_CAP:
                reason = "total size cap"
            if reason:
                record["excluded"].append({"path": rel.as_posix(), "reason": reason})
                continue
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(src.stat().st_mode & 0o777)
            total += len(content)
            record["copied"].append(rel.as_posix())
    return record

# Staged task directories (packages/bio-tasks): TASK.md, data/<flat files>, manifest.json.
# The manifest format is defined here, once, so the arm runner (system python, stdlib only)
# and the bio-tasks library write and verify exactly the same bytes.
TASK_MANIFEST_SCHEMA = "bio-tasks/manifest@1"
_TASK_DATA_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def task_manifest_write(stage: Path, task_id: str, seed: int) -> str:
    """Write STAGE/manifest.json over STAGE/TASK.md and every STAGE/data/<file>; return its sha256."""
    stage = Path(stage)
    entries = []
    names = ["TASK.md"] + ["data/" + p.name for p in sorted((stage / "data").iterdir(), key=lambda q: q.name)]
    for rel in names:
        p = stage / rel
        if p.is_symlink() or not p.is_file():
            raise SystemExit(f"staged entry is not a regular file: {rel}")
        if rel != "TASK.md" and not _TASK_DATA_NAME.match(p.name):
            raise SystemExit(f"staged data file name not allowed: {rel}")
        entries.append({"path": rel, "bytes": p.stat().st_size, "sha256": sha256_file(p)})
    raw = (json.dumps({"schema": TASK_MANIFEST_SCHEMA, "task": task_id, "seed": int(seed), "files": entries},
                      indent=2, sort_keys=True) + "\n").encode()
    (stage / "manifest.json").write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def _task_manifest_entries(stage: Path, expected_sha: str) -> tuple[list, list[str]]:
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha or ""):
        return [], ["expected manifest sha256 is malformed"]
    mpath = stage / "manifest.json"
    if mpath.is_symlink() or not mpath.is_file():
        return [], ["manifest.json missing"]
    raw = mpath.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha:
        return [], ["manifest.json does not hash to the expected task manifest sha256"]
    try:
        m = json.loads(raw)
    except ValueError:
        return [], ["manifest.json unparseable"]
    files = m.get("files") if isinstance(m, dict) else None
    if not isinstance(m, dict) or m.get("schema") != TASK_MANIFEST_SCHEMA or not isinstance(files, list) or not files:
        return [], ["manifest.json schema invalid"]
    seen, problems = set(), []
    for f in files:
        rel = f.get("path") if isinstance(f, dict) else None
        ok = isinstance(rel, str) and (rel == "TASK.md" or (rel.startswith("data/") and
                                                         _TASK_DATA_NAME.match(rel[5:]) is not None))
        if (not ok or rel in seen or not isinstance(f.get("sha256"), str) or
                not isinstance(f.get("bytes"), int) or isinstance(f.get("bytes"), bool)):
            return [], [f"manifest entry invalid: {rel!r}"]
        seen.add(rel)
    if "TASK.md" not in seen:
        problems.append("manifest lists no TASK.md")
    return files, problems


def task_manifest_problems(stage: Path, expected_sha: str) -> list[str]:
    """Empty list only when STAGE holds exactly the manifest's files with matching bytes."""
    stage = Path(stage)
    files, problems = _task_manifest_entries(stage, expected_sha)
    if problems or not files:
        return problems or ["manifest empty"]
    listed = {f["path"] for f in files}
    for f in files:
        p = stage / f["path"]
        if p.is_symlink() or not p.is_file():
            problems.append(f"missing {f['path']}")
        elif p.stat().st_size != f["bytes"] or sha256_file(p) != f["sha256"]:
            problems.append(f"hash mismatch {f['path']}")
    for dirpath, dirnames, filenames in os.walk(stage, followlinks=False):
        rel_dir = Path(dirpath).relative_to(stage)
        for d in dirnames:
            rel = (rel_dir / d).as_posix()
            if rel != "data" or (Path(dirpath) / d).is_symlink():
                problems.append(f"unexpected directory {rel}")
        for name in filenames:
            rel = (rel_dir / name).as_posix()
            if rel != "manifest.json" and rel not in listed:
                problems.append(f"unexpected file {rel}")
    return sorted(set(problems))


def copy_task_stage(stage: Path, expected_sha: str, work: Path) -> list[str]:
    """Verify STAGE, copy its files into WORK (data read-only), and verify the copies."""
    stage, work = Path(stage), Path(work)
    problems = task_manifest_problems(stage, expected_sha)
    if problems:
        return problems
    files, _ = _task_manifest_entries(stage, expected_sha)
    (work / "data").mkdir(parents=True, exist_ok=True)
    for f in files:
        src, dst = stage / f["path"], work / f["path"]
        if dst.exists():
            return [f"refusing to overwrite {f['path']} in the work dir"]
        if subprocess.run(["cp", "-c", str(src), str(dst)], capture_output=True).returncode != 0:
            shutil.copyfile(src, dst)
        if f["path"].startswith("data/"):
            os.chmod(dst, 0o444)
    for f in files:
        p = work / f["path"]
        if p.is_symlink() or not p.is_file() or p.stat().st_size != f["bytes"] or sha256_file(p) != f["sha256"]:
            problems.append(f"copied file does not match the manifest: {f['path']}")
    return problems


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def hash_tree(root: Path, out: Path) -> None:
    lines = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        rel_dir = Path(dirpath).relative_to(root)
        if rel_dir.parts and rel_dir.parts[0] in {"env", ".pixi"}:
            dirnames[:] = []
            continue
        for name in sorted(filenames):
            p = Path(dirpath) / name
            if p.is_symlink() or not p.is_file():
                continue
            lines.append(f"{sha256_file(p)}  {p.stat().st_size}  {p.relative_to(root)}")
    out.write_text("\n".join(lines) + ("\n" if lines else ""))


def collect(work: Path, dest: Path, limit_mb: float) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    skipped, links, copied = [], [], 0
    limit = int(limit_mb * 1024 * 1024)
    for dirpath, dirnames, filenames in os.walk(work, followlinks=False):
        rel_dir = Path(dirpath).relative_to(work)
        if not rel_dir.parts:
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_TOP]
        dirnames.sort()
        for name in sorted(filenames):
            src = Path(dirpath) / name
            rel = src.relative_to(work)
            if not rel_dir.parts and name in EXCLUDE_TOP:
                continue
            if src.is_symlink():
                links.append({"path": str(rel), "target": os.readlink(src)})
                continue
            if not src.is_file():
                continue
            size = src.stat().st_size
            if size > limit:
                skipped.append({"path": str(rel), "bytes": size, "sha256": sha256_file(src)})
                continue
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest / rel, follow_symlinks=False)
            copied += 1
        for d in list(dirnames):
            if (Path(dirpath) / d).is_symlink():
                links.append({"path": str(rel_dir / d), "target": os.readlink(Path(dirpath) / d)})
    (dest.parent / "collect.json").write_text(json.dumps(
        {"copied_files": copied, "skipped_large": skipped, "symlinks": links, "limit_mb": limit_mb},
        indent=2, sort_keys=True) + "\n")


def finish(work: Path, result: Path, limit_mb: float) -> str:
    if os.environ.get("ARM_FORCE_FINISH_FAIL"):  # test seam: simulate a collection failure
        raise SystemExit("ARM_FORCE_FINISH_FAIL")
    collect(work, result / "workdir", limit_mb)
    hash_tree(work / "data", result / "data_after.sha256")
    before = [ln.replace("  data/", "  ", 1) for ln in (result / "inputs.sha256").read_text().splitlines()
              if "  data/" in ln]
    after = (result / "data_after.sha256").read_text().splitlines()
    return "false" if before == after and before else "true"


def final_claude(transcript: Path, out: Path) -> None:
    init, result = {}, None
    for line in transcript.read_text(errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            init = {k: ev.get(k) for k in ("model", "tools", "mcp_servers", "permissionMode", "cwd",
                                           "claude_code_version", "session_id")}
        if ev.get("type") == "result":
            result = ev
    out.write_text((result or {}).get("result") or "")
    tools = init.get("tools") or []
    web = sorted(t for t in tools if t in ("WebSearch", "WebFetch"))
    mcp = init.get("mcp_servers") or []
    toolset_ok = (isinstance(init.get('tools'), list) and bool(tools) and
                  set(tools) <= CLAUDE_BASELINE_TOOLS and init.get('mcp_servers') == [])
    meta(out.parent / "meta.json", [
        "model_reported=" + json.dumps(init.get("model")),
        "web_tools_present=" + json.dumps(web),
        "mcp_servers_present=" + json.dumps(mcp),
        "baseline_tools_check=" + ("pass" if toolset_ok else "FAIL-or-unknown"),
        "no_web_check=" + ("pass" if toolset_ok else "FAIL-or-unknown"),
    ])
    (out.parent / "claude_init.json").write_text(json.dumps(
        {"init": init, "result_meta": {k: (result or {}).get(k) for k in
                                        ("subtype", "is_error", "num_turns", "duration_ms",
                                         "total_cost_usd", "usage", "modelUsage")}},
        indent=2, sort_keys=True, default=str) + "\n")


def meta(out: Path, pairs: list[str]) -> None:
    data = json.loads(out.read_text()) if out.exists() else {}
    for kv in pairs:
        k, _, v = kv.partition("=")
        try:
            data[k] = json.loads(v)
        except json.JSONDecodeError:
            data[k] = v
    temporary = out.with_name(out.name + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, out)


ENV_SH_HEAD = """# Activation for the analysis environment (generated by `pixi shell-hook`).
# Safe to source from scripts that use `set -euo pipefail`: the conda activation hooks
# reference unset variables, so nounset/errexit are suspended while they run.
case $- in *u*) __omb_u=1 ;; *) __omb_u=0 ;; esac
case $- in *e*) __omb_e=1 ;; *) __omb_e=0 ;; esac
set +u +e
"""
ENV_SH_TAIL = """
[ "$__omb_e" = 1 ] && set -e
[ "$__omb_u" = 1 ] && set -u
unset __omb_u __omb_e
"""


def audit_transcript(transcript: Path, worktmp: str, pkg: str, home: str) -> str:
    """Did the agent touch a sealed path, the sealing key, the repo or the data store? Scans the
    raw transcript for references to forbidden locations, after blanking the arm's own temp tree
    (its only legitimate working area). Returns 'clean', 'no-transcript', or
    'CONTAMINATED:<comma-separated hits>'. Conservative: over-detection is safe for an audit."""
    transcript = Path(transcript)
    if not transcript.is_file():
        return "no-transcript"
    text = transcript.read_text(errors="replace")
    if worktmp:
        text = text.replace(worktmp, "<WORK>")
    repo_root = str(Path(pkg).resolve().parents[1]) if pkg else ""
    forbidden = {
        "repo": repo_root,
        "data_store": str(Path(home) / ".omerta-bio") if home else "",
        "omerta": str(Path(home) / ".omerta") if home else "",
        "sealed_answer": "SEALED-ANSWER",
        "sealed_task_key": "SEALED-KEY",
        "sealing_key": "sealing.key",
    }
    hits = sorted(name for name, pat in forbidden.items() if pat and pat in text)
    return "CONTAMINATED:" + ",".join(hits) if hits else "clean"


def _sb_quote(p: str) -> str:
    return '"' + p.replace("\\", "\\\\").replace('"', '') + '"'


def sandbox_profile(worktmp: Path, proxy_port: int, deny_subpaths: list[str],
                    extra_read: list[str]) -> str:
    """A seatbelt profile that wraps an arm whose own sandbox cannot deny reads (Codex).

    Start from `(allow default)`, then: deny reads of the real HOME and the other sensitive
    roots; allow reads back only inside the arm's own temp tree (and its path ancestors, so the
    kernel can resolve it) plus a few explicit auth-file literals; deny all writes except inside
    the temp tree and the character devices a shell needs; deny all network except the loopback
    egress proxy. Last matching rule wins in seatbelt, so the allow-backs come after the denies.
    """
    worktmp = str(Path(worktmp))
    # Ancestors of the temp tree must stay traversable after we deny its broad parent root.
    ancestors = []
    cur = Path(worktmp).parent
    while True:
        ancestors.append(str(cur))
        if cur == cur.parent:
            break
        cur = cur.parent
    lines = [
        "(version 1)",
        "(allow default)",
        "; deny reads of the real home and the other sensitive roots",
        "(deny file-read* file-read-metadata",
    ]
    for p in deny_subpaths:
        lines.append(f"  (subpath {_sb_quote(p)})")
    lines.append(")")
    lines.append("; allow reads back only inside the arm's own temp tree and its ancestors")
    lines.append(f"(allow file-read* file-read-metadata (subpath {_sb_quote(worktmp)}))")
    if ancestors:
        lines.append("(allow file-read* file-read-metadata")
        for p in ancestors:
            lines.append(f"  (literal {_sb_quote(p)})")
        lines.append(")")
    if extra_read:
        lines.append("(allow file-read* file-read-metadata")
        for p in extra_read:
            lines.append(f"  (literal {_sb_quote(p)})")
        lines.append(")")
    lines += [
        "; writes: nothing outside the arm's own temp tree (plus the devices a shell needs)",
        "(deny file-write*)",
        f'(allow file-write* (subpath {_sb_quote(worktmp)}) (literal "/dev/null") '
        '(literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") '
        '(regex #"^/dev/fd/") (regex #"^/dev/ttys"))',
        "; network: nothing outbound except the loopback egress proxy",
        "(deny network*)",
        f'(allow network-outbound (remote ip "localhost:{int(proxy_port)}"))',
    ]
    return "\n".join(lines) + "\n"


CLAUDE_BASELINE_TOOLS = {'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'}
CLAUDE_DENIED_TOOLS = ['WebSearch', 'WebFetch', 'Task', 'Agent', 'SendMessage', 'Workflow',
                       'Skill', 'RemoteTrigger', 'CronCreate', 'CronDelete', 'CronList',
                       'ScheduleWakeup', 'EnterWorktree', 'ExitWorktree', 'Monitor',
                       'PushNotification', 'Artifact*', 'mcp__*']


def claude_settings(worktmp: Path, home: Path) -> dict:
    roots = [str(home), '/private/tmp', '/tmp', '/private/var/folders', '/var/folders',
             '/Volumes', '/Users/Shared']
    # Native tools use permission rules; Bash uses the kernel sandbox. Deny sibling attempts.
    arms = worktmp.parent
    siblings = [str(p) for p in arms.iterdir() if p != worktmp]
    denied = roots + siblings
    # Native deny rules also feed Claude's Bash sandbox. Do not deny its temp
    # directory: --restricted + work-only allows confine native writes there.
    native_denied = denied + [str(worktmp / 'home')]
    return {
        'permissions': {'allow': [f'{tool}(/{worktmp}/work/**)' for tool in ('Read', 'Edit', 'Write', 'NotebookEdit')], 'deny': CLAUDE_DENIED_TOOLS +
                        [f'{tool}(/{p}/**)' for tool in ('Read', 'Edit', 'Write', 'NotebookEdit') for p in native_denied]},
        'sandbox': {'enabled': True, 'failIfUnavailable': True,
                    'autoAllowBashIfSandboxed': True, 'allowUnsandboxedCommands': False,
                    'network': {'allowedDomains': [], 'strictAllowlist': True},
                    'filesystem': {'denyRead': denied, 'denyWrite': denied,
                                   'allowWrite': [str(worktmp)]}},
    }


def env_sh(pixi_toml: Path, out: Path) -> None:
    """Run `pixi shell-hook` in a clean environment (so no deactivate block for whatever env the
    caller is in) and wrap it so it survives `set -euo pipefail` in the sourcing script."""
    pixi = shutil.which("pixi") or "/opt/homebrew/bin/pixi"
    r = subprocess.run([pixi, "shell-hook", "--frozen", "--shell", "bash", "--manifest-path", str(pixi_toml)],
                       capture_output=True, text=True,
                       env={"HOME": os.environ.get("HOME", "/tmp"), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"})
    if r.returncode != 0 or "CONDA_PREFIX" not in r.stdout:
        raise SystemExit("pixi shell-hook failed: " + r.stderr[-1000:])
    out.write_text(ENV_SH_HEAD + r.stdout + ENV_SH_TAIL)


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "hash-tree":
        hash_tree(Path(argv[2]), Path(argv[3]))
    elif cmd == "collect":
        collect(Path(argv[2]), Path(argv[3]), float(argv[4]))
    elif cmd == "finish":
        print(finish(Path(argv[2]), Path(argv[3]), float(argv[4])))
    elif cmd == "final-claude":
        final_claude(Path(argv[2]), Path(argv[3]))
    elif cmd == "meta":
        meta(Path(argv[2]), argv[3:])
    elif cmd == "env-sh":
        env_sh(Path(argv[2]), Path(argv[3]))
    elif cmd == "audit":
        print(audit_transcript(Path(argv[2]), argv[3], argv[4], argv[5]))
    elif cmd in ("verify-task", "copy-task"):
        problems = (task_manifest_problems(Path(argv[2]), argv[3]) if cmd == "verify-task"
                    else copy_task_stage(Path(argv[2]), argv[3], Path(argv[4])))
        for p in problems:
            print(f"task stage: {p}", file=sys.stderr)
        return 1 if problems else 0
    elif cmd == "claude-settings":
        Path(argv[4]).write_text(json.dumps(claude_settings(Path(argv[2]), Path(argv[3])), indent=2) + '\n')
    elif cmd == "sandbox-profile":
        # sandbox-profile WORKTMP PORT OUT DENY:a:b:c READ:x:y
        worktmp, port, out = argv[2], int(argv[3]), Path(argv[4])
        deny = [p for p in argv[5].split(":") if p] if len(argv) > 5 else []
        extra = [p for p in argv[6].split(":") if p] if len(argv) > 6 else []
        out.write_text(sandbox_profile(Path(worktmp), port, deny, extra))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
