#!/usr/bin/env python3
"""Convergence metrics for a saved Ultra-delegation acceptance run.

Why this exists
---------------
The whole-task question is not "did the model do work" but "did the parent DELIVER inside
the whole-task budget". A saved ``report.json`` answers that with a handful of numbers that
are easy to misread by hand (the parent's own budget is not ``limits.approx_cumulative_input``
— that cap covers parent and children together). This prints them in one block so a later
holder can compare runs without re-deriving the arithmetic.

Read-only: it opens the report and prints JSON. It never runs a model, imports production
modules, or writes anything.

Usage
-----
    python3 evals/ultra_delegation/convergence.py /path/to/run/report.json [more.json ...]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Same token accounting the harness observer applies: every request the parent AND its
# children issue counts against the one cumulative figure.
APPROX_INPUT_FIELD = "approx_input_tokens"


def _group_requests(report: dict) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    """Requests (and their responses) bucketed per session, in issue order."""
    requests: dict[str, list[dict]] = {}
    responses: dict[str, list[dict]] = {}
    for req in report.get("requests") or []:
        if isinstance(req, dict):
            requests.setdefault(str(req.get("session_id") or "?"), []).append(req)
    for resp in report.get("responses") or []:
        if isinstance(resp, dict):
            responses.setdefault(str(resp.get("session_id") or "?"), []).append(resp)
    return requests, responses


def _delivery_seconds(report: dict) -> float | None:
    """When the children's last result arrived: the parent's delivery phase starts here."""
    moments = [
        child.get("duration_seconds")
        for child in report.get("children_finished") or []
        if isinstance(child, dict) and isinstance(child.get("duration_seconds"), (int, float))
    ]
    return round(max(moments), 3) if moments else None


def _parent_session_id(report: dict, requests: dict[str, list[dict]]) -> str | None:
    """The root session: declared by ``sessions`` (no ``parent_session_id``), else the busiest."""
    for entry in report.get("sessions") or []:
        if isinstance(entry, dict) and not entry.get("parent_session_id") and entry.get("id"):
            candidate = str(entry["id"])
            if candidate in requests:
                return candidate
    if not requests:
        return None
    return max(requests, key=lambda sid: len(requests[sid]))


def _parent_starts_before_delivery(events_path: Path, ui_session_id: str | None) -> tuple[int, float] | None:
    """``(parent turns started before the last child finished, that finish moment)``.

    The report carries no per-request wall-clock stamp, so the events log is the only faithful way
    to split the parent's requests into dispatch work and delivery work. A turn that started but
    never produced a response — the interrupted last one — has no entry in ``responses``, so the
    caller treats this count as a ceiling on the tail rather than an index into it. ``None`` when
    the sibling events file is absent: callers must say the split is unknown rather than substitute
    a number that looks like data.
    """
    if not events_path.is_file():
        return None
    starts: list[float] = []
    child_done: list[float] = []
    try:
        for line in events_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            name = event.get("event")
            if name == "message.start" and ui_session_id and str(event.get("session_id")) == ui_session_id:
                if isinstance(event.get("time"), (int, float)):
                    starts.append(float(event["time"]))
            elif name == "subagent.complete" and isinstance(event.get("time"), (int, float)):
                child_done.append(float(event["time"]))
    except OSError:
        return None
    if not child_done:
        return None
    delivery_at = max(child_done)
    return len([moment for moment in starts if moment < delivery_at]), round(delivery_at, 3)


def summarize(report: dict, *, path: str | None = None, events_path: Path | None = None) -> dict:
    limits = report.get("limits") or {}
    requests, responses = _group_requests(report)
    parent_id = _parent_session_id(report, requests)
    events_path = events_path or (Path(path).parent / "events.jsonl" if path else None)
    starts = (
        _parent_starts_before_delivery(events_path, report.get("session_id"))
        if events_path is not None else None
    )

    parent_requests = requests.get(parent_id or "", [])
    cumulative_total = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for rs in requests.values() for r in rs)
    parent_cumulative = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in parent_requests)

    # The budget is whole-task: subtract what the children had already spent when their
    # results were handed over, or the parent looks richer than it was.
    child_cumulative = cumulative_total - parent_cumulative
    child_request_count = sum(len(rs) for sid, rs in requests.items() if sid != parent_id)

    finish_reasons = [
        str(r.get("finish_reason")) for r in responses.get(parent_id or "", []) if isinstance(r, dict)
    ]
    approx = [int(r.get(APPROX_INPUT_FIELD) or 0) for r in parent_requests]
    # ``responses`` is grouped by turn, not sorted by wall clock (``api_call_count`` restarts each
    # turn), so a positional tail split would mix the dispatch turn's short status reply into the
    # delivery phase. Answer the question that matters instead: did the parent conclude a turn
    # after the children's results were in hand, and did that turn end with an answer or a tool call?
    parent_turns_before_delivery: int | None = None
    delivery_at: float | None = None
    if starts is not None:
        parent_turns_before_delivery, delivery_at = starts
    final_reason = finish_reasons[-1] if finish_reasons else None
    answered = bool(finish_reasons) and final_reason not in ("tool_calls",)
    interrupted_mid_loop = final_reason == "tool_calls"

    return {
        "report": path,
        "scenario": report.get("scenario"),
        "live": report.get("live"),
        "stop_reason": report.get("stop_reason"),
        "natural_final": report.get("stop_reason") == "normal_final",
        "caps": report.get("caps") or [],
        "elapsed_seconds": report.get("elapsed_seconds"),
        "limits": {
            "seconds": limits.get("seconds"),
            "requests": limits.get("requests"),
            "approx_cumulative_input": limits.get("approx_cumulative_input"),
            "monetary_hard_cap": limits.get("monetary_hard_cap"),
        },
        "delivery": {
            "children_finished": len(report.get("children_finished") or []),
            # Two different clocks: each child's own runtime, versus the wall-clock moment the last
            # result landed. They are not interchangeable — the children start after dispatch.
            "children_own_seconds_max": _delivery_seconds(report),
            "last_child_wall_seconds": delivery_at,
            "parent_requests_total": len(parent_requests),
            "child_requests_total": child_request_count,
        },
        "budget_split": {
            "cumulative_approx_input_total": cumulative_total,
            "parent_cumulative_approx_input": parent_cumulative,
            "children_cumulative_approx_input": child_cumulative,
            "note": "limits.approx_cumulative_input is the HARNESS's local rough estimate summed over "
                    "parent and children; it is not a server-side or product limit. The split below is "
                    "derived arithmetic, not an observed per-session allowance.",
        },
        "parent_cost_shape": {
            "requests": len(parent_requests),
            "first_request_input": approx[0] if approx else None,
            "peak_request_input": max(approx) if approx else None,
            "mean_request_input": round(sum(approx) / len(approx)) if approx else None,
            "context_growth_ratio": round(approx[-1] / approx[0], 2) if len(approx) > 1 and approx[0] else None,
        },
        "parent_delivery_behaviour": {
            "parent_turns_before_delivery": parent_turns_before_delivery,
            "last_child_wall_seconds": delivery_at,
            "finish_reasons": finish_reasons,
            "final_finish_reason": final_reason,
            "answer_attempted": answered,
            "interrupted_mid_tool_loop": interrupted_mid_loop,
            "note": "final reason 'tool_calls' means the parent was still in its tool loop when the "
                    "run ended: it never offered an answer, so the interrupt cannot have cut one short. "
                    "'stop' with a natural_final is a delivered answer.",
        },
        "parent_tools": report.get("parent_all_tool_counts") or report.get("parent_tool_counts") or {},
        "parent_exact_duplicate_tools": report.get("parent_exact_duplicate_tools"),
        "parent_character_count_calls": len(report.get("parent_character_count_calls") or []),
        "fixture_changed_count": len(report.get("fixture_changed") or []),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("reports", nargs="+", type=Path, help="saved run report.json files")
    parser.add_argument("--json", action="store_true", help="emit one JSON array instead of a table")
    args = parser.parse_args(argv)

    summaries = []
    for path in args.reports:
        try:
            summaries.append(summarize(json.loads(path.read_text()), path=str(path)))
        except (OSError, ValueError) as exc:
            print(f"cannot read {path}: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

    if args.json:
        print(json.dumps(summaries, ensure_ascii=False, indent=2))
        return 0

    for summary in summaries:
        print(f"== {summary['report']}")
        for key in ("scenario", "live", "stop_reason", "natural_final", "caps", "elapsed_seconds"):
            print(f"   {key}: {summary[key]}")
        for section in ("limits", "delivery", "budget_split", "parent_cost_shape",
                        "parent_delivery_behaviour", "parent_tools"):
            print(f"   {section}:")
            for name, value in summary[section].items():
                print(f"      {name}: {value}")
        print(f"   parent_exact_duplicate_tools: {summary['parent_exact_duplicate_tools']}")
        print(f"   parent_character_count_calls: {summary['parent_character_count_calls']}")
        print(f"   fixture_changed_count: {summary['fixture_changed_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
