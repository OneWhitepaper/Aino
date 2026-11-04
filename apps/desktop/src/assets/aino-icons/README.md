# Approved Aino interface icons

Curated static SVG paths exported from `@icon-park/react` version `1.4.2`, the same library used by the approved Aino interface prototype. The outline uses the prototype's 48-unit viewBox and 1.7-unit stroke. These assets are rendered through the existing `src/lib/icons.ts` entry point; no new runtime package is installed.

Source: https://github.com/bytedance/IconPark
Copyright 2020 ByteDance. Distributed under Apache-2.0; see LICENSE.

The subset keeps the original path geometry and uses inherited stroke width for existing icon props. Named filled-state variants retain the filled paths. Brand/provider images, file-type art and specialized git/resource icons keep their established assets. The existing `assets/aino-home/` masks used by navigation and window controls are exported from the same source.

`PlayFilled` reuses the approved Play triangle without its enclosing ring for the composer continuation button.
