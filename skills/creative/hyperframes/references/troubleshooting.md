# Troubleshooting

Use the installed project-local CLI through `terminal`. Setup, browser/model downloads, and dependency upgrades are separate effects: perform them when required by the authorized task and preserve the project's package-manager/lockfile workflow. Examples below do not authorize global installs or privilege changes.

## `HeadlessExperimental.beginFrame' wasn't found` (first thing to check)

**Symptom:** `npx --no-install hyperframes render` fails with:

```
✗ Render failed
Protocol error (HeadlessExperimental.beginFrame):
'HeadlessExperimental.beginFrame' wasn't found
```

**Cause:** Chromium 147+ removed the `HeadlessExperimental.beginFrame` CDP command. This affected sandbox environments (e.g., OpenClaw, some containerized agent hosts) that ship modern Chromium as the system browser. See [hyperframes#294](https://github.com/heygen-com/hyperframes/issues/294).

**Fix when the installed release is affected:** select a verified compatible version through the project's dependency workflow. If the task includes the needed dependency update, use the project's package manager and retain its lockfile; do not run a self-updater or an unpinned install.

`hyperframes >= 0.4.2` auto-detects whether the resolved browser supports `beginFrame` (checks for `chrome-headless-shell` in the binary path) and falls back to screenshot capture mode when it doesn't. Commit [`4c72ba4`](https://github.com/heygen-com/hyperframes/commit/4c72ba4a36ec2bd6733f7b9cb2a9e63f9fb234b9) (March 2026) shipped this auto-detect.

**Fix (escape hatch — if you can't upgrade):**

Set `PRODUCER_FORCE_SCREENSHOT=true` for the owned render process using the host's environment syntax, then run `npx --no-install hyperframes render`. In POSIX shells use `export PRODUCER_FORCE_SCREENSHOT=true`; in PowerShell use `$env:PRODUCER_FORCE_SCREENSHOT = 'true'`. Restore a pre-existing value after the check.

This forces screenshot mode regardless of the binary. Screenshot mode is slightly slower but visually identical.

**Fix (prevent — recommended):** install `chrome-headless-shell` so the engine can use the fast BeginFrame path:

```bash
npx --no-install puppeteer browsers install chrome-headless-shell
# or let the CLI do it
npx --no-install hyperframes browser --install
```

Use the installed CLI browser setup command when the project requires it.

## `npx --no-install hyperframes render` hangs for 120s then times out

**Cause:** the resolved browser is system Chrome (e.g., `/usr/bin/google-chrome`) and doesn't support the BeginFrame path, but auto-detect also missed it (older `hyperframes` version).

**Fix:**
1. Check which binary is being used: `npx --no-install hyperframes browser --path`
2. If it's system Chrome, either:
   - Install `chrome-headless-shell`: `npx --no-install hyperframes browser --install`, OR
   - Use the scoped screenshot fallback described above, OR
   - Update the affected project dependency to a verified compatible release through its package manager.

## `ffmpeg: command not found`

Use an existing project-supported FFmpeg binary first. If setup is needed, follow the host's normal package-manager workflow within the authorized task; system installation may require privileges. These are host-specific setup examples:

| OS / distro     | Command                             |
| --------------- | ----------------------------------- |
| Ubuntu / Debian | `sudo apt-get install -y ffmpeg`    |
| Fedora / RHEL   | `sudo dnf install -y ffmpeg`        |
| Arch            | `sudo pacman -S ffmpeg`             |
| macOS           | `brew install ffmpeg`               |
| Windows         | `winget install Gyan.FFmpeg`        |

Verify: `ffmpeg -version`.

## `Node version X is not supported`

HyperFrames requires Node.js >= 22. Check with `node --version`.

Use the repository's existing runtime manager or documented version setup. Do not replace a system Node binary or force-link a different version to repair one project. If no compatible runtime exists, complete the requested setup through the host's supported manager.

## `ENOSPC: no space left on device` or OOM kills during render

Renders are memory- and disk-hungry. Minimums:

- **RAM:** 4 GB free (8 GB recommended for 60fps / `--quality high`)
- **Disk:** 2 GB free scratch space — frames are written to the system temp dir (`$TMPDIR`) during capture

Mitigations:
- Lower quality: `--quality draft`.
- Lower fps: `--fps 24`.
- Lower worker count: `--workers 1`.
- Configure a task-owned temporary directory on a volume with enough space using the host's supported temporary-directory setting. Preserve and restore any existing value; do not assume a particular mount path.

## Lint passes but the render is blank / black frames

Check the browser console in `preview` — usually:
- A timeline was registered with the wrong key (`__timelines["typo"]` instead of `__timelines["root"]`).
- The root composition was wrapped in `<template>` (only sub-compositions use `<template>`).
- A script tag failed to load — check Network tab in preview.

Run `npx --no-install hyperframes lint --verbose` to see info-level findings.

## Contrast warnings from `hyperframes validate`

```
⚠ WCAG AA contrast warnings (3):
  · .subtitle "secondary text" — 2.67:1 (need 4.5:1, t=5.3s)
```

- **Dark backgrounds:** brighten the failing color until it clears 4.5:1 (normal text) or 3:1 (large text — 24px+ or 19px+ bold).
- **Light backgrounds:** darken it.
- Stay within the palette family — don't invent a new color, adjust the existing one.
- Skip the check temporarily with `--no-contrast` if iterating rapidly, but clear it before delivery.

## `Font family 'X' not supported by compiler`

The compiler embeds a curated set of web-safe + open-source fonts. If a font isn't supported, either:
- Swap to a supported alternative from the warning.
- Register a custom font via `@font-face` pointing to a `.woff2` in the project directory (the compiler embeds referenced `@font-face` files).

## Video plays back muted or with no audio

Check:
- The `<video>` element has `muted playsinline` (required — browser autoplay policy).
- Audio is a **separate** `<audio>` element, not the video element.
- Audio `data-volume` is set (defaults to 1).
- The audio file is at the expected path — compositions load relative to their own directory.

## Docker render fails on Linux with rootless Docker

Inspect the runtime sandbox policy and use a supported project renderer. Do not automatically grant privileged access. A narrowly scoped authorized container configuration may use:

```bash
npx --no-install hyperframes render --docker --docker-args "--cap-add=SYS_ADMIN"
```

The headless browser needs namespace permissions for sandboxing.

## Runaway CPU from leftover preview workers

**Symptom:** load average climbs and stays high; `top` shows several `chrome-headless-shell --type=gpu-process` at ~300%+ CPU each, alive for hours/days, even when you're not rendering.

**Cause:** `npx --no-install hyperframes preview` is a long-lived server that keeps Chrome render workers resident. On hosts with no real GPU (WSL, containers, most CI), each idle worker falls back to software WebGL (`swiftshader`) whose GPU process busy-spins a CPU core. A preview left open — or several started over time — stacks these up.

**Diagnose:**

Inspect the saved preview process/session and its actual child process tree with the host's process tools. Confirm process identity, ownership, and measured CPU use; do not infer ownership from an argv substring or stop every browser process.

**Fix:** stop the preview server and its workers (see [the skill procedure](../SKILL.md)):

```bash
# Stop the saved task-owned preview process/session only.
# Inspect child process identity before stopping owned render workers.
```

**Avoid:** never leave a `preview` running after review; use `render` (one-shot, self-cleaning) for output. Keep `--workers` low on shared/GPU-less hosts.

## Bug reports

Prepare a redacted report with `npx --no-install hyperframes info` output and the relevant error log. The upstream issue tracker is [github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes/issues); posting requires the user's authorization.
