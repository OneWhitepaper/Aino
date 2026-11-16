---
name: Aino Group Conversations
description: Readable people, precise recipients, and a calm desktop conversation.
colors:
  reading-surface: "var(--ui-bg-elevated)"
  member-bubble: "var(--ui-bg-secondary)"
  human-bubble: "var(--ui-chat-bubble-background)"
  ink: "var(--ui-text-primary)"
  supporting-ink: "var(--ui-text-secondary)"
  action: "var(--aino-action-bg)"
  action-ink: "var(--aino-action-fg)"
  accent: "var(--ui-accent)"
  divider: "var(--ui-stroke-tertiary)"
typography:
  body:
    fontFamily: "var(--dt-font-sans)"
    fontSize: "0.875rem"
    lineHeight: 1.75
  label:
    fontFamily: "var(--dt-font-sans)"
    fontSize: "0.8125rem"
    fontWeight: 500
  caption:
    fontFamily: "var(--dt-font-sans)"
    fontSize: "0.75rem"
  standalone-title:
    fontFamily: "var(--dt-font-sans)"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  bubble: "12px"
  composer: "16px"
  mention-row: "8px"
  shared-control: "0.375rem"
spacing:
  message-gap: "12px"
  message-separation: "28px"
  gutter-wide: "48px"
  gutter-desktop: "40px"
  gutter-compact: "24px"
  gutter-small: "16px"
components:
  message-bubble:
    backgroundColor: "{colors.member-bubble}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.bubble}"
    padding: "12px 16px"
  human-message-bubble:
    backgroundColor: "{colors.human-bubble}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
  composer:
    backgroundColor: "{colors.reading-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "16px 18px 12px"
  mention-option:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.mention-row}"
    padding: "9px 10px"
    height: "54px"
  participant-toolbar:
    backgroundColor: "{colors.reading-surface}"
    padding: "8px 28px"
    height: "54px"
  information-panel:
    backgroundColor: "{colors.reading-surface}"
    textColor: "{colors.ink}"
    width: "320px"
---

# Design System: Aino Group Conversations

## Overview

**Creative North Star: "A conversation among named agents"**

This contract covers group conversation, mentions, information, creation and
legacy group siblings. It replaces the former group layout without changing the
rest of the desktop system. A reader identifies a person by portrait and name,
understands who will receive a message, and finds optional management without
leaving the conversation.

**Key Characteristics:**

- One shell title and a compact participant toolbar.
- A centered reading column shared with the composer.
- Familiar message bubbles, existing portraits and restrained semantic color.
- Readable names backed by exact, source-bound delivery identities.

Implementation authority: `apps/desktop/src/plugins/hermes-bots/canonical-group.css`,
shared `apps/desktop/src/styles/aino-theme.css`, and existing SDK primitives.
The parent desktop contract remains `apps/desktop/DESIGN.md`. Tokens above
reference live theme roles; no group-specific palette or font family is created.

## Colors

The reading surface and information panel use the elevated theme surface.
Member and human bubbles use their separate existing background roles. Primary
text, supporting text, dividers, accent, warning and destructive states all use
shared semantic variables; Light/Dark/System remain the palette authority.

**The Identity Rule.** Names and existing portraits identify people; background
color does not encode a new member identity or delivery route.

## Typography

Body, labels and metadata use the shared sans family. Body remains 14px with
1.75 line height, labels 13px and metadata 12px. The standalone/fallback title is
15px at weight 600; a main group does not repeat this title inside its content.
Messages are limited to 66ch, with wrapping for names, prose and diagnostics.
Code remains code and can scroll horizontally within the message.

## Layout

Messages and composer share a 1120px maximum column. Chat-container gutters are
40px by default, 48px at 1400px and above, 24px at 960px and below, and 16px at
480px and below. These are container breakpoints, not window guesses.

The main participant toolbar has a 54px minimum height; the standalone header
retains its title and Back. Participant buttons reduce their visible count in
narrow containers while the full member list stays available in information.
The 320px information panel sits beside workspaces at least 1100px wide. Below
that width, the existing Dialog provides Escape, focus return and a scrollable
information body. Members, Files and Manage are tabs of one panel.

Messages use a 12px avatar gap and 28px separation. Avatars are the existing
32px portraits; the reply strip uses 24px. The picker uses 30px portraits and
54px-minimum rows on a surface clamped to 340px or viewport minus 32px.

## Elevation & Depth

The conversation is flat; dividers and tonal surfaces establish structure.
The mention picker reuses the portal Popover and its existing `shadow-nous`;
there is no new group shadow scale. Failures are compact expandable events,
with details revealed in place rather than repeated large diagnostic cards.
Hover action visibility uses the existing 100ms opacity transition and respects
reduced motion. Keyboard focus uses a 2px accent outline with a 3px offset.

## Shapes

Message bubbles have 12px corners, the composer 16px, and picker rows 8px.
Controls retain the shared Button radius and size API. The composer has a shared
stroke; focus changes its border color without changing geometry. Existing
portraits retain their configured shapes and images.

## Components

**Mentions.** The picker shows portrait, readable name, optional source detail,
and one All members choice. It searches both names and handles, supports keyboard
selection and IME, and anchors through the existing portal Popover. The native
textarea displays projected names while its owning draft stores exact frozen
addresses. Same-name recipients remain distinct; no display-name reverse lookup
is permitted.

**Clipboard.** Plain text exported to other applications contains readable
names. Complete selected mentions also carry private source-and-room-scoped
metadata. Only validated same-scope metadata with still-seated addresses restores
bindings; renaming preserves identity. Foreign, removed or malformed metadata
neutralizes ASCII @ and prompts reselection. Partial selections do not gain a
binding. Existing attachment paste ownership remains unchanged.

**Recipient summary and sending.** Fresh unresolved recipient-looking names
cannot silently become a broadcast. The footer follows the authoritative
runtime parser over raw text, including its existing code/email handling.
Repeated display names show explicit counts while exact handles remain separate.
The original send journal, retry bytes and pending-send recovery remain owners.

**History.** Readable mention decoration and search preserve the stored message.
History copying, code, links, attachments and retry payloads retain original
content. Historical human labels are not replaced with the current user without
authoritative identity.
Member reply headers, notices and search use the current readable name from the
same connection and profile as that room's seated member, matching the toolbar,
mention picker and reply status. A historical actor's label cannot override the
current name, including when the runtime recorded an encoded profile ID as its
display name. Departed members retain a genuine recorded name when available;
an address-only actor uses the generic member label, with its ID confined to
technical details. Display names never change delivery identities or log data.

**Reply process.** The strip above the composer shows the responding member,
actual queued activity and Stop this round. Stopping disables duplicate stop.
Each active member's label follows the current task's runtime activity: thinking,
reading, editing, searching, running commands, browsing, generating images or
generating a reply. Missing or unknown activity remains generic Working;
approval, queue and stop states take priority. These are category labels, with
no command, path, tool arguments or private reasoning content. Activity never
simulates streamed text or changes message delivery. Visible active rooms poll
lightweight status more frequently; unchanged log cursors retain the transcript
instead of loading it again. Terminal tasks retire their activity.
Completed replies require a matching committed member message and settlement in
the same room, discussion and thread. Ambiguous concurrent discussions omit the
count; cumulative totals or missing state cannot imply completion.

**Conversation model changes.** A model request addressed to a robot selects
only that member's current conversation in that room. The agent queries the
desktop's actual available Aino account catalog and authenticated configured
providers through the existing model command. Matching Aino built-ins take
priority; ambiguous matches return candidates rather than inventing a route.
Selection takes effect at the next message through the existing native model
binding. The in-flight turn, profile default, private Bot Chat, other rooms and
other members retain their own routes. The desired selection survives restart
and compression in the same conversation; a new independent conversation does
not inherit it. Native credential binding and account isolation remain the
authority, and metadata queries never return keys.

**Information and creation.** Members offers person actions; Files owns shared
files; Manage contains rename, identifiers and disband. Creation uses the same
readable member choices. Existing SDK Button, Tabs, Dialog, Popover and attachment
components own their behavior; this document does not introduce alternatives.

## Do's and Don'ts

- Do show the person before a protocol address.
- Do preserve exact source, room and recipient authority behind readable names.
- Do keep transcript and composer on the same content axis at every container width.
- Do keep states, counts and historical attribution grounded in recorded facts.
- Don't repeat the main group title or restore a horizontal row of conversations.
- Don't guess a recipient from a display name, including after paste or rename.
- Don't label missing activity as successful completion or invent streamed text.
- Don't replace journal, attachment, approval or retry owners during UI work.
