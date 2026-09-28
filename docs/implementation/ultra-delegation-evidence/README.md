# Ultra delegation: portable WIP evidence

This package supports the [implementation handoff](../ultra-delegation-handoff.md).
It preserves enough evidence for a reviewer without the originating machine to
understand the current result. The goal remains **efficient, natural completion of
complex tasks within the whole-task budget**. It has not been achieved by these
experiments. Accuracy is one part of that goal, alongside completion, cost, latency,
tool behavior, and stable conversation context.

The latest full run, `live-large-132101`, completed three children and delivered
their complete JSON in one batch, but hit its cumulative input limit without a
parent final answer. `live-replay-140532` then finished the parent phase naturally
using those same results and a fresh, independent budget. Its final answer still
failed the independent accuracy review. This is a WIP checkpoint, not a release or
an acceptance pass.

## Read these files

| File | Kind and purpose |
| --- | --- |
| [run-history.derived.json](run-history.derived.json) | Allowlisted metrics for all 25 recorded runs, totaling $56.080199 in recorded settled costs, plus detailed metrics for the latest full run and replay. |
| [replay-final-answer.original.md](replay-final-answer.original.md) | Exact unedited model final answer from the replay, including its mistakes. |
| [child-0-compression-display.original.json](child-0-compression-display.original.json) | Exact child evidence string for compression and display. |
| [child-1-delegation.original.json](child-1-delegation.original.json) | Exact child evidence string for cancellation, concurrency, and model inheritance. |
| [child-2-model-history.original.json](child-2-model-history.original.json) | Exact child evidence string for model switching and history. |
| [accuracy-notes.derived.md](accuracy-notes.derived.md) | Compact synthesis of the independent semantic audits; corrections are kept outside model artifacts. |
| [checkpoint-validation.derived.json](checkpoint-validation.derived.json) | Fresh targeted regression receipts and their scope. |
| [checkpoint-python.sanitized.log](checkpoint-python.sanitized.log) | Python regression stdout with local checkout/venv paths replaced. |
| [checkpoint-review.md](checkpoint-review.md) | Separately authored checkpoint review of current WIP risks, with local reproduction probes and limits. |
| [provenance.json](provenance.json) | Per-source hashes, extraction rules, and hashes of every other package file. |

`original` means an exact immutable export for this checkpoint. The answer is
2,867 bytes and equals `final_event.payload.text` encoded as UTF-8. Each child file
is solely the original SQLite result's `summary` string encoded as UTF-8; no final
newline, reindentation, corrected claim, or runtime row wrapper was added. The
strings contain only the reviewed code findings and limitations. Their `confirmed`
labels are model claims, not auditor endorsements.

`derived` means selected fields or editorial synthesis. Metrics round recorded USD
values to six decimals and replace session identifiers with aggregate counts.
The history is in source inventory order, not chronological order. Sanitized
Python stdout replaces machine-specific paths with `<venv>` or `<checkout>`; its
source and exported hashes are recorded separately.
The desktop result is a current-turn tool receipt reported by the coordinating
agent; its raw stdout was not saved. Original Markdown line-break spaces are
intentionally retained in the unedited model answer.

## Provenance and exclusion boundary

The logical `acceptance/` sources are the existing local acceptance archive; the
logical `runtime/` sources are the corresponding saved run directories. Absolute
host paths are intentionally absent. `provenance.json` records SHA-256 and byte
size for each source actually used, including the source SQLite database and the
six reviewed source snapshots. Reading the database used SQLite read-only,
immutable mode. Source hashes were unchanged after extraction.

Extraction uses an allowlist. This package does **not** contain full run reports,
event streams, databases, profiles, authentication material, account/session IDs,
credential tokens, encrypted reasoning, reasoning text, or raw network dumps.
Only numeric aggregate token usage is retained. The originals have been reviewed
for this boundary; they were not edited to achieve it. Technical identifiers such
as `api_key` in a code claim are source-code names, not credential values.

Hashes establish which local artifacts were used and allow a later holder of the
originals to compare them. They do not independently prove the truth of a model
claim, authenticate an unavailable server ledger, or make the omitted raw
transport independently replayable. Delivery and input-integrity claims here are
derived from the saved independent audits, not a replacement for those raw traces.

## Limits that must survive the handoff

- The full run's limits were 1,200 seconds, 64 requests, and 2,000,000 approximate
  cumulative input tokens. Its $5 observed-spend threshold was delayed settlement
  monitoring, **not a monetary hard cap**. It stopped at 2,012,563 approximate input
  tokens after 1,120.27 seconds; no final answer was delivered.
- The replay had its own 1,200 seconds, 24 requests, 2,000,000 approximate input
  tokens, and $2 delayed observed-spend target. Earlier parent and child costs/time
  were not charged to it. Its 436.66-second natural completion does not pass the
  original full run's budget.
- Recorded settled costs, completed-response usage, approximate input guards, and
  elapsed time are distinct measurements. The $56.080199 total is the sum of the
  25 recorded values, not a guarantee that every physical request has final billing.
- The native comparison runs had transport, spawning, effort-matching, or budget
  limitations. This package establishes no ranking or equivalence with Codex.
- Code citations in the original artifacts refer to the six fixed fixture files,
  whose hashes are recorded here. They may not match current checkout line numbers.
  The same six snapshots are available in
  [the checked-in review fixture](../../../evals/ultra_delegation/fixtures/large).
  All six checked-in hashes were verified equal to the recorded source snapshots;
  they are not duplicated in this evidence directory.
- Fresh targeted regressions passed: 489 Python tests across 12 files and nine
  desktop tests across three files. They are not the full suite and do not certify
  model accuracy or end-to-end budget completion. No paid model calls were made
  while preparing this checkpoint.

To check package integrity from this directory:

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
manifest = json.loads(Path('provenance.json').read_text())
for name, record in manifest['package_files'].items():
    data = Path(name).read_bytes()
    assert len(data) == record['bytes'], name
    assert hashlib.sha256(data).hexdigest() == record['sha256'], name
print('Package hashes match; semantic acceptance remains separate.')
PY
```
