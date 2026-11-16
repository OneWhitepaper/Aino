---
title: "Brainstorming — Turn a product idea into a workable, scoped design"
sidebar_label: "Brainstorming"
description: "Turn a product idea into a workable, scoped design"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Brainstorming

Turn a product idea into a workable, scoped design.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/software-development/brainstorming` |
| Version | `1.0.0` |
| Author | Jesse Vincent (@obra); Aino contributors (Hermes Agent adaptation) |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `design`, `requirements`, `architecture`, `product` |
| Related skills | [`writing-plans`](../../bundled/software-development/software-development-writing-plans.md), [`executing-plans`](../../bundled/software-development/software-development-executing-plans.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Brainstorming Skill

Develop a design from the real product, its constraints, and the user's
intended outcome. Resolve decisions that materially affect implementation
while preserving any design or scope the user already approved.

## When to Use

- A new capability has unresolved product or architecture choices.
- A redesign needs coherent navigation, behavior, and acceptance criteria.
- Several plausible approaches have different compatibility or cost tradeoffs.

For a bounded bug with a clear expected result, investigate and fix it
without forcing the user through a new design process.

## Prerequisites

- The request, existing decisions, and affected repository instructions.
- Current product behavior, relevant code, screenshots, and design assets.
- `read_file`, `search_files`, and `terminal` for evidence gathering.
- Available browser or preview tools for interactive designs when useful.

## How to Run

1. Inspect how the system works now and state the actual design problem.
2. Clarify missing decisions that change the outcome.
3. Compare viable approaches, then recommend a concrete design.
4. Make the design reviewable and define how it will be accepted.

## Quick Reference

| Scope | Useful output |
| --- | --- |
| Small interaction change | Behavior description and direct preview |
| Feature crossing several components | Design, interfaces, acceptance criteria |
| Architectural uncertainty | Bounded investigation and measured tradeoffs |
| Independent large subsystems | Separate designs with integration contracts |

## Procedure

### Understand the existing system

Inspect actual entry points, state ownership, extension points, and tests.
Use the running product when possible. Verify that the proposed problem
exists and identify functionality that must survive the change.

Look for established components and reusable APIs before proposing another
manager, store, protocol, or service. Read prior decisions and the history
of affected behavior so an intentional constraint is not casually removed.

Separate facts, assumptions, and open questions. A screenshot establishes
visible structure; it does not establish every hidden interaction or backend
contract.

### Resolve the decisions that matter

Ask about missing outcomes, constraints, or preferences only when the
answer changes the design. Prefer one focused question or a small coherent
set. Continue independent investigation while waiting for needed answers.

Use known product conventions and engineering judgment for routine choices.
State reasonable assumptions where they matter. Do not repeatedly ask the
user to approve work they already authorized.

If uncertain about feasibility, perform a bounded spike with a clear
question, time/effort limit, and discardable artifact. Use the result to
choose the design instead of treating the spike as production code.

### Compare viable approaches

Present alternatives only when they are meaningfully different. Compare
user workflow, compatibility, implementation complexity, runtime cost,
maintenance, and recovery. Recommend one and explain its decisive tradeoff.

Keep scope small enough to implement and verify. If independent subsystems
need different owners or acceptance criteria, split them while defining
their shared contracts.

### Make the design concrete

Describe the user's entry point, main flow, state changes, and exit.
Cover affected empty, loading, error, cancellation, and recovery behavior.
For UI work, map every visible control to a real action or clearly mark a
prototype-only interaction.

Specify ownership, interfaces, persistence, lifecycle, and migration where
they are relevant. Preserve accessibility, existing permissions, and user
data. Explain how the design fits the current architecture and visual style.

Provide an interactive preview when interaction or layout is the decision
being made. Use available preview tools; do not invent a host API or launch
an unnecessary companion service.

### Close the design loop

Check the design against each requirement and record material assumptions
or unresolved decisions. Save it in the repository's documented location
when the scope needs a durable artifact.

If implementation is already authorized and decisions are settled, proceed
to `writing-plans` or the bounded change. If the user asked only to review a
proposal, present the concrete design before implementing it.

## Pitfalls

- Designing from a generic template before inspecting the real application.
- Replacing accepted layout or behavior during an unrelated improvement.
- Asking for repeated approval of already accepted decisions.
- Comparing options that differ only in wording.
- Deferring failure handling until implementation without an ownership model.
- Growing a small interaction into a platform rewrite.

## Verification

Each requested behavior has a place in the design and an observable
acceptance condition. Check that proposed APIs exist or are explicitly part
of the change, existing functions remain reachable, and unresolved decisions
are visible before dependent implementation begins.

Adapted from [Superpowers](https://github.com/obra/superpowers/tree/main/skills/brainstorming).
The upstream MIT notice is included in `LICENSE`.
