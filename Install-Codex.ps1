param([string]$UserRoot = [Environment]::GetFolderPath('UserProfile'))
$ErrorActionPreference = 'Stop'
Get-Command node -ErrorAction Stop | Out-Null
Get-Command codex -ErrorAction Stop | Out-Null
$nodeMajor = & node -p 'parseInt(process.versions.node)'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 22) { throw 'Node.js 22 or newer is required' }
$UserRoot = [IO.Path]::GetFullPath($UserRoot)
$base = [IO.Path]::GetFullPath((Join-Path $UserRoot '.codex/local-plugins'))
$pluginTarget = Join-Path $base 'codex-dsh-assistant'
$stamp = [Guid]::NewGuid().ToString('N')
$stage = $pluginTarget + '.stage-' + $stamp
$backup = $pluginTarget + '.backup-' + $stamp
$failed = $pluginTarget + '.failed-' + $stamp
function Assert-OwnedPath([string]$Value) {
    $resolved = [IO.Path]::GetFullPath($Value)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $base -or -not ([IO.Path]::GetFileName($resolved)).StartsWith('codex-dsh-assistant')) { throw 'Unexpected installation target' }
}
foreach ($item in @($pluginTarget,$stage,$backup,$failed)) { Assert-OwnedPath $item }
$marketFile = Join-Path $UserRoot '.agents/plugins/marketplace.json'
$marketExisted = Test-Path -LiteralPath $marketFile
$marketBytes = $null
if ($marketExisted) {
    $marketBytes = [IO.File]::ReadAllBytes($marketFile)
    $market = Get-Content -LiteralPath $marketFile -Raw -Encoding UTF8 | ConvertFrom-Json
} else { $market = [pscustomobject]@{name='personal';interface=[pscustomobject]@{displayName='Personal'};plugins=@()} }
if (-not $market.name -or -not $market.PSObject.Properties['plugins']) { throw 'Invalid marketplace configuration' }
$priorList = & codex plugin list --marketplace $market.name --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect installed plugins; no changes made' }
$priorState = $priorList | ConvertFrom-Json
$wasInstalled = @($priorState.installed | Where-Object pluginId -eq ('codex-dsh-assistant@' + $market.name)).Count -gt 0
New-Item -ItemType Directory -Path $base -Force | Out-Null
New-Item -ItemType Directory -Path $stage | Out-Null
# Copy first; the live source is untouched until the new package is complete.
Get-ChildItem -LiteralPath $PSScriptRoot -Force | Copy-Item -Destination $stage -Recurse -Force
$manifest = Get-Content -LiteralPath (Join-Path $stage 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne 'codex-dsh-assistant') { throw 'Unexpected plugin identity' }
$hadTarget = Test-Path -LiteralPath $pluginTarget
$swapped = $false
$marketWritten = $false
try {
    if ($hadTarget) { Move-Item -LiteralPath $pluginTarget -Destination $backup }
    Move-Item -LiteralPath $stage -Destination $pluginTarget
    $swapped = $true
    New-Item -ItemType Directory -Path (Split-Path $marketFile) -Force | Out-Null
    if ($marketExisted) { [IO.File]::WriteAllBytes(($marketFile + '.backup-' + $stamp),$marketBytes) }
    $entry = [pscustomobject]@{name='codex-dsh-assistant';source=[pscustomobject]@{source='local';path='./.codex/local-plugins/codex-dsh-assistant'};policy=[pscustomobject]@{installation='AVAILABLE';authentication='ON_INSTALL'};category='Developer Tools'}
    $market.plugins = @($market.plugins | Where-Object { $_.name -ne 'codex-dsh-assistant' }) + @($entry)
    $marketWritten = $true
    [IO.File]::WriteAllText($marketFile,($market | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
    & codex plugin add ('codex-dsh-assistant@' + $market.name) --json
    if ($LASTEXITCODE -ne 0) { throw 'Codex plugin installation failed' }
    Write-Output 'Installed. Invoke the plugin in Codex to begin local DSH setup.'
} catch {
    $originalError = $_
    try {
        if ($swapped -and (Test-Path -LiteralPath $pluginTarget)) { Move-Item -LiteralPath $pluginTarget -Destination $failed }
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $pluginTarget }
        if ($marketWritten) {
            if ($marketExisted) { [IO.File]::WriteAllBytes($marketFile,$marketBytes) }
            elseif (Test-Path -LiteralPath $marketFile) { Move-Item -LiteralPath $marketFile -Destination ($marketFile + '.failed-' + $stamp) }
        }
        if ($wasInstalled) { & codex plugin add ('codex-dsh-assistant@' + $market.name) --json }
        else { & codex plugin remove ('codex-dsh-assistant@' + $market.name) --json }
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Files restored; Codex registration rollback needs inspection.' }
    } catch { Write-Warning ('Rollback needs inspection: ' + $_.Exception.Message) }
    throw $originalError
}
