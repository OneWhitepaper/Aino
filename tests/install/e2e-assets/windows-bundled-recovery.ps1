# The successful update keeps its own receipts even when a recovery case fails.
# These helpers only operate on the package and explicit roots owned by the caller.
function Wait-RecoveryEvidence($Run, [string]$File, [int]$TimeoutSeconds = 360) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $File)) {
        if ((Test-Path -LiteralPath $Run.ExitFile) -or -not (Get-Process -Id $Run.Id -ErrorAction SilentlyContinue)) {
            throw "Recovery driver exited before writing $File"
        }
        if ((Get-Date) -ge $deadline) { throw "Recovery evidence timed out: $File" }
        Start-Sleep -Milliseconds 200
    }
}

function Write-RecoveryOutcome([string]$Out, $Result) {
    $Result | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Out 'scenario-result.json')
}

function Invoke-NativePreparationRecovery($Settings, [scriptblock]$PublishNew, [scriptblock]$PublishOld,
    [scriptblock]$AssertOld, [scriptblock]$VerifyState) {
    $out = Join-Path $Settings.Proof 'preparation-failure'
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $driver = $null
    $result = $null
    try {
        $driver = Start-OutsideRunnerJob 'preparation-recovery' $Settings.Work $Settings.Node @(
            (Join-Path $Settings.Assets 'native-update-recovery.ts'), '--scenario', 'preparation-failure',
            '--exe', $Settings.Exe, '--root', $Settings.Root, '--home', $Settings.Home,
            '--user-data', $Settings.UserData, '--out', $out, '--expect-commit', $Settings.Commit,
            '--mock-url', $Settings.MockUrl, '--descriptor', $Settings.Descriptor)
        Wait-RecoveryEvidence $driver (Join-Path $out 'preparation-chat-ready.json')
        & $PublishNew | Out-Host
        Set-Content -Encoding ascii -LiteralPath (Join-Path $out 'preparation-feed-ready') -Value 'published'
        if ((Wait-OutsideRunnerJob $driver 8) -ne 0) { throw 'Native preparation failure did not recover in the same OLD window' }
        & $AssertOld | Out-Host
        & $VerifyState 'preparation-failure' | Out-Host
        $proof = Get-Content -Raw -LiteralPath (Join-Path $out 'recovery.json') | ConvertFrom-Json
        if ($proof.status -cne 'passed' -or $proof.scenario -cne 'preparation-failure') { throw 'Preparation recovery receipt is not successful' }
        $result = @{ ok=$true; scenario='preparation-failure'; sameOldProcess=$true; descriptorHttpStatus=404; proof='preparation-failure/recovery.json' }
    } catch {
        $result = @{ ok=$false; scenario='preparation-failure'; error=$_.Exception.Message }
    } finally {
        if ($driver) { Stop-OutsideRunnerJob $driver }
        # The Node observer restores the exact held descriptor; a failed launch
        # before that observer still leaves the caller's source usable.
        & $PublishOld | Out-Host
        Remove-Item -LiteralPath "$($Settings.Descriptor).recovery-held" -Force -ErrorAction SilentlyContinue
    }
    Write-RecoveryOutcome $out $result
    return [pscustomobject]$result
}

function Invoke-NativeCancelRecovery($Settings, [scriptblock]$PublishOld, [scriptblock]$PublishNew,
    [scriptblock]$AssertOld, [scriptblock]$VerifyState) {
    $out = Join-Path $Settings.Proof 'cancel-reopen'
    $oldOut = Join-Path $out 'old'
    $reopenOut = Join-Path $out 'manual-reopen'
    New-Item -ItemType Directory -Path $oldOut, $reopenOut -Force | Out-Null
    $driver = $null
    $installed = $false
    $result = $null
    $nativeEnvironment = @{}
    try {
        if (Get-AppxPackage -Name $Settings.Identity) { throw 'Cancellation recovery requires the successful journey to have uninstalled its package first' }
        & $PublishOld | Out-Host
        Add-AppxPackage -AppInstallerFile $Settings.Descriptor
        $installed = $true
        & $AssertOld | Out-Host
        $driver = Start-OutsideRunnerJob 'cancel-old' $Settings.Work $Settings.Node @(
            (Join-Path $Settings.Assets 'drive-update.cjs'), $Settings.Exe, $oldOut, $Settings.Commit, '--native-handoff')
        $readyPath = Join-Path $oldOut 'old-chat-ready.json'
        Wait-RecoveryEvidence $driver $readyPath
        $ready = Get-Content -Raw -LiteralPath $readyPath | ConvertFrom-Json
        $rows = Main-Processes $Settings.Exe
        if ($rows.Count -ne 1 -or $rows[0].ProcessId -ne $ready.pid -or $ready.exe -cne $Settings.Exe -or $ready.oldSha -cne $Settings.Commit -or
            [IO.Path]::GetFullPath($ready.userData) -ine [IO.Path]::GetFullPath($Settings.UserData)) {
            throw 'Cancellation scenario did not identify its OLD process and preserved profile'
        }
        # Even an unexpected apply/relaunch on a failed cancellation must stay
        # inside this scenario's explicit data root and account fixture.
        $nativeEnvironment = Publish-NativeRelaunchEnvironment (Join-Path $oldOut 'native-relaunch-environment.json') $Settings.Work $Settings.UserData
        & $PublishNew | Out-Host
        $clickPath = Join-Path $out 'cancel-click.json'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Settings.Assets 'windows-bundled-drive-update.ps1') `
            -OldProcessId $ready.pid -ProofDir $out -ResultPath $clickPath -InstallerAction Cancel -ExpectedDisplayName 'Aino'
        if ($LASTEXITCODE -ne 0) { throw 'OS App Installer cancellation was not observed; absence of its UI is not success' }
        $click = Get-Content -Raw -LiteralPath $clickPath | ConvertFrom-Json
        if (-not $click.ok -or -not $click.exited -or -not $click.appInstallerObserved -or -not $click.appInstallerCancelled -or -not $click.newVisibleWindow -or
            $click.installerAction -cne 'Cancel' -or $click.action -notin @('cancel-button', 'window-close')) {
            throw 'The strict OS cancellation receipt is incomplete'
        }
        Wait-RecoveryEvidence $driver (Join-Path $oldOut 'old-process-closed.json') 30
        & $AssertOld | Out-Host
        & $VerifyState 'os-cancel' | Out-Host
        Restore-NativeRelaunchEnvironment $nativeEnvironment
        $nativeEnvironment = @{}
        Set-Content -LiteralPath (Join-Path $oldOut 'native-update-complete') -Value 'cancelled'
        if ((Wait-OutsideRunnerJob $driver 1) -ne 0) { throw 'Cancelled OLD driver did not release its account fixture' }
        $driver = $null
        $code = Invoke-OutsideRunnerJob 'cancel-manual-reopen' $Settings.Work $Settings.Node @(
            (Join-Path $Settings.Assets 'native-update-recovery.ts'), '--scenario', 'manual-old-reopen',
            '--exe', $Settings.Exe, '--root', $Settings.Root, '--home', $Settings.Home,
            '--user-data', $Settings.UserData, '--out', $reopenOut, '--expect-commit', $Settings.Commit,
            '--mock-url', $Settings.MockUrl) 15
        if ($code -ne 0) { throw 'Manually reopened OLD did not retain its account, history, model and real chat' }
        & $AssertOld | Out-Host
        & $VerifyState 'cancel-manual-reopen' | Out-Host
        $proof = Get-Content -Raw -LiteralPath (Join-Path $reopenOut 'recovery.json') | ConvertFrom-Json
        if ($proof.status -cne 'passed' -or -not $proof.manualReopen -or $proof.automaticRecovery) { throw 'Manual OLD recovery receipt is incomplete' }
        $result = @{ ok=$true; scenario='os-cancel-manual-reopen'; installerCancellationObserved=$true;
            oldVersionPreserved=$true; manualReopen=$true; automaticRecovery=$false; proof='cancel-reopen/manual-reopen/recovery.json' }
    } catch {
        $result = @{ ok=$false; scenario='os-cancel-manual-reopen'; automaticRecovery=$false; error=$_.Exception.Message }
    } finally {
        Restore-NativeRelaunchEnvironment $nativeEnvironment
        if ($driver) { Stop-OutsideRunnerJob $driver }
        if ($installed) { Remove-DesktopJourneyPackage $Settings.Identity }
    }
    Write-RecoveryOutcome $out $result
    return [pscustomobject]$result
}
