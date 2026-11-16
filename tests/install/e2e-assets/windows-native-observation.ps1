# Process supervision for the existing native journey; no app launch or update here.
function Invoke-NativeObserver([string]$Node, [string]$Assets, [string]$Proof, $Request) {
    $requestPath = Join-Path $Proof 'native-observation-request.json'
    $Request | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $requestPath
    $script = Join-Path $Assets 'windows-native-observation.mjs'
    $observer = Start-Process -FilePath $Node -ArgumentList @(('"' + $script + '"'), ('"' + $requestPath + '"')) `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Proof 'native-observation.log') `
        -RedirectStandardError (Join-Path $Proof 'native-observation-error.log')
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $heartbeat = 0
    while (-not $observer.HasExited) {
        if ($clock.Elapsed.TotalSeconds -ge 940) {
            # This is an owned diagnostic tree, never the installed app or OS installer.
            & taskkill.exe /PID $observer.Id /T /F | Out-Null
            @{ status='unaccepted'; phase='supervisor-timeout' } | ConvertTo-Json |
                Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Proof 'native-observation.json')
            throw 'Native observation supervisor timed out after 940 seconds'
        }
        if ($clock.Elapsed.TotalSeconds -ge $heartbeat) {
            $file = Join-Path $Proof 'native-observation.json'
            if (Test-Path -LiteralPath $file) {
                $value = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json
                $summary = $value | Select-Object status, phase, packageQuery, processQuery, oldPayloadCount, newMainCount, waiterStage | ConvertTo-Json -Compress
                Write-Host "[native-e2e] observation=$summary elapsed=$([int]$clock.Elapsed.TotalSeconds)s"
            } else { Write-Host "[native-e2e] observation starting elapsed=$([int]$clock.Elapsed.TotalSeconds)s" }
            $queryFile = Join-Path $Proof 'native-query-progress.json'
            if (Test-Path -LiteralPath $queryFile) {
                $query = Get-Content -Raw -LiteralPath $queryFile | ConvertFrom-Json
                Write-Host "[native-e2e] query=$($query.operation) started=$($query.startedAt)"
            }
            $heartbeat = $clock.Elapsed.TotalSeconds + 30
        }
        Start-Sleep -Milliseconds 200
    }
    $observer.WaitForExit()
    Get-Content -LiteralPath (Join-Path $Proof 'native-observation.log') -Encoding UTF8 | Write-Host
    if ($observer.ExitCode -ne 0) { throw 'Native replacement/activation observation failed; see native-observation.json' }
    $result = Get-Content -Raw -LiteralPath (Join-Path $Proof 'native-observation.json') | ConvertFrom-Json
    if ($result.status -cne 'observed' -or $result.phase -cne 'new-observed') { throw 'Automatic NEW observation is incomplete' }
    return $result
}

function Remove-NativeJourneyPackage([string]$Node, [string]$Assets, [string]$Proof, [string]$Identity) {
    $request = Join-Path $Proof 'native-cleanup-request.json'
    @{ identity=$Identity } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $request
    & $Node (Join-Path $Assets 'windows-native-observation.mjs') $request 'cleanup'
    if ($LASTEXITCODE -ne 0) { throw 'Owned native package cleanup failed or exceeded 90 seconds; evidence retained' }
}
