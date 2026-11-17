#!/usr/bin/env bash
# One-click pet deploy, failure-safe edition:
#   push sources -> compile to a temp exe -> verify hash/freshness ->
#   only then stop the running pet -> swap -> launch -> verify it came up.
# Any failure after the stop relaunches the previous build automatically.
# runner.js/watchdog.js are pushed too; they take effect at the next runner start.
# Usage: deploy-pet.sh [--assets]   (--assets also pushes anim60/anim-flat/stills)
set -euo pipefail
SSH="ssh -F /home/hatch/.ssh/config userpc"
SCP="scp -F /home/hatch/.ssh/config"
BB=~/workspace/butler-build/AliceButler
TL=~/workspace/tools
PCT=$TL/pc-transfer.sh
CSC='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
REFS='/reference:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll'
NEWEXE='C:\ProgramData\AliceButler\AlicePetNew.new.exe'

KILLED=0
rollback() {
  echo "!! deploy failed after the stop — restoring the previous binary and relaunching"
  $SSH "chcp 65001 >nul && taskkill /IM AlicePetNew.exe /F" >/dev/null 2>&1 || true
  $SSH "chcp 65001 >nul && if exist C:\ProgramData\AliceButler\AlicePetNew.prev.exe move /y C:\ProgramData\AliceButler\AlicePetNew.prev.exe C:\ProgramData\AliceButler\AlicePetNew.exe" >/dev/null 2>&1 || true
  $SSH "chcp 65001 >nul && schtasks /run /tn AlicePetLaunch" >/dev/null 2>&1 || true
}
trap 'if [ "$KILLED" = "1" ]; then rollback; fi' ERR

echo "[1/6] push sources (pet*.cs, runner.js, watchdog.js, probe)"
$SSH "chcp 65001 >nul && del /q C:\ProgramData\AliceButler\pet.*.cs 2>nul" >/dev/null 2>&1 || true
for f in "$BB"/pet*.cs; do $SCP "$f" userpc:'C:/ProgramData/AliceButler/' >/dev/null; done
$SCP "$BB/runner.js" userpc:'C:/ProgramData/AliceButler/runner.js' >/dev/null
$SCP "$BB/watchdog.js" userpc:'C:/ProgramData/AliceButler/watchdog.js' >/dev/null
$SCP "$TL/probe-v3.ps1" userpc:'C:/Users/alice.DESKTOP-4Q8GMO4/scripts/probe-v3.ps1' >/dev/null

if [ "${1:-}" = "--assets" ]; then
  echo "  push assets while she is still up (slow, ~316KB/s)"
  $PCT push "$BB/assets/anim60" 'C:/ProgramData/AliceButler/assets' >/dev/null
  $PCT push "$BB/assets/sprites" 'C:/ProgramData/AliceButler/assets' >/dev/null
  $PCT push "$BB/assets/anim-flat" 'C:/ProgramData/AliceButler/assets' >/dev/null
  for f in "$BB"/assets/pet-flat*.png; do $SCP "$f" userpc:'C:/ProgramData/AliceButler/assets/' >/dev/null; done
fi

echo "[2/6] verify sources arrived intact (sha256 per file)"
for f in "$BB"/pet*.cs; do
  b=$(basename "$f")
  L=$(sha256sum "$f" | cut -d' ' -f1)
  R=$($SSH "chcp 65001 >nul && certutil -hashfile C:/ProgramData/AliceButler/$b SHA256" | tr -d '\r' | grep -iE '^[0-9a-f]{64}$' | head -1 | tr 'A-F' 'a-f')
  if [ "$L" != "$R" ]; then echo "hash mismatch on $b: local $L remote $R"; exit 1; fi
done

echo "[3/6] compile to AlicePetNew.new.exe (old build keeps running)"
SRCLIST=""
for f in "$BB"/pet*.cs; do SRCLIST="$SRCLIST C:\\ProgramData\\AliceButler\\$(basename "$f")"; done
$SSH "chcp 65001 >nul && del /q $NEWEXE 2>nul & $CSC /nologo /target:winexe /out:$NEWEXE $REFS $SRCLIST > C:\ProgramData\AliceButler\csc-out.txt 2>&1 & type C:\ProgramData\AliceButler\csc-out.txt" > /tmp/csc-out.txt 2>&1 || true
if grep -q ": error" /tmp/csc-out.txt; then echo "compile errors:"; cat /tmp/csc-out.txt; exit 1; fi
AGE=$($SSH "chcp 65001 >nul && powershell -NoProfile -Command \"[int]((Get-Date).ToUniversalTime() - (Get-Item 'C:\ProgramData\AliceButler\AlicePetNew.new.exe').LastWriteTimeUtc).TotalSeconds\"" | tr -d '\r' | tail -1)
case "$AGE" in ''|*[!0-9-]*) echo "cannot verify the new exe"; exit 1;; esac
if [ "$AGE" -gt 300 ]; then echo "new exe is stale (age ${AGE}s) — compile must have failed"; cat /tmp/csc-out.txt; exit 1; fi
grep -v "CS0414" /tmp/csc-out.txt | head -5 || true
echo "  compiled ok"

echo "[4/6] swap in the new build"
KILLED=1
$SSH "chcp 65001 >nul && copy /y C:\ProgramData\AliceButler\AlicePetNew.exe C:\ProgramData\AliceButler\AlicePetNew.prev.exe >nul" 2>/dev/null || echo "  (no current exe to back up)"
$SSH "chcp 65001 >nul && taskkill /IM AlicePetNew.exe /F" 2>/dev/null || echo "  (was not running)"
$SSH "chcp 65001 >nul && move /y $NEWEXE C:\ProgramData\AliceButler\AlicePetNew.exe" >/dev/null

echo "[5/6] launch"
$SSH "chcp 65001 >nul && schtasks /run /tn AlicePetLaunch" >/dev/null
sleep 6

echo "[6/6] probe (process must be up, start log fresh)"
OUT=$($SSH "chcp 65001 >nul && powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\alice.DESKTOP-4Q8GMO4\scripts\probe-v3.ps1" 2>/dev/null | tr -d '\r')
echo "$OUT"
if ! echo "$OUT" | grep -q "^RUNNING pid="; then echo "pet not running after deploy"; rollback; exit 1; fi
SAGE=$($SSH "chcp 65001 >nul && powershell -NoProfile -Command \"[int]((Get-Date).ToUniversalTime() - (Get-Item 'C:\ProgramData\AliceButler\pet-start.log').LastWriteTimeUtc).TotalSeconds\"" | tr -d '\r' | tail -1)
case "$SAGE" in ''|*[!0-9-]*) : ;; *) if [ "$SAGE" -gt 180 ]; then echo "pet-start.log is stale (age ${SAGE}s) — the new build did not start cleanly"; rollback; exit 1; fi;; esac
KILLED=0
echo "[7/7] smoke: drop a once self-check job and require its done receipt"
SID="deploysmoke$(date +%s)"
printf '{"id":"%s","name":"部署冒烟","type":"once","cmd":"C:\\\\Windows\\\\System32\\\\cmd.exe","args":["/c","echo smoke-ok"]}' "$SID" > /tmp/$SID.json
$SCP /tmp/$SID.json userpc:'C:/ProgramData/AliceButler/jobs/' >/dev/null
# the done receipt is the only trustworthy proof of delivery (the acltest
# lesson): the runner may consume the job file within a second, so checking
# jobs/ itself would race — poll for the receipt instead
SMOKE=0
for i in $(seq 1 10); do
  sleep 2
  OUT=$($SSH "chcp 65001 >nul && type C:\ProgramData\AliceButler\done\\$SID.result.json 2>nul" 2>/dev/null | tr -d '\r' || true)
  if echo "$OUT" | grep -q '"exitCode": 0'; then SMOKE=1; break; fi
done
$SSH "chcp 65001 >nul && del /q C:\ProgramData\AliceButler\done\\$SID.result.json C:\ProgramData\AliceButler\logs\\$SID.log 2>nul" >/dev/null 2>&1 || true
rm -f /tmp/$SID.json
if [ "$SMOKE" != "1" ]; then echo "SMOKE FAILED: once-job receipt missing or nonzero — the runner path is broken (pet itself is up)"; exit 1; fi
echo "  smoke ok (job $SID consumed, exit 0, receipt verified)"
trap - ERR
echo "deploy done"
