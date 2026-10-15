# Citation suite fixtures

Published snapshots omit `suite/public.jsonl`. The loader prefers that full suite
in development and otherwise uses `suite/synthetic.jsonl`: fifteen fictional
rows, one per failure class. These rows exercise software behavior; they provide
no benchmark coverage or admission evidence. Tests always validate the synthetic
fixture and run full-suite coverage/history checks only when the full file is
present. Publication retains this package's tests for the synthetic path.
