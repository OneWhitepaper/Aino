# Ultra delegation acceptance harness

This is a portable source copy of the local acceptance harness used on September
25–28, 2026, with its frozen large and small fixtures. It exercises the existing
Aino desktop WebSocket RPC, managed model binding, tools, asynchronous delegation,
and parent continuation. It adds no product tool, scheduler, or runtime framework.
The latest scenario is:

```text
large --review-skill=none --matched-comparison --evidence-contract
```

Omit `--independent-completions` for that scenario: children run concurrently, and
a single tasks call delivers one batch completion. The parent uses Ultra/Max, and
the matched task explicitly requests `gpt-5.6-sol` with High children. The evidence
contract asks children to return findings, triggers, file/line evidence, and
limitations through the existing `output_schema`. The parent retains ownership of
the three short review sections and Top 3. JSON validity is not evidence that a
finding is true or that a model completed naturally.

## Contents and setup

- `harness.py`: Python runner; offline by default.
- `platform-runner.ts`: explicit live runner using the existing desktop account
  token store, auth, and platform client.
- `codex_driver.py`: optional native Codex CLI comparator.
- `daily_contract.py`: independent standard-library behavior checks for the small
  repair fixture.
- `fixtures/large`: six selected Python source snapshots, with no outside
  dependencies supplied. `fixtures/small`: three intentionally faulty sample
  modules and their specification. Do not update them to current production code.
- `fixtures.sha256.json`: hashes of the exact original ten fixture files.

Use an existing checkout with its normal Python dependencies installed in a
virtual environment, plus the existing Node dependencies from the root and desktop
workspace. The Python runner imports `yaml`, `httpx`, `uvicorn`, `starlette`,
`websockets`, and production Aino modules; a bare Python installation is not enough.
The live runner also needs the installed desktop Electron and root esbuild. No
extra package, plugin, private skill, or account is needed for the Aino offline
scenario below. Native Codex is optional and is not needed to build or run it.

Run these commands from the repository root. Adjust `ACCEPTANCE_PYTHON` to an
already prepared environment if this is a worktree without its own `.venv`.

```sh
ACCEPTANCE_PYTHON="$PWD/.venv/bin/python"
"$ACCEPTANCE_PYTHON" evals/ultra_delegation/harness.py --help
"$ACCEPTANCE_PYTHON" -m py_compile evals/ultra_delegation/harness.py \
  evals/ultra_delegation/codex_driver.py evals/ultra_delegation/daily_contract.py
node_modules/.bin/esbuild evals/ultra_delegation/platform-runner.ts \
  --bundle --platform=node --format=cjs --external:electron \
  --outfile=evals/ultra_delegation/.build/platform-runner.cjs
apps/desktop/node_modules/.bin/electron \
  evals/ultra_delegation/.build/platform-runner.cjs --help
```

The Electron runner is a bundled Node application with Electron as an external
module: launch it with Electron, not `node`. Its `--help` exits before account or
network access. The build artifact is ignored and is not part of the source handoff.

Python resolves the checkout and fixtures relative to `harness.py`; override with
`--repo` or `--fixtures`. The Electron runner defaults `--repo` to the current
working directory and forwards it to Python; its production TypeScript imports
are repository-relative at build time. Rebuild when testing a different checkout.
Both runners default output to `aino-ultra-delegation-runs` under the operating
system temporary directory. `--output-root` accepts another location, and `--name`
sets a new child directory name. Relative option paths resolve from the invocation
directory, before the harness changes into its isolated workspace.

Keep output outside a checkout or other directory with ancestor `AGENTS.md`
instructions to preserve the original fixture isolation. `.runs/` is ignored for
local convenience, but putting runs there can change the model's instruction
context. Reports, event streams, model bodies, databases, copied skills, and
profiles are local evidence and must not be committed or redistributed unreviewed.

## Offline RPC check

This command starts a loopback scripted model and exercises the real Aino RPC and
delegation lifecycle. It does not call a paid model or contact the account service.

```sh
ACCEPTANCE_OUTPUT="$(mktemp -d)"
"$ACCEPTANCE_PYTHON" evals/ultra_delegation/harness.py large \
  --review-skill=none --matched-comparison --evidence-contract \
  --budget=90 --output-root="$ACCEPTANCE_OUTPUT" --name=offline-large
```

Dry mode clears inherited environment variables except process-launch essentials,
sets a new isolated home/profile, and rejects non-loopback Python DNS/connection
attempts. Its managed lease points only to the local scripted endpoint. The
optional native Codex child also receives the cleaned environment, an isolated
`CODEX_HOME`, and a loopback model provider with host config, rules, skills,
plugins, update checks, and analytics disabled. The Python socket guard is not an
OS network sandbox for native child processes.

A passing offline run exits zero, reports `stop_reason: normal_final`, has three
completed children and a parent final after batch delivery, and reports no changed
fixtures. Usage and wire-observer self-checks run locally. All model text and token
usage in this mode are synthetic: this proves transport and local contracts only,
not review quality, provider behavior, billing, or full live acceptance.

Other preserved scenarios are `simple`, `no_subagent`, `length`, `replay`, `daily`,
and `daily_replay`. Original review scenarios require the external private skill;
`daily` does not. The `daily` dry path writes a transport smoke test but deliberately
does not repair the bugs, so its external behavior checks are expected to fail.
The `length` formatting probe requires `--length-source=/path/to/report.json` from
a previously saved no-subagent review. Those reports are not bundled.

## Explicit full live scenario

Live runs may incur charges. Nothing in setup, compilation, help, or offline
validation launches them automatically. The Electron runner requires `--live` for
all account access, including catalog and settlement-only operations.

Use an existing signed-in Aino desktop account on the same OS user account. By
default, the runner reads `Aino/platform-tokens.json` and
`Aino/desktop-installation.json` beneath Electron's application-data directory.
Use `--token-path` and `--installation-path` for a different installation. The
encrypted token store depends on that machine's OS key storage; copying its JSON
file is not an authentication setup. Token refresh may update the existing token
store. Credentials are passed to Python through stdin and redacted from receipts;
never paste a lease or token into a command or a tracked file.

The following runs the entire latest matched large diagnostic, including real
children and parent completion. It is an explicit command for a future authorized
run, not a claim that this handoff passed live acceptance.

```sh
ACCEPTANCE_OUTPUT="$(mktemp -d)"
apps/desktop/node_modules/.bin/electron \
  evals/ultra_delegation/.build/platform-runner.cjs large --live \
  --repo="$PWD" --python="$ACCEPTANCE_PYTHON" \
  --output-root="$ACCEPTANCE_OUTPUT" --name=live-large \
  --review-skill=none --matched-comparison --evidence-contract \
  --budget=1200 --spend-target=5
```

The managed origin defaults to `https://api.agentera.com.cn`; `--origin=URL` can
select the origin associated with the existing account store. The runner selects
an available `gpt-5.6-sol` and obtains a new model lease. `--python` accepts a path
or executable name; without it the runner tries the checkout's `.venv/bin/python`,
then `venv/bin/python`, then `python3`. Value options on the Electron runner use
`--name=value`; the Python runner also accepts `--name value`.

Existing limits are preserved:

| Scenario | Python default seconds | Live runner default seconds | Request threshold | Rough cumulative input | Observed USD target |
| --- | ---: | ---: | ---: | ---: | ---: |
| simple | 300 | 300 | 64 | 2,000,000 | 5 |
| large | 900 | 1200 | 64 | 2,000,000 | 5 |
| no_subagent | 600 | 600 | 64 | 2,000,000 | 5 |
| length | 300 | 300 | 64 | 2,000,000 | 1 |
| replay | 1200 | 1200 | 24 | 2,000,000 | 2 |
| daily | 600 | 600 | 48 | 500,000 | 1.5 |
| daily_replay | 600 | 600 | 24 | 500,000 | 1 |

All use a 60,000 observed output-token threshold. Native Codex defaults to 1200
seconds. The live wrapper accepts 30–1200 seconds and an observed spend target
above zero and at most USD 5. Request/input/output thresholds stop after
observation, and settlement polling has lag: none is an exact monetary hard cap.
The latest matched live command pins 1200 seconds explicitly, as the historical
scenario did. Model/provider availability and pricing may change.

After a run, inspect `report.json`, local events, and `settlement.json`. A natural
final alone does not establish acceptance: check child exit reasons, truncation,
schema validity, parent completion/delivery, unchanged review fixtures, findings,
and settled billing. The harness preserves raw evidence locally. Refresh live
receipts only when explicitly intended:

```sh
apps/desktop/node_modules/.bin/electron \
  evals/ultra_delegation/.build/platform-runner.cjs --settlement-only --live \
  --repo="$PWD" --output-root="$ACCEPTANCE_OUTPUT"
```

## External skill and saved-run boundaries

The original `read-only-source-review` skill is private and is not included.
`--review-skill=original` remains the default for compatibility, but requires
`--review-skill-path=/absolute/path/to/read-only-source-review` for original review
runs. Its complete directory is copied into the isolated runtime profile, and
its hashes are recorded. The native comparison embeds `SKILL.md` plus
`references/evidence-rating.md` from it. Removing the skill changes the task, so
`large --review-skill=none` is a diagnostic and cannot pass the original
skill-bearing acceptance.

The parent-only replay needs the **original local saved run**, including its
`report.json`, `profile/state.db`, and original `workspace/`. No saved run database,
raw report, event log, profile, or private skill is distributed here. For example:

```sh
"$ACCEPTANCE_PYTHON" evals/ultra_delegation/harness.py replay \
  --replay-source=/absolute/path/to/original/saved-run \
  --output-root="$ACCEPTANCE_OUTPUT" --budget=90
```

That form restores the saved prompt/config and prefix before the first complete
batch notification, then delivers the exact stored child results. It does not
rerun children. A pre-tool hook fails the replay before a new child spawn;
`--replay-dry-redelegate` exercises that negative case offline. If the source used
the private skill, also supply its external path. Legacy replay and `daily_replay`
instead accept `--legacy-replay-source=/absolute/path/to/original/saved-run`.

Saved messages and prompts contain original absolute paths, provider identity,
and encrypted reasoning state. Replay uses the original workspace location;
moving a saved run or rewriting its paths does not reproduce the original run.
No exact portability or byte-identical full-provider-prompt claim is made. The
normal issuer guard still controls whether saved encrypted reasoning is reusable.
Replay receives fresh parent-only limits and cannot establish that the original
whole run fit its budget. Review-only replay should leave its source fixture
unchanged; the legacy daily replay operates on the original saved repair workspace.

`--dry-child-results=/absolute/path/to/original/saved-run` can be added to the
matched offline batch evidence-contract scenario. It requires complete saved
schema-valid results and matching fixture hashes, then feeds those exact child
summaries through real batch delivery. The parent remains scripted. This is also
a local-only saved-database diagnostic, not distributable acceptance evidence.

## Optional native Codex comparison

An independently installed, compatible `codex` CLI is optional; `--codex-bin`
selects it. Add `--driver=codex` to a large offline run with `--review-skill=none`
and optionally `--matched-comparison`; omit the Aino-only `--evidence-contract`
and `--independent-completions` flags. `--codex-dry-case` selects `tools`,
`output-cap`, `delegation`, or the historical `delegation-ephemeral` negative probe.
The CLI must support the switches/settings used by `codex_driver.py`; compatibility
with arbitrary installed Codex versions is not promised.

A live native comparison additionally requires `--codex-native-comparison` and
`--live`. Native tool schemas, functions/code mode, prompts, skill loading,
estimator scopes, and delegation lifecycle differ from Aino. Native V2 counts the
root in its four slots and may ignore `agents.max_depth=1`. This comparator is not
a strict single-variable A/B and does not establish quality parity.

No paid or native Codex run was performed while packaging this source handoff.
