#!/usr/bin/env bash
# Set Alice's live presence shown by the desktop pet (tray text + chat subtitle).
# Usage: alice-presence.sh working "正在跑商店审计" | alice-presence.sh idle
# Non-idle states start a small refresher that re-stamps the presence every
# 8 minutes (the pet expires a stamp after 12), so a long task doesn't
# silently fall back to "在岗" while Alice is still busy. idle stops it.
set -euo pipefail
CUR=/tmp/alice-presence-current.json
PIDF=/tmp/alice-presence-refresher.pid
SSH="ssh -F /home/hatch/.ssh/config userpc"
SCP="scp -q -F /home/hatch/.ssh/config"

write_once() {
  python3 - "$1" "$2" > /tmp/alice-presence.json <<'PYEOF'
import json, sys, datetime
print(json.dumps({"state": sys.argv[1], "note": sys.argv[2],
  "ts": datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, ensure_ascii=False))
PYEOF
  # atomic on the PC side: write to a temp name, then rename over the live file,
  # so the pet never reads a half-written presence
  $SCP /tmp/alice-presence.json "userpc:C:/ProgramData/AliceButler/presence.json.tmp"
  $SSH "chcp 65001 >nul && move /y C:\ProgramData\AliceButler\presence.json.tmp C:\ProgramData\AliceButler\presence.json" >/dev/null
}

if [ "${1:-}" = "--tick" ]; then
  # idempotent restamp for external schedulers: if a non-idle state is on
  # record, re-stamp it once (used to recover after the refresher died)
  [ -f "$CUR" ] || exit 0
  S=$(sed -n 's/.*"state": *"\([^"]*\)".*/\1/p' "$CUR" | head -1)
  N=$(sed -n 's/.*"note": *"\([^"]*\)".*/\1/p' "$CUR" | head -1)
  if [ -z "$S" ] || [ "$S" = "idle" ]; then exit 0; fi
  write_once "$S" "$N"
  echo "presence restamped: $S $N"
  exit 0
fi

if [ "${1:-}" = "--refresh-loop" ]; then
  while true; do
    sleep 480
    [ -f "$CUR" ] || exit 0
    S=$(sed -n 's/.*"state": *"\([^"]*\)".*/\1/p' "$CUR" | head -1)
    N=$(sed -n 's/.*"note": *"\([^"]*\)".*/\1/p' "$CUR" | head -1)
    if [ -z "$S" ] || [ "$S" = "idle" ]; then exit 0; fi
    write_once "$S" "$N" || true
  done
fi

STATE="${1:-idle}"; NOTE="${2:-}"
if [ -f "$PIDF" ]; then kill "$(cat "$PIDF")" 2>/dev/null || true; rm -f "$PIDF"; fi
python3 - "$STATE" "$NOTE" > "$CUR" <<'PYEOF'
import json, sys
print(json.dumps({"state": sys.argv[1], "note": sys.argv[2]}, ensure_ascii=False))
PYEOF
write_once "$STATE" "$NOTE"
if [ "$STATE" != "idle" ]; then
  nohup "$0" --refresh-loop >/dev/null 2>&1 &
  echo $! > "$PIDF"
fi
echo "presence set: $STATE $NOTE"
