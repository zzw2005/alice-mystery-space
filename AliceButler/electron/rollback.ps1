# Run by the packaged tray. Simulation uses the same restore path against a fixture.
param([Parameter(Mandatory)][ValidatePattern('^\d{14}-[0-9a-f]{8}$')][string]$BackupId,
      [string]$SimulationRoot)
$ErrorActionPreference = 'Stop'
$root = if ($SimulationRoot) { (Resolve-Path -LiteralPath $SimulationRoot).Path } else { 'C:\ProgramData\AliceButler' }
$backups = Join-Path $root 'deploy-backups'
function BackupFile($name) { Join-Path $backups $name }
function SafeRelative([string]$relative) {
    $parts = $relative.Replace('\','/').Split('/')
    if ($parts.Where({ !$_ -or $_ -in '.', '..' -or $_ -match '[:*?"<>|]' }).Count) { throw "Invalid backup member $relative" }
    if ($parts[0] -notin 'resources','locales','assets' -and
        ($parts.Length -ne 1 -or $parts[0] -notmatch '^(LICENSE|LICENSES\.chromium\.html|version|AlicePetNew\.exe|[\w.-]+\.(dll|pak|dat|bin|json|txt|html))$')) {
        throw "Unexpected package member $relative"
    }
    return $parts -join '/'
}
function ReadChanges($folder) {
    $manifest = Join-Path $folder 'new-package-manifest.json'
    $changes = @{}
    if (Test-Path -LiteralPath $manifest) {
        foreach ($entry in (Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json)) {
            $rel = SafeRelative $entry.relative
            $file = Join-Path $folder $rel
            $changes[$rel] = if (Test-Path -LiteralPath $file -PathType Leaf) { $file } else { $null }
        }
        $legacy = Join-Path $folder 'legacy-assets'
        if (Test-Path -LiteralPath $legacy) {
            foreach ($file in Get-ChildItem -LiteralPath $legacy -File -Recurse) {
                $rel = SafeRelative ('assets/' + [IO.Path]::GetRelativePath($legacy, $file.FullName))
                $changes[$rel] = $file.FullName
            }
        }
    } elseif (Test-Path -LiteralPath (Join-Path $folder 'idle.webm') -PathType Leaf) {
        $changes['resources/app/media/idle.webm'] = Join-Path $folder 'idle.webm'
    } else { throw "Incomplete backup $folder" }
    if (!$changes.Count) { throw "Empty backup $folder" }
    return $changes
}
function ApplyChanges($changes) {
    foreach ($rel in $changes.Keys) {
        $dest = Join-Path $root $rel
        if ($changes[$rel]) {
            [IO.Directory]::CreateDirectory((Split-Path $dest)) | Out-Null
            [IO.File]::Copy($changes[$rel], $dest, $true)
        } elseif ([IO.File]::Exists($dest)) { [IO.File]::Delete($dest) }
    }
}
$lock = [IO.File]::Open((Join-Path $backups '.rollback.lock'), 'OpenOrCreate','ReadWrite','None')
$stopped = $false
$applied = $false
try {
    $history = @(Get-ChildItem -LiteralPath $backups -Directory | Where-Object Name -Match '^\d{14}-[0-9a-f]{8}$' |
        Sort-Object @{Expression='CreationTimeUtc';Descending=$true}, @{Expression='Name';Descending=$true})
    $changes = @{}
    $found = $false
    foreach ($entry in $history) {
        $delta = ReadChanges $entry.FullName
        foreach ($rel in $delta.Keys) { $changes[$rel] = $delta[$rel] }
        if ($entry.Name -eq $BackupId) { $found = $true; break }
    }
    if (!$found) { throw 'Backup no longer exists' }
    $id = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $stage = BackupFile ('.pending-' + $id)
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    if (!$SimulationRoot) {
        Set-Content -LiteralPath (Join-Path $root 'pet-disabled.flag') 'rollback'
        $stopped = $true
        & schtasks.exe /end /tn AlicePetLaunch | Out-Null
        Get-Process AlicePetNew -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill(); $_.WaitForExit() }
    }
    foreach ($rel in $changes.Keys) {
        $src = Join-Path $root $rel
        if ([IO.File]::Exists($src)) {
            $dest = Join-Path $stage $rel
            [IO.Directory]::CreateDirectory((Split-Path $dest)) | Out-Null
            [IO.File]::Copy($src, $dest)
        }
    }
    $manifest = @($changes.Keys | ForEach-Object { @{ relative = $_ } })
    ConvertTo-Json -InputObject $manifest | Set-Content -LiteralPath (Join-Path $stage 'new-package-manifest.json')
    $inverse = BackupFile $id
    [IO.Directory]::Move($stage, $inverse)
    try { ApplyChanges $changes; $applied = $true }
    catch { ApplyChanges (ReadChanges $inverse); throw }
    Write-Output $id
} finally {
    try {
        if ($stopped) {
            [IO.File]::Delete((Join-Path $root 'pet-disabled.flag'))
            & schtasks.exe /run /tn AlicePetLaunch
            if ($LASTEXITCODE -ne 0) {
                if ($applied) { ApplyChanges (ReadChanges $inverse); & schtasks.exe /run /tn AlicePetLaunch }
                throw 'AlicePetLaunch did not restart'
            }
        }
    } finally { $lock.Dispose() }
}
