---
name: skill-creator
description: Create focused reusable skills with bundled resources.
version: 1.0.0
author: OpenAI, Aino contributors
license: Apache-2.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [skill-creator, software-development]
    category: software-development
    related_skills: [skill-installer]
---

# Skill Creator Skill

Create and improve skills that teach Aino useful workflows through its existing skill system. Preserve user intent and keep non-obvious operational knowledge close to the resources that implement it.

## When to Use

Use when the user asks to build, adapt, or improve a skill, or to save a reusable workflow learned during authorized work.

## Prerequisites

- For installed profile skills: `skills_list`, `skill_view`, and `skill_manage` available in this session.
- For repository-bundled contributions: native `read_file`, `write_file`, `patch`, and `terminal`, plus the repository's authoring rules.
- Inspect an existing relevant skill first and the repository's `skills/AGENTS.md` when contributing bundled skills.
- Preserve profile-scoped storage and configured skill roots; never hardcode a home directory.

## How to Run

For a skill installed in the current profile, use `skill_manage`'s advertised `operations` array. The result and `skill_view` reveal its installed directory and authoring warnings.

For a contribution to an application's built-in skill bundle, edit the explicitly requested repository directory with native file tools and run its authoring checks. Do not write a profile-local copy in place of the requested repository change.

## Quick Reference

```text
skill_manage(operations=[{
  "action": "create", "name": "my-workflow", "category": "productivity",
  "content": "<complete YAML frontmatter and Markdown>"
}])
skill_manage(operations=[{
  "action": "write_file", "name": "my-workflow",
  "file_path": "references/details.md", "file_content": "<reference>"
}])
skill_view(name="my-workflow")
```

Required frontmatter: name, concise sentence description (at most 60 characters), version, human/project author, license, supported platforms, `metadata.hermes` tags/category/related_skills.

## Procedure

1. Identify the repeated task and useful decision rules. Avoid generic instructions that the model already knows and universal mandatory workflows unrelated to the task.
2. Search existing skills to extend before creating a duplicate. Distinguish skills (instructions/resources) from tools (runtime capabilities).
3. Write an accurate trigger description and sections: When to Use, Prerequisites, How to Run, Quick Reference, Procedure, Pitfalls, Verification.
4. Name real Aino tools or explicitly configured MCP services. Platform-gate genuinely host-specific behavior and explain external dependencies without pretending to ship them.
5. Put substantial reusable logic into scripts and detailed material into references; include the necessary license/attribution and working relative links. Do not copy proprietary runtime assets.
6. Create or patch in the correct target: `skill_manage` for the owning profile, native file tools for a repository contribution. Respect existing write-approval policy and read before replacing; a content-only `skill_manage` patch replaces the whole skill.
7. Exercise a realistic request using the skill in an isolated workspace. For complex workflows use an independent delegate when available and appropriate, with actual inputs rather than the intended answer.
8. Iterate on observed failures. Verify discovery and references, then explain how to invoke it in the next/refreshed session without mutating cached conversation prompts.

## Pitfalls

- A named skill cannot call tools that the runtime does not have.
- Do not add duplicate helper managers, unnecessary scripts, or broad setup side effects.
- Do not read/write another Bot's profile as an implicit shortcut.
- Avoid storing credentials, transient task progress, or user-private artifacts as reusable skill content.

## Verification

For installed skills, read the entry and referenced resources with `skill_view`. For repository contributions, run the supported authoring and bundle-discovery checks before claiming installation. Confirm supported platform gating, helper behavior, and a realistic task without hidden host paths.

## Attribution

Adapted from the OpenAI Apache-2.0 skill-creator; schema and paths use Aino's existing skill runtime.
