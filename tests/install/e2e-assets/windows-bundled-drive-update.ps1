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
    # Cancel is destructive to a system window: bind it to this test's product.
    [string]$ExpectedDisplayName = '',
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
if ($InstallerAction -eq 'Cancel' -and [string]::IsNullOrWhiteSpace($ExpectedDisplayName)) {
    throw 'Cancel requires ExpectedDisplayName for the package under test'
}
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

function Find-InvokableButton {
    # Depth-first walk for a button whose Name matches one of the regexes.
    param($Root, [string[]]$Patterns, [switch]$UpdateNavigation)
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)
    $buttons = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($UpdateNavigation) {
        $observed = @(foreach ($button in $buttons) {
            try {
                $current = $button.Current
                @{ Element=$button; Name=$current.Name; IsEnabled=$current.IsEnabled; IsOffscreen=$current.IsOffscreen }
            } catch { continue }
        })
        return Get-UpdateNavigationButton $observed
    }
    foreach ($b in $buttons) {
        try { $current = $b.Current } catch { continue }
        if ($current.IsOffscreen -or -not $current.IsEnabled) { continue }
        $name = $current.Name
        if (-not $name) { continue }
        foreach ($pat in $Patterns) {
            if ($name -match $pat) { return @{ Element = $b; Name = $name } }
        }
    }
    return $null
}

function Invoke-Button($Element) {
    if ($Element.Current.IsOffscreen -or -not $Element.Current.IsEnabled) { return $false }
    $invoke = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
        $invoke.Invoke()
        return $true
    }
    # Fall back to a legacy click through the legacy pattern.
    $legacy = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)) {
        try { $legacy.DoDefaultAction(); return $true } catch {}
    }
    return $false
}

function Show-UpdateAbout($Element, $Window) {
    if ((Get-AppPids).Count -ne 1 -or -not $Element.Current.IsEnabled -or
        $Element.Current.Name -notmatch '^(About|关于|關於)$') { return $false }
    # Only ancestors below this identified OLD window may receive a scroll.
    $ancestors = [System.Collections.Generic.List[object]]::new()
    $parent = $Element
    $bound = $false
    for ($depth = 0; $depth -lt 32; $depth++) {
        if ([System.Windows.Automation.AutomationElement]::Compare($parent, $Window)) { $bound = $true; break }
        $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($parent)
        if ($null -eq $parent) { return $false }
        $ancestors.Add($parent)
    }
    if (-not $bound) { return $false }
    $item = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$item)) {
        $item.ScrollIntoView()
    }
    foreach ($ancestor in $ancestors) {
        if (-not $Element.Current.IsEnabled) { return $false }
        if (-not $Element.Current.IsOffscreen) { return $true }
        if ([System.Windows.Automation.AutomationElement]::Compare($ancestor, $Window)) { break }
        $scroll = $null
        if (-not $ancestor.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$scroll) -or
            -not $scroll.Current.VerticallyScrollable) { continue }
        for ($attempt = 0; $attempt -lt 4 -and $Element.Current.IsOffscreen; $attempt++) {
            $scroll.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement)
        }
        break
    }
    return $Element.Current.IsEnabled -and -not $Element.Current.IsOffscreen
}

function Get-VerifiedInstallerWindows {
    $installerPackages = @(Get-AppxPackage -Name 'Microsoft.DesktopAppInstaller')
    if ($installerPackages.Count -ne 1) { throw 'Cannot identify one installed Windows App Installer package' }
    $installerRoot = $installerPackages[0].InstallLocation.TrimEnd('\') + '\'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($candidate in @(Get-Process -Name 'AppInstaller' -ErrorAction SilentlyContinue)) {
        if (-not $candidate.Path.StartsWith($installerRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $candidate.Id)
        foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
            if ($window.Current.NativeWindowHandle -eq 0 -or $window.Current.IsOffscreen) { continue }
            [pscustomobject]@{ Element=$window; ProcessId=$candidate.Id; Birth=$candidate.StartTime;
                Handle=$window.Current.NativeWindowHandle; Title=$window.Current.Name }
        }
    }
}

function Find-TestInstallerWindow([datetime]$ClickedAt, [string]$DisplayName, [object[]]$PreviouslyVisible) {
    $boundWindows = @()
    $productPattern = '(?i)(?<![\p{L}\p{N}])' + [regex]::Escape($DisplayName) + '(?![\p{L}\p{N}])'
    foreach ($candidate in @(Get-VerifiedInstallerWindows)) {
        $startedForAttempt = $candidate.Birth -ge $ClickedAt
        $wasVisible = @($PreviouslyVisible | Where-Object { $_.ProcessId -eq $candidate.ProcessId -and
            $_.Birth -eq $candidate.Birth -and $_.Handle -eq $candidate.Handle }).Count -gt 0
        if ($wasVisible) { continue }
        $names = @($candidate.Title)
        foreach ($element in $candidate.Element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            $names += $element.Current.Name
        }
        if (-not (($names -join "`n") -match $productPattern)) { continue }
        $boundWindows += [pscustomobject]@{ Element=$candidate.Element; ProcessId=$candidate.ProcessId; Birth=$candidate.Birth;
            Handle=$candidate.Handle; Title=$candidate.Title; NewVisibleWindow=(-not $wasVisible); ProcessStartedForAttempt=$startedForAttempt }
    }
    if ($boundWindows.Count -gt 1) { throw 'Refusing to cancel: more than one new App Installer window matches this product' }
    if ($boundWindows.Count -eq 1) { return $boundWindows[0] }
    return $null
}

function Invoke-TestInstallerCancel($Window) {
    $hit = Find-InvokableButton -Root $Window.Element -Patterns @('^Cancel$', '^Cancel (?:update|installation)$', '^取消(?:更新|安装)?$')
    if ($hit -and (Invoke-Button $hit.Element)) { return 'cancel-button' }
    $pattern = $null
    if ($Window.Element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
        $pattern.Close()
        return 'window-close'
    }
    throw 'The identified App Installer window exposes neither Cancel nor WindowPattern.Close'
}

function Test-InstallerWindowClosed($Window) {
    $candidate = Get-Process -Id $Window.ProcessId -ErrorAction SilentlyContinue
    if (-not $candidate -or $candidate.StartTime -ne $Window.Birth) { return $true }
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $Window.ProcessId)
    foreach ($current in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
        if ($current.Current.NativeWindowHandle -eq $Window.Handle -and -not $current.Current.IsOffscreen) { return $false }
    }
    return $true
}

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
            if ($InstallerAction -eq 'Cancel') { $visibleBeforeAttempt = @(Get-VerifiedInstallerWindows) }
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
            } -Scroll { param($element) Show-UpdateAbout $element $win } -Invoke {
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
while ((Get-Date) -lt $cDeadline -and -not $confirmed -and -not $installerCancelled) {
    if ($InstallerAction -eq 'Cancel') {
        $boundWindow = Find-TestInstallerWindow $updateClickedAt $ExpectedDisplayName $installerVisibleBeforeClick
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
    $installer = Get-Process -Name "AppInstaller" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installer) {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $installer.Id)
        $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
        if ($win) {
            $installerObserved = $true
            $installerPid = $installer.Id
            $installerWindow = @{ handle=$win.Current.NativeWindowHandle; title=$win.Current.Name }
            $hit = Find-InvokableButton -Root $win -Patterns @('^Update$', '^Install$', '^(Reinstall|Update) .*', '^更新$', '^安装$', '^重新安装$')
            if ($hit) {
                Save-Shot "02-appinstaller-confirm"
                Write-Host "  [uia] App Installer dialog: clicking '$($hit.Name)'"
                if (Invoke-Button $hit.Element) { $confirmed = $true; $installerActionTaken = 'confirm-button' }
            }
        }
    }
    # The app quits before App Installer opens; keep watching its confirmation.
    Start-Sleep -Seconds 3
}
if ($InstallerAction -eq 'Cancel' -and -not $installerCancelled) {
    Save-Shot 'zz-appinstaller-cancel-ui-missing'
    @{ ok=$false; clicked=$clicked.Name; installerAction=$InstallerAction; appInstallerObserved=$installerObserved;
        appInstallerCancelled=$false; appInstallerConfirmed=$false; installerPid=$installerPid; installerWindow=$installerWindow;
        action=$installerActionTaken; newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt;
        exited=((Get-AppPids).Count -eq 0) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    throw 'Cancel requires an observed App Installer window bound to this update; none was cancellable'
}
if ($installerCancelled) { Write-Host "  [uia] identified App Installer window cancelled via $installerActionTaken" }
elseif ($confirmed) { Write-Host "  [uia] App Installer confirmation clicked" }
else { Write-Host "  [uia] no App Installer dialog appeared (OnLaunch ShowPrompt=false + real source registration): ok" }
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
            installerPid=$installerPid; installerWindow=$installerWindow; action=$installerActionTaken;
            newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt } |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
        exit 0
    }
    Start-Sleep -Seconds 5
}
Save-Shot "zz-app-never-exited"
@{ ok = $false; clicked = $clicked.Name; appInstallerConfirmed = [bool]$confirmed; exited = $false;
    installerAction=$InstallerAction; appInstallerObserved=$installerObserved; appInstallerCancelled=$installerCancelled;
    installerPid=$installerPid; installerWindow=$installerWindow; action=$installerActionTaken;
    newVisibleWindow=$newVisibleWindow; processStartedForAttempt=$processStartedForAttempt } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
throw "the $ProcessName process never exited after the update trigger ($ExitTimeoutSec s) - a surviving process would hold package files during the swap"
