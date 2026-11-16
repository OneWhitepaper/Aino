# Open Bot Avatar · Ghost

Source: https://github.com/dominikscholz/open-bot-avatar
Commit: `921907e614fb40e76c249bf8684d8619a8a3bf0f`
Definition: [`gallery/ghost.json`](https://github.com/dominikscholz/open-bot-avatar/blob/921907e614fb40e76c249bf8684d8619a8a3bf0f/gallery/ghost.json)
License: MIT, Copyright (c) 2026 Dominik Scholz; full notice in `LICENSE`.

`ghost.json` is the unmodified upstream avatar definition. `BotModeIcon` uses the
original `open-bot-avatar@0.2.1` DOM renderer (npm gitHead
`6c42fc3b90f6fc92d2333807de775d0e9e48212f`) for its floating, blinking and
pointer-following motion. The white body and dark pill eyes keep their upstream
geometry. A small contrast edge preserves visibility on the light navigation.

The dependency is bundled locally: no iframe, remote script or service is used.
Its canvas renderer shares a frame clock and limits small avatars to 30fps;
offscreen avatars sleep. Aino's existing window pause controller switches to a
still when hidden/minimized or inside a hidden pane; visible unfocused windows
continue normally. System reduced-motion preferences are passed to the original
engine. Unmount destroys the avatar and removes its observers and subscriptions.
A static render is present before the first animation frame.

The activity rail and Bot pane tab share this glyph through the existing UI SDK.
User-selected bot portraits, the Aino brand mark and subagent artwork keep their
existing sources and behavior.
