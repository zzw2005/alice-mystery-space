#!/usr/bin/env bash
# Run a uishot capture exactly once and leave no scheduled task behind:
# the task is created as a one-shot a couple of minutes out and deleted
# explicitly at the end (schtasks /z writes an invalid EndBoundary on this
# Windows build), instead of a daily task a human must remember to delete.
# Usage: run-uishot.sh 1|2   (1 = full flow with typing+send, 2 = light)
set -euo pipefail
SSH="ssh -F /home/hatch/.ssh/config userpc"
V="${1:-2}"
if [ "$V" = "1" ]; then TN=AliceUiShot; EXE='C:\ProgramData\AliceButler\tools\uishot.exe'; else TN=AliceUiShot2; EXE='C:\ProgramData\AliceButler\tools\uishot2.exe'; fi
WHEN=$(date -d '+2 minutes' +%H:%M)
echo "scheduling $TN once at $WHEN"
$SSH "chcp 65001 >nul && schtasks /create /tn $TN /tr $EXE /sc once /st $WHEN /ru mikasan /it /f" | tail -1
# wait until the capture files are fresh (the run takes ~15s once it fires);
# a stale capture must never be delivered as if it were this run's evidence
FOUND=0
for i in $(seq 1 40); do
  sleep 6
  AGE=$($SSH "chcp 65001 >nul && powershell -NoProfile -Command \"try { [int]((Get-Date) - (Get-Item 'C:\ProgramData\AliceButler\tools\full.png').LastWriteTime).TotalSeconds } catch { 9999 }\"" 2>/dev/null | tr -d '\r' | tail -1)
  case "$AGE" in ''|*[!0-9-]*) continue;; *) if [ "$AGE" -lt 120 ]; then echo "captured (full.png age ${AGE}s)"; FOUND=1; break; fi;; esac
done
if [ "$FOUND" != "1" ]; then
  if $SSH "chcp 65001 >nul && schtasks /query /tn $TN" >/dev/null 2>&1; then $SSH "chcp 65001 >nul && schtasks /delete /tn $TN /f" >/dev/null 2>&1 || true; fi
  echo "ERROR: no fresh capture appeared — the uishot run did not complete; not delivering stale screenshots" >&2
  exit 1
fi
scp -F /home/hatch/.ssh/config userpc:'C:/ProgramData/AliceButler/tools/full.png' /tmp/uishot-full.png >/dev/null 2>&1 || true
scp -F /home/hatch/.ssh/config userpc:'C:/ProgramData/AliceButler/tools/chatFinal.png' /tmp/uishot-chat.png >/dev/null 2>&1 || true
if $SSH "chcp 65001 >nul && schtasks /query /tn $TN" >/dev/null 2>&1; then
  echo "note: task still present, deleting it now"
  $SSH "chcp 65001 >nul && schtasks /delete /tn $TN /f" >/dev/null
fi
echo "task $TN gone; images in /tmp/uishot-full.png /tmp/uishot-chat.png"
