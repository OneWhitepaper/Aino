# Native bundle cache deduplication

## Scope

Keep the existing feature list, tools, ready Python environment, bytecode and offline dependency inputs. This change only preserves uv's existing shared cache layout on POSIX; it does not add a runtime manager, download-on-use behavior or UI changes. Windows keeps its existing copying behavior without requiring symlink privileges; no Windows size reduction is claimed.

`scripts/bundles/native.py::stage_uv_cache` previously used `shutil.copytree` with its default link-following behavior. uv's `wheels-v6` index links into `archive-v0`, so staging materialized another complete extracted wheel tree. The fix retains those links, rewrites absolute builder references to relative cache-owned targets, and refuses links whose target cannot be staged inside the cache.

Preserving links also exposed an existing pruning mismatch: `ruamel.yaml-0.18.16.dist-info` was compared with the lock name `ruamel-yaml` without normalizing dots. The archive was removed while the dereferenced index copy survived. `pm/uv_cache_prune.py` now uses the same standard-library PEP 503 normalization for lock, distribution and index names. This module must remain importable under `python -S`; importing `packaging` at module scope broke that contract during development and was removed.

## Measured comparison

The published ARM64 0.1.0 ZIP was identified by SHA-256 `c33ff43ad3b3357fadd879ccf13db0d96bc5d64dc3a2d2047f64c23f5ebedf00`. It contains 4,618,625,287 expanded bytes, including 4,225,698,289 bytes of agent payload. It is an older published product, not a newly released v0.22.4 installer.

For a controlled size comparison, both staging implementations consumed the same preserved release build cache and the same original project lock. Both applied the corrected name normalization, retained all lock-selected inputs and pruned the same two stale entries. Each staged cache was archived with the same macOS `ditto -c -k --keepParent` command.

| Cache measurement | Link-following baseline | Shared-layout candidate | Reduction |
| --- | ---: | ---: | ---: |
| Regular-file bytes | 1,795,817,348 | 898,340,770 | 897,476,578 |
| Regular files | 61,639 | 30,954 | 30,685 |
| Relative, cache-owned links | 0 | 237 | — |
| Cache ZIP bytes | 618,323,795 | 308,275,781 | 310,048,014 |

These are measured cache-component results, not a claim that a new complete public installer has been released. Whole-application size also depends on archive settings and the final signature resource manifest.

## Validation

- The original three link-preservation/relocation cases failed on the baseline, then passed with the fix. The normalized-name case independently failed before the pruning correction.
- `scripts/run_tests.sh tests/pm/ tests/scripts/ -q --file-retries 0`: 306 files, 2,427 passed, zero failures, 284 skips on macOS (host/opt-in conditions).
- `python scripts/check --staged`: all 12 checks passed; zero code-health blockers or advisories.
- Independent review caught the same `python -S` bootstrap regression; the standard-library correction passed the existing real bootstrap test and re-review found no remaining blockers.
- The real Electron `builder-util` resource copier retained the shared cache layout in a disposable copy of the existing app.
- The resident PM rebuilt the complete locked runtime dependency environment offline from both the staged cache and the Electron-copied cache, using its existing `no_install_project=True` runtime-build path. Both inventories retained all 47 originally enabled extras. Native/pure imports of NumPy, ONNX Runtime, ruamel.yaml, Playwright, gRPC and PyAV passed.

The offline probe deliberately tests the existing runtime dependency rebuild, not rebuilding the Hermes project wheel. A separate initial probe that also built the project encountered uncached build requirements on the baseline; it is not evidence of a deduplication regression.

Formal Developer ID re-signing of the disposable candidate encountered Apple's unavailable timestamp service. This does not justify weakening production signing requirements. Public installers, update feeds and daily profiles were left unchanged; release signing/notarization remains part of the next installer publication.
