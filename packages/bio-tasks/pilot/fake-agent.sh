#!/usr/bin/env bash
# Deliberately incomplete answer. Exercises delivery and fail-closed grading, no key knowledge.
set -euo pipefail
printf '{"type":"system","subtype":"init","model":"pilot-fake","tools":["Bash"],"mcp_servers":[],"cwd":"%s"}\n' "$PWD"
mkdir -p code outputs
printf '#!/usr/bin/env bash\nset -eu\nsource ./env.sh\nprintf '\''{"claims":[],"extra":{}}\\n'\'' > results.json\n' > run_all.sh
bash run_all.sh
printf '# Synthetic pilot dry run\n' > REPORT.md
printf '{"type":"result","subtype":"success","is_error":false,"result":"dry run complete","num_turns":1}\n'
