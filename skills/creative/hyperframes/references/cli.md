# HyperFrames CLI

Run the project-local locked CLI through `terminal` using `npx --no-install hyperframes`. Requires Node.js >= 22, FFmpeg, and a supported browser. Do not silently download a CLI release or install globally.

## Workflow

1. **Scaffold** — `npx --no-install hyperframes init my-video` (or `npx --no-install hyperframes capture <url>` if starting from a website)
2. **Write** — author HTML composition (see `composition.md`)
3. **Lint** — `npx --no-install hyperframes lint`
4. **Validate** — `npx --no-install hyperframes validate` (WCAG contrast audit)
5. **Inspect** — `npx --no-install hyperframes inspect` (visual layout audit)
6. **Preview** — `npx --no-install hyperframes preview`
7. **Render** — `npx --no-install hyperframes render`

Always lint before preview/render — catches missing `data-composition-id`, overlapping tracks, and unregistered timelines.

## init — Scaffold a Project

```bash
npx --no-install hyperframes init my-video                        # interactive wizard
npx --no-install hyperframes init my-video --example warm-grain   # pick an example template
npx --no-install hyperframes init my-video --video clip.mp4       # seed with a video file
npx --no-install hyperframes init my-video --audio track.mp3      # seed with an audio file
npx --no-install hyperframes init my-video --non-interactive      # skip prompts (CI / agent use)
```

Templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`.

`init` creates the correct file structure, copies media, transcribes audio with Whisper, and installs authoring skills. Use it instead of creating files by hand.

## capture — Website → Editable Components

```bash
npx --no-install hyperframes capture https://example.com                  # → captures/example.com/
npx --no-install hyperframes capture https://stripe.com -o stripe-video   # custom output dir
npx --no-install hyperframes capture https://example.com --json           # machine-readable output
npx --no-install hyperframes capture https://example.com --skip-assets    # skip images/SVGs
```

Captures the site into `captures/<hostname>/capture/` by default, producing `capture/screenshots/`, `capture/assets/`, `capture/extracted/` (tokens.json, visible-text.txt, fonts.json), and a self-contained snapshot.

All downstream steps (DESIGN.md, SCRIPT.md, STORYBOARD, composition) read from the `capture/` subfolder — see `website-to-video.md`.

## lint

```bash
npx --no-install hyperframes lint                # current directory
npx --no-install hyperframes lint ./my-project   # specific project
npx --no-install hyperframes lint --verbose      # include info-level findings
npx --no-install hyperframes lint --json         # machine-readable output
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (only with `--verbose`).

## validate

```bash
npx --no-install hyperframes validate                 # WCAG contrast audit at 5 timestamps
npx --no-install hyperframes validate --no-contrast   # skip while iterating
```

Seeks to 5 timestamps, screenshots the page, samples background pixels behind every text element, and warns on contrast ratios below 4.5:1 (normal text) or 3:1 (large text — 24px+, or 19px+ bold). Run before final render.

## inspect

```bash
npx --no-install hyperframes inspect                 # visual layout audit at 5 timestamps
npx --no-install hyperframes inspect ./my-project    # specific project
npx --no-install hyperframes inspect --json          # agent-readable findings
npx --no-install hyperframes inspect --samples 15    # denser timeline sweep
npx --no-install hyperframes inspect --at 1.5,4,7.25 # explicit hero-frame timestamps
```

Use this after `lint` and `validate`, especially for compositions with speech bubbles, cards, captions, or tight typography. Reports overflow, off-frame elements, occluded text, contrast warnings, and per-timestamp layout summaries — catches issues that pure timeline lint can't see (e.g., a caption that wraps past the safe area only at a specific timestamp).

`npx --no-install hyperframes layout` is a compatibility alias for the same visual inspection pass.

## preview

```bash
npx --no-install hyperframes preview                # serve current directory (port 3002)
npx --no-install hyperframes preview --port 4567    # custom port
```

Hot-reloads on file changes. Opens the Studio in your browser automatically.

## render

```bash
npx --no-install hyperframes render                              # standard MP4
npx --no-install hyperframes render --output final.mp4           # named output
npx --no-install hyperframes render --quality draft              # fast iteration
npx --no-install hyperframes render --fps 60 --quality high      # final delivery
npx --no-install hyperframes render --format webm                # transparent WebM
npx --no-install hyperframes render --docker                     # byte-identical reproducible render
```

| Flag           | Options                 | Default                        | Notes                       |
| -------------- | ----------------------- | ------------------------------ | --------------------------- |
| `--output`     | path                    | `renders/<name>_<timestamp>.mp4` | Output path                 |
| `--fps`        | 24, 30, 60              | 30                             | 60fps doubles render time   |
| `--quality`    | `draft`, `standard`, `high` | standard                   | draft for iterating         |
| `--format`     | `mp4`, `webm`           | mp4                            | WebM supports transparency  |
| `--workers`    | 1–8 or `auto`           | auto                           | Each spawns Chrome          |
| `--docker`     | flag                    | off                            | Reproducible output         |
| `--gpu`        | flag                    | off                            | GPU-accelerated encoding    |
| `--strict`     | flag                    | off                            | Fail on lint errors         |
| `--strict-all` | flag                    | off                            | Fail on errors AND warnings |

**Quality guidance:** `draft` while iterating, `standard` for review, `high` for final delivery.

## transcribe

```bash
npx --no-install hyperframes transcribe audio.mp3
npx --no-install hyperframes transcribe video.mp4 --model medium.en --language en
npx --no-install hyperframes transcribe subtitles.srt     # import existing
npx --no-install hyperframes transcribe subtitles.vtt
npx --no-install hyperframes transcribe openai-response.json
```

Produces word-level timings suitable for caption components. First run downloads the Whisper model (cached after).

## tts

```bash
npx --no-install hyperframes tts "Text here" --voice af_nova --output narration.wav
npx --no-install hyperframes tts script.txt --voice bf_emma
npx --no-install hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav
npx --no-install hyperframes tts "Hello there" --voice af_heart --lang fr-fr --output accented.wav
npx --no-install hyperframes tts --list                    # show all voices
```

Uses Kokoro (local, no API key). Voice ID first letter encodes language: `a` American English, `b` British English, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese, `p` Brazilian Portuguese, `z` Mandarin. The CLI auto-infers the phonemizer locale from that prefix — pass `--lang` only to override (e.g. stylized accents). Valid `--lang` codes: `en-us`, `en-gb`, `es`, `fr-fr`, `hi`, `it`, `pt-br`, `ja`, `zh`. Non-English phonemization requires `espeak-ng` installed system-wide (`apt-get install espeak-ng` / `brew install espeak-ng`).

## doctor

```bash
npx --no-install hyperframes doctor
```

Verifies environment:
- Node.js >= 22
- FFmpeg present on PATH
- Available RAM (renders are memory-hungry — 4 GB minimum)
- Chrome binary resolution (`chrome-headless-shell` preferred over system Chrome)
- Current `hyperframes` version

Run this **first** when a render fails. See `troubleshooting.md` for interpreting the output.

## browser

Browser installation downloads an external binary; cache cleaning removes installed resources. Perform setup or cleanup only within the requested task, with the project-specific cache and dependency ownership known.

```bash
npx --no-install hyperframes browser --install      # install the bundled chrome-headless-shell
npx --no-install hyperframes browser --path         # print the resolved browser binary path
npx --no-install hyperframes browser --clean        # clear the bundled browser cache
```

## info

```bash
npx --no-install hyperframes info
```

Prints version, Node version, FFmpeg version, OS, and resolved browser path — useful in bug reports.

## upgrade

Inspect the installed version and project lockfile before changing dependencies. If the requested work includes setup or an upgrade, select a verified compatible release and update it through the project's package manager, retaining its lockfile. Do not run a self-updater that bypasses those pins.

For `HeadlessExperimental.beginFrame` failures, first check the installed version's supported browser path and capture fallback. The upstream auto-detect fix shipped in `hyperframes@0.4.2` (commit 4c72ba4, March 2026).

## Other

```bash
npx --no-install hyperframes compositions    # list compositions in the project
npx --no-install hyperframes docs            # open documentation in browser
npx --no-install hyperframes benchmark .     # benchmark render performance
npx --no-install hyperframes add <block>     # install a block/component from the catalog
npx --no-install hyperframes add --list      # browse the catalog
```

Popular catalog blocks: `flash-through-white` (shader transition), `instagram-follow` (social overlay), `data-chart` (animated chart), `lower-third` (talking-head overlay). See [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog).
