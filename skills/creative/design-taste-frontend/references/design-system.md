# A coherent visual system

## Product fit

Write audience, primary task, use environment and approved visual constraints.
A desktop app can use one well-tuned system sans; a brand page may justify a
more characteristic display face. Never change the whole product's type for
one component.

## Token table

Record semantic roles and actual values:

| Family | Roles |
|---|---|
| Color | canvas, panel, raised surface, primary/muted text, border, accent, state |
| Type | body, label, caption, section heading, display, code/numbers |
| Space | inline gap, control inset, group gap, section gap, page inset |
| Shape | control, menu, card, large panel, full pill where justified |
| Motion | immediate feedback, reveal, pane transition, reduced motion |

Do not introduce one-off values where an existing token fits. Keep readable
contrast and distinct selected/focus/error states.

## Composition

Use shared left/right edges and deliberate group spacing. Align pane headers,
row baselines and divider endpoints. Data surfaces can be dense; prose needs
measure. For marketing, let each section explain one meaningful idea, but let
content determine its height on narrow screens.

## Components

Specify default, hover, focus, pressed/selected, disabled, loading, error and
empty where applicable. Measure icon optical weight, not only bounding box.
Keep menus outside clipping ancestors and preserve accessible hit areas.
Avoid nested cards and duplicate entry points unless each has a task reason.

## Responsive continuity

Collapse/reorder navigation and panes before making text too small. Keep the
same action vocabulary across sizes. Verify long names and translations,
zoom, keyboard focus and overlay scroll behavior.
