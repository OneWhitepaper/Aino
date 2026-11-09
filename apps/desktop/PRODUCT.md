# Aino Desktop

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Aino users working in a desktop Electron app. Group conversations let users coordinate several configured agents without needing their protocol identifiers.

## Product Purpose

Aino provides ordinary conversations, persistent agent chats, group conversations, files and tool panels, models, account services and settings. Existing functionality must survive visual redesigns.

## Operating Context

The desktop runs with local or remote Hermes gateways. Sessions, profiles and group rooms are source-bound. The renderer presents server-owned facts; live execution depends on the connected service.

## Capabilities and Constraints

Groups support mentions, attachments, search, member information, rename, approvals, stop, and exact retry. Legacy groups retain member management and room settings. Friendly names may change; frozen handles remain authoritative for delivery. Never infer identity from matching names.

## Brand Commitments

Keep Aino naming, bot portraits and desktop icons. The user requested familiar Codex/ChatGPT desktop navigation and WeChat-like group interaction, and explicitly allowed replacing the rejected group page style. Chinese copy describes user actions; identifiers belong in technical details.

## Evidence on Hand

User screenshots and confirmed requirements to retain all existing features. Component fixtures are synthetic and never prove successful model execution.

## Product Principles

- Identify members by names and portraits, while keeping delivery exact.
- Retain drafts and context when changing views.
- State failures honestly and retain recovery actions.
- Keep account, connection, profile and room boundaries intact.
