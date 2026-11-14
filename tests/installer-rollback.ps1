$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-install-test-' + [Guid]::NewGuid().ToString('N'))
$marketPath = Join-Path $testRoot '.agents/plugins/marketplace.json'
$target = Join-Path $testRoot '.codex/local-plugins/codex-dsh-assistant'
New-Item -ItemType Directory -Path (Split-Path $marketPath),$target -Force | Out-Null
$originalMarket = '{"name":"personal","interface":{"displayName":"Personal"},"plugins":[]}'
[IO.File]::WriteAllText($marketPath,$originalMarket,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $target 'old-only.txt'),'original')
$global:installAttempts = 0
$global:mockFail = $true
$global:wasInstalledMock = $true
function global:codex {
    if ($args[1] -eq 'list') { $global:LASTEXITCODE=0; if ($global:wasInstalledMock) { return '{"installed":[{"pluginId":"codex-dsh-assistant@personal"}]}' }; return '{"installed":[]}' }
    if ($args[1] -eq 'add') {
        $global:installAttempts++
        if ($global:mockFail -and $global:installAttempts -eq 1) { $global:LASTEXITCODE=1; return }
    }
    $global:LASTEXITCODE=0
    return '{}'
}
$installer = Join-Path (Split-Path $PSScriptRoot) 'Install-Codex.ps1'
$failed = $false
try { & $installer -UserRoot $testRoot } catch { $failed=$true }
if (-not $failed) { throw 'Expected injected installation failure' }
if (([IO.File]::ReadAllText($marketPath)) -ne $originalMarket) { throw 'Marketplace rollback failed' }
if (-not (Test-Path -LiteralPath (Join-Path $target 'old-only.txt'))) { throw 'Old plugin not restored' }
if (Test-Path -LiteralPath (Join-Path $target 'plugin.json')) { throw 'New files survived rollback' }
if ($global:installAttempts -ne 2) { throw 'Prior plugin registration was not restored' }
$global:mockFail=$false
& $installer -UserRoot $testRoot
if (Test-Path -LiteralPath (Join-Path $target 'old-only.txt')) { throw 'Upgrade retained removed old files' }
if (-not (Test-Path -LiteralPath (Join-Path $target 'plugin.json'))) { throw 'New plugin not installed' }
Write-Output ('PASS: rollback and clean upgrade; fixtures retained at ' + $testRoot)
$freshRoot = $testRoot + '-fresh'
$global:wasInstalledMock=$false
$global:mockFail=$true
$global:installAttempts=0
$failed=$false
try { & $installer -UserRoot $freshRoot } catch { $failed=$true }
if (-not $failed) { throw 'Expected first-install failure' }
if (Test-Path -LiteralPath (Join-Path $freshRoot '.agents/plugins/marketplace.json')) { throw 'New market was not rolled back' }
if (Test-Path -LiteralPath (Join-Path $freshRoot '.codex/local-plugins/codex-dsh-assistant')) { throw 'New plugin source was not rolled back' }
Write-Output 'PASS: failed first installation preserves no live source or market'
