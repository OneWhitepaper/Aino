# v0.22.2 CI integration fixes

## Contributor attribution

`contributor-check.yml` now pins the reviewed Hermes v0.22.2 release commit
`d923a5eb487a17c0a68801bba9ef0f56c81040a8`. The existing import-only exception
still compares the merge base, preserves original Git authorship for commits
already in that release, and requires mappings for all Aino commits.

## Plugin catalog admission

The pinned-source job recognizes the merge shape used for the reviewed release
import: the fixed release commit must be an ancestor of the PR head and absent
from the target branch. The PR head tree and `plugin-catalog/` must match that
reviewed commit exactly, and the scanner, catalog validator, and PM setup action
must remain byte-for-byte pinned. This exception expires automatically after
the target branch contains the release. Imported entry files still flow into
the existing clone-at-SHA, manifest, payload, and self-updater checks; new
catalog edits or unreviewed code commits are rejected.

Tests cover accepted pinned imports, rejection of an extra code commit, and
expiry after the target branch advances. Validation receipts:

- `temporary/aino-v0222-ci-attribution.log`
- `temporary/aino-v0222-ci-plugin.log`
- `scripts/run_tests.sh tests/ci/test_plugin_catalog_ci_confinement.py` (the
  Linux-marked file is skipped on this macOS host; syntax and fixture checks
  were run directly and are recorded above).
