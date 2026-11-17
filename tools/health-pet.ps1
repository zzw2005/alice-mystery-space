$ErrorActionPreference = 'Continue'
$base = 'C:\ProgramData\AliceButler'
function L($m){ Write-Output $m }

L '== status.json =='
if (Test-Path "$base\status.json") { Get-Content "$base\status.json" -Raw } else { L 'missing' }
L '== presence.json =='
if (Test-Path "$base\presence.json") { Get-Content "$base\presence.json" -Raw } else { L 'missing' }

L '== processes =='
Get-Process | Where-Object { $_.ProcessName -match 'AlicePet|node' } | ForEach-Object {
  L ("{0} pid={1} session={2} WS_MB={3:N1} start={4}" -f $_.ProcessName, $_.Id, $_.SessionId, ($_.WorkingSet64/1MB), $_.StartTime)
}

L '== queues =='
foreach ($d in 'jobs','inbox','outbox','done','logs') {
  $items = @(Get-ChildItem "$base\$d" -ErrorAction SilentlyContinue)
  L ("{0}: {1} files" -f $d, $items.Count)
  $items | Select-Object -First 30 | ForEach-Object { L ("  " + $_.Name) }
}

L '== sizes =='
$tot = (Get-ChildItem $base -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
L ("AliceButler total MB: {0:N1}" -f ($tot/1MB))
Get-ChildItem "$base\assets" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $s = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  L ("  assets\{0}: {1:N1} MB" -f $_.Name, ($s/1MB))
}

L '== pet-error.log tail =='
if (Test-Path "$base\pet-error.log") { Get-Content "$base\pet-error.log" -Tail 5 } else { L 'no error log file' }
L '== pet-start.log tail =='
if (Test-Path "$base\pet-start.log") { Get-Content "$base\pet-start.log" -Tail 3 } else { L 'no start log file' }

L '== heartbeat ages / lock =='
function AgeSec($p) { if (Test-Path $p) { return [int]((Get-Date).ToUniversalTime() - (Get-Item $p).LastWriteTimeUtc).TotalSeconds } return -1 }
L ("status.json age_s: " + (AgeSec "$base\status.json"))
L ("pet-heartbeat age_s: " + (AgeSec "$base\pet-heartbeat.txt"))
L ("pet-disabled.flag: " + (Test-Path "$base\pet-disabled.flag"))
if (Test-Path "$base\runner.lock") { L ("runner.lock: " + (Get-Content "$base\runner.lock" -Raw)) }
if (Test-Path "$base\watchdog.log") { L 'watchdog.log tail:'; Get-Content "$base\watchdog.log" -Tail 2 }

L '== test residue =='
$prof = 'C:\Users\alice.DESKTOP-4Q8GMO4'
L ('petapp exists: ' + (Test-Path "$prof\petapp"))
Get-ChildItem $prof -Filter 'AlicePet*.exe' -ErrorAction SilentlyContinue | ForEach-Object { L ('  ' + $_.FullName) }
Get-ChildItem $base -Filter 'AlicePet*.exe' -ErrorAction SilentlyContinue | ForEach-Object { L ('  ' + $_.FullName + ' ' + [math]::Round($_.Length/1KB) + 'KB') }
L 'DONE'
