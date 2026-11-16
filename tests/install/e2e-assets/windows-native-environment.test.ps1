$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:OS -cne 'Windows_NT') { throw 'Disposable Windows Actions runner required' }
. (Join-Path $PSScriptRoot 'windows-native-environment.ps1')
$work = Join-Path $env:RUNNER_TEMP ('aino-activation-env-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
$document = Join-Path $work 'environment.json'
$userData = Join-Path $work 'user-data'
$before = [Environment]::GetEnvironmentVariable('HERMES_DESKTOP_USER_DATA_DIR', 'User')
$prior = @{}
try {
    @{ HERMES_DESKTOP_USER_DATA_DIR=$userData; HERMES_HOME=(Join-Path $work 'home') } |
        ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $document
    $prior = Publish-NativeRelaunchEnvironment $document $work $userData
    if ([Environment]::GetEnvironmentVariable('HERMES_DESKTOP_USER_DATA_DIR', 'User') -cne $userData) { throw 'GUI activation environment was not published' }
    Restore-NativeRelaunchEnvironment $prior
    $prior = @{}
    if ([Environment]::GetEnvironmentVariable('HERMES_DESKTOP_USER_DATA_DIR', 'User') -cne $before) { throw 'GUI activation environment was not restored' }
    @{ HERMES_DESKTOP_USER_DATA_DIR=$userData; HTTPS_PROXY='https://foreign.invalid' } |
        ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $document
    $rejected = $false
    try { Publish-NativeRelaunchEnvironment $document $work $userData | Out-Null }
    catch { $rejected = $true }
    if (-not $rejected) { throw 'Nonfixture proxy was admitted' }
    if ([Environment]::GetEnvironmentVariable('HERMES_DESKTOP_USER_DATA_DIR', 'User') -cne $before) { throw 'Rejected input changed GUI activation environment' }
    @{ ok=$true; scope='disposable-current-user-activation-environment' } | ConvertTo-Json
} finally {
    Restore-NativeRelaunchEnvironment $prior
    Remove-Item -LiteralPath $work -Recurse -Force
}
