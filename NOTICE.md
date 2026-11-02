# Aino attribution

Aino is an independent distribution and desktop product built from the
[Hermes Agent](https://github.com/NousResearch/hermes-agent) project by Nous
Research.

The upstream project and its contributors remain credited under the MIT license
in [`LICENSE`](LICENSE). Aino's branding and application packaging do not remove
or replace those copyright notices.

## Desktop interface icons

The curated desktop interface SVG paths in
`apps/desktop/src/assets/aino-icons/` and the corresponding navigation/window
control masks in `apps/desktop/src/assets/aino-home/` are derived from
[IconPark](https://github.com/bytedance/IconPark), `@icon-park/react` 1.4.2.
Copyright 2020 ByteDance. Licensed under Apache-2.0; the full license is retained
in `apps/desktop/src/assets/aino-icons/LICENSE`. The subset is exported as static
paths, with stroke width inherited from the shared component API and redundant
boundary-only masks removed from Upload and VolumeMute. Original geometry is
preserved.
