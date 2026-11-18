# Invoked only through deploy-pet.sh. Does not change runner, watchdog, ACLs or task definitions.
[CmdletBinding()]
param(
    [switch]$VerifyOnly,
    [ValidateSet('idle.webm')][string]$Asset,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$package = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../AliceButler/electron/release/AlicePetNew-win32-x64'))
$checks = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../AliceButler/butler-config.json') -Raw | ConvertFrom-Json).deployChecks
$target = 'C:\ProgramData\AliceButler'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (!(Test-Path -LiteralPath $pwsh)) { throw "System PowerShell 7 not found: $pwsh" }
if (!$ReportPath) { $ReportPath = Join-Path $target 'electron-deploy-result.json' }
if ($Asset -and !$PSBoundParameters.ContainsKey('ReportPath')) {
    $ReportPath = Join-Path $target 'electron-asset-deploy-result.json'
}
$files = @(Get-ChildItem -LiteralPath $package -File -Recurse)
if (!(Test-Path -LiteralPath (Join-Path $package 'AlicePetNew.exe')) -or !(Test-Path -LiteralPath (Join-Path $package 'resources/app/dist/main/main.js'))) { throw 'Build npm run package first' }
if (!(Test-Path -LiteralPath (Join-Path $package 'resources/app/media/doze.webm'))) { throw 'Missing packaged videos' }
$manifest = @($files | ForEach-Object { @{relative=[IO.Path]::GetRelativePath($package,$_.FullName);hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash;bytes=$_.Length} })
if ($VerifyOnly -and !$Asset) { @{verified=$true;files=$files.Count;bytes=($files | Measure-Object Length -Sum).Sum;exe='AlicePetNew.exe'} | ConvertTo-Json; exit 0 }
$admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Production ACL requires administrator. Re-run deploy-pet.sh in elevated PowerShell 7; no files changed.' }
function Stop-Pet {
    & schtasks.exe /end /tn AlicePetLaunch 2>$null | Out-Null
    foreach ($p in @(Get-Process AlicePetNew -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        $p.WaitForExit($checks.stopWaitMs) | Out-Null
    }
}
$stamp = [DateTime]::UtcNow
$id = $stamp.ToString('yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$backup = Join-Path $target "deploy-backups\$id"
$stage = Join-Path $target "deploy-stage\$id"
foreach ($p in @($backup,$stage)) {
    $resolved = [IO.Path]::GetFullPath($p)
    if (!$resolved.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe deployment path' }
    New-Item -ItemType Directory -Path $resolved -Force | Out-Null
}
if ($Asset) {
    $assetList = @('idle.webm','walk.webm','wave.webm','sleepstart.webm','doze.webm','wakeup.webm','clickhappy.webm','clickshy.webm','clicktsun.webm')
    $mediaRoot = Join-Path $target 'resources/app/media'
    $assetSource = Join-Path $package "resources/app/media/$Asset"
    $assetLocal = Join-Path $PSScriptRoot "../AliceButler/electron/media/$Asset"
    $assetTarget = Join-Path $mediaRoot $Asset
    $assetHash = (Get-FileHash -LiteralPath $assetSource -Algorithm SHA256).Hash
    if ($assetHash -ne (Get-FileHash -LiteralPath $assetLocal -Algorithm SHA256).Hash) { throw 'Packaged asset differs from repository media; run npm run package first' }
    if ($VerifyOnly) {
        @{verified=$true;asset=$Asset;sha256=$assetHash;bytes=(Get-Item -LiteralPath $assetSource).Length} | ConvertTo-Json
        exit 0
    }
    if (!(Test-Path -LiteralPath $assetTarget)) { throw "Target asset missing: $assetTarget" }
    $otherAssets = @($assetList | Where-Object { $_ -ne $Asset })
    $beforeOthers = @{}
    foreach ($name in $otherAssets) {
        $local = Join-Path $package "resources/app/media/$name"
        $deployed = Join-Path $mediaRoot $name
        if (!(Test-Path -LiteralPath $deployed)) { throw "Target asset missing: $name" }
        $localHash = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash
        if ($localHash -ne (Get-FileHash -LiteralPath $deployed -Algorithm SHA256).Hash) {
            throw "Other asset already differs before targeted deploy: $name"
        }
        $beforeOthers[$name] = $localHash
    }
    $assetBackup = Join-Path $backup $Asset
    $assetStage = Join-Path $stage $Asset
    $stopped = $false
    $receipt = $null
    try {
        Write-Output "[1/4] Backup $Asset and stop the Electron pet"
        Set-Content -LiteralPath (Join-Path $target 'pet-disabled.flag') -Value 'asset deploy in progress' -Encoding utf8NoBOM
        Stop-Pet; $stopped = $true
        Copy-Item -LiteralPath $assetTarget -Destination $assetBackup
        Copy-Item -LiteralPath $assetSource -Destination $assetStage
        if ((Get-FileHash -LiteralPath $assetStage).Hash -ne $assetHash) { throw "Staged hash mismatch: $Asset" }
        Copy-Item -LiteralPath $assetStage -Destination $assetTarget -Force
        if ((Get-FileHash -LiteralPath $assetTarget).Hash -ne $assetHash) { throw "Target hash mismatch: $Asset" }
        Write-Output "[2/4] Launch AlicePetLaunch and require fresh video/heartbeat"
        & schtasks.exe /run /tn AlicePetLaunch
        if ($LASTEXITCODE -ne 0) { throw 'AlicePetLaunch failed' }
        $ready = $false
        for ($i=0; $i -lt $checks.videoAttempts; $i++) {
            Start-Sleep -Milliseconds $checks.pollMs
            $start = Join-Path $target 'pet-start.log'; $hb = Join-Path $target 'pet-heartbeat.txt'
            if ((Get-Process AlicePetNew -ErrorAction SilentlyContinue) -and
                (Test-Path $start) -and (Get-Item $start).LastWriteTimeUtc -ge $stamp -and
                (Get-Content $start -Raw).StartsWith('electron video ok') -and
                (Test-Path $hb) -and (Get-Item $hb).LastWriteTimeUtc -ge $stamp) { $ready=$true; break }
        }
        if (!$ready) { throw 'Missing fresh Electron video startup/heartbeat' }
        Write-Output '[3/4] Require runner once-job done receipt, exitCode=0'
        $smokeId = 'deploysmoke-' + [Guid]::NewGuid().ToString('N')
        $task = 'AliceDeploySmoke-' + $smokeId
        try {
            $writer = Join-Path $PSScriptRoot 'write-deploy-smoke.ps1'
            $action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoProfile -File "' + $writer + '" -Id ' + $smokeId)
            $principal = New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
            Register-ScheduledTask -TaskName $task -Action $action -Principal $principal | Out-Null
            Start-ScheduledTask -TaskName $task
            $receipt = Join-Path $target "done\$smokeId.result.json"
            $result = $null
            for ($i=0; $i -lt $checks.receiptAttempts; $i++) {
                Start-Sleep -Milliseconds $checks.pollMs
                if (Test-Path $receipt) { $result = Get-Content $receipt -Raw | ConvertFrom-Json; break }
            }
            if ($null -eq $result -or $result.exitCode -ne 0) { throw 'Smoke receipt missing or nonzero' }
        } finally { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }
        foreach ($name in $otherAssets) {
            $deployed = Join-Path $mediaRoot $name
            if ((Get-FileHash -LiteralPath $deployed -Algorithm SHA256).Hash -ne $beforeOthers[$name]) {
                throw "Unrelated asset changed during targeted deploy: $name"
            }
        }
        Write-Output '[4/4] Write targeted asset result'
        @{success=$true;exitCode=0;asset=$Asset;sha256=$assetHash;bytes=(Get-Item -LiteralPath $assetTarget).Length;receipt=$receipt;backup=$backup;deployedAt=$stamp.ToString('o');otherAssetsUnchanged=@($otherAssets)} | ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
        Get-Content -LiteralPath $ReportPath
        exit 0
    } catch {
        $failure = $_
        if ($stopped) {
            try {
                Stop-Pet
                if (Test-Path -LiteralPath $assetBackup) { Copy-Item -LiteralPath $assetBackup -Destination $assetTarget -Force }
                Remove-Item -LiteralPath (Join-Path $target 'pet-disabled.flag') -Force -ErrorAction SilentlyContinue
                & schtasks.exe /run /tn AlicePetLaunch
                Write-Warning "Restored previous $Asset"
            } catch { Write-Warning "Rollback failed: $_" }
        }
        @{success=$false;asset=$Asset;error=$failure.ToString();receipt=$receipt;backup=$backup;deployedAt=$stamp.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
        throw $failure
    }
}
$changed = [Collections.Generic.List[object]]::new()
$legacyMoved = [Collections.Generic.List[string]]::new()
$stopped = $false
$receipt = $null
try {
    Write-Output '[1/5] Stage and hash every packaged file'
    foreach ($item in $manifest) {
        $dest = Join-Path $stage $item.relative
        New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $package $item.relative) -Destination $dest
        if ((Get-FileHash -LiteralPath $dest).Hash -ne $item.hash) { throw "Stage hash mismatch: $($item.relative)" }
    }
    Write-Output '[2/5] Stop WinForms pet, preserve legacy assets and swap Electron'
    Set-Content -LiteralPath (Join-Path $target 'pet-disabled.flag') -Value 'deploy in progress' -Encoding utf8NoBOM
    Stop-Pet; $stopped = $true
    foreach ($name in @('anim','anim-flat','anim60','sprites')) {
        $legacy = Join-Path $target "assets\$name"
        if (Test-Path -LiteralPath $legacy) {
            $savedLegacy = Join-Path $backup "legacy-assets\$name"
            New-Item -ItemType Directory -Path (Split-Path $savedLegacy) -Force | Out-Null
            Move-Item -LiteralPath $legacy -Destination $savedLegacy
            $legacyMoved.Add($name)
        }
    }
    foreach ($item in ($manifest | Sort-Object { $_.relative -eq 'AlicePetNew.exe' })) {
        $dest = Join-Path $target $item.relative
        if (![IO.Path]::GetFullPath($dest).StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package path' }
        $existed = Test-Path -LiteralPath $dest
        if ($existed) {
            $saved = Join-Path $backup $item.relative
            New-Item -ItemType Directory -Path (Split-Path $saved) -Force | Out-Null
            Copy-Item -LiteralPath $dest -Destination $saved
        }
        $changed.Add(@{relative=$item.relative;existed=$existed})
        New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $stage $item.relative) -Destination $dest -Force
        if ((Get-FileHash -LiteralPath $dest).Hash -ne $item.hash) { throw "Target hash mismatch: $($item.relative)" }
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'new-package-manifest.json') -Encoding utf8NoBOM
    Write-Output '[3/5] Launch existing AlicePetLaunch and require fresh video/heartbeat'
    & schtasks.exe /run /tn AlicePetLaunch
    if ($LASTEXITCODE -ne 0) { throw 'AlicePetLaunch failed' }
    $ready = $false
    for ($i=0; $i -lt $checks.videoAttempts; $i++) {
        Start-Sleep -Milliseconds $checks.pollMs
        $start = Join-Path $target 'pet-start.log'; $hb = Join-Path $target 'pet-heartbeat.txt'
        if ((Get-Process AlicePetNew -ErrorAction SilentlyContinue) -and
            (Test-Path $start) -and (Get-Item $start).LastWriteTimeUtc -ge $stamp -and
            (Get-Content $start -Raw).StartsWith('electron video ok') -and
            (Test-Path $hb) -and (Get-Item $hb).LastWriteTimeUtc -ge $stamp) { $ready=$true; break }
    }
    if (!$ready) { throw 'Missing fresh Electron video startup/heartbeat' }
    Write-Output '[4/5] Require runner once-job done receipt, exitCode=0'
    $smokeId = 'deploysmoke-' + [Guid]::NewGuid().ToString('N')
    $task = 'AliceDeploySmoke-' + $smokeId
    try {
        $writer = Join-Path $PSScriptRoot 'write-deploy-smoke.ps1'
        $action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoProfile -File "' + $writer + '" -Id ' + $smokeId)
        $principal = New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $task -Action $action -Principal $principal | Out-Null
        Start-ScheduledTask -TaskName $task
        $receipt = Join-Path $target "done\$smokeId.result.json"
        $result = $null
        for ($i=0; $i -lt $checks.receiptAttempts; $i++) {
            Start-Sleep -Milliseconds $checks.pollMs
            if (Test-Path $receipt) { $result = Get-Content $receipt -Raw | ConvertFrom-Json; break }
        }
        if ($null -eq $result -or $result.exitCode -ne 0) { throw 'Smoke receipt missing or nonzero' }
    } finally { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }
    Write-Output '[5/5] Write deployment result; keep rollback and receipt'
    $stopped = $false
    @{success=$true;exitCode=0;receipt=$receipt;backup=$backup;deployedAt=$stamp.ToString('o');packageBytes=($files | Measure-Object Length -Sum).Sum;legacyAssetsBackedUp=@($legacyMoved)} | ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
    Get-Content -LiteralPath $ReportPath
} catch {
    $failure = $_
    if ($stopped) {
        try {
            Stop-Pet
            foreach ($item in $changed) {
                $dest = Join-Path $target $item.relative
                if ($item.existed) { Copy-Item -LiteralPath (Join-Path $backup $item.relative) -Destination $dest -Force }
                elseif (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
            }
            foreach ($name in $legacyMoved) {
                $legacy = Join-Path $target "assets\$name"
                $savedLegacy = Join-Path $backup "legacy-assets\$name"
                if ((Test-Path -LiteralPath $savedLegacy) -and !(Test-Path -LiteralPath $legacy)) {
                    Move-Item -LiteralPath $savedLegacy -Destination $legacy
                }
            }
            Remove-Item -LiteralPath (Join-Path $target 'pet-disabled.flag') -Force -ErrorAction SilentlyContinue
            & schtasks.exe /run /tn AlicePetLaunch
            Write-Warning 'Restored previous runtime from backup'
        } catch { Write-Warning "Rollback failed: $_" }
    }
    @{success=$false;error=$failure.ToString();receipt=$receipt;backup=$backup;deployedAt=$stamp.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding utf8NoBOM
    throw $failure
}
