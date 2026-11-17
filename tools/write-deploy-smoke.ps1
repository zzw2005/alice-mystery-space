param([Parameter(Mandatory)][ValidatePattern('^deploysmoke-[a-f0-9]{32}$')][string]$Id)
$ErrorActionPreference = 'Stop'
# SYSTEM publishes without broadening the existing alice/SYSTEM jobs ACL.
$job = "C:\ProgramData\AliceButler\jobs\$Id.json"
@{id=$Id;name='Electron 部署冒烟';type='once';cmd=(Get-Process -Id $PID).Path;args=@('-NoProfile','-Command','Write-Output smoke-ok')} | ConvertTo-Json -Compress | Set-Content -LiteralPath "$job.tmp" -Encoding utf8NoBOM
Move-Item -LiteralPath "$job.tmp" -Destination $job
if (!(Test-Path -LiteralPath $job)) { throw 'Smoke job publication failed' }
