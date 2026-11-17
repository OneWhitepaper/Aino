# Aino integration of Hermes v0.23.2

## Release and ancestry

This upgrade imports the exact Hermes v0.23.2 release commit
`ae2a81ccc00e9b7c06301523e5bb09608397149c` (annotated tag object
`28f57ed8e3dba4eceb67dfd3e3abda1a7604452d`). The previous release was
`3b421578588243f920886e6fe79a6faa87ea026e`. The release window contains
7,918 non-merge commits and changes 5,211 files.

Aino's existing provider protocol-refresh and origin-scoped Responses replay
fixes were committed first in `42df924900e91c154cb9d492dc9dc665577eaa52`.
The release integration uses a merge commit so upstream ancestry remains
verifiable, rather than replacing Aino's tree with the upstream tree.

## Compatibility decisions

- Preserve Aino's shell, 52 px activity rail, 252 px navigation, chat widths,
  typography, palette, rounded components, summary and tabbed tool panel.
  Upstream behavior is integrated into the existing feature owners and
  components. New conversations use Settings defaults; session overrides do
  not become another conversation's default.
- Preserve account-scoped local history, Bot profiles and canonical Bot chats,
  managed model permissions, billing, credential routing and browser account
  partitions. Both installation and active account homes participate in native
  sensitive-file protection, including after account activation.
- Preserve Aino identity and installed offline help while updating their
  capabilities and generated contracts. Protocol identifiers, actual third-party
  names and license attribution remain accurate. Delegated task briefs use the
  upstream first-user-message envelope without mutating cached prompt prefixes.
- Preserve browser target ownership, approval boundaries, inline previews,
  theme tokens and widget send bridges. New image/paste IPC limits also apply
  in Aino's active extracted IPC handlers.
- Aino conversation cloud sync remains retired. Upstream Backup & Transfer is
  a separate, explicit action. Opening Settings performs no cloud discovery;
  discovery is account-fenced, bounded and returns only public transfer data.
- Keep standard GitHub-hosted runners, pinned tools and complete validation
  gates. The imported catalog runs the exact release's source validator and
  scanners; its release-import exception is limited to the reviewed catalog
  tree and exact release enforcement files. New merge regressions remain
  blocking in code-health checks.
- Runtime resolution follows the canonical gateway and existing PM machinery.
  Bundled Python staging includes the selected interpreter's standard library
  without losing Aino's sealed-bundle bytecode policy. Nix's pnpm content hash
  is updated to the result computed by its fixed-output builder.

## Verification record

The final PR checks are authoritative for the complete Python, platform, Nix,
catalog and workspace matrix. Intermediate failures were repaired and rerun;
they are not counted as successful verification.

- Desktop build and renderer, Electron and E2E TypeScript checks passed.
- All 20 non-health repository checks passed. The reviewed code-health
  comparison across 3,051 files reports zero blocking and zero advisory
  findings beyond the exact upstream baseline; inherited findings remain
  visible with their provenance.
- The complete Electron suite passed on Electron 44.10.2: 495 files and
  4,716 cases; 11 files and 68 cases retained their existing conditional skips.
  This final run includes the fresh-cache network bootstrap test and both new
  native viewport contracts, with no test-file exclusions.
- The complete renderer suite passed in one final eight-worker run: all
  2,035 files and 17,042 cases. The existing summary-layout test also passed
  alone after a cold full-renderer import exceeded its deadline under load;
  no deadline or assertion was relaxed.
- Real Electron journeys passed account A-to-B-to-A home/history/Chromium
  isolation, same-account Bot recovery through the local API fixture, ordinary
  and Bot identity, group/delegated-child identity, and both inline widget send
  bridges with live theme tokens. Native fixtures follow the current activity
  rail and creation disclosure, preserving their behavior assertions.
- Runtime regression batches exercised provider defaults, managed billing,
  credentials, fallback routing, child lifecycle, account boundaries, CLI
  updates, packaging and generated protocol/prompt contracts. Failed cases
  were diagnosed at the actual production or fixture owner and rerun.
- The installed Aino handbook, generated skill documentation and documentation
  links were refreshed and checked. Contributor attribution retains the
  original authors of imported upstream changes.
- The native installed-desktop smoke rejects a predicted home outside its own
  disposable run even when it finds a retained account fixture; its regression
  asserts that unrelated profile bytes remain unchanged.

Native browser regression testing also found an older viewport clamp that
resized the page on every frame while its panel slid into the window. Requested
viewport dimensions are now capped by the host window independently of the
animated origin; the native parent clips the off-window region. Bounds and
owner validation remain enforced. The new IPC contracts failed before this
fix and passed afterward. A continuous capture of the exact fixture window
verified three reopening cycles with unchanged guest identity and viewport,
no white frames, and the existing page-color thresholds. The test now records
the native window's media stream because renderer-only CDP screenshots cannot
observe WebContentsView children.

The Linux zoom-retention fixture separately exposed Chromium scroll-offset
quantization (`399.9999694824219` to `400`). Its identity, URL, draft and history
assertions remain exact; scroll retention is compared within one CSS pixel.
The payload-bundle fixture now includes the existing `BuildRequest.windows_zip`
default introduced upstream, with 15 relevant packaging contracts passing.

The original serial catalog run passed 362 entries before its 60-minute limit.
The import is therefore validated in deterministic parallel shards using the
same exact-release validator and scanners, with complete coverage required.
The first complete eight-shard run attempted 1,228 entries: 1,221 passed and
seven failed. Six newly introduced discovery entries are not listed:
`hermes-proactive-radar`, `vibeline`, `injection-shield` and `helper` contain
safety examples or static documentation that the exact release scanner rejects;
`hermes-market` and `scope-recall` point to repositories that independently
returned GitHub 404 and Git clone failures. The current official revisions do
not repair the four scanner failures. The earlier `calm-mode` exclusion remains:
its safety regex contains a filesystem-format command name, and its only later
revision adds artwork. No scanner or allowlist exception was added. These are
catalog discovery exclusions; installed plugins and plugin installation remain
available, and this validation repair removes no pre-existing Aino catalog entry.

The upstream release independently retires nine unavailable catalog sources and
three author-withdrawn entries, and renames three entries: `antigravity-duet`
to `daak-duffy`, `gemini-live-bridge` to `livetalk`, and `kiwi` to
`kiwi-shopping`. Their replacement entries are retained. These upstream changes
remove discovery and update paths for the old IDs; they do not delete or disable
already installed copies, and no Aino-specific entry was removed.

The existing Nexus entry remains at upstream version 0.22.48. Its original
`625d1adc6c8e237f37b40a3808ed33f64f9dbdf0` pin disappeared from advertised Git
history, so the catalog uses the reachable official rewritten commit
`37f3c580f5a648b8ae03eb10c25c24ed9122b037`. All seven plugin files were compared:
six blobs are identical, and the only differences in `__init__.py` redact two
sample company names in a comment and a docstring. Python ASTs are identical
after removing docstrings. The exact release CLI validates this replacement after installing its declared
dependencies into an isolated PM environment; its capability probe and security
scanner pass. Clean pinned payload, confinement and attestation-declaration
checks also pass. The pinned-source CI repeats these checks on the final catalog.

The first complete Linux Python matrix passed more than 85,000 cases and
exposed five remaining failing files. The endpoint edit path now recognizes
when the active main route is a copy of the provider being edited, replaces
only that reference inside the credential transaction, and snapshots the actual
hashed credential slot for rollback. Independent model overrides, other hosts
and fallback consumers remain protected. Tests also compare public core
identity with the compatibility source instead of a frozen release string;
exercise atomic snapshot publication through real Bash and retained readers;
complete the disposable pre-update desktop installation's brand resource; and
measure the hardline scanner's CPU cost and linear scaling without counting
other CI workers' scheduling time. Native Linux remains the authority for the
desktop self-stop process contract.

No production deployment or installer publication is part of this upgrade.
