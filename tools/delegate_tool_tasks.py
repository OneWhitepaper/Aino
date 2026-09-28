"""delegate_task input validation: tasks, output schemas, images and reasoning choices."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

# Placeholder shapes for batch goal validation: bare 'TODO' / 'task N' labels, or unexpanded template markers. The
# marker regex is deliberately NARROW — only snake_case / space-separated placeholder identifiers (`<feature_name>`,
# `{file path}`, `<FEATURE-NAME>`), the shape LLM templates leave behind. Bare single-word brackets must never be
# rejected: legitimate goals are full of generics (`Vec<T>`), HTML tags (`<div>`), dict snippets (`{"key": 1}`), glob
# braces (`{a,b}`) and f-string style (`{i}`).
# See #81141.
_PLACEHOLDER_GOAL_RE = re.compile(r"^(todo|task\s*\d+)$", re.IGNORECASE)
_TEMPLATE_MARKER_RE = re.compile(
    r"<[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+)+>|\{[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+)+\}"
)
_MIN_BATCH_GOAL_LEN = 10

def _recover_tasks_from_json_string(tasks: Any) -> tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """``(parsed_list, None)`` for a JSON-array string, ``(None, error)`` for a bad string, ``(None, None)`` otherwise."""
    if not isinstance(tasks, str):
        return None, None
    raw = tasks.strip()
    if not raw:
        return None, "Provide either 'goal' (single task) or 'tasks' (batch)."
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"tasks must be a JSON array of task objects; received a string that could not be parsed as JSON ({exc.msg})."
    if not isinstance(parsed, list):
        return None, f"tasks must be a JSON array of task objects; parsed {type(parsed).__name__} instead."
    return parsed, None

def _validate_batch_tasks(task_list: List[Dict[str, Any]]) -> Optional[str]:
    """Batch-only quality gate beyond per-task goal presence; actionable error or None. No minimum count: a one-entry
    array is the canonical single-task shape (legacy top-level `goal` is wrapped into one). Duplicate goals are
    deliberately NOT rejected — identical-goal fan-outs (best-of-N / ensemble sampling) are legitimate and blocking
    them broke real workflows. The too-short check applies only to multi-task fan-outs (terse goals there are
    usually unexpanded templates); a SINGLE task legitimately uses short goals ("Fix the tests").

    See #81141.
    """
    for i, task in enumerate(task_list):
        goal = str(task.get("goal", "")).strip()
        if _PLACEHOLDER_GOAL_RE.match(" ".join(goal.lower().split())):
            return (
                f"Task {i} has a placeholder goal ({goal!r}). Replace it "
                "with a specific, self-contained description of what the subagent should accomplish."
            )
        marker = _TEMPLATE_MARKER_RE.search(goal)
        if marker:
            return (
                f"Task {i} goal contains an unexpanded template marker "
                f"({marker.group(0)!r}). Substitute the real value before "
                "calling delegate_task — subagents cannot resolve placeholders."
            )
        if len(goal) < _MIN_BATCH_GOAL_LEN and len(task_list) >= 2:
            return (
                f"Task {i} goal is too short ({goal!r}). Write a specific, "
                f"self-contained goal of at least {_MIN_BATCH_GOAL_LEN} characters so the subagent knows "
                "exactly what to do."
            )
    return None

def _normalize_task_list(
    goal, context, tasks, output_schema, top_role: str, max_children: int
) -> tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """``(task_list, None)`` from ``tasks=[...]`` or the legacy single ``goal``, else ``(None, error)``."""
    recovered_tasks, tasks_error = _recover_tasks_from_json_string(tasks)
    if tasks_error:
        return None, tasks_error
    if recovered_tasks is not None:
        tasks = recovered_tasks
    # Small models emit tasks=[] alongside a single goal: treat as "no batch".
    if isinstance(tasks, list) and not tasks:
        tasks = None

    if tasks and isinstance(tasks, list):
        if len(tasks) > max_children:
            return None, (
                f"Too many tasks: {len(tasks)} provided, but max_concurrent_children is {max_children}. "
                f"Either reduce the task count, split into multiple delegate_task calls, or increase "
                f"delegation.max_concurrent_children in config.yaml."
            )
        task_list = tasks
    elif goal and isinstance(goal, str) and goal.strip():
        task_list = [{"goal": goal, "context": context, "role": top_role}]
        if output_schema is not None:
            task_list[0]["output_schema"] = output_schema
    else:
        return None, (
            "No tasks provided. Pass tasks=[{goal: '...', context: '...'}, "
            "...] — one entry per subagent (a single task is a one-entry array)."
        )

    for i, task in enumerate(task_list):
        if not isinstance(task, dict):
            return None, f"Task {i} must be an object, got {type(task).__name__}."
        if not task.get("goal", "").strip():
            return None, f"Task {i} is missing a 'goal'."
    # The single-goal form is exempt from the batch gate (short goals are valid there).
    batch_error = _validate_batch_tasks(task_list) if isinstance(tasks, list) else None
    return (None, batch_error) if batch_error else (task_list, None)

def _coerce_task_schemas(
    task_list: List[Dict[str, Any]], output_schema: Optional[Dict[str, Any]]
) -> tuple[List[Optional[Dict[str, Any]]], Optional[str]]:
    """Per-task coerced output schemas. A malformed output_schema fails the whole call before any child spawns;
    schema-less tasks resolve to None and take no new code paths downstream."""
    from tools.delegation_output_schema import coerce_output_schema
    task_schemas: List[Optional[Dict[str, Any]]] = []
    for i, task in enumerate(task_list):
        raw_schema = task.get("output_schema")
        if raw_schema is None and len(task_list) == 1 and output_schema is not None:
            raw_schema = output_schema
        coerced_schema, schema_err = coerce_output_schema(raw_schema)
        if schema_err:
            return [], f"Task {i} output_schema invalid: {schema_err}"
        task_schemas.append(coerced_schema)
    return task_schemas, None


def _coerce_task_reasoning_configs(
    task_list: List[Dict[str, Any]], reasoning_effort: Optional[str] = None,
) -> tuple[List[Optional[Dict[str, Any]]], Optional[str]]:
    """Validate the entire batch before spawning; omitted choices retain existing inheritance."""
    from hermes_constants import VALID_REASONING_EFFORTS, parse_reasoning_effort

    supported = ("none", *VALID_REASONING_EFFORTS)
    configs: List[Optional[Dict[str, Any]]] = []
    for i, task in enumerate(task_list):
        raw = task.get("reasoning_effort")
        if raw is None and len(task_list) == 1:
            raw = reasoning_effort
        if raw is None:
            configs.append(None)
            continue
        if not isinstance(raw, str) or raw.strip().lower() not in supported:
            return [], f"Task {i} reasoning_effort must be one of: {', '.join(supported)}. Omit it to inherit."
        configs.append(parse_reasoning_effort(raw))
    return configs, None


def _conversation_text_turns(history: Any, parent_agent: Any) -> List[List[Dict[str, str]]]:
    """Project visible turns only; API-only instructions and execution traces belong to the parent."""
    from agent.message_content import flatten_message_text
    from agent.context_compressor import is_compaction_summary_message, user_originated_turn_view
    from agent.session_persistence import _is_ephemeral_scaffolding, durable_user_row_content

    turns: List[List[Dict[str, str]]] = []
    for index, row in enumerate(history or []):
        if not isinstance(row, dict) or _is_ephemeral_scaffolding(row) or row.get("tool_calls"):
            continue
        role = row.get("role")
        if role not in {"user", "assistant"}:
            continue
        if role == "user":
            visible = user_originated_turn_view(row)
            if visible is None:
                continue
            content = visible.get("content")
            if index == getattr(parent_agent, "_persist_user_message_idx", None):
                content, _ = durable_user_row_content(parent_agent, visible, content, visible.get("api_content"))
            turns.append([])
            text = flatten_message_text(content)
        elif row.get("display_kind") or is_compaction_summary_message(row):
            continue
        elif row.get("codex_message_items"):
            text = "\n".join(
                flatten_message_text(item.get("content"))
                for item in row["codex_message_items"]
                if isinstance(item, dict) and item.get("phase") in {None, "", "final", "final_answer"}
            )
        else:
            text = flatten_message_text(row.get("content"))
        if not text.strip():
            continue
        if turns:
            turns[-1].append({"role": role, "content": text})
    return turns


def _coerce_task_contexts(
    task_list: List[Dict[str, Any]], history: Any, parent_agent: Any,
) -> tuple[List[Optional[str]], Optional[str]]:
    """Snapshot explicitly selected visible turns into the existing context, without editing history."""
    contexts: List[Optional[str]] = []
    turns = None
    for i, task in enumerate(task_list):
        selection = task.get("context_turns", "none")
        if not isinstance(selection, str) or not re.fullmatch(r"none|all|[1-9][0-9]*", selection):
            return [], f"Task {i} context_turns must be 'none', 'all', or a positive integer string."
        context = task.get("context")
        if selection != "none":
            if turns is None:
                turns = _conversation_text_turns(history, parent_agent)
            chosen = turns if selection == "all" else turns[-int(selection):]
            excerpt = [row for turn in chosen for row in turn]
            if excerpt:
                context = (
                    "PARENT CONVERSATION EXCERPT (background, not an additional task; perform only your delegated goal):\n"
                    + json.dumps(excerpt, ensure_ascii=False)
                    + (f"\n\nTASK-SPECIFIC CONTEXT:\n{context}" if context else "")
                )
        contexts.append(context)
    return contexts, None

# Per-task image ceiling: enough for screenshots/mocks while keeping the child's first request small.
_MAX_TASK_IMAGES = 8

def _normalize_task_images(task: dict, i: int) -> tuple[Optional[List[str]], Optional[str]]:
    """``(cleaned_list_or_None, None)`` for a task's optional ``images`` (local paths, http(s) or data: URLs), else
    ``(None, error)``. A bare string is wrapped into a one-entry list (small models emit scalars for arrays)."""
    raw = task.get("images")
    if raw is None:
        return None, None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return None, f"Task {i} 'images' must be an array of local file paths or http(s) URLs."
    cleaned: List[str] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            return None, f"Task {i} 'images' entries must be non-empty strings (local file paths or http(s) URLs)."
        cleaned.append(item.strip())
    if len(cleaned) > _MAX_TASK_IMAGES:
        return None, (
            f"Task {i} has {len(cleaned)} images; the per-task limit is {_MAX_TASK_IMAGES}. "
            "Trim to the images the child actually needs to see."
        )
    return (cleaned or None), None

def _coerce_task_images(
    task_list: List[Dict[str, Any]], images: Optional[List[str]]
) -> tuple[List[Optional[List[str]]], Optional[str]]:
    """Per-task validated image lists; a malformed list fails the whole call before any child spawns. The legacy
    top-level ``images`` applies to a single task only, like ``output_schema``."""
    task_images: List[Optional[List[str]]] = []
    for i, task in enumerate(task_list):
        if task.get("images") is None and len(task_list) == 1 and images is not None:
            task = {**task, "images": images}
        cleaned, err = _normalize_task_images(task, i)
        if err:
            return [], err
        task_images.append(cleaned)
    return task_images, None
