#!/usr/bin/env bash
# Send a reply to the desktop pet's chat, atomically: the reply is uploaded
# under a temp name and renamed into place, so the pet can never catch a
# half-written file (a slow upload used to risk the reply being quarantined
# as corrupt). Usage: pet-reply.sh <msg-id> <text> [animation-category]
#   msg-id: the inbox message id (msg-...), reply becomes reply-<msg-id>.json
set -euo pipefail
ID="${1:?msg id required}"
TEXT="${2:?reply text required}"
TMPF=$(mktemp)
trap 'rm -f "$TMPF"' EXIT
python3 - "$ID" "$TEXT" "${3:-}" > "$TMPF" <<'PYEOF'
import json, sys, datetime
reply = {"id": sys.argv[1], "text": sys.argv[2],
  "ts": datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
if sys.argv[3]:
    reply["animationCategory"] = sys.argv[3]
print(json.dumps(reply, ensure_ascii=False))
PYEOF
if python3 - "$ID" "$TMPF" <<'PYEOF'
import json, os, pathlib, re, sys, tempfile, time

msg_id, reply_file = sys.argv[1:]
state = pathlib.Path.home() / "hooks/state"
try:
    heartbeat = int((state / "relay-heartbeat").read_text())
    pc_online = json.loads((state / "relay-pc-status").read_text()).get("online") is True
except (OSError, ValueError, AttributeError):
    sys.exit(1)
if not pc_online or not 0 <= time.time() * 1000 - heartbeat < 60000 or not re.fullmatch(r"[\w-]+", msg_id, re.ASCII):
    sys.exit(1)
outbox = state / "relay-outbox"
temporary = tempfile.NamedTemporaryFile(dir=outbox, prefix=".tmp-", delete=False)
try:
    with temporary:
        temporary.write(pathlib.Path(reply_file).read_bytes())
    os.replace(temporary.name, outbox / f"reply-{msg_id}.json")
finally:
    pathlib.Path(temporary.name).unlink(missing_ok=True)
PYEOF
then
    echo "reply queued for relay: $ID"
    exit 0
fi
scp -q -F /home/hatch/.ssh/config "$TMPF" "userpc:C:/ProgramData/AliceButler/outbox/.tmp-$ID.json"
ssh -F /home/hatch/.ssh/config userpc "chcp 65001 >nul && move /y C:\ProgramData\AliceButler\outbox\.tmp-$ID.json C:\ProgramData\AliceButler\outbox\reply-$ID.json" >/dev/null
echo "reply delivered atomically: reply-$ID.json"
