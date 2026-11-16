# Real UIA windows exercise multi-window selection without installing packages.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { Write-Output 'SKIP: real installer UIA contracts require Windows'; exit 0 }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')
$helper = New-Object System.Windows.Forms.Form
$target = New-Object System.Windows.Forms.Form
$foreign = New-Object System.Windows.Forms.Form
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Update'
$button.AccessibleName = 'Update'
$target.Controls.Add($button)
$helper.Text = 'Installer helper'
$target.Text = 'Install Aino 0x80073d02'
$foreign.Text = 'Install AnotherProduct'
$clicked = Get-Date
$birth = $clicked.AddSeconds(-5)
function Window-Record($Form) {
    [pscustomobject]@{ Element=[System.Windows.Automation.AutomationElement]::FromHandle($Form.Handle);
        ProcessId=$PID; Birth=$birth; Handle=$Form.Handle.ToInt32(); Title=$Form.Text }
}
try {
    $helper.Show()
    $target.Show()
    $foreign.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $candidates = @((Window-Record $helper), (Window-Record $foreign), (Window-Record $target))
    $selected = Find-TestInstallerWindow $clicked 'Aino' @() $candidates
    if ($null -eq $selected -or $selected.Handle -ne $target.Handle.ToInt32()) {
        throw 'Confirmation must search beyond the first helper and unrelated product window'
    }
    $hit = Find-InvokableButton $selected.Element @('^Update$')
    if ($null -eq $hit -or $hit.Name -cne 'Update') { throw 'The selected product must expose its actual enabled Update button' }
    if (-not $selected.NewVisibleWindow -or $selected.ProcessStartedForAttempt) {
        throw 'A newly visible window in an older installer process must remain identifiable'
    }
    $previous = @((Window-Record $target))
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
    $button.Enabled = $false
    [System.Windows.Forms.Application]::DoEvents()
    if ($null -ne (Find-InvokableButton $selected.Element @('^Update$'))) { throw 'Disabled Update must remain unavailable' }
    if ((Get-InstallerWindowSnapshot 'Aino' $candidates).installerState -cne 'no-confirmation-control') {
        throw 'A visible product with disabled confirmation must not be reported as absent'
    }
    Write-Output 'PASS: all native installer windows are searched, product-bound and checked for enabled confirmation'
} finally {
    foreach ($form in @($helper, $target, $foreign)) { $form.Close(); $form.Dispose() }
}
