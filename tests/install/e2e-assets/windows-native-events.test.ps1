# Deployment diagnostics must distinguish an empty log from a failed native query.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$work = Join-Path ([IO.Path]::GetTempPath()) ('aino-event-probe-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($work) | Out-Null
$request = Join-Path $work 'request.json'
@{ identity='Aino.ProbeFixture'; startedAt=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $request
$probe = Join-Path $PSScriptRoot 'windows-native-probe.ps1'
try {
    function Get-WinEvent {
        [CmdletBinding()]param($FilterHashtable, $MaxEvents)
        $record = [Management.Automation.ErrorRecord]::new([UnauthorizedAccessException]::new('fixture denied'),
            'NativeEventAccessDenied', [Management.Automation.ErrorCategory]::PermissionDenied, $null)
        $PSCmdlet.WriteError($record)
    }
    $denied = $false
    try { $null = & $probe -Operation events -RequestPath $request }
    catch { $denied = $_.FullyQualifiedErrorId -like 'NativeEventAccessDenied*' }
    if (-not $denied) { throw 'An inaccessible deployment log must not become a successful empty observation' }

    function Get-WinEvent {
        [CmdletBinding()]param($FilterHashtable, $MaxEvents)
        $record = [Management.Automation.ErrorRecord]::new([Exception]::new('fixture no matching events'),
            'NoMatchingEventsFound', [Management.Automation.ErrorCategory]::ObjectNotFound, $null)
        $PSCmdlet.WriteError($record)
    }
    $empty = (& $probe -Operation events -RequestPath $request) | ConvertFrom-Json
    if ($empty.queryStatus -cne 'ok' -or $empty.matchedCount -ne 0) {
        throw 'The native no-matching-events result must remain a successful empty observation'
    }

    function Get-WinEvent {
        [CmdletBinding()]param($FilterHashtable, $MaxEvents)
        $event = [pscustomobject]@{ Id=404; Level=2 }
        $event | Add-Member -MemberType ScriptMethod -Name ToXml -Value {
            '<Event><Data>Aino.ProbeFixture</Data><Data>0x80073d02</Data></Event>'
        }
        return $event
    }
    $matched = (& $probe -Operation events -RequestPath $request) | ConvertFrom-Json
    if ($matched.queryStatus -cne 'ok' -or $matched.matchedCount -ne 1 -or $matched.errorCount -ne 1 -or
        @($matched.hresults).Count -ne 1 -or $matched.hresults[0] -cne '0x80073D02') {
        throw 'Actual matching deployment facts must retain their typed counts and HRESULT'
    }
    if ($env:OS -eq 'Windows_NT') {
        Remove-Item -LiteralPath Function:\Get-WinEvent
        @{ identity='Aino.ProbeFixture'; startedAt=[DateTime]::UtcNow.AddYears(1).ToString('o') } |
            ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $request
        $nativeEmpty = (& $probe -Operation events -RequestPath $request) | ConvertFrom-Json
        if ($nativeEmpty.queryStatus -cne 'ok' -or $nativeEmpty.matchedCount -ne 0) {
            throw 'The real Windows event cmdlet must identify its empty selection'
        }
    }
    Write-Output 'PASS: deployment query failures remain distinct from no matching events'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
