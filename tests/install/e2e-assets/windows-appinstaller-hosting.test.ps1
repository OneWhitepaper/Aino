# Observe the real Microsoft App Installer shell surface without installing a package.
param([string]$OpenFixture='')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:OS -cne 'Windows_NT') {
    throw 'Disposable hosted Windows runner required'
}
if ($OpenFixture) {
    Start-Process -FilePath $OpenFixture
    exit 0
}
. (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1')
. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')
Initialize-InstallerAutomation
$work = Join-Path $env:RUNNER_TEMP ('aino-installer-hosting-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($work) | Out-Null
$descriptor = Join-Path $work 'AinoHostingFixture.appinstaller'
# A nonexistent local payload produces a native error surface; no installation,
# remote download, signing trust or acceptance click is performed.
$descriptorUri = ([Uri]$descriptor).AbsoluteUri
$missingUri = ([Uri](Join-Path $work 'missing.msix')).AbsoluteUri
@"
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2018" Uri="$descriptorUri" Version="1.0.0.0">
  <MainPackage Name="Aino.Hosting.Fixture" Publisher="CN=Aino Hosting Fixture" Version="1.0.0.0" ProcessorArchitecture="x64" Uri="$missingUri" />
</AppInstaller>
"@ | Set-Content -LiteralPath $descriptor -Encoding UTF8
$packages = @(Get-AppxPackage -Name Microsoft.DesktopAppInstaller)
if ($packages.Count -ne 1) { throw 'One real Microsoft App Installer package is required' }
$installerRoot = $packages[0].InstallLocation.TrimEnd('\') + '\'
$root = [System.Windows.Automation.AutomationElement]::RootElement
$before = @($root.FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.NativeWindowHandle })
$owned = @()
try {
    $code = Invoke-OutsideRunnerJob 'installer-hosting' $work (Get-Process -Id $PID).Path @(
        '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-OpenFixture', $descriptor) 1
    if ($code -ne 0) { throw 'The real App Installer shell launch failed' }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $direct = @()
    do {
        $processes = @(Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 10 | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installerRoot, [StringComparison]::OrdinalIgnoreCase)
        })
        $direct = @(Get-VerifiedInstallerWindows)
        foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.Condition]::TrueCondition)) {
            $handle = $window.Current.NativeWindowHandle
            if (-not $handle -or $before -contains $handle -or $window.Current.IsOffscreen) { continue }
            foreach ($process in $processes) {
                $condition = [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$process.ProcessId)
                $children = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition)
                if ($children.Count -eq 0) { continue }
                $owned += [pscustomobject]@{ Element=$window; Handle=$handle;
                    Direct=($window.Current.ProcessId -eq $process.ProcessId) }
                break
            }
        }
        if ($owned.Count) { break }
        Start-Sleep -Milliseconds 300
    } while ($clock.Elapsed.TotalSeconds -lt 30)
    $report = @{ verifiedInstallerProcessCount=$processes.Count; directWindowCount=$direct.Count;
        observedWindowCount=$owned.Count; hostedWindowCount=@($owned | Where-Object { -not $_.Direct }).Count }
    Write-Output ('[installer-hosting] ' + ($report | ConvertTo-Json -Compress))
    if (-not $owned.Count) { throw 'No real App Installer surface was observed after the controlled shell launch' }
    foreach ($window in $owned) {
        if (@($direct | Where-Object { $_.Handle -eq $window.Handle }).Count -ne 1) {
            throw 'The real App Installer surface is omitted by verified-window discovery'
        }
    }
    Write-Output 'PASS: verified installer discovery includes the real shell-activated surface'
} finally {
    foreach ($window in $owned) {
        $pattern = $null
        if (-not $window.Element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) {
            throw 'Owned fixture surface exposes no safe window-close pattern'
        }
        $pattern.Close()
    }
    Remove-Item -LiteralPath $work -Recurse -Force
}
