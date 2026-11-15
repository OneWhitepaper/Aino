# Scoped GUI activation environment for disposable native update acceptance.
function Publish-NativeRelaunchEnvironment([string]$Document, [string]$Work, [string]$UserData) {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:OS -cne 'Windows_NT') { throw 'Disposable Windows Actions runner required' }
    $values = Get-Content -LiteralPath $Document -Raw | ConvertFrom-Json
    $allowed = @('HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM',
        'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')
    if ([IO.Path]::GetFullPath($values.HERMES_DESKTOP_USER_DATA_DIR) -ine [IO.Path]::GetFullPath($UserData)) { throw 'Native activation userData differs from OLD' }
    $root = [IO.Path]::GetFullPath($Work).TrimEnd('\') + '\'
    foreach ($entry in $values.PSObject.Properties) {
        if ($allowed -cnotcontains $entry.Name) { throw 'Unexpected activation environment key' }
        if ($entry.Name -in @('HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'NODE_EXTRA_CA_CERTS')) {
            if (-not [IO.Path]::GetFullPath([string]$entry.Value).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Activation path is outside disposable work' }
        }
        if ($entry.Name -in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
            $url = [Uri]$entry.Value
            if ($url.Scheme -cne 'http' -or $url.Host -cne '127.0.0.1' -or $url.UserInfo) { throw 'Activation proxy must be the isolated loopback fixture' }
        }
    }
    $prior = @{}
    try {
        foreach ($entry in $values.PSObject.Properties) {
            $prior[$entry.Name] = [Environment]::GetEnvironmentVariable($entry.Name, 'User')
            [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'User')
        }
        Send-NativeEnvironmentChange
    } catch {
        Restore-NativeRelaunchEnvironment $prior
        throw
    }
    return $prior
}

function Send-NativeEnvironmentChange {
    if (-not ('AinoInstallerEnvironmentChange' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AinoInstallerEnvironmentChange {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam,
        string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
    }
    $result = [UIntPtr]::Zero
    [AinoInstallerEnvironmentChange]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero,
        'Environment', 2, 5000, [ref]$result) | Out-Null
}

function Restore-NativeRelaunchEnvironment([hashtable]$Prior) {
    foreach ($entry in $Prior.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User')
    }
    if ($Prior.Count) { Send-NativeEnvironmentChange }
}
