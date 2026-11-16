---
name: openai-platform-api-key
description: Configure OpenAI credentials without exposing secrets.
version: 1.0.0
author: Aino contributors
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [openai-platform-api-key, software-development]
    category: software-development
    related_skills: [openai-docs]
---

# OpenAI Platform API Key Skill

Connect an authorized OpenAI integration to credentials stored locally. This Aino-native workflow uses the existing provider setup; it does not include Codex's private key picker or create credentials without user action.

## When to Use

Use when OpenAI API authentication is missing, configuring a first integration, or fixing an explicitly scoped credential destination.

## Prerequisites

- The user owns or is authorized to use the relevant OpenAI project.
- Access to Aino provider settings or the application's documented secret store.
- Read the project's configuration instructions and `.env.example` names without printing actual secret files.

## How to Run

Use `openai-docs` to verify official setup guidance. If a key must be created, guide the user to https://platform.openai.com/api-keys and let them enter it directly into Aino settings or the intended local secret store.

## Quick Reference

| Destination | Guidance |
| --- | --- |
| Aino provider | Existing model/provider settings |
| Project backend | Existing secret store or ignored local env file |
| Browser frontend | Never embed a private API key |
| CI | Repository/environment secret store |

An Aino account/device key is not an OpenAI API key.

## Procedure

1. Identify the actual provider and failed authentication layer before requesting a new credential. Check endpoint/model/project names without exposing key values.
2. Reuse a working configured provider when that matches the task. Do not require OpenAI keys for Aino built-in models or unrelated providers.
3. Establish the exact local destination from the existing configuration contract. Preserve existing secrets and file permissions.
4. Let the user create/paste the credential into the relevant secure UI or local environment. Do not ask them to transmit it in chat.
5. Validate presence without echoing the value. Run a minimal authorized request only when live testing is in scope, avoiding unnecessary cost.
6. Check ignored/untracked status of local secret files and redact error details before reporting.

## Pitfalls

- Never put secrets into source, skill content, generated docs, screenshots, URLs, or shell arguments.
- Do not create an account, accept terms, or change project billing as part of routine local setup.
- Redact Authorization values and connection strings in logs.
- A permission/quota/model error may require configuration changes rather than another key.

## Verification

Confirm the intended integration loads the secret from its documented location and, if tested live, authentication succeeds. Report only provider, destination, and result; never the credential.
