---
sidebar_position: 4
title: Conversations with several agents
---

# Conversations with several agents

Aino's ordinary conversations let you ask several agents for help in one chat.
Choose an agent beside the message box, or use the agent picker opened by `@`.
Clear the selection to return to the general assistant. Earlier messages stay in
place, with the author and the model used for each answer.

Projects organize your files and work. Agents supply their own instructions,
model, skills, tools, permissions and memory. Selecting an agent does not move the
project or replace the chat history. An agent receives the public conversation
needed for its turn; another agent's private memory, tool trace and hidden
instructions are not copied into that history.

Use **Agent Hub** to create and configure agents, open their private chats and
manage expert groups. Private Bot Chats and groups retain their existing behavior.
CLI and messaging Profile selection also keeps its existing meaning.

## Working in a conversation

You can choose the next responder and prepare a draft while an answer is running.
Send it when the current turn finishes. Stopping a running answer stops its actual
agent; choosing the next responder does not retarget that control. Agents may
still delegate work to subagents when their own tools and settings permit it.

A model or configuration change starts a fresh private execution context for
that agent. Earlier public answers retain their original authors and model
labels. Reasoning and fast controls appear only when the selected provider can
confirm support.

Editing a submitted message creates a branch and sends the edited message there.
The original history stays intact. Branching copies the selected public prefix;
regenerating adds a new response. If an edited branch cannot send, its draft can
be retried or cancelled. Reactions are saved separately from the message body.

Dictation and voice input use the selected agent's voice settings. Spoken replies
use the replying agent's settings even if you have chosen another agent for the
next message. Changing the input agent ends its old recording so the transcript
cannot land in a different agent's draft. End an active voice conversation before
selecting another agent. Voice availability still depends on your microphone,
provider configuration and backend capabilities.

## Existing chats and archives

Old ordinary chats remain readable. **Continue as conversation** explicitly
imports their visible messages into a new conversation after existing work has
settled. Hidden messages, reasoning and tool traces stay private. The old chat is
preserved for reading and export, and its old desktop link leads to the imported
conversation. Future turns use the new conversation so there are not two writers
for the same history. A failed import can be resumed.

Rename and archive use the original session menu. Archived conversations remain
readable and exportable. Storage limits refuse new work before accepting it;
they do not silently remove old messages or truncate answers. Export produces a
public conversation package including complete referenced content and attachments.
It does not export an agent's private memory or credentials.

## Backups and compatibility

A conversation backup includes the shared records and their required Profile
sessions, receipts and attachments as one verified recovery set. Restore validates
that set before replacement. Interrupted work may require an explicit Stop after
restore; old execution leases and grants do not resume automatically.

The desktop checks backend support before using the new workflow. Older backends
retain their original ordinary chats. Every running backend that owns the same
installation must support conversation purposes before new managed work is
admitted. Keep a compatible backend when disabling the new UI so new history can
still be read and exported. Arbitrarily downgrading a live installation to an old
binary is not supported.

Supported backends use this workflow for new ordinary chats by default. Set
`conversations.enabled: false` in the installation's root `config.yaml` to retain
the original new-chat flow; existing conversation history remains readable and
exportable. Availability is checked by the backend, including the General
assistant's execution environment. Unsupported environments retain the original
ordinary chat. This page does not expand support to operating systems or remote
execution environments that have not passed acceptance.
