"""Replay artifact handoffs and smoke fetches against a fake R2."""
import copy
import hashlib
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import hermes_yaml
import pytest

from tests.ci.desktop_release_roles import (
    CANARY_TAG as TAG, NATIVE_TARGETS, SHA, native_builds, needs_of, phase_result, selection_gates,
    smoke_callers, stage_step, termux_builder, universal_assembler,
)
from tests.ci.test_commit_build_staging import ROOT, shell_step
from tests.ci.test_desktop_release_tag_admission import _workflow
from tests.scripts.test_release_r2 import r2_server as r2_server  # noqa: PLC0414 -- explicit pytest fixture export prevents F811 on its parameter
from tests.scripts.test_release_artifacts import staged_candidate as staged_candidate  # noqa: PLC0414 -- explicit pytest fixture export prevents F811 on its parameter
from tests.scripts.test_stable_release import https_origin as https_origin  # noqa: PLC0414 -- explicit pytest fixture export prevents F811 on its parameter


def smoke_workflow():
    return hermes_yaml.safe_load((ROOT / '.github/workflows/desktop-bundle-smoke.yml').read_text(encoding='utf-8-sig'))


def smoke_fetch_script():
    """The public artifact fetch every smoke runner shares."""
    scripts = {step['run'] for job in smoke_workflow()['jobs'].values()
               for step in job.get('steps', []) if step.get('id') == 'artifact'}
    (script,) = scripts
    return script


def transport_env(tmp_path, server, *, commit=False):
    for file in ('apps/desktop/product-identity.cjs', 'apps/desktop/brand.json', 'apps/desktop/package.json',
                 'scripts/msix-shared.mjs', 'scripts/release-content-types.json'):
        target = tmp_path / file
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / file, target)
    return dict(HERMES_PAYLOAD_TAG='' if commit else TAG, HERMES_BUILD_COMMIT=SHA if commit else '',
                RELEASE_TAG='' if commit else TAG, RELEASE_COMMIT=SHA, COMMIT_BUILD=str(commit).lower(),
                PUBLIC_BASE=f'http://127.0.0.1:{server.server_port}/hermes-releases',
                CLOUDFLARE_R2_PUBLIC_URL=f'http://127.0.0.1:{server.server_port}/hermes-releases',
                CLOUDFLARE_R2_ACCOUNT_ID='loopback', CLOUDFLARE_R2_ACCESS_KEY_ID='test-inert',
                CLOUDFLARE_R2_SECRET_ACCESS_KEY='test-inert', CLOUDFLARE_R2_BUCKET='hermes-releases',
                RELEASE_PHASE='', SMOKE_ROOT=str(tmp_path / 'smoke'), GITHUB_OUTPUT=str(tmp_path / 'output'))


@pytest.mark.parametrize('commit', [False, True])
@pytest.mark.parametrize('platform,fmt,arch', [
    ('darwin', 'dmg', 'arm64'), ('darwin', 'zip', 'arm64'),
    ('darwin', 'dmg', 'x64'), ('darwin', 'zip', 'x64'),
    ('win32', 'msix', 'arm64'), ('win32', 'msix', 'x64'),
    ('win32', 'msixbundle', 'arm64'), ('win32', 'msixbundle', 'x64')])
def test_public_smoke_fetches_the_receipt_bound_native_format(tmp_path, r2_server, commit, platform, fmt, arch):
    env = transport_env(tmp_path, r2_server, commit=commit)
    validate = smoke_workflow()['jobs']['validate']['steps'][0]['run']
    admitted = shell_step(tmp_path, r2_server, '', '', {**env, 'TARGET': f'{platform}/{arch}/{fmt}'}, script=validate)
    assert admitted.returncode == 0, admitted.stdout + admitted.stderr
    release = tmp_path / 'apps/desktop/release'
    release.mkdir(parents=True)
    suffix = f'mac-{arch}.{fmt}' if platform == 'darwin' else ('win.msixbundle' if fmt == 'msixbundle' else f'win-{arch}.msix')
    filename = f'AinoBundled-0.28.0-{suffix}'
    payload = b'transport fixture only: not a deployable package'
    (release / filename).write_bytes(payload)
    (release / ('Store-' + filename)).write_bytes(b'not eligible')
    universal = fmt == 'msixbundle'
    jobs = _workflow()['jobs']
    producer = universal_assembler(jobs) if universal else native_builds(jobs)[(f'{platform}-{arch}', 'commit')]
    if platform == 'darwin':
        # The producer stages all of its formats together; smoke selects one.
        for ext in ('dmg', 'zip', 'zip.blockmap'):
            (release / f'AinoBundled-0.28.0-mac-{arch}.{ext}').write_bytes(payload)
        (release / f'{arch}-canary-mac.yml').write_bytes(payload)
    staged = shell_step(tmp_path, r2_server, '', '', {**env, 'TARGET': f'{platform}-{arch}'},
                        script=stage_step(jobs[producer])['run'])
    assert staged.returncode == 0, staged.stdout + staged.stderr
    assert all('/canary/' not in key for key in r2_server.store)
    script = smoke_fetch_script()
    # Deliberately remove every storage credential before executing public fetch.
    public_env = {key: '' if key.startswith('CLOUDFLARE_') else value for key, value in env.items()}
    public_env.update(PLATFORM=platform, ARCH=arch, FORMAT=fmt)
    r2_server.requests.clear()
    result = shell_step(tmp_path, r2_server, '', '', public_env, script=script)
    assert result.returncode == 0, result.stdout + result.stderr
    selected = Path((tmp_path / 'output').read_text(encoding='utf-8-sig').strip().removeprefix('path='))
    assert selected.name == filename and selected.read_bytes() == payload
    witness = json.loads((tmp_path / 'smoke/out/download.json').read_text(encoding='utf-8-sig'))
    assert witness['commit'] == SHA and witness['artifact']['sha256'] == hashlib.sha256(payload).hexdigest()
    assert not any(file.name.startswith('Store-') for file in selected.parent.iterdir())
    assert all(method == 'GET' and 'Authorization' not in headers for method, _, headers in r2_server.requests)


@pytest.mark.parametrize('fault', ['missing', 'ambiguous', 'wrong-commit', 'corrupt'])
def test_download_faults_never_export_an_accepted_artifact(tmp_path, r2_server, fault):
    env = transport_env(tmp_path, r2_server, commit=True)
    filename = 'AinoBundled-0.28.0-win-x64.msix'
    payload = b'inert integrity fixture'
    row = {'path': filename, 'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    receipt = {'schema': 2, 'commit': 'b' * 40 if fault == 'wrong-commit' else SHA,
               'name': 'win32-x64', 'files': [row]}
    prefix = f'releases/commit/{SHA}/'
    r2_server.store[prefix + filename] = (b'corrupted' if fault == 'corrupt' else payload, '"e"')
    if fault == 'missing':
        receipt['files'] = [{**row, 'path': 'Store-' + filename}]
    elif fault == 'ambiguous':
        second = 'AinoBundled-0.29.0-win-x64.msix'
        receipt['files'].append({**row, 'path': second})
        r2_server.store[prefix + second] = (payload, '"e"')
    r2_server.store[prefix + 'handoff-win32-x64.json'] = (json.dumps(receipt).encode(), '"e"')
    script = smoke_fetch_script()
    result = shell_step(tmp_path, r2_server, '', '', {**env, 'PLATFORM': 'win32', 'ARCH': 'x64', 'FORMAT': 'msix'}, script=script)
    assert result.returncode != 0
    assert not (tmp_path / 'output').exists()
    assert not (tmp_path / 'smoke/out/download.json').exists()


def test_stable_phase_result_requires_smoke_but_preserves_other_phases(tmp_path, r2_server):
    jobs = _workflow()['jobs']
    gates, smokes = selection_gates(jobs), smoke_callers(jobs)
    group_jobs = {target: [gates[target], smokes[target]] for target in NATIVE_TARGETS}
    group_jobs['win32-bundle'] = [universal_assembler(jobs)]
    group_jobs['termux'] = [termux_builder(jobs)]
    verdict = phase_result(jobs)
    members = {member for group in group_jobs.values() for member in group}
    # Beyond admission and the build groups, the verdict needs the file publication
    # and the Store submission; both run off validate, and only the Store is advisory.
    publication = [name for name in needs_of(jobs[verdict]) if name not in members | {'validate'}
                   and not set(needs_of(jobs[name])) - {'validate'}]
    (store,) = [name for name in publication if jobs[name].get('continue-on-error') is True]
    (publish,) = [name for name in publication if name != store]

    def run_phase(phase, selected, failed=None, skip_tests=False, skip_signed=False):
        needs = {name: {'result': 'success'} for name in needs_of(jobs[verdict])}
        needs['validate']['outputs'] = {group: ('true' if group in selected else 'false')
                                        for group in group_jobs}
        for group, group_members in group_jobs.items():
            if group not in selected:
                for member in group_members:
                    needs[member]['result'] = 'skipped'
        if skip_tests:
            for smoke in smokes.values():
                needs[smoke]['result'] = 'skipped'
        if skip_signed:
            for target in ('win32-arm64', 'win32-x64'):
                needs[smokes[target]]['result'] = 'skipped'
        if failed:
            needs[failed]['result'] = 'cancelled'
        (step,) = [step for step in jobs[verdict]['steps'] if 'SKIP_TESTS' in (step.get('env') or {})]
        return shell_step(tmp_path, r2_server, '', '',
                          {'RELEASE_NEEDS': json.dumps(needs), 'RELEASE_PHASE': phase,
                           'SKIP_TESTS': 'true' if skip_tests else 'false',
                           'SKIP_SIGNED': 'true' if skip_signed else 'false'}, script=step['run'])

    every = set(group_jobs)
    assert run_phase('candidate', every).returncode == 0
    # A claim that skipped tests runs no smoke, and every build still counts.
    assert run_phase('candidate', every, skip_tests=True).returncode == 0
    assert run_phase('candidate', every, failed=gates['win32-x64'], skip_tests=True).returncode != 0
    # A Store-only Windows claim smokes no Windows package, but its builds and the Mac smoke still count.
    assert run_phase('candidate', every, skip_signed=True).returncode == 0
    assert run_phase('candidate', every, failed=gates['win32-x64'], skip_signed=True).returncode != 0
    assert run_phase('candidate', every, failed=smokes['darwin-arm64'], skip_signed=True).returncode != 0
    assert run_phase('publish', every).returncode == 0
    assert run_phase('publish', every - {'termux'}).returncode == 0
    for group in group_jobs:
        # A group that was not selected is not a failure of the phase.
        assert run_phase('candidate', every - {group}).returncode == 0, group
    for failed in (smokes['darwin-arm64'], gates['win32-x64'], termux_builder(jobs)):
        assert run_phase('candidate', every, failed=failed).returncode != 0, failed
    assert run_phase('candidate', every, failed=publish).returncode == 0
    # A partial selection still judges the groups it selected.
    assert run_phase('candidate', {'darwin-arm64'}).returncode == 0
    assert run_phase('candidate', {'darwin-arm64'}, failed=smokes['darwin-arm64']).returncode != 0
    # The Store is not a release gate: a failed submission leaves the publish phase green
    # (the job names the package for a manual upload), while stable-publish still gates it.
    assert run_phase('publish', set(), failed=store).returncode == 0
    assert run_phase('publish', set(), failed=publish).returncode != 0
    assert jobs[store].get('continue-on-error') is True


@pytest.mark.parametrize("staged_candidate", [TAG], indirect=True)
def test_canary_publisher_consumes_staged_bytes_and_writes_pointer_last(
        tmp_path, r2_server, staged_candidate, monkeypatch):
    """The accepted-candidate controller replaced the standalone Windows publisher."""
    from scripts.bundles import release_artifacts
    from scripts.releases import channel_releases

    manifest, _, base = staged_candidate
    manifest_key = f"releases/tag/{manifest['archive']}/release-candidates.json"
    accepted_bytes = r2_server.store[manifest_key][0]
    monkeypatch.setenv("CANDIDATE_MANIFEST_SHA256", hashlib.sha256(accepted_bytes).hexdigest())
    args = ["--tag", TAG, "--archive", TAG, "--commit", manifest["commit"], "--public-base", base]
    windows = next(row for row in manifest["packages"] if row["platform"] == "windows")
    key = windows["artifact"]["url"].removeprefix(base + "/")
    tested_bytes = r2_server.store[key][0]
    filename = key.rsplit("/", 1)[1]
    promoted = tmp_path / "promoted"
    # The same promoter used by publish_release consumes only the admitted candidate.
    release_artifacts.main(["publish", *args, "--root", str(tmp_path / "verified")])
    r2_server.requests.clear()
    channel_releases.promote_stable_feeds(manifest, promoted, base)
    assert (promoted / filename).read_bytes() == tested_bytes
    assert r2_server.store[f"releases/win32/canary/{filename}"][0] == tested_bytes
    writes = [path for method, path, _ in r2_server.requests if method == "PUT"]
    windows_writes = [path for path in writes if "/win32/" in path]
    assert windows_writes[-1].endswith("/canary.appinstaller")
    descriptor = ET.fromstring(r2_server.store["releases/win32/canary/canary.appinstaller"][0])
    assert descriptor.get("Version") == descriptor.find("{*}MainBundle").get("Version") == windows["version"]
    assert not any("/stable/" in path for path in writes)

    # A renamed or ambiguous envelope cannot replace the accepted manifest, even if its
    # native version/identity would otherwise look plausible. The pinned digest refuses it.
    for wrong in ["AinoBundled-0.29.0.0-win.msixbundle", "AinoBundled-0.28.1.65536-win.msixbundle",
                  "AinoBundled-0.28.1-canary.20260818101010-win.msixbundle", filename]:
        substituted = copy.deepcopy(manifest)
        row = next(item for item in substituted["files"] if item["path"] == filename)
        if wrong == filename:
            substituted["files"].append(dict(row))
        else:
            row["path"] = wrong
        r2_server.store[manifest_key] = (json.dumps(substituted).encode(), '"substituted"')
        r2_server.requests.clear()
        with pytest.raises(ValueError, match="digest mismatch"):
            release_artifacts.main(["promote", *args, "--root", str(tmp_path / "refused")])
        assert not any(method == "PUT" for method, _, _ in r2_server.requests)
    r2_server.store[manifest_key] = (accepted_bytes, '"accepted"')

    # Receipt integrity and native identity are independent checks: even a matching new
    # digest cannot hide a different identity/version from candidate publication.
    for field, wrong in [("Version", "0.28.1.0"), ("Name", "NousResearch.Other"), ("Publisher", "CN=Other")]:
        bad_bundle = tmp_path / "forged.msixbundle"
        with zipfile.ZipFile(promoted / filename) as archive:
            native = ET.fromstring(archive.read("AppxMetadata/AppxBundleManifest.xml"))
        native.find("Identity").set(field, wrong)
        with zipfile.ZipFile(bad_bundle, "w") as archive:
            archive.writestr("AppxMetadata/AppxBundleManifest.xml", ET.tostring(native))
        body = bad_bundle.read_bytes()
        substituted = copy.deepcopy(manifest)
        for item in substituted["files"]:
            if item["path"] == filename:
                item.update(sha256=hashlib.sha256(body).hexdigest(), size=len(body))
        for row in substituted["packages"]:
            if row["platform"] == "windows":
                row["artifact"]["sha256"] = hashlib.sha256(body).hexdigest()
        r2_server.store[key] = (body, '"forged"')
        r2_server.requests.clear()
        with pytest.raises(ValueError, match="Universal bundle identity"):
            release_artifacts.publish(substituted, tmp_path / f"refused-{field}", base)
        assert not any(method == "PUT" for method, _, _ in r2_server.requests)
    r2_server.store[key] = (tested_bytes, '"accepted"')
