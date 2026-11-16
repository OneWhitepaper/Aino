# Native calls run in a killable child; only explicit disposable cleanup mutates state.
param(
    [Parameter(Mandatory=$true)][ValidateSet('package','process','installer','events','cleanup')][string]$Operation,
    [Parameter(Mandatory=$true)][string]$RequestPath,
    [string]$NewExecutable=''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$request = Get-Content -Raw -LiteralPath $RequestPath | ConvertFrom-Json
switch ($Operation) {
    'cleanup' {
        if ($env:GITHUB_ACTIONS -cne 'true' -or $env:OS -cne 'Windows_NT') { throw 'Disposable Windows Actions runner required' }
        . (Join-Path $PSScriptRoot 'desktop-smoke-windows.ps1')
        Remove-DesktopJourneyPackage $request.identity
        if (Get-AppxPackage -Name $request.identity) { throw 'Owned package registration remains after removal' }
        @{ removed=$true } | ConvertTo-Json -Compress
    }
    'package' {
        $packages = @(Get-AppxPackage -Name $request.identity)
        $result = @{ state='absent' }
        if ($packages.Count -gt 1) { $result.state='invalid' }
        if ($packages.Count -eq 1) {
            $pkg = $packages[0]
            $result.version = $pkg.Version.ToString()
            $result.state = 'invalid'
            if ($result.version -ceq $request.old.version) { $result.state='old' }
            if ($result.version -ceq $request.new.version -and $pkg.Publisher -ceq $request.new.publisher -and
                $pkg.Architecture.ToString() -ieq $request.arch) {
                $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
                $application = @($manifest.Package.Applications.Application | Where-Object { $_.Id -ceq $request.new.applicationId })
                $stamp = Get-Content -Raw -LiteralPath (Join-Path $pkg.InstallLocation 'app\resources\install-stamp.json') | ConvertFrom-Json
                if ($application.Count -eq 1 -and $stamp.commit -ceq $request.new.commit -and
                    $stamp.tag -ceq $request.new.tag -and $stamp.payload -ceq 'bundled') {
                    $exe = Join-Path $pkg.InstallLocation $application[0].Executable
                    if (Test-Path -LiteralPath $exe) {
                        $result.state='target'
                        $result.installed = @{ exe=$exe; stamp=$stamp; package=@{ InstallLocation=$pkg.InstallLocation;
                            Version=$result.version; Publisher=$pkg.Publisher; Architecture=$pkg.Architecture.ToString();
                            Name=$pkg.Name; PackageFullName=$pkg.PackageFullName; PackageFamilyName=$pkg.PackageFamilyName } }
                    }
                }
            }
        }
        $result | ConvertTo-Json -Depth 12 -Compress
    }
    'process' {
        $rows = @(Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 10)
        $oldRoot = $request.old.location.TrimEnd('\') + '\'
        $oldPayload = @($rows | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($oldRoot, [StringComparison]::OrdinalIgnoreCase) })
        $oldDetails = @($oldPayload | ForEach-Object {
            $category = switch -Regex ([IO.Path]::GetFileName($_.ExecutablePath)) {
                '^python(?:[0-9.]+|w)?[.]exe$' { 'python'; break }
                '^node[.]exe$' { 'node'; break }
                default { 'other' }
            }
            @{ processId=$_.ProcessId; parentProcessId=$_.ParentProcessId; executablePath=$_.ExecutablePath;
               birth=$_.CreationDate.ToUniversalTime().ToString('o'); category=$category }
        })
        # Only the manifest/stamp-verified package probe can supply NEW's path.
        $main = @($rows | Where-Object { $NewExecutable -and $_.ExecutablePath -and $_.ExecutablePath -ieq $NewExecutable -and $_.CommandLine -notmatch '(?:^|\s)--type(?:=|\s)' })
        @{ oldMainCount=@($rows | Where-Object { $_.ProcessId -eq $request.oldPid }).Count;
            oldPayloadCount=$oldPayload.Count; oldPayloadProcesses=$oldDetails;
            oldPythonCount=@($oldDetails | Where-Object { $_.category -ceq 'python' }).Count;
            oldNodeCount=@($oldDetails | Where-Object { $_.category -ceq 'node' }).Count;
            oldOtherCount=@($oldDetails | Where-Object { $_.category -ceq 'other' }).Count;
            newMain=@($main | ForEach-Object { @{ ProcessId=$_.ProcessId; ExecutablePath=$_.ExecutablePath; CreationDate=$_.CreationDate.ToUniversalTime().ToString('o') } });
            installerCount=@($rows | Where-Object { $_.Name -in @('AppInstaller.exe', 'AppInstallerFullTrustAppServiceClient.exe') -and
                $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $env:ProgramFiles 'WindowsApps\Microsoft.DesktopAppInstaller_'), [StringComparison]::OrdinalIgnoreCase) }).Count
        } | ConvertTo-Json -Depth 5 -Compress
    }
    'installer' {
        . (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')
        Initialize-InstallerAutomation
        Get-InstallerWindowSnapshot $request.displayName | ConvertTo-Json -Depth 10 -Compress
    }
    'events' {
        $events = @()
        try {
            $events = @(Get-WinEvent -FilterHashtable @{ LogName='Microsoft-Windows-AppXDeploymentServer/Operational';
                StartTime=([DateTime]$request.startedAt) } -MaxEvents 80 -ErrorAction Stop)
        } catch {
            # The native cmdlet reports an empty selection as an error too;
            # permission/channel/provider errors must remain failed probes.
            if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound,*') { throw }
        }
        $matched = @($events | Where-Object { $_.ToXml().Contains($request.identity) })
        $codes = @($matched | ForEach-Object { [regex]::Matches($_.ToXml(), '0x[89A-Fa-f][0-9a-fA-F]{7}') | ForEach-Object { $_.Value.ToUpperInvariant().Replace('0X','0x') } } | Sort-Object -Unique | Select-Object -First 20)
        @{ queryStatus='ok'; matchedCount=$matched.Count; errorCount=@($matched | Where-Object { $_.Level -le 2 }).Count;
            eventIds=@($matched | ForEach-Object { $_.Id } | Sort-Object -Unique); hresults=$codes } | ConvertTo-Json -Depth 4 -Compress
    }
}
