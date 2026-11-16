# Shared native UIA observation and identity checks for the installed update journey.
function Initialize-InstallerAutomation {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    if (-not ('AinoInstallerAutomation' -as [type])) {
        # UIA's default-provider loader walks ReflectedType on the call stack.
        # PowerShell dynamic frames have none; a concrete non-inlined CLR frame
        # supplies the assembly reference on the very first provider load.
        Add-Type -ReferencedAssemblies @(
            [System.Windows.Automation.AutomationElement].Assembly.Location,
            [System.Windows.Automation.ControlType].Assembly.Location) -TypeDefinition @'
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Windows.Automation;
public static class AinoInstallerAutomation {
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void Initialize() {
        AssemblyName name = typeof(AutomationElement).Assembly.GetName();
        name.Name = "UIAutomationClientsideProviders";
        ClientSettings.RegisterClientSideProviderAssembly(name);
    }
}
'@
    }
    [AinoInstallerAutomation]::Initialize()
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

function Get-VerifiedInstallerWindows {
    $installerPackages = @(Get-AppxPackage -Name 'Microsoft.DesktopAppInstaller')
    if ($installerPackages.Count -ne 1) { throw 'Cannot identify one installed Windows App Installer package' }
    $installerRoot = $installerPackages[0].InstallLocation.TrimEnd('\') + '\'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = @($root.FindAll([System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition))
    foreach ($candidate in @(Get-Process -Name 'AppInstaller' -ErrorAction SilentlyContinue)) {
        $candidatePath = $candidate.Path
        if (-not $candidatePath -or -not $candidatePath.StartsWith($installerRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$candidate.Id)
        foreach ($window in $windows) {
            if ($window.Current.NativeWindowHandle -eq 0 -or $window.Current.IsOffscreen) { continue }
            # UWP's visible frame belongs to a system host. Bind it through the
            # actual installer-owned subtree, never the frame title or host name.
            if ($null -eq $window.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $condition)) { continue }
            [pscustomobject]@{ Element=$window; ProcessId=$candidate.Id; Birth=$candidate.StartTime;
                Handle=$window.Current.NativeWindowHandle; Title=$window.Current.Name }
        }
    }
}

function Find-TestInstallerWindow([datetime]$ClickedAt, [string]$DisplayName, [object[]]$PreviouslyVisible,
    [object[]]$Candidates = @(Get-VerifiedInstallerWindows)) {
    $boundWindows = @()
    $productPattern = '(?i)(?<![\p{L}\p{N}])' + [regex]::Escape($DisplayName) + '(?![\p{L}\p{N}])'
    foreach ($candidate in $Candidates) {
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
    if ($boundWindows.Count -gt 1) { throw 'More than one new App Installer window matches this product; refusing the action' }
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
    foreach ($current in @(Get-VerifiedInstallerWindows)) {
        if ($current.ProcessId -eq $Window.ProcessId -and $current.Birth -eq $Window.Birth -and
            $current.Handle -eq $Window.Handle) { return $false }
    }
    return $true
}

# Raw titles and controls remain local; callers publish only typed counters/state.
function Get-InstallerWindowSnapshot([string]$DisplayName, [object[]]$Candidates = @(Get-VerifiedInstallerWindows)) {
    $productPattern = '(?i)(?<![\p{L}\p{N}])' + [regex]::Escape($DisplayName) + '(?![\p{L}\p{N}])'
    $windows = @(foreach ($candidate in $Candidates) {
        $controls = @($candidate.Element.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition) | Select-Object -First 128 | ForEach-Object {
                @{ name=$_.Current.Name; enabled=$_.Current.IsEnabled; offscreen=$_.Current.IsOffscreen;
                   controlType=$_.Current.ControlType.ProgrammaticName }
            })
        $matches = ((@($candidate.Title) + @($controls | ForEach-Object { $_.name })) -join "`n") -match $productPattern
        $confirm = $null
        if ($matches) { $confirm = Find-InvokableButton $candidate.Element @('^Update$', '^Install$', '^(Reinstall|Update) .*', '^更新$', '^安装$', '^重新安装$') }
        @{ pid=$candidate.ProcessId; birth=$candidate.Birth.ToString('o'); handle=$candidate.Handle;
           title=$candidate.Title; productMatches=$matches; confirmAvailable=($null -ne $confirm); controls=$controls }
    })
    $matching = @($windows | Where-Object { $_.productMatches })
    $confirmCount = @($matching | Where-Object { $_.confirmAvailable }).Count
    $codes = @($matching | ForEach-Object {
        $names = @($_.title) + @($_.controls | ForEach-Object { $_.name })
        [regex]::Matches(($names -join "`n"), '(?i)\b0x[89a-f][0-9a-f]{7}\b') | ForEach-Object {
            $_.Value.ToUpperInvariant().Replace('0X', '0x')
        }
    } | Sort-Object -Unique | Select-Object -First 20)
    $state = if ($windows.Count -eq 0) { 'not-observed' }
        elseif ($matching.Count -eq 0) { 'window-not-bound' }
        elseif ($matching.Count -gt 1) { 'ambiguous-window' }
        elseif ($confirmCount -gt 0) { 'confirmation-available' } else { 'no-confirmation-control' }
    return @{ installerState=$state; visibleWindowCount=$windows.Count; matchingWindowCount=$matching.Count;
        confirmButtonCount=$confirmCount; hresults=$codes; windows=$windows }
}
