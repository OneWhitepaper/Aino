# ============================================================================
# windows-bundled-drive-update.ps1 — drive the REAL in-app update surface of
# the INSTALLED (MSIX) desktop app via UI Automation.
# ============================================================================
# The packaged arm's whole point: a real user trigger starts the update
# against the controlled feed. No Playwright Electron-driver attach (the
# package must run AS INSTALLED, not from a checkout), so this helper drives
# UIA exactly like the reference technique (package-update-acceptance.md):
# the installed Electron UI exposes text and controls once Chromium's
# accessibility engages for a UIA client.
#
# Sequence, each step polled with screenshots into -ProofDir:
#   1. find the Hermes window (by process id, NOT window-title guesswork)
#   2. click the in-app update trigger: the "Update now" button (i18n 'en'
#      updates-overlay: "A new version of Hermes is ready. Update now and
#      Windows will finish it for you."). Names matched case-insensitively
#      on 'update' for the button the app owns; NEVER an internal apply call.
#   3. when the OS App Installer confirmation window appears, click its
#      Update/Install button (UpdateSettings OnLaunch ShowPrompt=false means
#      it usually does NOT appear; tolerate both).
#      -InstallerAction Cancel instead requires a new system window bound to
#      -ExpectedDisplayName, invokes Cancel/Close, and observes its dismissal.
#   4. wait for the app processes to exit (the hand-off quits the app) —
#      exit 0 = the trigger was clicked by THIS driver and the app exited.
#
# The driver never launches a new app instance: proving the NEW process
# without driver launch is the parent driver's job (windows-bundled-e2e.ps1).
# ============================================================================

param(
    [Parameter(Mandatory = $true)][int]$OldProcessId,
    [Parameter(Mandatory = $true)][string]$ProofDir,
    [string]$ResultPath = "",
    [ValidateSet('Confirm', 'Cancel')][string]$InstallerAction = 'Confirm',
    # Both OS actions must bind to this test's product.
    [Parameter(Mandatory=$true)][string]$ExpectedDisplayName,
    # How long to keep looking for the in-app button (the app may still be
    # booting its backend when the driver starts).
    [int]$ButtonTimeoutSec = 300,
    # How long to wait for the App Installer confirmation dialog, if the OS
    # shows one at all.
    [int]$ConfirmTimeoutSec = 120,
    # How long to wait for the app processes to exit after the click.
    [int]$ExitTimeoutSec = 600
)

$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable CI runner required' }
if ([string]::IsNullOrWhiteSpace($ExpectedDisplayName)) { throw 'ExpectedDisplayName is required' }
. (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1')
$oldProcess = Get-Process -Id $OldProcessId
$oldBirth = $oldProcess.StartTime
$ProcessName = $oldProcess.ProcessName
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

New-Item -ItemType Directory -Path $ProofDir -Force | Out-Null
if (-not $ResultPath) { $ResultPath = Join-Path $ProofDir "drive-update-result.json" }

function Save-Shot([string]$Name) {
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $bmp.Save((Join-Path $ProofDir "$Name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
    } catch { Write-Host "  [uia] screenshot $Name failed: $($_.Exception.Message)" }
}

function Get-AppPids {
    $current = Get-Process -Id $OldProcessId -ErrorAction SilentlyContinue
    if ($current -and $current.StartTime -eq $oldBirth) { return @($OldProcessId) }
    return @()
}

# UIA element helpers --------------------------------------------------------

function Find-AppWindow {
    param([int[]]$Pids)
    if (-not $Pids -or $Pids.Count -eq 0) { return $null }
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $Pids[0])
    # The process hosts several top-level windows (main + hidden helpers);
    # prefer one with a window handle (visible).
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $wins) {
        if ($w.Current.NativeWindowHandle -ne 0) { return $w }
    }
    if ($wins.Count -gt 0) { return $wins[0] }
    return $null
}

. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')

# 1. the in-app Update trigger ------------------------------------------------

Write-Host "[uia] waiting for the $ProcessName window and its Update now button (up to ${ButtonTimeoutSec}s) ..."
$pids = Get-AppPids
if ($pids.Count -eq 0) { throw "no $ProcessName process is running - the install phase must leave the OLD app running" }

$deadline = (Get-Date).AddSeconds($ButtonTimeoutSec)
$clicked = $null
$updateClickedAt = $null
$installerVisibleBeforeClick = @()
while ((Get-Date) -lt $deadline -and -not $clicked) {
    $pids = Get-AppPids
    $win = Find-AppWindow -Pids $pids
    if ($win) {
        $hit = Find-InvokableButton -Root $win -Patterns @(
            '^Update now',            # en: the packaged overlay's primary action
            'Update (Aino|Hermes)',
            '^Update$',
            '^立即更新',
            '^更新(?: Aino)?$'
        )
        if ($hit) {
            Save-Shot "01-before-update-click"
            Write-Host "  [uia] clicking button '$($hit.Name)'"
            $visibleBeforeAttempt = @()
            $visibleBeforeAttempt = @(Get-VerifiedInstallerWindows)
            $attemptedAt = Get-Date
            if (Invoke-Button $hit.Element) {
                $clicked = $hit
                $updateClickedAt = $attemptedAt
                $installerVisibleBeforeClick = $visibleBeforeAttempt
            } else { Write-Host "  [uia] invoke pattern unavailable; retrying" }
        } else {
            # Use the visible settings flow; never call the updater bridge.
            $navigation = Find-InvokableButton -Root $win -UpdateNavigation
            [void](Invoke-UpdateNavigationButton $navigation -Refresh {
                if ((Get-AppPids).Count -eq 1) { Find-InvokableButton -Root $win -UpdateNavigation }
            } -Scroll {
                param($element)
                if ((Get-AppPids).Count -eq 1) { Show-UpdateAbout $element $win }
            } -Invoke {
                param($element)
                Invoke-Button $element
            })
        }
    }
    if (-not $clicked) { Start-Sleep -Seconds 3 }
}
if (-not $clicked) {
    Save-Shot "zz-no-update-button"
    throw "never found an invokable Update button in the $ProcessName UI after $ButtonTimeoutSec s"
}
Write-Host "  [uia] in-app update trigger clicked: $($clicked.Name)"

# 2. the OS App Installer action (Cancel requires an observed system window) --

Write-Host "[uia] watching for App Installer action $InstallerAction (up to ${ConfirmTimeoutSec}s) ..."
$cDeadline = (Get-Date).AddSeconds($ConfirmTimeoutSec)
$confirmed = $false
$installerObserved = $false
$installerCancelled = $false
$installerPid = $null
$installerWindow = $null
$installerActionTaken = $null
$newVisibleWindow = $false
$processStartedForAttempt = $false
$installerSnapshot = @{ installerState='not-observed'; visibleWindowCount=0; matchingWindowCount=0; hresults=@() }
while ((Get-Date) -lt $cDeadline -and -not $confirmed -and -not $installerCancelled) {
    if ($InstallerAction -eq 'Cancel') {
        $windows = @(Get-VerifiedInstallerWindows)
        $installerSnapshot = Get-InstallerWindowSnapshot $ExpectedDisplayName $windows
        $boundWindow = Find-TestInstallerWindow $updateClickedAt $ExpectedDisplayName $installerVisibleBeforeClick $windows
        if ($boundWindow) {
            $installerObserved = $true
            $installerPid = $boundWindow.ProcessId
            $newVisibleWindow = $boundWindow.NewVisibleWindow
            $processStartedForAttempt = $boundWindow.ProcessStartedForAttempt
            $installerWindow = @{ handle=$boundWindow.Handle; title=$boundWindow.Title;
                processStartTime=$boundWindow.Birth.ToString('o'); expectedDisplayName=$ExpectedDisplayName;
                newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt;
                visibleBeforeClick=@($installerVisibleBeforeClick | ForEach-Object {
                    @{ pid=$_.ProcessId; birth=$_.Birth.ToString('o'); handle=$_.Handle }
                }) }
            Save-Shot '02-appinstaller-before-cancel'
            $installerActionTaken = Invoke-TestInstallerCancel $boundWindow
            Save-Shot '02-appinstaller-cancel-action'
            $cancelDeadline = (Get-Date).AddSeconds(30)
            while (-not (Test-InstallerWindowClosed $boundWindow)) {
                if ((Get-Date) -ge $cancelDeadline) {
                    Save-Shot 'zz-appinstaller-cancel-not-closed'
                    throw 'App Installer remained visible after the observed cancellation action'
                }
                Start-Sleep -Milliseconds 200
            }
            $installerCancelled = $true
            Save-Shot '03-appinstaller-cancelled'
        }
        if (-not $installerCancelled) { Start-Sleep -Milliseconds 200 }
        continue
    }
    # Reuse cancellation's exact system-package/product/new-window binding.
    # A helper window or another product's installer must never hide the target.
    $windows = @(Get-VerifiedInstallerWindows)
    $installerSnapshot = Get-InstallerWindowSnapshot $ExpectedDisplayName $windows
    $installerSnapshot | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $ProofDir 'installer-window-observation.json')
    $boundWindow = Find-TestInstallerWindow $updateClickedAt $ExpectedDisplayName $installerVisibleBeforeClick $windows
    if ($boundWindow) {
        $installerObserved = $true
        $installerPid = $boundWindow.ProcessId
        $installerWindow = @{ handle=$boundWindow.Handle; title=$boundWindow.Title }
        $newVisibleWindow = $boundWindow.NewVisibleWindow
        $processStartedForAttempt = $boundWindow.ProcessStartedForAttempt
        $hit = Find-InvokableButton $boundWindow.Element @('^Update$', '^Install$', '^(Reinstall|Update) .*', '^更新$', '^安装$', '^重新安装$')
        if ($hit) {
            Save-Shot '02-appinstaller-confirm'
            Write-Host "  [uia] identified App Installer dialog: clicking '$($hit.Name)'"
            if (Invoke-Button $hit.Element) { $confirmed = $true; $installerActionTaken = 'confirm-button' }
        }
    }
    # The app quits before App Installer opens; keep watching its confirmation.
    Start-Sleep -Seconds 3
}
if ($InstallerAction -eq 'Cancel' -and -not $installerCancelled) {
    Save-Shot 'zz-appinstaller-cancel-ui-missing'
    @{ ok=$false; clicked=$clicked.Name; installerAction=$InstallerAction; appInstallerObserved=$installerObserved;
        appInstallerCancelled=$false; appInstallerConfirmed=$false; installerPid=$installerPid; installerWindow=$installerWindow;
            installerState=$(if ($confirmed) { 'confirmation-invoked' } elseif ($installerCancelled) { 'cancelled' } else { $installerSnapshot.installerState });
            installerHresults=$installerSnapshot.hresults; visibleWindowCount=$installerSnapshot.visibleWindowCount; matchingWindowCount=$installerSnapshot.matchingWindowCount;
        action=$installerActionTaken; newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt;
        exited=((Get-AppPids).Count -eq 0) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    throw 'Cancel requires an observed App Installer window bound to this update; none was cancellable'
}
if ($installerCancelled) { Write-Host "  [uia] identified App Installer window cancelled via $installerActionTaken" }
elseif ($confirmed) { Write-Host "  [uia] App Installer confirmation clicked" }
elseif ($installerSnapshot.visibleWindowCount -gt 0) { Write-Host "  [uia] installer UI observed without a confirmation action: state=$($installerSnapshot.installerState); package replacement remains unverified" }
else { Write-Host '  [uia] no verified visible App Installer window observed; package replacement remains unverified' }
Save-Shot "03-after-trigger"

# 3. wait for the app to exit (the hand-off quits it; never kill it here) -----

Write-Host "[uia] waiting for $ProcessName to exit (up to ${ExitTimeoutSec}s) ..."
$eDeadline = (Get-Date).AddSeconds($ExitTimeoutSec)
while ((Get-Date) -lt $eDeadline) {
    if ((Get-AppPids).Count -eq 0) {
        Save-Shot "04-app-exited"
        Write-Host "  [uia] OLD app exited for the package swap"
        @{ ok = $true; clicked = $clicked.Name; appInstallerConfirmed = [bool]$confirmed; exited = $true;
            installerAction=$InstallerAction; appInstallerObserved=$installerObserved; appInstallerCancelled=$installerCancelled;
            installerPid=$installerPid; installerWindow=$installerWindow;
            installerState=$(if ($confirmed) { 'confirmation-invoked' } elseif ($installerCancelled) { 'cancelled' } else { $installerSnapshot.installerState });
            installerHresults=$installerSnapshot.hresults; visibleWindowCount=$installerSnapshot.visibleWindowCount; matchingWindowCount=$installerSnapshot.matchingWindowCount; action=$installerActionTaken;
            newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt } |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
        exit 0
    }
    Start-Sleep -Seconds 5
}
Save-Shot "zz-app-never-exited"
@{ ok = $false; clicked = $clicked.Name; appInstallerConfirmed = [bool]$confirmed; exited = $false;
    installerAction=$InstallerAction; appInstallerObserved=$installerObserved; appInstallerCancelled=$installerCancelled;
    installerPid=$installerPid; installerWindow=$installerWindow;
            installerState=$(if ($confirmed) { 'confirmation-invoked' } elseif ($installerCancelled) { 'cancelled' } else { $installerSnapshot.installerState });
            installerHresults=$installerSnapshot.hresults; visibleWindowCount=$installerSnapshot.visibleWindowCount; matchingWindowCount=$installerSnapshot.matchingWindowCount; action=$installerActionTaken;
    newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
throw "the $ProcessName process never exited after the update trigger ($ExitTimeoutSec s) - a surviving process would hold package files during the swap"
