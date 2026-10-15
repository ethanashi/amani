"""Extract CLI-owned turn_context receipts from this attempt's throwaway CODEX_HOME."""
import json
from pathlib import Path
import sys


def events(path):
    try:
        for line in path.read_text(errors="replace").splitlines():
            try:
                event = json.loads(line)
                if isinstance(event, dict):
                    yield event
            except ValueError:
                continue
    except OSError:
        return


def observed_identity(home, transcript):
    threads = {e.get("thread_id") for e in events(transcript) if e.get("type") == "thread.started"}
    threads.discard(None)
    models, efforts = [], []
    for path in sorted((home / "sessions").rglob("*.jsonl")):
        stream = list(events(path))
        if not any(e.get("type") == "session_meta" and isinstance(e.get("payload"), dict) and
                   e["payload"].get("id") in threads for e in stream):
            continue
        for event in stream:
            payload = event.get("payload")
            if event.get("type") == "turn_context" and isinstance(payload, dict):
                model, effort = payload.get("model"), payload.get("effort")
                if isinstance(model, str) and model:
                    models.append(model)
                if isinstance(effort, str) and effort:
                    efforts.append(effort)
    return {"model_reported": sorted(set(models)), "effort_reported": sorted(set(efforts)),
            "model_identity_source": "codex-session"}


if __name__ == "__main__":
    home, transcript, meta = map(Path, sys.argv[1:])
    value = json.loads(meta.read_text())
    value.update(observed_identity(home, transcript))
    meta.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
