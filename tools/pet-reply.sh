#!/usr/bin/env bash
# Send a reply to the desktop pet's chat, atomically: the reply is uploaded
# under a temp name and renamed into place, so the pet can never catch a
# half-written file (a slow upload used to risk the reply being quarantined
# as corrupt). Usage: pet-reply.sh <msg-id> <text>
#   msg-id: the inbox message id (msg-...), reply becomes reply-<msg-id>.json
set -euo pipefail
ID="${1:?msg id required}"
TEXT="${2:?reply text required}"
TMPF=$(mktemp)
trap 'rm -f "$TMPF"' EXIT
python3 - "$ID" "$TEXT" > "$TMPF" <<'PYEOF'
import json, sys, datetime
print(json.dumps({"id": sys.argv[1], "text": sys.argv[2],
  "ts": datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, ensure_ascii=False))
PYEOF
scp -q -F /home/hatch/.ssh/config "$TMPF" "userpc:C:/ProgramData/AliceButler/outbox/.tmp-$ID.json"
ssh -F /home/hatch/.ssh/config userpc "chcp 65001 >nul && move /y C:\ProgramData\AliceButler\outbox\.tmp-$ID.json C:\ProgramData\AliceButler\outbox\reply-$ID.json" >/dev/null
echo "reply delivered atomically: reply-$ID.json"
