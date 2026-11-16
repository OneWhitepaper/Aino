# Real UIA observation must run outside the UI owner thread/process.
param([switch]$Fixture, [string]$ReadyFile, [string]$ReadyEvent, [string]$StopEvent)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { Write-Output 'SKIP: real installer UIA contracts require Windows'; exit 0 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AinoInstallerControlFixture {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateWindowEx(int exStyle, string className, string text,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
        IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")]
    public static extern bool EnableWindow(IntPtr window, bool enabled);
}
'@
if ($Fixture) {
    $helperForm = New-Object System.Windows.Forms.Form
    $targetForm = New-Object System.Windows.Forms.Form
    $foreignForm = New-Object System.Windows.Forms.Form
    $helperForm.Text = 'Installer helper'
    $targetForm.Text = 'Install Aino 0x80073d02'
    $foreignForm.Text = 'Install AnotherProduct'
    $buttonHandle = [AinoInstallerControlFixture]::CreateWindowEx(0, 'BUTTON', 'Update', 0x50010000,
        16, 16, 120, 32, $targetForm.Handle, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($buttonHandle -eq [IntPtr]::Zero) { throw 'Could not create the owned standard Win32 button' }
    $readySignal = [Threading.EventWaitHandle]::OpenExisting($ReadyEvent)
    $stopSignal = [Threading.EventWaitHandle]::OpenExisting($StopEvent)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 100
    $script:published = $false
    $timer.add_Tick({
        if (-not $script:published) {
            @{ helper=$helperForm.Handle.ToInt64(); target=$targetForm.Handle.ToInt64();
               foreign=$foreignForm.Handle.ToInt64(); button=$buttonHandle.ToInt64() } |
                ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8
            $script:published = $true
            [void]$readySignal.Set()
        }
        if ($stopSignal.WaitOne(0) -or $clock.Elapsed.TotalSeconds -ge 120) {
            [System.Windows.Forms.Application]::ExitThread()
        }
    })
    try {
        $helperForm.Show()
        $foreignForm.Show()
        $targetForm.Show()
        $timer.Start()
        # Keep the provider's Windows-message pump alive while another process
        # performs UIA. Calling UIA from this thread silently fell back to Pane.
        [System.Windows.Forms.Application]::Run()
    } finally {
        $timer.Stop(); $timer.Dispose()
        foreach ($form in @($helperForm, $targetForm, $foreignForm)) { $form.Close(); $form.Dispose() }
        $readySignal.Dispose(); $stopSignal.Dispose()
    }
    exit 0
}

function Window-Record([long]$Handle) {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
    if ($element.Current.ProcessId -ne $fixtureProcess.Id) { throw 'UIA window is outside the owned fixture process' }
    [pscustomobject]@{ Element=$element; ProcessId=$fixtureProcess.Id; Birth=$fixtureProcess.StartTime;
        Handle=$Handle; Title=$element.Current.Name }
}

$nonce = [Guid]::NewGuid().ToString('N')
$work = Join-Path ([IO.Path]::GetTempPath()) "aino-installer-ui-$nonce"
[IO.Directory]::CreateDirectory($work) | Out-Null
$readyPath = Join-Path $work 'ready.json'
$readyName = "AinoInstallerUiReady$nonce"
$stopName = "AinoInstallerUiStop$nonce"
$readySignal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $readyName)
$stopSignal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $stopName)
$fixtureProcess = $null
try {
    $fixtureProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -NoNewWindow -PassThru -ArgumentList @(
        '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Fixture',
        '-ReadyFile', "`"$readyPath`"", '-ReadyEvent', $readyName, '-StopEvent', $stopName)
    if (-not $readySignal.WaitOne(30000)) { throw 'The separate UI owner did not start its message pump within 30 seconds' }
    $handles = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    $clicked = Get-Date
    $helper = Window-Record $handles.helper
    $target = Window-Record $handles.target
    $foreign = Window-Record $handles.foreign
    $candidates = @($helper, $foreign, $target)
    $selected = Find-TestInstallerWindow $clicked 'Aino' @() $candidates
    if ($null -eq $selected -or $selected.Handle -ne $target.Handle) {
        throw 'Confirmation must search beyond the first helper and unrelated product window'
    }
    $buttonElement = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$handles.button)
    Write-Output "fixture Update: enabled=$($buttonElement.Current.IsEnabled) offscreen=$($buttonElement.Current.IsOffscreen)"
    Write-Output "fixture direct button: name=$($buttonElement.Current.Name) type=$($buttonElement.Current.ControlType.ProgrammaticName)"
    $controls = @($selected.Element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
    Write-Output "fixture selected descendants: $($controls.Count)"
    foreach ($control in $controls) {
        Write-Output "fixture descendant: name=$($control.Current.Name) type=$($control.Current.ControlType.ProgrammaticName) enabled=$($control.Current.IsEnabled) offscreen=$($control.Current.IsOffscreen)"
    }
    $hit = Find-InvokableButton $selected.Element @('^Update$')
    if ($null -eq $hit -or $hit.Name -cne 'Update') { throw 'The selected product must expose its actual enabled Update button' }
    if (-not $selected.NewVisibleWindow -or $selected.ProcessStartedForAttempt) {
        throw 'A newly visible window in an older installer process must remain identifiable'
    }
    $previous = @($target)
    if ($null -ne (Find-TestInstallerWindow $clicked 'Aino' $previous $candidates)) {
        throw 'A previously visible installer must not be approved by the new update attempt'
    }
    if ($null -ne (Find-TestInstallerWindow $clicked 'MissingProduct' @() $candidates)) {
        throw 'A foreign product window must never be approved'
    }
    $snapshot = Get-InstallerWindowSnapshot 'Aino' $candidates
    if ($snapshot.installerState -cne 'confirmation-available' -or $snapshot.visibleWindowCount -ne 3 -or $snapshot.matchingWindowCount -ne 1) {
        throw 'Visible helper/foreign windows and the actionable product must be reported separately'
    }
    if (@($snapshot.hresults).Count -ne 1 -or $snapshot.hresults[0] -cne '0x80073D02') {
        throw 'A product-bound installer HRESULT must be retained without arbitrary window text'
    }
    [void][AinoInstallerControlFixture]::EnableWindow([IntPtr][long]$handles.button, $false)
    if ($null -ne (Find-InvokableButton $selected.Element @('^Update$'))) { throw 'Disabled Update must remain unavailable' }
    if ((Get-InstallerWindowSnapshot 'Aino' $candidates).installerState -cne 'no-confirmation-control') {
        throw 'A visible product with disabled confirmation must not be reported as absent'
    }
    Write-Output 'PASS: all native installer windows are searched, product-bound and checked for enabled confirmation'
} finally {
    [void]$stopSignal.Set()
    if ($fixtureProcess -and -not $fixtureProcess.WaitForExit(5000)) {
        $fixtureProcess.Kill()
        if (-not $fixtureProcess.WaitForExit(5000)) { throw 'Owned UI fixture did not stop after termination' }
    }
    $readySignal.Dispose(); $stopSignal.Dispose()
    if ($fixtureProcess) { $fixtureProcess.Dispose() }
    Remove-Item -LiteralPath $work -Recurse -Force
}
