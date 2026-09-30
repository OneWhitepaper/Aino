# Ultra delegation acceptance harness

This is a portable source copy of the local acceptance harness used on September
25–28, 2026, with its frozen large and small fixtures. It exercises the existing
Aino desktop WebSocket RPC, managed model binding, tools, asynchronous delegation,
and parent continuation. It adds no product tool, scheduler, or runtime framework.
An optional matched diagnostic is:

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

## Current acceptance scope: UI summaries are separate from compression

The user's summary request concerns the board/session overview surface. It does
not request a new conversation-compaction algorithm, a shorter model-facing
handoff, or a length limit on normal answers. Preserve the upstream compression
policy and existing verified Aino transport/profile/billing integrations. A
finding about `context_compressor.py` in the frozen review fixture is a test of
the model's code-review accuracy, not authorization to change live compression
to satisfy a board-display request.

For the current user-approved large-task acceptance, always pass
`--large-report-length=unbounded`. Retain the separately authorized 3600-second
budget, $10 observed-spend threshold and configured High children when a new
live run is actually scheduled; this scope clarification itself starts no run.
Do not attach a per-group word/character limit to the parent or children. The
independent candidate review skill remains experimental, not a default product
change or a demonstrated accuracy fix.

The original 400-character case is an optional historical constrained-output
stress test. Its existing parser default remains for reproducing old commands,
so a bare `large` invocation is not the current acceptance recipe. Explicitly
choose `--large-report-length=original` when intentionally reproducing it.
`original_acceptance_eligible=false` identifies changed historical conditions;
it is not by itself a failure of the user's current unrestricted-output goal.
Natural delivery, material accuracy, elapsed time, cost and stability remain
separate checks. Existing historical results and fingerprints are unchanged.

Do not bulk-delete the number 400 or code named `summary`: board notifications,
summary eligibility thresholds, refusal-detection windows, provider reasoning
summaries and model-facing compaction have different producers and consumers.
Change the display layer only when addressing a display requirement, and trace
all consumers before changing a shared value.

## System delivery and answer quality are separate acceptance dimensions

Use the existing report and convergence fields. Do not add a combined score or
change runtime behavior to turn a model's review conclusion into a product rule.

- **Natural delivery:** `natural_delivery` requires `normal_final`, a nonempty
  `complete` final event and an eligible completion guard. A draft, interruption
  notice, provider error or waiting message is not successful delivery.
- **Task coverage:** inspect the final answer against the actual request. Empty,
  unrelated or materially incomplete answers still fail the task; useful coverage
  does not require every judgment to match another reviewer's judgment.
- **Collaboration integrity:** verify real child sessions and request routing,
  completion-unit delivery, notification identity/content and subsequent parent
  activity. Distinguish completed children from failed children with delivered
  error results. For failures, record whether the parent recovered, reported a
  limitation or failed the task; do not label all finished children successful.
- **Model output quality:** keep factual contradictions, missing premises and
  unsupported impact claims separate from reasonable design or ranking choices.
  A second model disagreeing is not sufficient evidence. Preserve specific
  counterexamples and uncertainty. `needs-correction` for one answer is not proof
  of an orchestration defect; trace missing/corrupted inputs, routing or lifecycle
  behavior before assigning a product cause. Clearly wrong factual claims remain
  wrong even when transport succeeds.
- **Stability and limits:** distinguish an observed successful path from repeated
  representative success. Different skills, prompts, budgets or provider states
  are not a controlled comparison or a general success-rate estimate. Record
  time, cost, cap triggers, outstanding billing and provider failures separately.

Read the actual serialized model/effort when available; configuration alone does
not prove every request used it. Missing observations remain unknown. Stable
system hashes prove only that recorded system messages stayed stable, not that
every cache-relevant prefix or provider-side behavior was identical.

Historical review-method experiments retain their original strict quality
rubrics and `overall_acceptance` values. The current system audit is an additional
dimension, not a rewrite of those scores or evidence. Likewise, historical
`original_acceptance_eligible` describes task-policy comparability, not a current
unrestricted-output pass/fail gate. Do not require eliminating all model errors
to close a demonstrated runtime bug; do not use that distinction to excuse
missing deliverables or verified information loss.

## The historical 400-character task requirement

The frozen `large` prompt includes `每组结论控制在400字以内。` This is an
author-written acceptance-task requirement, not an upstream Hermes rule or a
product-wide response limit. The harness sends it as ordinary task text only
when that scenario is explicitly run. It does not truncate responses at 400
characters; the separate aggregate output threshold is 60,000 tokens. Normal
conversations do not automatically load this prompt.

The requirement asks for a compact report. There is no established product need
for the number 400, nor sufficient evidence identifying why that exact number
was originally chosen. Historical runs show children inheriting it and spending
additional calls revising and counting text. That observation does not establish
it as the sole cause of failure. Keep the frozen prompt for reproducibility,
not as a default instruction for everyday conversations.

The existing `daily` scenario has no 400-character requirement and exercises a
separate small repair task. Its results must be reported separately: its task,
fixtures and limits differ, so it is neither a same-task length ablation nor a
replacement for the original large acceptance. Both `--review-skill=none` and
`--evidence-contract` still retain the large prompt's length requirement.

For an explicit same-task length diagnostic, pass
`--large-report-length=unbounded` to either runner. The default is `original`.
The diagnostic removes only `每组结论控制在400字以内。`, preserves the skill,
fixtures and configuration, and records the actual prompt. The length option
does not itself change budgets; explicit budget overrides are recorded separately.
Reports set `diagnostic.large_report_length=unbounded` and
`original_acceptance_eligible=false`; convergence summaries retain these markers.
This is a changed task, so natural delivery does not mean original-task acceptance.
Only fresh large tasks accept the override; source-owned replays retain their
source prompt and diagnostic provenance. No production conversation loads this
option automatically.
Combining this override with `--matched-comparison` (including its
`--evidence-contract` variant) is rejected before run creation or account access,
so another diagnostic prompt cannot reintroduce the removed length requirement.

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

For a fresh Aino task, `--file-read-max-chars=N` sets the existing
`file_read_max_chars` configuration option in the isolated profile. Both runners
accept it, and the report records the value under `config`. This changes source
admission before a tool result enters history: longer reads retain their existing
line-boundary pagination and `next_offset`. It does not raise the total input,
request, output, time, or spending thresholds, change the prompt or review skill,
or change installed user settings. It is a candidate configuration, not evidence
of lower total cost; additional paging and result quality must be measured.
Source-owned replays and the native Codex driver reject this Aino-only override.

Two other optional fresh-profile settings reuse existing delegation configuration:
`--child-reasoning-effort=high|max` sets `delegation.reasoning_effort` without the
matched-comparison prompt extension or removing the original review skill. A task's
explicit effort still takes precedence; the parent remains Ultra.
The configured child effort also survives provider fallback through the existing
child override mechanism; ordinary agents continue to resolve fallback defaults.
`--child-compression-threshold-tokens=N` sets the existing child compression trigger
(at least 16000 tokens), without changing the parent's threshold. This trigger is
not a hard input or cost cap. Existing compression prunes older source evidence,
so citation correctness, lost evidence and subsequent rereads must be audited.
Neither option changes product defaults or installed user profiles. Both reject
source-owned replay and native Codex; matched comparisons retain their fixed High
child setting. These are independently selectable diagnostic configurations, not
proven delivery fixes.

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

| Scenario | Python default seconds | Live runner default seconds | Request threshold | Cumulative input ceiling | Observed USD target |
| --- | ---: | ---: | ---: | ---: | ---: |
| simple | 300 | 300 | 64 | 2,000,000 | 5 |
| large | 900 | 1200 | 64 | 2,000,000 | 5 |
| no_subagent | 600 | 600 | 64 | 2,000,000 | 5 |
| length | 300 | 300 | 64 | 2,000,000 | 1 |
| replay | 1200 | 1200 | 24 | 2,000,000 | 2 |
| daily | 600 | 600 | 48 | 500,000 | 1.5 |
| daily_replay | 600 | 600 | 24 | 500,000 | 1 |

The cumulative input ceiling is an **acceptance-policy choice**, named by
`limits.cumulative_input_basis`. The current basis is
`input_excluding_cache_reads`: per unique `api_request_id`,
`uncached_input_tokens + cache_write_tokens`, plus validated pending reserves.
These provider usage buckets do not measure unique or logically new content.
The metric is neither fresh input nor cost: excluded reads are real input
the provider processed, and the buckets are priced differently.

Only complete, valid usage satisfying
`prompt = uncached + cache_write + cache_read` replaces a reserve. Missing,
invalid, incomplete or conflicting usage retains a validated rough reserve;
a valid conserved response with an unmatched id is counted and reported
separately. Unquantifiable or unkeyed work sets `accounting_complete=false`
and stops with `input_accounting_incomplete`, never silently counting as zero.
Shared pure accounting and observation helpers live in the existing
`convergence.py` and use normal imports. Runtime request/response appends and
accounting observations share the existing lock.

A reserve can settle to a smaller value, so the metric is **non-monotonic**:
read `ever_crossed` and `peak_value`, not the final value, to identify a crossing.
Historical replay follows recorded event append order and never preloads future
responses. It does not establish historical live cross-thread scheduling or
turn an undelivered run into a natural pass.

The superseded basis, `approx_represented_input`, summed each request's whole
re-presented context. That was a coherent, *stricter* policy bounding total
context volume, not a miscount; the present basis is **looser**, so runs scored
under the two bases are **not comparable**. Reports written before this change
carry no `input_accounting` block and keep the old semantics — `convergence.py`
reports each run on its own recorded basis. Native Codex runs record their own
limits and are a separate budget policy.

All use a 60,000 observed output-token threshold. Native Codex defaults to 1200
seconds. The live Aino wrapper accepts 30–3600 seconds (native Codex remains
limited to 1200 seconds because its driver does not renew leases) and an observed spend target
above zero and at most USD 10. Scenario defaults stay unchanged (large: 1200
seconds and USD 5). Request/input/output thresholds stop after
observation, and settlement polling has lag: none is an exact monetary hard cap.
The latest matched live command pins 1200 seconds explicitly, as the historical
scenario did. Model/provider availability and pricing may change.

An explicit extended diagnostic can use `--large-report-length=unbounded
--budget=3600 --spend-target=10`. This removes the task's length sentence and
extends the time and spend policies; it does not alter the original review skill,
fixtures, model effort, 64-request ceiling, 60,000-output threshold, or 2M
input-excluding-cache-reads threshold. Other limits can therefore stop the run
before 60 minutes. Reports identify the reference budgets and each extension in
`diagnostic.extended_budget`, and mark `original_acceptance_eligible=false`.
Natural completion under these conditions is a result for this changed task and
budget, not proof of success under the historical 20-minute/USD 5 contract.

The live Aino wrapper retains its lease grant and renews through the existing
`auth.modelLease` and `session.renew_managed_model` interfaces. Lease updates travel
only through the private stdin pipe; they do not rebuild the agent or inject model
messages. A failed renewal does not extend the old lease, and the backend retains
its real expiry guard. No everyday desktop timeout or prompt default is changed.

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

### Manual evidence-rating regression cases

Use the fixed large fixture and the run's actual parent answer for these known
counterexamples. Record the claim, message/session identity, supporting branch,
missing contract, and whether the parent preserved the limitation. A valid line
number or child schema is not a semantic quality pass. These are manual review
cases, not a keyword score or an exhaustive review of every finding.

| Case | Supported observation | Evidence still required for a confirmed defect | Reject as overstatement |
| --- | --- | --- | --- |
| Requested-child budget | The code reserves the requested count before constructing children. | A contract requiring only successful starts to consume that budget, plus the relevant failure path. | Calling this monetary overbilling or an incorrect quota charge solely because failed construction does not refund. |
| Profile change and composer pin | Missing composer provenance returns early; a changed profile can replace a composer pin, with one attempt per config edit. | The intended failure/retry contract and old-pin + failed-switch + later-resume behavior. | Claiming a missing provenance still clears the pin, or equating one attempt per edit with proven permanent loss of recovery. |
| Post-switch partial commit | A propagating exception after a successful switch can skip later local commit steps. | Helper failure behavior, persistence semantics and outer/later-turn recovery to establish duration and user impact. | Declaring permanent divergence or relative likelihood from the absence of a local rollback alone. |
| Terminal summary flags after a session reset | The reset leaves terminal failure flags set. | An extra abort requires reaching the failure gate with no final summary, a currently nonterminal failure, and ordinary-failure fallback enabled. | Expanding a conditional extra abort into any future failure freezing the whole session; ignoring successful fallback or feasibility skips. |
| Repeated one-turn switches | A later switch replaces the saved restore snapshot. | The permitted calling sequence, primary-runtime restoration precedence, and the restore consumer's contract. | Inferring loss of the original effective runtime from the overwritten model-name field alone. |

For the third case, missing evidence does not prove the risk impossible. Keep
the conditional control-flow finding and name the unverified recovery boundary.
Existing tests of the current implementation are separate evidence from the
historical frozen fixture; do not silently import missing dependencies into
that fixture. Detailed examples and test limits are recorded in the delivery
diagnosis, sections 17.6 and 17.9.

For an overstatement, trace the actual claim through child assistant message →
durable result/event → parent notification → parent verification output → final
finding and cross-group ranking. Record message/session identities and the pair
`(delegation_id, task_index)`; task indices can repeat across units. Distinguish a
child's initial overstatement, a parent's retained rating, a parent's correction,
and a stronger claim introduced during final ranking. Do not label all four as
the same propagation failure.

Test preservation against the entire saved text, not a few matching keywords.
Where this harness recorded canonical wire-item hashes, match the notification
and decisive tool-output items to captured chat requests. That proves client-side
submission of those items, not provider internals or model understanding. Inspect
actual returned line windows before saying a comment or branch was available;
read-file arguments and valid citation line numbers are insufficient. A complete
child summary does not prove that every preceding tool output was untruncated.

Keep these semantic cases as manual evidence-rating regressions. Do not turn them
into a keyword scorer, alter a fixture to make a finding true, or patch product
policy simply because a model called it a defect. Record an attribution of model
judgment when the relevant content survived and no executable transport defect
has been demonstrated; this is not a claim that every possible transport path is
bug-free. The dated, re-derivable lineage receipt is linked in diagnosis §18.8.

## External skill and saved-run boundaries

The original `read-only-source-review` skill is private and is not included.
`--review-skill=original` remains the default for compatibility, but requires
`--review-skill-path=/absolute/path/to/read-only-source-review` for original review
runs. Its complete directory is copied into the isolated runtime profile, and
its hashes are recorded. The native comparison embeds `SKILL.md` plus
`references/evidence-rating.md` from it. Removing the skill changes the task, so
`large --review-skill=none` is a diagnostic and cannot pass the original
skill-bearing acceptance.

For an isolated review-method experiment, use `large --review-skill=candidate
--review-skill-path=/absolute/path/to/candidate`. This reuses the same whole-directory
installation and records the candidate's actual `review_skill_hashes`; it does not
modify the original directory or everyday skills. Keep the baseline and candidate
directories separately frozen. Even byte-identical instructions selected as
`candidate` remain diagnostic, with `original_acceptance_eligible=false`.

The initial candidate mode accepts only a fresh Aino large task, without matched
comparison. Candidate-derived replay and length runs are rejected before run
creation (and before account access in the platform wrapper), including when the
caller leaves `--review-skill=original` at its default. Native Codex candidate
comparison is not supported. Existing original/none behavior is retained.

Offline scripted completion proves installation, transport and provenance only:
the dry model does not read the skill or evaluate findings. A real candidate
evaluation must check actual skill use and delegation context, complete natural
delivery, semantic accuracy including true-defect retention, conditional language
in the final ranking, evidence integrity and all costs. Changing the review method
is a task-contract intervention, not a runtime fix or original-task acceptance.

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


## Free regression and desktop finalization (2026-09-30)

Run the complete offline suite through the canonical runner:

    scripts/run_tests.sh tests/evals/test_ultra_delegation_*.py
    npm test --workspace tests-js -- ultra-delegation-platform-runner.test.ts

The original combined convergence file exceeded its effective 343-second timeout.
It is now separated into convergence metrics, harness hooks, configuration and
scenario contracts, with one shared offline subprocess fixture. All 52 function
ASTs, including decorators and assertions, were verified unchanged. No limits,
assertions or retry policy were weakened. Fresh results: Python 96 passed, zero
failed, one Linux-only skip on macOS; maximum file time 192.54s. JS runner: 26 passed.

The current-branch Electron development build was checked with isolated HOME,
HERMES_HOME and userData, a real gateway/child and a loopback scripted model.
The test waits for both delegation and process notifications to be consumed before
asserting final idle. It checks running child, full result delivery, parent
continuation, final text, no running/Stop indicator, and retained Completed status.
An observed display regression was fixed by retaining received native outcomes in
the existing retired-child bookkeeping. Transcript and overview use exact receipt
identities; the live roster still prunes completed work. No model prompts,
conversation compression or task budgets changed. This is in-memory retention,
not a new durable store; unknown historical dispatches remain unknown when no
outcome evidence is available.

Fresh desktop state regression: 72 passed; update-root helper tests: 7 passed;
native update IPC and lifecycle E2E each passed. The native IPC test was also red
against the original main process and green with the fix, using a real linked Git
worktree and existing offline update cache. Build, all three TypeScript targets,
related ESLint and Ruff passed. Update application, Windows recovery, Linux and
remote topology were not exercised.

No paid model call, push, merge, daily profile change or daily desktop restart was
performed during finalization. Prior live system successes and the daily sample's
two functional failures remain distinct, unchanged evidence. The latest read-only
ledger refresh still contains 32 settled rows totaling $1.35760500; one title call
remains unmatched, so final billing is not closed.

Logs, red/green evidence, screenshots, grouped commits and source hashes:
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-eval-desktop-finalization/report.md

## Cross-task comparison preparation (2026-09-30; no live run authorized here)

**Goal:** prepare reproducible task and baseline checks without treating model
judgment errors as demonstrated Ultra transport bugs. Reuse this harness, its
external fixture/skill inputs, existing behavior tests and separate report fields.
No new product prompt, core tool, evaluator service or forced-final rule is needed.

**Starting point:** codex/ultra-delivery-stability at
ae1ef077dc9e2411ae756074f778482eed4f709d. Its production code is the same as the
611074f7342024426ae4f9ba685caa35e16a10b6 frozen live run: one full natural delivery
with three complete children, but important semantic claims need correction.
That one result is neither an overall stability rate nor a Codex parity result.
The preparation changes documentation only; a later documentation commit must not
be described as the exact HEAD executed by that historical live run.

### Task selection and independent scoring

| Task family | Reuse | Score against | Evidence boundary |
| --- | --- | --- | --- |
| Source review | large, original external review skill, unbounded output | Task coverage plus manual claim/evidence/trigger/impact review of the frozen six files | Known regression anchor; many prior runs, not a held-out task. Valid citations alone do not establish correct conclusions. |
| Code repair | daily with the existing small fixture and SPEC.md | Model-generated tests and the separate daily_contract.py behavior checks, reported separately | Different task from large, but also previously used. Natural delivery and self-reported tests cannot substitute for external behavior. |
| Recovery and retry | Existing notification, durable-store, replay and lease tests | Queue/claim conservation, exactly-once consumption, intact results, real import/RPC behavior where exercised | Scripted/local validation, not an independent paid model task or real-provider endurance evidence. |

simple and no_subagent use the same small fixture; length and replay depend on
prior answers. Renaming a run, changing an effort or removing the skill does not
create a new independent task. The repository currently provides two frozen task
fixtures, not a fresh generalization set. A future held-out case must have its
task/specification and external oracle frozen before any candidate answers are
seen; record its exposure history separately. Do not silently replace the existing
fixtures or reinterpret historical scores.

For code-repair scoring, map each assertion to an explicit requirement or a
necessary implication. Separate unspecified policy choices from contradicted
behavior. Monetary rounding, rejection versus clamping and job-ID reuse policy
must not acquire new hidden requirements after a model run. Keep known failure
receipts, such as zero-discount integer precision loss and cross-tenant stale
payload under a concrete interleaving, with the exact applicable assumptions.

For review scoring, retain supported defects as well as counting overstatements.
Record the full claim and its source identity; classify contradiction, missing
premise, unsupported consequence and reasonable design/ranking disagreement
separately. Trace child-to-parent changes using existing stored messages and wire
hashes where available. An independent reviewer supplies source-backed reasons,
not a majority-vote ground truth or a keyword score.

### Baseline readiness: actual capabilities, not assumed equivalence

| Baseline | Fixed identity / existing entry | Ready scope | Before claiming a matched comparison |
| --- | --- | --- | --- |
| Aino | Current branch above; harness.py and platform-runner.ts | large and daily, loopback dry checks and managed live path | Fresh freeze of source, runner, fixtures, skill, effective config and actual model/effort. Existing results keep their own policy. |
| Native Codex | Locally installed codex-cli 0.158.0; codex_driver.py | large only; native dry tools/delegation probes | Native tools, embedded skill text and lifecycle differ; no daily write path. Input still sums represented context; live wrapper permits at most 1200 seconds because this driver lacks lease renewal. |
| Upstream Hermes | Release v0.21.5 at f97608f178d1ffeca59860195ab7da295f7c8e5f | Native source available in local Git history | No upstream driver exists in this harness. Aino managed/Desktop hooks cannot be called an unmodified upstream run; validate the native entry and provider binding independently. |

The release identity is the second parent of Aino merge
32371ee0bdaa4a56079e6bf5ce5481c79e84cc81, not the moving upstream/main ref.
The local annotated tag v2026.9.24 peels to that commit; the release's
hermes_cli/__init__.py declares version 0.21.5.
Do not change the daily checkout or infer a latest upstream version from a local
remote-tracking branch. Baseline preparation needs no fetch or desktop restart.

The upstream CLI already offers chat --query-file with --oneshot and stream-json,
and the native AIAgent and desktop RPC are existing integration seams. Finite
one-shot consumers synchronously join children, however, and the default
delegation.oneshot_max_children is two. Such a run can compare task results with
those differences declared; it cannot stand in for the desktop's asynchronous
notification-to-parent path. Use the existing ordinary desktop RPC if that path
is the question. Upstream stream-json also projects/truncates tool results and
defaults missing usage fields, so retain raw usage/history evidence before
claiming intact model inputs or measured zero cache usage.

The release already has evals/core_tool_deferral/worker.py for isolated source
trees, evals/delegation_group_schema/probe.py for offline schema stability, and
evals/api_delegation_sync_probe.py for local persistence/delivery checks. Reuse
these patterns selectively; the existing task-specific provider bindings and
contracts do not automatically become a general three-product comparator.

Keep the user-approved Aino recipe unbounded/3600 seconds/$10 when describing
that recipe. Do not shorten it to 1200 seconds merely to label Codex comparable.
The identical number 2M has different meanings in the two current drivers;
record cumulative_input_basis and threshold crossings explicitly. Until the
budget/routing/entry gaps are resolved, native runs are descriptive comparisons,
not a strict product A/B. Equal task text still does not equal identical system
prompts, tools, skill loading or provider state.

The existing convergence natural_delivery gate is Aino-specific: it requires an
Aino final_event and completion_guard. Native Codex reports expose final_text,
CLI events and their own probes instead. The offline native delegation probe can
pass while that common summary prints natural_delivery=false with both Aino
fields missing. Record this as unsupported cross-driver evidence mapping, not a
Codex delivery failure; do not fabricate an Aino guard to make it true. A later
comparison needs explicit per-driver evidence mapping in the existing analyzer
before aggregating delivery outcomes. Historical report files stay unchanged.

Any necessary comparator work belongs in the existing harness/driver/accounting
paths, with behavior tests proving the executed binding. A new Hermes driver,
Codex daily support or longer Codex leases is not implemented by this preparation
and must not appear in a runnable command as though it exists. Reuse the current
provider and renewal infrastructure where possible; never copy the user's live
credentials into a fixture or infer request purposes from response presence.

### Execution order and decision rule

1. Freeze candidate source identity and the exact existing fixture/skill files;
   verify imports use the intended worktree. Copy only manifest-listed fixtures
   into an external staging root so generated bytecode is not model input.
2. Run the existing offline scenario, native comparator probe and recovery tests.
   Use scripts/run_tests.sh for Python tests, with a prepared environment and
   local model endpoints. Preserve failures and environment corrections.
3. Record each baseline's executable capabilities and missing pieces. Resolve
   oracle ambiguity before arranging any further paid comparison; do not modify
   an oracle to make an already observed answer pass.
4. Before a paid batch, fix its run list, immutable versions, task exposure, model
   bindings, per-run limits, aggregate spending scope and stop-on-failure rule.
   The previous single-run authorization does not launch this batch. No automatic
   reruns, adaptive prompt edits or budget expansion belong in a frozen batch.
5. Report each run's natural delivery, coverage, collaboration integrity, material
   accuracy, elapsed time, usage and settled/missing bills separately. Give raw
   pass/fail counts by task and baseline; a small pilot is not a reliable population
   success rate and cannot identify a cause from a single cross-product difference.

An Aino-specific, executable loss/routing/recovery counterexample justifies a
runtime repair. Intact evidence with an unsupported final claim remains a model
quality finding until a runtime cause is shown. Similar failures in another
baseline do not excuse Aino's answer; a baseline success alone does not isolate
the cause of Aino's failure. Do not require zero possible model errors to close
a demonstrated transport bug, or use that distinction to accept missing work.

### Free recovery checks and their limits

Reuse the following existing behavior-test files through the canonical runner:

```sh
scripts/run_tests.sh -j 4 \
  tests/evals/test_ultra_delegation_*.py \
  tests/tui_gateway/test_notification_turn_release.py \
  tests/tools/test_async_delegation_orphan_sweep.py \
  tests/tools/test_async_delegation.py \
  tests/tui_gateway/test_managed_model_agent.py \
  tests/tools/test_managed_delegation_billing.py
npm test --workspace tests-js -- ultra-delegation-platform-runner.test.ts
```

The notification test covers rejected admission without losing the copy or
spending delivery attempts, including transient SQLite refund failures. Refund
here means returning a delivery attempt, not money. Orphan/claim tests use real
temporary databases and producer processes; profile recovery includes A-to-B-to-A
scope checks. Owner-death tests preserve completed child results and keep
unfinished children unknown; they do not resume a killed in-flight agent.

Managed-agent tests use real RPC/Agent/SDK calls to local scripted endpoints,
including a later request using renewed authority without rebuilding the agent
or prompt. Managed-delegation tests check actual child authority and reject an
uncredentialed endpoint override. These do not query bills or test the real
account lease service. Some recovery tests replace worker admission/delivery;
fault-injected database errors are not a real competing-lock stress test.

Together these are component/integration regression checks, not one end-to-end
proof of missing-lease notification rejection, real automatic renewal, child
result consumption, natural parent answer and desktop rendering in sequence.
Keep that missing combined path, real desktop restart/reconnect, real-provider
expiry and platform/remote coverage explicit. Synthetic models establish no
answer-quality or provider-speed result.

Preparation receipts: 10 Python files / 175 passed / 0 failed / 1 Linux-only
skip on macOS, with file retries disabled; the existing JavaScript wrapper suite
passed 26 tests. The canonical Python runner temporarily used the main checkout's
prepared environment because its local environment lacks a protocol dependency;
the original worktree environment was restored with the same directory inode.
No packages were installed, and production imports remained in this worktree.

Three separate loopback runs also completed: Aino large delivered three child
results and a guarded parent final; native Codex's actual CLI passed its child
spawn/read/return probe; Aino daily exercised file writing and unittest. The daily
script deliberately did not repair code: the independent contract retained the
same 10 failing subcases and 1 error before/after, daily.accepted=false. That is
the expected negative quality result, not a failed recovery regression or a
successful code repair. Synthetic durations cannot rank product performance.

No production or evaluator logic changed in this preparation. No live model,
account/settlement query, push, merge, daily profile change or desktop restart
was performed. Exact commands, source/fixture identities, logs, native probe
fields and remaining baseline work are recorded at:
/Users/zizimutou/.codex/visualizations/2026/09/29/01a0eadc-dc19-7f42-98b4-e6812a7cb811/ultra-cross-task-preparation-20260930/report.md
