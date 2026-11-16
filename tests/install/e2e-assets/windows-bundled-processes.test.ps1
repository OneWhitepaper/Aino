# Pure driver contracts only; no package installation or live process changes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1')

# Like a CIM process record, this object has no Count property of its own.
class BundledProcessRecord {
    [int]$ProcessId
    [string]$ExecutablePath
    [string]$CommandLine
    BundledProcessRecord([int]$Id, [string]$Exe, [string]$Command) {
        $this.ProcessId = $Id
        $this.ExecutablePath = $Exe
        $this.CommandLine = $Command
    }
}
$exe = 'C:\fixture\Hermes.exe'
$script:processRecords = @()
function Get-CimInstance([string]$ClassName) {
    if ($ClassName -cne 'Win32_Process') { throw 'Unexpected CIM query' }
    $script:processRecords
}

foreach ($count in 0, 1, 2) {
    $script:processRecords = @(for ($i = 0; $i -lt $count; $i++) {
        [BundledProcessRecord]::new(100 + $i, $exe, 'Hermes.exe')
    })
    # The OLD identity check and NEW relaunch poll both assign the helper directly.
    $rows = Main-Processes $exe
    if ($rows -isnot [array] -or $rows.Count -ne $count) { throw "Lost process array for $count row(s)" }
    for ($i = 0; $i -lt $count; $i++) {
        if ($rows[$i].ProcessId -ne 100 + $i) { throw 'Process identity/order lost' }
    }
}
Write-Output 'PASS: zero, one and multiple process rows preserve Count and indexing'

$script:processRecords = @(
    [BundledProcessRecord]::new(100, $exe.ToUpperInvariant(), 'Hermes.exe'),
    [BundledProcessRecord]::new(101, $exe, 'Hermes.exe --type=renderer'),
    [BundledProcessRecord]::new(102, $exe, 'Hermes.exe --type utility'),
    [BundledProcessRecord]::new(103, 'C:\other\Hermes.exe', 'Hermes.exe'),
    [BundledProcessRecord]::new(104, '', 'Hermes.exe')
)
$rows = Main-Processes $exe
if ($rows.Count -ne 1 -or $rows[0].ProcessId -ne 100) { throw 'Installed main-process filtering changed' }
Write-Output 'PASS: exact executable identity excludes Electron children and unrelated processes'

$englishWarning = 'Type "allow pasting" below and press Enter to allow pasting.'
if ((Get-DevToolsPastePhrase $englishWarning) -cne 'allow pasting') { throw 'English DevTools paste confirmation changed' }
Write-Output 'PASS: English DevTools warning types its exact confirmation phrase'
$chineseWarning = '请在下方输入“允许粘贴”并按 Enter 键以允许粘贴。'
if ((Get-DevToolsPastePhrase $chineseWarning) -cne '允许粘贴') { throw 'Chinese DevTools paste confirmation must use its localized phrase' }
Write-Output 'PASS: Chinese DevTools warning types its exact confirmation phrase'
if ($null -ne (Get-DevToolsPastePhrase "Console`nConsole prompt")) { throw 'Paste confirmation requires an observed warning' }
Write-Output 'PASS: no paste confirmation is typed without an observed warning'

function Navigation-Button([string]$Name, [bool]$Enabled=$true, [bool]$Offscreen=$false) {
    return @{ Element=[object]::new(); Name=$Name; IsEnabled=$Enabled; IsOffscreen=$Offscreen }
}
function Assert-NavigationButton([object[]]$Buttons, $Expected, [string]$Message) {
    $actual = Get-UpdateNavigationButton $Buttons
    if ($null -eq $Expected) {
        if ($null -ne $actual) { throw $Message }
    } elseif ($null -eq $actual -or -not [object]::ReferenceEquals($actual.Element, $Expected.Element)) {
        throw $Message
    }
}

foreach ($names in @(
    @('Open settings', 'About', 'Check now', 'Checking…'),
    @('打开设置', '关于', '立即检查', '检查中…'),
    @('開啟設定', '關於', '立即檢查', '檢查中…')
)) {
    $settings = Navigation-Button $names[0]
    $about = Navigation-Button $names[1]
    $check = Navigation-Button $names[2]
    Assert-NavigationButton @($settings, $about, $check) $check 'Check must win over earlier Settings/About controls'
    Assert-NavigationButton @($settings, $about) $about 'About must win over an earlier Settings control'
    $about.IsEnabled = $false
    Assert-NavigationButton @($about, $settings) $settings 'Disabled About must not be invoked'
    $about.IsEnabled = $true

    foreach ($busyName in @($names[2], $names[3])) {
        $busy = Navigation-Button $busyName $false
        Assert-NavigationButton @($settings, $about, $busy) $null 'Busy checks must wait without fallback navigation'
        Assert-NavigationButton @($busy, $about, $check) $check 'An actionable check must win over another busy control'
        $busy.IsOffscreen = $true
        Assert-NavigationButton @($busy, $about) $about 'Offscreen checks must not block visible navigation'
    }
    $check.IsOffscreen = $true
    Assert-NavigationButton @($check, $about) $about 'Offscreen checks must not be invoked'
    $about.IsOffscreen = $true
    Assert-NavigationButton @($settings, $about) $about 'About below a short sidebar viewport must be selected for scrolling'
    $check.IsOffscreen = $false
    Assert-NavigationButton @($about, $check) $check 'An actionable check must win over an offscreen About'
    $check.IsEnabled = $false
    Assert-NavigationButton @($about, $check) $null 'An offscreen About must not bypass a busy check'
}
$later = Navigation-Button 'Choose a provider later'
$settings = Navigation-Button 'Open settings'
Assert-NavigationButton @($later, $settings) $settings 'Settings must win over the onboarding fallback'
Assert-NavigationButton @($later) $later 'The existing onboarding fallback must remain available'
Write-Output 'PASS: actionable checks precede navigation; busy checks wait; English and both Chinese locales agree'

# The native driver supplies UIA effects; the coordinator must refresh selection
# after scrolling, rather than invoke an element from the old viewport snapshot.
$about = Navigation-Button '关于' $true $true
$script:buttonsAfterScroll = @($about)
$script:navigationEffects = [System.Collections.Generic.List[string]]::new()
$scrolled = Invoke-UpdateNavigationButton $about -Refresh {
    Get-UpdateNavigationButton $script:buttonsAfterScroll
} -Scroll {
    param($element)
    if (-not [object]::ReferenceEquals($element, $about.Element)) { throw 'Scroll lost the matched UIA element' }
    $script:navigationEffects.Add('scroll')
    $about.IsOffscreen = $false
    return $true
} -Invoke {
    param($element)
    if (-not [object]::ReferenceEquals($element, $about.Element)) { throw 'Invoke lost the matched UIA element' }
    $script:navigationEffects.Add('invoke')
    return $true
}
if (-not $scrolled -or ($script:navigationEffects -join ',') -cne 'scroll,invoke') {
    throw 'An offscreen About must scroll, refresh, then invoke the same visible element'
}

foreach ($state in @('still-offscreen', 'disabled', 'replaced', 'busy-check', 'ready-check')) {
    $about = Navigation-Button 'About' $true $true
    $freshAbout = Navigation-Button 'About'
    $busy = Navigation-Button 'Checking…' $false
    $check = Navigation-Button 'Check now'
    $script:buttonsAfterScroll = @($about)
    $invoked = Invoke-UpdateNavigationButton $about -Refresh {
        Get-UpdateNavigationButton $script:buttonsAfterScroll
    } -Scroll {
        $script:buttonsAfterScroll = switch ($state) {
            'still-offscreen' { @($about) }
            'disabled' { $about.IsEnabled = $false; @($about) }
            'replaced' { @($freshAbout) }
            'busy-check' { @($about, $busy) }
            'ready-check' { @($about, $check) }
        }
        return $true
    } -Invoke { throw 'A stale or blocked About must never be invoked' }
    if ($invoked) { throw "Navigation did not stop after scrolling into $state" }
}
$check = Navigation-Button '立即检查'
$invoked = Invoke-UpdateNavigationButton $check -Refresh { $check } -Scroll {
    throw 'An enabled check must not scroll About'
} -Invoke { return $true }
if (-not $invoked) { throw 'An enabled check must remain actionable without scrolling' }
$about = Navigation-Button 'About' $true $true
$invoked = Invoke-UpdateNavigationButton $about -Refresh { $null } -Scroll {
    throw 'A check that became busy before scrolling must stop stale About navigation'
} -Invoke { throw 'A busy check must not invoke a stale About' }
if ($invoked) { throw 'A newly busy check unexpectedly navigated' }
$invoked = Invoke-UpdateNavigationButton $null -Refresh {
    throw 'A busy check must wait before refreshing or scrolling About'
} -Scroll { throw 'A busy check must not scroll About' } -Invoke { throw 'A busy check must not invoke About' }
if ($invoked) { throw 'A busy check unexpectedly navigated' }
Write-Output 'PASS: offscreen About scrolls before a fresh visible invoke; changed, disabled or busy selections wait'
