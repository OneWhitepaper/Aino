"""Private acceptance preserves the real builder's provenance and native integrations."""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
import zipfile

import pytest

from scripts.ci import windows_installer_candidate as candidate


@pytest.mark.parametrize("key", ["PSModulePath", "PSMODULEPATH", "psmodulepath"])
@pytest.mark.parametrize("logged", [False, True])
def test_candidate_children_rebuild_module_search_path_without_mutating_parent(tmp_path, key, logged):
    import json

    env = {**os.environ, key: "incompatible-powershell-seven-modules", "AINO_CANDIDATE_SENTINEL": "kept"}
    script = ("import json,os; print(json.dumps({'modulePath': [k for k in os.environ if "
              "k.upper() == 'PSMODULEPATH'], 'sentinel': os.environ['AINO_CANDIDATE_SENTINEL']}))")
    log = tmp_path / "child.log" if logged else None
    output = candidate.run([sys.executable, "-c", script], env, log=log)
    if log:
        output = log.read_text(encoding="utf-8")
    assert json.loads(output) == {"modulePath": [], "sentinel": "kept"}
    assert env[key] == "incompatible-powershell-seven-modules"


@pytest.mark.platforms("windows")
def test_candidate_certificate_has_private_key_and_removes_disposable_trust(tmp_path):
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"):
        pytest.skip("Test trust is only installed on disposable GitHub-hosted Windows")
    publisher = f"CN=Aino Installer Candidate {uuid.uuid4()}"
    env = {**os.environ, "CANDIDATE_PUBLISHER": publisher,
           "CANDIDATE_THUMBPRINT": str(tmp_path / "certificate-thumbprint.txt"),
           "CANDIDATE_CERTIFICATE": str(tmp_path / "candidate-public.cer")}
    try:
        thumbprint = candidate.create_certificate(env)
        assert len(thumbprint) == 40
        assert candidate.powershell(r"""
          $thumbprint = (Get-Content -Raw -LiteralPath $env:CANDIDATE_THUMBPRINT).Trim()
          $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
          if ($cert.Subject -cne $env:CANDIDATE_PUBLISHER -or -not $cert.HasPrivateKey) {
            throw 'Candidate signing identity or private key missing'
          }
          $trust = Get-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint"
          if ($trust.HasPrivateKey) { throw 'Machine trust must contain only the public certificate' }
          # CurrentUser logical stores inherit machine trust; inspect physical persistence.
          foreach ($store in @('HKCU:\Software\Microsoft\SystemCertificates\TrustedPeople',
                               'HKCU:\Software\Microsoft\SystemCertificates\Root',
                               'HKLM:\Software\Microsoft\SystemCertificates\Root')) {
            $physical = "$store\Certificates\$thumbprint"
            if (Test-Path -LiteralPath $physical) { throw "Candidate broadened certificate trust: $physical" }
          }
          $cert.HasPrivateKey
          """, env) == "True"
    finally:
        candidate.remove_certificate(env)
    assert candidate.powershell(r"""
      $thumbprint = (Get-Content -Raw -LiteralPath $env:CANDIDATE_THUMBPRINT).Trim()
      foreach ($store in @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\TrustedPeople')) {
        if (Test-Path -LiteralPath "$store\$thumbprint") {
          throw "Candidate certificate remains in $store"
        }
      }
      'removed'
      """, env) == "removed"


def test_candidate_admission_requires_private_hosted_pinned_workflow():
    env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
           "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Windows",
           "GITHUB_REPOSITORY": "owner/private-ci", "GITHUB_SHA": "a" * 40}
    event = {"repository": {"private": True, "full_name": "owner/private-ci"}}
    assert candidate.admit(env, event) == env["GITHUB_SHA"]
    assert candidate.admit({**env, "GITHUB_EVENT_NAME": "push",
                            "GITHUB_REF": "refs/heads/validation/windows-installer/probe"}, event)
    for key, value in (("RUNNER_ENVIRONMENT", "self-hosted"), ("GITHUB_SHA", "main"),
                       ("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_REPOSITORY", "owner/public")):
        with pytest.raises(ValueError):
            candidate.admit({**env, key: value}, event)
    with pytest.raises(ValueError):
        candidate.admit(env, {"repository": {"private": False, "full_name": "owner/private-ci"}})
    with pytest.raises(ValueError):
        candidate.admit({**env, "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main"}, event)


def test_job_local_claim_uses_real_source_and_builder_timestamp(tmp_path, monkeypatch):
    from scripts.bundles.desktop_prepare import BuildRequest

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    (tmp_path / "pyproject.toml").write_text('[project]\nname="candidate-fixture"\nversion="0.0.0"\n')
    git("add", "pyproject.toml")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "Fixture")
    commit = git("rev-parse", "HEAD")
    monkeypatch.setattr(candidate, "ROOT", tmp_path)
    epoch = 1794816000
    claim, object_id = candidate.local_claim("v0.1.6", commit, epoch, os.environ)
    monkeypatch.setenv("RELEASE_CLAIM_TAG", claim)
    monkeypatch.setenv("RELEASE_CLAIM_OBJECT", object_id)
    request = BuildRequest.create(tmp_path, tag="v0.1.6", commit=None, variant="bundled",
                                  release_commit=commit, work=tmp_path / ".build/job",
                                  cache=tmp_path / ".cache/inputs", bundle_env={})
    assert request.commit == commit
    assert request.release_epoch == epoch
    assert request.version == "0.1.6"
    assert git("tag", "--list", "v*") == ""
    assert git("remote") == ""


def test_sdk_package_admission_retains_win10_floor_and_native_integrations(tmp_path):
    publisher = "CN=Aino Installer Candidate fixture"
    xml = f'''<Package xmlns="urn:fixture">
      <Identity Publisher="{publisher}" ProcessorArchitecture="x64" />
      <Dependencies><TargetDeviceFamily MinVersion="10.0.19045.0" /></Dependencies>
      <Applications><Application><Extensions>
        <Extension Category="windows.protocol" />
        <Extension Category="windows.appExecutionAlias" />
        <Extension Category="windows.appExtension">
          <AppExtension Name="com.microsoft.windows.copilotkeyprovider" />
        </Extension>
      </Extensions></Application></Applications></Package>'''
    package = tmp_path / "fixture.msix"

    def write(text):
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("AppxManifest.xml", text)

    write(xml)
    assert candidate.verify_package_contract(package, publisher, "x64")["minimumWindows"] == "10.0.19045.0"
    write(xml.replace('Category="windows.appExecutionAlias"', 'Category="removed"'))
    with pytest.raises(ValueError, match="CLI aliases"):
        candidate.verify_package_contract(package, publisher, "x64")
    write(xml.replace("10.0.19045.0", "10.0.22621.0"))
    with pytest.raises(ValueError, match="minimum OS"):
        candidate.verify_package_contract(package, publisher, "x64")
