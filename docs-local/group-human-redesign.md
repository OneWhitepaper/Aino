# Human-readable group conversations

Mode: Operate. Scope: group conversation, mentions, information panel, creation and legacy siblings. The non-group application system is outside this visual replacement.

## Direction contract

THESIS: A conversation among named agents, not a runtime log. The first decision is who to ask; protocol identifiers never lead routine interactions.

OWN-WORLD: Familiar desktop conversation conventions requested in the session: white reading surface, cool neutral utility areas, dark readable labels, restrained Aino accent, existing portraits, one compact header and a centered transcript/composer column. No duplicate navigation or nested diagnostic cards.

STORY: Find a group, read who said what, choose a person by face and name, type naturally, send to the exact original member. Members, files and management are distinct views of one information panel.

FIRST VIEWPORT: Single shell group title; a 54px-minimum toolbar with named participant chips and search/info actions. Messages share a 1120px maximum column with 40px desktop gutters and a compact composer; the footer reflects actual mentions. A 320px info panel separates Members/Files/Manage. Gutters adapt to the actual chat container: 48px at 1400px and above, 24px at 960px and below, 16px at 480px and below. Failures become compact expandable events.

FORM: Code-led familiar desktop chat. User pinned Codex/ChatGPT and WeChat conventions in the session; no further concept choice is needed. seed: none (unavailable). Signature: selecting a face and name using @ while keeping an immutable delivery token behind the displayed name.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavioral constraints

Do not change send journals, retry bytes, source/profile/room routing or backend protocol. Unknown handles remain unguessed. Preserve attachments, approvals, exact retries, legacy settings and member management. Do not call a generic desktop actor this user without authoritative identity. Never restart the user's gateway for appearance checks.

## User evidence

/var/folders/d8/tb_9ybdj5xzg_l5451f5209c0000gn/T/codex-clipboard-06be3d6f-7119-4ae2-93f1-efbb999a6a41.png


## Implemented contract

The scoped [DESIGN.md](group-human-redesign/DESIGN.md) and its
[Impeccable sidecar](group-human-redesign/.impeccable/design.json) record the
implemented group tokens and patterns. Non-group application contracts remain
in `apps/desktop/DESIGN.md`.

- One main shell title, 54px-minimum participant toolbar, 1120px reading/composer
  column, 320px information panel with Members, Files and Manage; existing
  Dialog below 1100px workspace width.
- Readable mentions preserve exact frozen addresses in the owning draft and
  requests. No display-name lookup or arbitrary source substitution.
- Validated same-room/source clipboard metadata preserves bindings; foreign or
  invalid metadata neutralizes @ and asks the user to select recipients again.
  Fresh unresolved mentions cannot silently broadcast. The recipient summary
  mirrors the authoritative runtime parser, with explicit duplicate-name counts.
- Reply progress uses actual queued state and committed matching messages;
  missing state and cumulative totals never become fictional completion counts.
- Canonical/legacy sources, journals, threads, attachment manifests, approvals,
  discard confirmations and exact retries keep their existing authority.
