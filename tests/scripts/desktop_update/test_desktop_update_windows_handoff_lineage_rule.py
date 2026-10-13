"""Who may adopt a pre-written claim (real processes): an OLD packaged Desktop's
``cmd.exe`` wrapper v1 overwrite is accepted by lineage only (R4), and with
``-HandoffRun`` only the Desktop bridge for that run is adopted (protocol 2).
"""
from __future__ import annotations

import json
from pathlib import (
    Path,
)
import subprocess

import pytest

from tests.scripts.desktop_update.lineage_rule_cases import (
    ENV_CASES, RULE_CASES,
)
from tests.scripts.desktop_update.windows_handoff_support import (
    MARKER, MARKER_PS1, POWERSHELL,
)


_RULE_HARNESS = r"""
param([string]$MarkerPs1, [string]$Marker, [string]$Cases)
$MarkerPath = $Marker
$NoMarkerCleanup = $true
function Write-HandoffLog([string]$Message) { [Console]::Error.WriteLine($Message) }
. $MarkerPs1
$data = [System.IO.File]::ReadAllText($Cases) | ConvertFrom-Json
foreach ($c in $data.rule) {
    $facts = @{}
    foreach ($p in $c.facts.PSObject.Properties) { $facts[$p.Name] = [bool]$p.Value }
    [Console]::Out.WriteLine("$($c.id)=$([int][bool](Test-MarkerLauncherRule $facts))")
}
foreach ($c in $data.env) {
    $env:HERMES_UPDATE_STARTED_AT = $c.env
    [Console]::Out.WriteLine("env_$($c.id)=$([int][bool](Test-MarkerEnvStartedAt $c.line2))")
}
"""


_PASCAL = {'v1': 'V1', 'names_desktop': 'NamesDesktop', 'named_alive': 'NamedAlive',
           'named_is_our_parent': 'NamedIsOurParent', 'named_parent_is_desktop': 'NamedParentIsDesktop',
           'env_started_matches': 'EnvStartedMatches'}


@pytest.mark.platforms('windows')
def test_launcher_lineage_rule_matches_the_shared_table(tmp_path: Path) -> None:
    cases = tmp_path / 'cases.json'
    cases.write_text(json.dumps({
        'rule': [{'id': c['id'], 'facts': {_PASCAL[k]: v for k, v in c['facts'].items()}} for c in RULE_CASES],
        'env': [{'id': c['id'], 'env': c['env'], 'line2': c['line2']} for c in ENV_CASES],
    }), encoding='utf-8')
    harness = tmp_path / 'rule.ps1'
    harness.write_text(_RULE_HARNESS, encoding='utf-8')
    proc = subprocess.run([POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(harness),
                           '-MarkerPs1', str(MARKER_PS1), '-Marker', str(tmp_path / MARKER), '-Cases', str(cases)],
                          capture_output=True, text=True, timeout=120, check=False)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    got = dict(line.split('=') for line in proc.stdout.split())
    want = {c['id']: '1' if c['expect'] else '0' for c in RULE_CASES}
    want.update({f"env_{c['id']}": '1' if c['expect'] else '0' for c in ENV_CASES})
    assert got == want, proc.stderr
