# Read only the already-running NEW renderer. No app launch, account login or path override.
param([Parameter(Mandatory=$true)][string]$SpecPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:OS -cne 'Windows_NT') { throw 'Disposable native Windows runner required' }
. (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
$spec = Get-Content -LiteralPath $SpecPath -Raw | ConvertFrom-Json
function Assert-ObservedProcess {
    $actual = @(Main-Processes $spec.exe | Where-Object { $_.ProcessId -eq $spec.pid })
    if ($actual.Count -ne 1 -or ([DateTimeOffset]$actual[0].CreationDate).ToUnixTimeMilliseconds() -ne $spec.startedAt) {
        throw 'Automatic NEW process identity changed during observation'
    }
}
function Native-Windows {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$spec.pid)
    return [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $condition)
}
Assert-ObservedProcess
$deadline = (Get-Date).AddSeconds(45)
$main = $null
do {
    $process = Get-Process -Id $spec.pid
    if ($process.MainWindowHandle -ne 0) {
        $main = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
        break
    }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if (-not $main -or $main.Current.ProcessId -ne $spec.pid) { throw 'Automatic NEW has no owned native window' }
if (@(Native-Windows | Where-Object { $_.Current.Name -match '^DevTools' }).Count) { throw 'Refusing an already-open DevTools window' }
$devtools = $null
# Keep the previous clipboard object opaque: never inspect, serialize or log its content.
$clipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
try {
    $main.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^+i')
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $windows = @(Native-Windows | Where-Object { $_.Current.Name -match '^DevTools' -and -not $_.Current.IsOffscreen })
        if ($windows.Count -gt 1) { throw 'Automatic NEW exposed ambiguous DevTools windows' }
        if ($windows.Count -eq 1) { $devtools = $windows[0]; break }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    if (-not $devtools) { throw 'Automatic NEW native DevTools did not open; observation is unmet' }
    $devtools.SetFocus()
    # Select the actual Console tab rather than assuming a keyboard shortcut's
    # meaning inside a detached DevTools window or relying on its last panel.
    $tabs = @($devtools.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem -and
            $_.Current.Name -match '^(Console|控制台)$'
        })
    if ($tabs.Count -ne 1) { throw 'Cannot identify the owned DevTools Console tab' }
    $selection = $null
    if (-not $tabs[0].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
        throw 'The owned DevTools Console tab is not selectable'
    }
    $selection.Select()
    $deadline = (Get-Date).AddSeconds(30)
    $prompt = $null
    do {
        $prompts = @($devtools.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
                -not $_.Current.IsOffscreen -and $_.Current.Name -match '^(Console prompt|控制台提示符?)$'
            })
        if ($prompts.Count -eq 1) { $prompt=$prompts[0]; break }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    if (-not $prompt) { throw 'The owned DevTools Console prompt cannot be identified' }
    $prompt.SetFocus()
    [System.Windows.Forms.Clipboard]::SetText([string]$spec.expression)
    [System.Windows.Forms.SendKeys]::SendWait('^a^v{ENTER}')
    $allowedPaste = $false
    $deadline = (Get-Date).AddSeconds(90)
    $observed = $null
    do {
        # From this point the clipboard belongs to this test. Only accept our nonce.
        $text = [System.Windows.Forms.Clipboard]::GetText()
        if ($text.StartsWith('{"nonce":')) {
            $candidate = $text | ConvertFrom-Json
            if ($candidate.nonce -cne $spec.nonce) { throw 'Automatic NEW observation nonce mismatch' }
            $observed = $candidate
            break
        }
        if (-not $allowedPaste) {
            $names = @($devtools.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }) -join "`n"
            $phrase = Get-DevToolsPastePhrase $names
            if ($phrase) {
                [System.Windows.Forms.SendKeys]::SendWait("^a${phrase}{ENTER}")
                [System.Windows.Forms.SendKeys]::SendWait('^a^v{ENTER}')
                $allowedPaste = $true
            }
        }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    if (-not $observed -or $observed.status -cne 'passed') { throw 'Automatic NEW did not prove its retained workspace through existing IPC' }
    Assert-ObservedProcess
    $observed | Add-Member -NotePropertyName pid -NotePropertyValue ([int]$spec.pid)
    $observed | Add-Member -NotePropertyName startedAt -NotePropertyValue ([long]$spec.startedAt)
    $observed | Add-Member -NotePropertyName observedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $observed | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $OutputPath
} finally {
    try {
        if ($devtools) {
            $windowPattern = $null
            if (-not $devtools.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$windowPattern)) {
                throw 'Cannot close the owned DevTools observation window'
            }
            $windowPattern.Close()
        }
    } finally {
        if ($clipboard) { [System.Windows.Forms.Clipboard]::SetDataObject($clipboard, $true) }
        else { [System.Windows.Forms.Clipboard]::Clear() }
    }
}
Assert-ObservedProcess
