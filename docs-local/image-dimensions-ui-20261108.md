# Image dimensions and billing presentation — 2026-11-08

## Evidence and limits

Official documentation: https://ai.google.dev/gemini-api/docs/image-generation

Read on 2026-11-08. The current Model selection section identifies **Nano Banana 2** as
**Gemini 3.1 Flash Image** (`gemini-3.1-flash-image`), distinct from Nano Banana 2.1.
Its “Aspect ratios and image size” table contains this exact 3:2 row:

| Aspect ratio | 512px | 1K | 2K | 4K |
| --- | --- | --- | --- | --- |
| 3:2 | 632x424 | 1264x848 | 2528x1696 | 5056x3392 |

The official API takes an aspect ratio plus resolution class. Its 1K class does
not mean every image's longest edge is 1024 pixels. Dimensions vary by aspect
ratio. These provider resolution classes are different from Aino's existing
billing tiers.

Production acceptance record 10944 requested 1536x1024, returned 1264x848, and
charged 0.201 USD. The returned geometry matches the official 3:2 / 1K row.
However, production account17 uses an upstream alias named **Nano Banana 2**.
The display name and matching pixels do not prove every future request uses
the same native Gemini model, version, or transport. The original upstream
model identity has not been independently established. No permanent size
guarantee or desktop capability list is inferred from this alias.

Aino API's existing `image_billing_size.go` uses measured output dimensions
first, then input dimensions, then the configured/default fallback. Its longest
edge rule puts 1264x848 into 2K (longest edge >1024 and <=2048). This rule and
all prices remain unchanged. The supplier's `quality=1k` is a forwarding label;
it must not be substituted for the recorded 2K settlement tier.

Image requests may also use token billing (`openai_gateway_usage.go` selects
channel pricing mode). A size tier being present does not prove size determined
that request's charge. The desktop DTO currently lacks the pricing mode, so the
UI neutrally labels the API value **Image size tier**, explains that the bill
determines the fee/method, and never invents a per-image formula. The breakdown
map can also contain reserved `image_cache_read_tokens`; only its 1K/2K/4K
entries are size tiers.

## Implemented display

- Image results show verified actual dimensions and the distinct requested
  dimensions. When different, state that the provider returned another size
  and that the original image was preserved. No resizing is performed.
- Both live result objects and serialized historical tool results follow this
  path. `pixel_size` and `actual_size` can establish intrinsic dimensions;
  `size`/`requested_size` cannot.
- Per-turn cost details now show actual output dimensions, the server's billing
  tier/breakdown and the billing size source.
- My Account billing record details additionally show requested dimensions and
  image count. Unknown historical fields remain explicitly unrecorded.
- The existing authenticated usage parser now retains API `image_*` evidence.
  Browser and Electron use the same parser; no new billing API or calculation
  is introduced. Electron needs a main-process restart to pick up its build.
- All nine bundled locales include these explanations.

## Verification

Tests were added first and observed failing because dimensions were missing,
the usage parser dropped image evidence, and the UI showed no size/billing basis.
Targeted test commands and final results are reported to the parent task.
No real paid request, production pricing change, commit, push or merge was made
by this work item. The parent owns native desktop visual acceptance.

Final targeted verification at 2026-11-08 15:26 +08:00:

- `npx vitest run --project ui src/lib/generated-images.test.ts src/components/chat/image-geometry.test.tsx src/components/chat/generated-image-open.test.tsx src/app/settings/platform-billing/usage-view.test.tsx` — 4 files / 46 tests passed.
- `npx vitest run --project electron electron/platform-usage-contract.test.ts electron/platform-client.test.ts` — 2 files / 20 tests passed.
- `npx tsc -p . --noEmit` — passed. Root owns the final complete typecheck and build.
- ESLint over all 12 changed/new TypeScript files — passed without errors or warnings.
- `git diff --check` — passed.

Code review additionally reproduced and then fixed reserved image token counters
being mistaken for tiers, historical pixel strings being mislabeled as tiers,
and copy that incorrectly implied every image request is priced by dimensions.
Each behavior/wording change was observed red before the final passing run.

## Real historical tool routing follow-up

The parent native acceptance exposed a second path: the recorded assistant call
is `tool_call` with exactly one `calls` entry named `image_generate`; its tool row
is named `image_generate` and returns the same flat JSON fields. The transcript
was only routing directly named image calls to the image card, so this real
historical result still rendered as generic key/value bullets. Reading only
this synthetic blue-circle acceptance result confirmed the envelope.

The shared image helper now recognizes that single deferred call envelope.
Card routing, activity grouping, response visibility, paint budget and echo
deduplication use the same identification. A mixed batch is not treated as one
image. A replay test uses the real wire structure and verifies exactly one
visible image outside the collapsed tool process plus actual/requested pixels
and the mismatch explanation. A separate regression verifies the paint cost.
The parent observed a real fixture image card with actual 32x32 / requested
1024x1024 and the difference explanation, without another paid request.

## Fixed failed-turn notices

Also localized the three exact Hermes-authored failure boundary notices at
render time (not processed, partial actions, interrupted automation). Only
`display_kind=failed_turn` gets the marker; ordinary model/system text and
unknown boundary diagnostics are never translated. Original durable content
and runtime message content remain unchanged, partial-action risk is retained,
and no automatic replay is introduced. The marker participates in message
equivalence so a history refresh cannot discard it as unchanged.
