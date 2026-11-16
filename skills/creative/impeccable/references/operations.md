# Operation recipes

## Discover and document

**init:** State who uses the product, their task, platforms, data boundaries,
primary actions, content sources and constraints. Separate facts from unanswered
questions. Preserve existing custom identities and product requirements.

**document:** Inspect tokens and repeated controls; record semantic colors,
type scale, spacing, radii, divider ownership, icons and interaction states.
Link each extracted value to an implemented source; flag drift instead of
inventing a more attractive system.

**shape:** Diagram entry → action → response → recovery. Include loading,
empty/error states and where state persists. Explain why a panel, page,
popover or dialog suits the task before drawing it.

## Evaluate

**critique:** Follow one realistic task. Record the user-visible problem,
evidence, consequence, location and proposed repair. Rank blocked tasks before
visual preference. Familiar components often improve trust in operating tools.

**audit:** Check accessible names, keyboard/focus, contrast, target sizes,
resize/zoom, overflow, scrolling, animation preferences, runtime errors and
request/render costs. Automated checks supplement direct inspection.

## Refine

**polish:** Compare all controls in a family: size, stroke, baseline, label,
padding, radius, focus and selected state. Align shared container boundaries.
Check settings and secondary menus, not only the main screen.

**bolder/quieter:** Adjust a small set of meaningful axes: contrast, type,
scale, whitespace, imagery, density. Preserve primary/secondary action order
and semantic success/warning/error distinctions.

**distill:** Remove repetition and ornamental containers. Collapse optional
process details while keeping final results and discoverable controls. Never
remove a capability merely because it complicates the design.

**clarify:** Controls name the action; errors state what happened and what the
user can do. Avoid internal IDs, implementation jargon and misleading success
messages. Keep approved factual copy and terminology consistent.

## Harden and onboard

Check missing/expired credentials, network failure, retries, duplicate clicks,
cancel, empty lists, long names, translations, 200% zoom and retained state.
Show a useful next action. Do not block the entire screen while an independent
settings panel is loading. Disable only actions that actually cannot run.

First-run guidance belongs beside the task and disappears when no longer
relevant. Tutorials and marketing explanations must not interrupt repeat use.

## Animate

Give state changes a source and destination. Preserve DOM identity and scroll
anchors during panel changes. Prefer transform/opacity when they express the
transition; profile any expensive layout/filter animation. Typical app feedback
is brief (about 150–250 ms), but choose timings from the interaction, not a
universal animation rule. Input must stay responsive while motion runs.

Test rapid reversals, opening while streaming, reduced motion and interrupted
animations. No delayed content reveal may be required to read or act.

## Color, type and layout

Use semantic tokens for active/selected/focus/error surfaces. Establish a
compact type scale and prose measure. Fixed UI scale is often more stable than
fluid display type in resizable panels. Match icons optically, not merely by
SVG viewBox. Choose one owner for shared dividers and consistent inset rules.

## Adapt and optimize

Adapt layout structure at real window constraints. Collapse or reorder panes
before shrinking text. Test OS title bars, safe areas, display scaling and
keyboard navigation where those platforms are available.

Measure startup, network, parse/render and paint costs separately. Fix waterfalls,
wide subscriptions, remounts or expensive repeated parsing before adding a
blanket debounce or memoization layer. Remeasure comparable workloads.

## Extract and explore

Extract repeated anatomy into existing shared components and semantic tokens.
Preserve API and state semantics while replacing duplicated styles.

For alternatives, make a local preview with explicit variant controls and real
representative content. Keep variants comparable. Aino preview can show choices
and interactions; it does not provide the upstream Impeccable live-edit engine.
