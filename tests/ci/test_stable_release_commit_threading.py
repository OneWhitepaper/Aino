"""Stable runs on the default branch, so every lane must be told which commit to test."""
import re
from io import StringIO
from pathlib import Path

from ruamel.yaml import YAML

from tests.ci import _gha_expr as gha

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
LOCAL_CALL = re.compile(r"^\./\.github/workflows/(?P<name>[^/@]+)$")

# Reusable workflows that already named their commit input before this contract.
EXISTING_INPUT = {"pm-bundle.yml": "ref", "desktop-bundle-smoke.yml": "sha"}

# These jobs only re-smoke an exact artifact through workflow_dispatch, never a stable call.
MANUAL_ONLY_JOBS = {("desktop-bundle-smoke.yml", "native-candidate")}


def load(name: str) -> dict:
    return YAML(typ="base").load((WORKFLOWS / name).read_text(encoding="utf-8"))


def local_calls(doc: dict):
    for job_name, job in (doc.get("jobs") or {}).items():
        match = LOCAL_CALL.match(job.get("uses", ""))
        if match:
            yield job_name, job, match["name"]


def reachable(root: str = "stable-release.yml") -> dict[str, dict]:
    seen: dict[str, dict] = {}
    pending = [root]
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen[name] = load(name)
        pending.extend(called for _, _, called in local_calls(seen[name]))
    return seen


def commit_input(name: str) -> str:
    return EXISTING_INPUT.get(name, "commit")


def manual_only(name: str, job_name: str, doc: dict, job: dict) -> bool:
    if (name, job_name) not in MANUAL_ONLY_JOBS:
        return False
    # Reusable workflows inherit their caller's event, including workflow_dispatch.
    # The artifact selector must therefore be absent from the reusable contract.
    call_inputs = doc["on"]["workflow_call"]["inputs"]
    assert "artifact-id" not in call_inputs
    for event in ("workflow_dispatch", "push", "pull_request", "workflow_call"):
        context = {"github": {"event_name": event}, "inputs": {}}
        assert not gha.condition(job.get("if"), context), f"{name}:{job_name} reachable by stable caller"
    context = {"github": {"event_name": "workflow_dispatch"}, "inputs": {"artifact-id": "123"}}
    assert gha.condition(job.get("if"), context), f"{name}:{job_name} cannot re-smoke an existing artifact"
    return True


def test_every_reusable_lane_accepts_a_commit():
    for name, doc in reachable().items():
        if name in {"stable-release.yml", "desktop-bundled-release.yml"}:
            continue  # The controller, and the workflow that admits the claim itself.
        inputs = (doc["on"]["workflow_call"] or {}).get("inputs") or {}
        assert commit_input(name) in inputs, f"{name} cannot be told which commit to test"


def test_every_call_forwards_the_commit():
    for name, doc in reachable().items():
        for job_name, job, called in local_calls(doc):
            if called == "desktop-bundled-release.yml":
                continue  # Admits the claim itself and checks out the admitted SHA.
            key = commit_input(called)
            assert key in (job.get("with") or {}), f"{name}:{job_name} does not pass {key} to {called}"
            if name not in {"stable-release.yml", "desktop-bundled-release.yml"}:
                # A nested call must pass its own commit down. An empty or hard-coded value
                # would silently test the controller tip.
                value = job["with"][key]
                assert "inputs.commit" in value, f"{name}:{job_name} passes {value!r} to {called}"


def test_every_checkout_follows_the_commit_input():
    for name, doc in reachable().items():
        if name in {"stable-release.yml", "desktop-bundled-release.yml"}:
            continue
        key = commit_input(name)
        for job_name, job in (doc.get("jobs") or {}).items():
            if manual_only(name, job_name, doc, job):
                continue
            for index, step in enumerate(job.get("steps") or []):
                if not step.get("uses", "").startswith("actions/checkout"):
                    continue
                ref = (step.get("with") or {}).get("ref", "")
                assert f"inputs.{key}" in ref, f"{name}:{job_name}[{index}] checks out {ref or 'the default sha'}"


def test_stable_release_calls_pass_the_admitted_commit():
    jobs = load("stable-release.yml")["jobs"]
    for job_name, job, called in local_calls({"jobs": jobs}):
        if called == "desktop-bundled-release.yml":
            continue
        value = job["with"][commit_input(called)]
        assert value == "${{ needs.admit.outputs.commit }}", f"{job_name}: {value}"
        needs = job.get("needs", [])
        assert "admit" in ([needs] if isinstance(needs, str) else needs), f"{job_name} reads admit without needing it"


# Groups that name the run keep a stable run away from pushes to the same branch.
RUN_SCOPED = ("github.run_id", ("inputs.commit", "inputs.release"))
# docker.yml keys its group on the release phase, which a push never uses.
PHASE_SCOPED = {"docker.yml": "inputs.release-phase"}


def test_no_lane_shares_a_concurrency_group_with_pushes_to_the_default_branch():
    for name, doc in reachable().items():
        if name in {"stable-release.yml", "desktop-bundled-release.yml"}:
            continue
        blocks = [("workflow", doc.get("concurrency"))]
        blocks += [(job_name, job.get("concurrency")) for job_name, job in (doc.get("jobs") or {}).items()]
        for where, block in blocks:
            group = block.get("group", "") if isinstance(block, dict) else block or ""
            if not group:
                continue
            if name in PHASE_SCOPED:
                assert PHASE_SCOPED[name] in group, f"{name}:{where} group {group!r}"
                continue
            needed, scopes = RUN_SCOPED
            assert needed in group and any(scope in group for scope in scopes), \
                f"{name}:{where} group {group!r} would share main's group with a push"


# Uses of the triggering ref or SHA that are not a commit under test, with the reason each is safe.
CONTROLLER_REFERENCES = (
    ("github.event_name == 'push'", "a stable run is a workflow_dispatch, so push-only steps skip"),
    ("-${{ github.sha }}", "artifact display name, unique per run"),
    ("description:", "input documentation"),
    ("HEAD_REF:", "label on the lint summary"),
    ("key: visual-baselines-${{ github.ref_name }}", "restores main's baselines and never writes them for a stable run"),
    ("inputs.ref == github.sha", "saves candidates only for the triggering commit, so a stable claim never writes"),
    ("inputs.channel-build != '' && inputs.controller-sha", "smoke tests the staged artifact with the dispatched ref's scripts"),
)
FALLBACK = re.compile(r"inputs\.(commit|ref|sha) \|\|")
REFERENCE = re.compile(r"GITHUB_SHA|github\.sha|github\.ref_name|github\.ref\b|GITHUB_REF")


def test_no_lane_uses_the_controller_commit_as_the_commit_under_test():
    for name, doc in reachable().items():
        if name in {"stable-release.yml", "desktop-bundled-release.yml"}:
            continue
        blocks = [("workflow", {key: value for key, value in doc.items() if key != "jobs"})]
        blocks.extend((job_name, job) for job_name, job in doc["jobs"].items()
                      if not manual_only(name, job_name, doc, job))
        for scope, block in blocks:
            output = StringIO()
            yaml = YAML()
            yaml.default_flow_style = False
            yaml.width = 1_000_000
            yaml.dump(block, output)
            for line in output.getvalue().splitlines():
                text = line.strip()
                if text.startswith(("#", "group:")) or not REFERENCE.search(text):
                    continue
                if FALLBACK.search(text) or "inputs.commit" in text:
                    continue
                assert any(allowed in text for allowed, _reason in CONTROLLER_REFERENCES), \
                    f"{name}:{scope} uses the triggering ref or SHA: {text}"
