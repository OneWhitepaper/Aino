---
name: hyperframes
description: Render deterministic HTML animations into video.
version: 1.0.0
author: HeyGen, Aino contributors
license: Apache-2.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [hyperframes, creative]
    category: creative
    related_skills: [imagegen, visualize]
---

# HyperFrames Skill

Create editable HTML/GSAP compositions and render them to MP4/WebM with HyperFrames. Aino bundles the workflow and references; rendering uses an installed external CLI, FFmpeg, and browser.

## When to Use

Use for motion graphics, product tours, captioned narration, social overlays, and deterministic HTML-based video. Prefer a scientific plotting/animation tool for mathematical exposition.

## Prerequisites

- `terminal`, Node.js 22+, FFmpeg, and a project-local pinned HyperFrames CLI/browser installation.
- Inspect the project's lockfile and existing scripts before installing. Follow https://github.com/heygen-com/hyperframes when setup is needed.
- A concrete duration, aspect ratio, content outline, and existing brand/style constraints. Infer reasonable defaults from the task when sufficient.

## How to Run

Use the project-local CLI through `terminal`; `npx --no-install hyperframes` avoids silently downloading a different release. Read the relevant references with `skill_view` before composing.

## Quick Reference

```text
npx --no-install hyperframes init my-video --non-interactive
npx --no-install hyperframes lint
npx --no-install hyperframes preview
npx --no-install hyperframes render --output final.mp4
npx --no-install hyperframes doctor
```

References: `references/composition.md`, `references/gsap.md`, `references/features.md`, `references/cli.md`, `references/website-to-video.md`, `references/troubleshooting.md`.

## Procedure

1. Establish narrative, timing, visual identity, key scene frames, and media rights using the user's request and existing design rules.
2. Scaffold in a task-owned project directory. Build a static hero frame before adding animation; use layout constraints and safe margins rather than arbitrary offsets.
3. Read the composition contract and use the expected data attributes and `window.__timelines` registration. Keep the GSAP timeline paused, finite, and deterministic.
4. Add entrances/transitions that serve the content. Use finite repeats and seeded randomness; no wall-clock-dependent motion or async timeline construction.
5. Keep audio separate from muted video; align captions to actual speech and ensure captions become hidden after their segment. Use multilingual transcription models when appropriate.
6. Lint and preview. Inspect representative frames, scene transitions, clipping, text contrast, caption timing, and final audio before rendering.
7. Render the requested format/quality and inspect duration, dimensions, frame rate, audio, and start/middle/end frames.
8. Stop the preview process and only its owned workers using the saved process/session ID. Do not kill unrelated Chrome or browser automation sessions.

## Pitfalls

- A preview server is long-lived and may keep expensive browser workers active.
- Infinite animation repeats and non-deterministic timers break reproducible capture.
- Do not install globally or elevate browser privileges as a routine fix.
- CLI examples in references must match the installed version; prefer the local locked CLI and inspect `--help`.

## Verification

Require successful lint/render, a decodable output, expected duration/dimensions/audio, and inspected representative frames. Confirm task-owned preview processes are stopped and return the final artifact path.

## Attribution

Adapted from the Apache-2.0 HyperFrames workflow and the existing Aino optional bundle. References retain the composition/CLI contract; setup uses project-local dependencies.
