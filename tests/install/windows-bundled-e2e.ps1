# Native package replacement acceptance. Never run on a developer desktop.
param(
    [string]$ManifestUrl,
    [string]$CandidateManifest,
    [ValidateSet('x64','arm64')][string]$Arch = 'x64'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:OS -ne 'Windows_NT') { throw 'Disposable Windows Actions runner required' }
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Assets = Join-Path $PSScriptRoot 'e2e-assets'
if ([bool]$ManifestUrl -eq [bool]$CandidateManifest) { throw 'Supply exactly one of ManifestUrl or CandidateManifest' }
if ($CandidateManifest -and $env:AINO_PRIVATE_CANDIDATE -cne 'true') { throw 'Local candidates require the private disposable candidate runner' }
$Work = Join-Path $env:RUNNER_TEMP 'hermes-bundled-update'
if (Test-Path $Work) { throw "Refusing to reuse $Work" }
$Proof = Join-Path $Work 'proof'
New-Item -ItemType Directory -Path $Proof -Force | Out-Null
$env:HERMES_HOME = Join-Path $Work 'home'
New-Item -ItemType Directory -Path $env:HERMES_HOME | Out-Null
$env:HERMES_DESKTOP_USER_DATA_DIR = Join-Path $Work 'electron-user-data'
$env:HOME = Join-Path $Work 'os-home'
New-Item -ItemType Directory -Path $env:HOME | Out-Null
. (Join-Path $Assets 'desktop-smoke-windows.ps1')
. (Join-Path $Assets 'windows-native-environment.ps1')
. (Join-Path $Assets 'windows-bundled-recovery.ps1')
$Node = if ($env:HERMES_E2E_NODE) { $env:HERMES_E2E_NODE } else { (Get-Command node.exe).Source }
function Run-Node([string[]]$Argv) {
    & $Node @Argv
    if ($LASTEXITCODE -ne 0) { throw "Node failed: $($Argv[0])" }
}
$ManifestPath = Join-Path $Work 'bundle-inputs.json'
if ($CandidateManifest) {
    $candidatePath = (Resolve-Path -LiteralPath $CandidateManifest).ProviderPath
    $temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
    if (-not $candidatePath.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate manifest must be owned by RUNNER_TEMP' }
    Copy-Item -LiteralPath $candidatePath -Destination $ManifestPath
} else {
    Run-Node @((Join-Path $Assets 'bundle-inputs.mjs'), '--manifest-url', $ManifestUrl, '--platform', 'windows', '--arch', $Arch, '--out', $Work)
}
$m = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$validation = @((Join-Path $Assets 'windows-bundled-helpers.mjs'), 'validate-manifest', '--manifest', $ManifestPath, '--arch', $Arch)
if ($CandidateManifest) { $validation += @('--candidate-commit', $env:GITHUB_SHA) }
Run-Node $validation
$StateHelper = Join-Path $Assets 'windows-user-state.mjs'
$StateSnapshot = Join-Path $Proof 'user-state-before.json'
$fixturePython = if ($env:HERMES_PYTHON) { $env:HERMES_PYTHON } else { (Get-Command python.exe).Source }
function Verify-UserState([string]$Phase) {
    Run-Node @($StateHelper, 'verify', '--root', $env:HERMES_DESKTOP_USER_DATA_DIR,
        '--snapshot', $StateSnapshot, '--python', $fixturePython, '--report', (Join-Path $Proof "user-state-after-$Phase.json"))
}
if (Get-AppxPackage -Name $m.old.identity) { throw 'Package identity is already installed; refusing to modify it' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Assert-Bundle($Side) {
    $artifact = $Side.artifact.path
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant() -cne $Side.artifact.sha256) { throw 'Bundle hash mismatch' }
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact
    if ($signature.Status -ne 'Valid') { throw "Bundle signature invalid: $($signature.Status)" }
    $zip = [IO.Compression.ZipFile]::OpenRead($artifact)
    try {
        $entry = $zip.GetEntry('AppxMetadata/AppxBundleManifest.xml')
        if (-not $entry) { throw 'Not an MSIX bundle' }
        $reader = New-Object IO.StreamReader($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($xml.Bundle.Identity.Name -cne $Side.identity -or $xml.Bundle.Identity.Publisher -cne $Side.publisher -or $xml.Bundle.Identity.Version -cne $Side.version) { throw 'Bundle identity disagrees with pinned manifest' }
        if (-not @($xml.Bundle.Packages.Package | Where-Object { $_.Architecture -eq $Arch }).Count) { throw 'Requested architecture absent from bundle' }
    } finally { $zip.Dispose() }
}
Assert-Bundle $m.old
Assert-Bundle $m.new

function Installed($Side) {
    $packages = @(Get-AppxPackage -Name $Side.identity)
    if ($packages.Count -ne 1) { throw 'Expected exactly one installed package' }
    $pkg = $packages[0]
    if ($pkg.Version.ToString() -cne $Side.version -or $pkg.Publisher -cne $Side.publisher -or $pkg.Architecture.ToString() -ine $Arch) { throw 'Installed package identity/version/architecture mismatch' }
    $stampPath = Join-Path $pkg.InstallLocation 'app\resources\install-stamp.json'
    $stamp = Get-Content -Raw -LiteralPath $stampPath | ConvertFrom-Json
    if ($stamp.commit -cne $Side.commit -or $stamp.tag -cne $Side.tag -or $stamp.payload -cne 'bundled') { throw 'Installed payload provenance mismatch' }
    $xml = Get-AppxPackageManifest -Package $pkg.PackageFullName
    $application = @($xml.Package.Applications.Application | Where-Object { $_.Id -ceq $Side.applicationId })
    if ($application.Count -ne 1) { throw 'Installed applicationId missing' }
    $exe = Join-Path $pkg.InstallLocation $application[0].Executable
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed executable missing' }
    return @{ package=$pkg; exe=$exe; stamp=$stamp }
}
$Feed = Join-Path $Work 'feed'
New-Item -ItemType Directory -Path $Feed | Out-Null
Copy-Item -LiteralPath $m.old.artifact.path -Destination (Join-Path $Feed 'old.msixbundle')
Copy-Item -LiteralPath $m.new.artifact.path -Destination (Join-Path $Feed 'new.msixbundle')
$PortFile = Join-Path $Work 'feed-url'
$Helper = Join-Path $Assets 'windows-bundled-helpers.mjs'
$server = Start-Process -FilePath $Node -ArgumentList @('"'+$Helper+'"', 'serve', '--feed', '"'+$Feed+'"', '--port-file', '"'+$PortFile+'"') -PassThru -RedirectStandardOutput (Join-Path $Proof 'feed.log') -RedirectStandardError (Join-Path $Proof 'feed-error.log')
$installed = $false
$mock = $null
$oldDriver = $null
$acceptance = $null
$nativeEnvironment = @{}
$recovery = @{ preparation=@{ ok=$false; status='not-run' }; cancellation=@{ ok=$false; status='not-run' } }
$recoverySettings = $null
try {
    $mock = Start-DesktopJourneyMock $Node $Assets $Work $env:HERMES_HOME $Proof
    Run-Node @($StateHelper, 'seed', '--root', $env:HERMES_DESKTOP_USER_DATA_DIR, '--python', $fixturePython,
        '--origin', 'https://api.agentera.com.cn', '--mock-url', $env:HERMES_E2E_MOCK_URL,
        '--snapshot', $StateSnapshot, '--report', (Join-Path $Proof 'user-state-seed.json'))
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path $PortFile)) {
        if ($server.HasExited -or (Get-Date) -gt $deadline) { throw 'Feed failed to start' }
        Start-Sleep -Milliseconds 200
    }
    $baseUrl = (Get-Content -Raw $PortFile).Trim()
    function Descriptor($Side, [string]$File) {
        Run-Node @($Helper, 'descriptor', '--feed', $Feed, '--base-url', $baseUrl, '--identity', $Side.identity, '--publisher', $Side.publisher, '--version', $Side.version, '--bundle', $File, '--descriptor-filename', 'update.appinstaller')
    }
    Descriptor $m.old 'old.msixbundle'
    $descriptor = Join-Path $Feed 'update.appinstaller'
    Add-AppxPackage -AppInstallerFile $descriptor
    $installed = $true
    $old = Installed $m.old
    Verify-UserState install
    $startAppId = "$($old.package.PackageFamilyName)!$($m.old.applicationId)"
    $shortcutDeadline = (Get-Date).AddSeconds(30)
    do {
        $shortcut = @(Get-StartApps | Where-Object { $_.AppID -ceq $startAppId })
        if ($shortcut.Count -eq 1) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $shortcutDeadline)
    if ($shortcut.Count -ne 1) { throw 'Installed package did not register one Start menu entry' }
    $shortcut[0] | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Proof 'start-menu-entry.json')
    $recoverySettings = @{ Node=$Node; Assets=$Assets; Work=$Work; Proof=$Proof;
        Exe=$old.exe; Root=(Join-Path $old.package.InstallLocation 'app\resources\agent-payload');
        Home=$env:HERMES_HOME; UserData=$env:HERMES_DESKTOP_USER_DATA_DIR; Commit=$m.old.commit;
        Identity=$m.old.identity; MockUrl=$env:HERMES_E2E_MOCK_URL; Descriptor=$descriptor }
    # A missing descriptor must leave the same OLD window usable. This isolated
    # proof cannot hide the ordinary replacement journey's later diagnostics.
    $recovery.preparation = Invoke-NativePreparationRecovery $recoverySettings `
        { Descriptor $m.new 'new.msixbundle' } { Descriptor $m.old 'old.msixbundle' } `
        { Installed $m.old | Out-Null } { param($phase) Verify-UserState $phase }
    # Pin a real OS-registered update source before launching the application.
    $old.package | Select-Object Name, Version, Publisher, Architecture, InstallLocation | ConvertTo-Json | Set-Content (Join-Path $Proof 'old-package.json')
    $marker = Join-Path $env:HERMES_HOME 'bundle-state-marker'
    $witness = [Guid]::NewGuid().ToString()
    Set-Content -LiteralPath $marker -Value $witness
    $python = (Get-Command python.exe).Source
    $verifier = Join-Path $Assets 'verify-plugin-preservation.py'
    & $python $verifier seed --home $env:HERMES_HOME --external (Join-Path $Work 'external-plugin')
    if ($LASTEXITCODE -ne 0) { throw 'Plugin seed failed' }
    & $python $verifier snapshot --home $env:HERMES_HOME --out (Join-Path $Work 'plugins-before.json')
    if ($LASTEXITCODE -ne 0) { throw 'Plugin snapshot failed' }
    # Keep Playwright's actual OLD window alive across chat and the native UIA
    # trigger. The NEW descriptor is not published until OLD chat has passed.
    $oldChatReady = Join-Path $Proof 'old-chat-ready.json'
    $oldDriver = Start-OutsideRunnerJob 'native-old' $Work $Node @(
        (Join-Path $Assets 'drive-update.cjs'), $old.exe, $Proof, $m.old.commit, '--native-handoff'
    )
    $deadline = (Get-Date).AddMinutes(6)
    while (-not (Test-Path -LiteralPath $oldChatReady)) {
        if ((Test-Path -LiteralPath $oldDriver.ExitFile) -or -not (Get-Process -Id $oldDriver.Id -ErrorAction SilentlyContinue) -or (Get-Date) -ge $deadline) { throw 'Mandatory OLD desktop chat failed before the update trigger' }
        Start-Sleep -Milliseconds 200
    }
    $ready = Get-Content -LiteralPath $oldChatReady -Raw | ConvertFrom-Json
    $oldRows = Main-Processes $old.exe
    if ($oldRows.Count -ne 1 -or $oldRows[0].ProcessId -ne $ready.pid -or $ready.exe -cne $old.exe -or $ready.oldSha -cne $m.old.commit) {
        throw 'OLD chat did not run in the identified installed app process'
    }
    $oldChat = Get-Content -LiteralPath (Join-Path $Proof 'desktop-chat-old.json') -Raw | ConvertFrom-Json
    if ($oldChat.status -ne 'passed') { throw 'Mandatory OLD chat receipt failed' }
    $oldProcess = $oldRows[0]
    $oldProcess | Select-Object ProcessId, CreationDate, ExecutablePath | ConvertTo-Json | Set-Content (Join-Path $Proof 'old-process.json')
    $nativeEnvironment = Publish-NativeRelaunchEnvironment (Join-Path $Proof 'native-relaunch-environment.json') $Work $env:HERMES_DESKTOP_USER_DATA_DIR
    Descriptor $m.new 'new.msixbundle'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Assets 'windows-bundled-drive-update.ps1') -OldProcessId $oldProcess.ProcessId -ProofDir $Proof -ResultPath (Join-Path $Proof 'click.json')
    if ($LASTEXITCODE -ne 0) { throw 'Real in-app update trigger failed' }
    $click = Get-Content -Raw (Join-Path $Proof 'click.json') | ConvertFrom-Json
    if (-not $click.ok -or -not $click.exited) { throw 'In-app trigger receipt is not successful' }
    $closed = Join-Path $Proof 'old-process-closed.json'
    $closedDeadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $closed)) {
        if ((Test-Path -LiteralPath $oldDriver.ExitFile) -or (Get-Date) -ge $closedDeadline) { throw 'OLD Playwright ownership did not release after native process close' }
        Start-Sleep -Milliseconds 200
    }
    $deadline = (Get-Date).AddMinutes(15)
    $new = $null; $newRows = @()
    do {
        $pkg = Get-AppxPackage -Name $m.new.identity
        if ($pkg -and $pkg.Version.ToString() -ceq $m.new.version) {
            $new = Installed $m.new
            $newRows = Main-Processes $new.exe
            if ($newRows.Count -eq 1) { break }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (-not $new -or $newRows.Count -ne 1) { throw 'Native update did not automatically relaunch the new package' }
    $newProcess = $newRows[0]
    if ($newProcess.CreationDate -le $oldProcess.CreationDate) { throw 'New process was not created after OLD' }
    $stale = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($old.package.InstallLocation + '\', [StringComparison]::OrdinalIgnoreCase) })
    if ($stale.Count) { throw 'Old payload processes remain alive' }
    $healthy = $false
    $deadline = (Get-Date).AddMinutes(3)
    do {
        $payloadRoot = Join-Path $new.package.InstallLocation 'app\resources\agent-payload'
        $payloadProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($payloadRoot + '\', [StringComparison]::OrdinalIgnoreCase) })
        foreach ($proc in $payloadProcesses) {
            foreach ($connection in @(Get-NetTCPConnection -State Listen -OwningProcess $proc.ProcessId -ErrorAction SilentlyContinue)) {
                try {
                    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($connection.LocalPort)/api/health" -TimeoutSec 2
                    if ($response.StatusCode -eq 200) { $healthy=$true; $response.Content | Set-Content (Join-Path $Proof 'backend-health.json'); break }
                } catch { }
            }
            if ($healthy) { break }
        }
        if (-not $healthy) { Start-Sleep -Seconds 2 }
    } while (-not $healthy -and (Get-Date) -lt $deadline)
    if (-not $healthy) { throw 'New packaged backend never returned HTTP 200 health' }
    & $python $verifier verify --home $env:HERMES_HOME --snapshot (Join-Path $Work 'plugins-before.json') --report (Join-Path $Proof 'plugin-preservation.json')
    if ($LASTEXITCODE -ne 0) { throw 'Plugin preservation failed' }
    if ((Get-Content -Raw $marker).Trim() -cne $witness) { throw 'User-state witness changed' }
    # Record automatic relaunch before ANY driver-owned NEW launch.
    @{ oldPid=$oldProcess.ProcessId; oldBirth=$oldProcess.CreationDate; newPid=$newProcess.ProcessId; newBirth=$newProcess.CreationDate; newPath=$newProcess.ExecutablePath; automaticRelaunch=$true } |
        ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Proof 'relaunch-proof.json')
    Close-VerifiedDesktop $new.exe $newProcess.ProcessId
    Set-Content -LiteralPath (Join-Path $Proof 'native-update-complete') -Value 'verified'
    if ((Wait-OutsideRunnerJob $oldDriver 1) -ne 0) { throw 'OLD account fixture did not release cleanly' }
    Restore-NativeRelaunchEnvironment $nativeEnvironment
    $nativeEnvironment = @{}
    @{ phase='new'; launch='post-update-launch'; automaticRelaunchProof='relaunch-proof.json' } |
        ConvertTo-Json | Set-Content (Join-Path $Proof 'desktop-chat-new-launch.json')
    $newCode = Invoke-OutsideRunnerJob 'native-new' $Work $Node @(
        (Join-Path $Assets 'desktop-smoke.ts'), '--exe', $new.exe, '--root', $payloadRoot, '--origin', 'bundled',
        '--home', $env:HERMES_HOME, '--user-data', $env:HERMES_DESKTOP_USER_DATA_DIR, '--out', $Proof,
        '--phase', 'new', '--expect-commit', $m.new.commit, '--mock-url', $env:HERMES_E2E_MOCK_URL, '--platform-account') 15
    if ($newCode -ne 0) { throw 'Post-update native account/history/chat smoke failed' }
    Verify-UserState update
    $acceptance = @{ ok=$true; oldVersion=$m.old.version; newVersion=$m.new.version; oldPid=$oldProcess.ProcessId; oldBirth=$oldProcess.CreationDate; newPid=$newProcess.ProcessId; newBirth=$newProcess.CreationDate; newPath=$newProcess.ExecutablePath; stamp=$new.stamp; automaticRelaunch=$true; candidateOnly=[bool]$CandidateManifest; userStatePreserved=$true }
    $acceptance | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Proof 'native-update-success.json')
    Remove-DesktopJourneyPackage $m.old.identity
    $installed = $false
    Verify-UserState uninstall
    # Cancellation is last: its bounded OS waiter cannot race the successful
    # replacement's relaunch. No OS cancellation UI means this test is unmet.
    $recovery.cancellation = Invoke-NativeCancelRecovery $recoverySettings `
        { Descriptor $m.old 'old.msixbundle' } { Descriptor $m.new 'new.msixbundle' } `
        { Installed $m.old | Out-Null } { param($phase) Verify-UserState $phase }
} finally {
    Restore-NativeRelaunchEnvironment $nativeEnvironment
    if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -ErrorAction SilentlyContinue }
    if ($oldDriver) { Stop-OutsideRunnerJob $oldDriver }
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    # Disposable runner teardown only, scoped to the package installed by this leg.
    if ($installed) { Remove-DesktopJourneyPackage $m.old.identity }
    $recovery | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Proof 'recovery-coverage.json')
}

if ($acceptance) {
    if (Get-AppxPackage -Name $m.old.identity) { throw 'Uninstall did not remove the candidate package registration' }
    Verify-UserState uninstall
    $acceptance.uninstallPreservedUserState = $true
    $acceptance.recovery = $recovery
    $acceptance.publishedZipMigration = @{ tested=$false; release='v0.1.5'; reason='Released ZIP execution and manual first MSIX installation are not covered by this candidate journey' }
    $acceptance.ok = $recovery.preparation.ok -and $recovery.cancellation.ok
    $acceptance.status = if ($acceptance.ok) { 'accepted' } else { 'failed' }
    $recovery | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $Proof 'recovery-coverage.json')
    $acceptance | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Proof 'acceptance.json')
    if (-not $acceptance.ok) { throw 'Native success receipts were retained, but required recovery acceptance remains unmet' }
}
