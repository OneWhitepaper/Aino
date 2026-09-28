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


def _turn_split(report: dict, requests: list[dict], responses: list[dict]) -> dict:
    """Report each turn's PURPOSE and RESPONSE STATE as two independent dimensions.

    Purpose is not derivable here. The transport does record a real purpose per wire attempt
    (``wire_attempts[].purpose``, the managed-request purpose header), but that log shares no key
    with ``requests``: its ``turn_id`` is a transport UUID while a request's is the inner agent turn
    id, and neither ``api_request_id`` nor ``http_call_id`` appears on both sides. So no request can
    be labelled chat/auxiliary by evidence, and purpose stays ``unknown`` rather than being inferred.

    Response state is what the report does record, and it is reported without implying intent:
    ``answered``, ``unanswered`` (no response row) and ``usage_missing`` (flagged in observed_usage)
    are separate counts. A background side call that answers normally is therefore NOT thereby a
    task turn, and an interrupted chat request with no response is NOT thereby auxiliary — the two
    facts do not determine each other.

    Nothing is dropped: every request stays in the totals whatever its purpose or response state.
    """
    answered_ids = {
        str(r.get("api_request_id")) for r in responses if isinstance(r, dict) and r.get("api_request_id")
    }
    usage = report.get("observed_usage") or {}
    usage_ids = set()
    for key in ("missing_response_ids", "missing_usage_ids", "unmatched_response_ids"):
        values = usage.get(key)
        if isinstance(values, list):
            usage_ids.update(str(value) for value in values)

    by_turn: dict[str, list[dict]] = {}
    for request in requests:
        by_turn.setdefault(str(request.get("turn_id") or ""), []).append(request)

    turns = []
    for turn_id, turn_requests in by_turn.items():
        answered = [r for r in turn_requests if str(r.get("api_request_id")) in answered_ids]
        unanswered = [r for r in turn_requests if str(r.get("api_request_id")) not in answered_ids]
        usage_missing = [r for r in turn_requests if str(r.get("api_request_id")) in usage_ids]
        turns.append({
            "turn_id": turn_id,
            # Unproven by construction (see docstring), kept explicit so no reader assumes a turn was
            # classed by size or by whether it happened to answer.
            "purpose": "unknown",
            "requests": len(turn_requests),
            "answered_requests": len(answered),
            "unanswered_requests": len(unanswered),
            "usage_missing_requests": len(usage_missing),
            "approx_input": sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in turn_requests),
        })

    return {
        "turns": turns,
        "wire_purposes": _wire_purpose_totals(report),
        "answered_requests": [r for r in requests if str(r.get("api_request_id")) in answered_ids],
        "unanswered_requests": [
            r for r in requests if str(r.get("api_request_id")) not in answered_ids
        ],
        "usage_missing_requests": [
            r for r in requests if str(r.get("api_request_id")) in usage_ids
        ],
        # Purpose could not be proven for any request: every one is listed here so the count is
        # visible and cannot silently vanish from the totals.
        "purpose_unproven_requests": list(requests),
    }


def _wire_purpose_totals(report: dict) -> dict:
    """Purpose counts the transport actually recorded, with their unjoinable count.

    ``delegation`` attempts include each child's own managed calls, so these totals describe the
    wire rather than one session's turn list. ``unjoined_attempts`` makes the gap between the
    transport log and the request rows visible instead of smoothing it over.
    """
    attempts = report.get("wire_attempts")
    if not isinstance(attempts, list):
        return {"available": False}
    counts: dict[str, int] = {}
    for attempt in attempts:
        if isinstance(attempt, dict):
            purpose = str(attempt.get("purpose") or "unlabelled")
            counts[purpose] = counts.get(purpose, 0) + 1
    requests = report.get("requests") or []
    return {
        "available": True,
        "attempts_total": len(attempts),
        "requests_total": len(requests),
        "unjoined_attempts": len(attempts) - len(requests),
        "by_purpose": counts,
        "note": "Transport-recorded purposes. They share no join key with requests, so they stay "
                "totals only — never attributed to a request or a turn.",
    }


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
    parent_responses = responses.get(parent_id or "", [])
    cumulative_total = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for rs in requests.values() for r in rs)
    parent_cumulative = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in parent_requests)

    # The budget is whole-task: subtract what the children had already spent when their
    # results were handed over, or the parent looks richer than it was.
    child_cumulative = cumulative_total - parent_cumulative
    child_request_count = sum(len(rs) for sid, rs in requests.items() if sid != parent_id)

    split = _turn_split(report, parent_requests, parent_responses)
    answered_requests = split["answered_requests"]
    unanswered_requests = split["unanswered_requests"]
    usage_missing_requests = split["usage_missing_requests"]
    answered_ids = {str(r.get("api_request_id")) for r in answered_requests}
    # The parent's own delivery verdict is read from the turns that actually answered; requests
    # whose purpose is unproven still count in every total below.
    task_reasons = [
        str(r.get("finish_reason")) for r in parent_responses
        if str(r.get("api_request_id")) in answered_ids
    ]
    approx = [int(r.get(APPROX_INPUT_FIELD) or 0) for r in answered_requests]

    # Two questions, kept apart on purpose.
    #
    # (a) Was a text answer observed at all? That is the task turn's own final reason plus the
    #     final event's text. ``responses`` is grouped per turn and ``api_call_count`` restarts each
    #     turn, so neither order nor position identifies "the last thing the parent did".
    # (b) Did the COMPLETE task deliver naturally? Only when the run itself says so: a normal_final
    #     stop, a completion event whose status is ``complete`` with non-empty text, and a
    #     completion guard that actually admitted the final. An interrupt note, a wait status, or an
    #     unfinished request must never be counted as an accepted delivery.
    final_reason = task_reasons[-1] if task_reasons else None
    final_event = report.get("final_event") or {}
    payload = final_event.get("payload") if isinstance(final_event, dict) else None
    payload = payload if isinstance(payload, dict) else {}
    final_text = payload.get("text")
    final_status = payload.get("status")
    if final_reason is None:
        # No response was recorded for the task turn at all. If the run still recorded a completed
        # final with text, say what is actually known rather than implying the parent never spoke.
        answer_state = ("answered_from_final_event_only"
                        if final_status == "complete" and (final_text or "").strip()
                        else "unknown_no_recorded_response")
    elif final_reason == "tool_calls":
        answer_state = "mid_tool_loop"          # never offered an answer; an interrupt cut no answer short
    elif final_reason == "stop":
        answer_state = "answered" if (final_text or "").strip() else "stopped_without_text"
    else:
        answer_state = f"unknown_finish_reason:{final_reason}"

    guard = report.get("completion_guard") or {}
    delivery_reasons: list[str] = []
    if report.get("stop_reason") != "normal_final":
        delivery_reasons.append(f"stop_reason={report.get('stop_reason')!r} is not normal_final")
    if not payload:
        delivery_reasons.append("no final_event payload recorded")
    else:
        if final_status != "complete":
            delivery_reasons.append(f"final event status={final_status!r} is not 'complete'")
        if not (final_text or "").strip():
            delivery_reasons.append("final event text is empty")
    if not guard:
        delivery_reasons.append("no completion_guard recorded")
    elif not guard.get("eligible"):
        delivery_reasons.append("completion_guard did not admit the final")
    natural_delivery = not delivery_reasons

    parent_turns_before_delivery: int | None = None
    delivery_at: float | None = None
    if starts is not None:
        parent_turns_before_delivery, delivery_at = starts

    return {
        "report": path,
        "scenario": report.get("scenario"),
        "live": report.get("live"),
        "stop_reason": report.get("stop_reason"),
        "natural_final": report.get("stop_reason") == "normal_final",
        "natural_delivery": natural_delivery,
        "not_delivered_because": delivery_reasons,
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
            # Not the same number as the line above: a session's requests span several turns, and a
            "parent_answered_requests": len(answered_requests),
            "parent_unanswered_requests": len(unanswered_requests),
            "parent_usage_missing_requests": len(usage_missing_requests),
            # Purpose is unproven for every request (see _turn_split); the count is stated so it
            # cannot be mistaken for an empty category, and these requests stay in all totals.
            "parent_purpose_unproven_requests": len(split["purpose_unproven_requests"]),
            "parent_turns": split["turns"],
            "wire_purposes": split["wire_purposes"],
            "child_requests_total": child_request_count,
        },
        "budget_split": {
            "cumulative_approx_input_total": cumulative_total,
            "parent_cumulative_approx_input": parent_cumulative,
            "parent_answered_approx_input": sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in answered_requests),
            "parent_unanswered_approx_input": sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in unanswered_requests),
            "children_cumulative_approx_input": child_cumulative,
            "note": "limits.approx_cumulative_input is the HARNESS's local rough estimate summed over "
                    "parent and children; it is not a server-side or product limit. The split below is "
                    "derived arithmetic, not an observed per-session allowance.",
        },
        "parent_cost_shape": {
            "answered_requests": len(answered_requests),
            "first_request_input": approx[0] if approx else None,
            "peak_request_input": max(approx) if approx else None,
            "mean_request_input": round(sum(approx) / len(approx)) if approx else None,
            "context_growth_ratio": round(approx[-1] / approx[0], 2) if len(approx) > 1 and approx[0] else None,
        },
        "parent_delivery_behaviour": {
            "parent_turns_before_delivery": parent_turns_before_delivery,
            "last_child_wall_seconds": delivery_at,
            "task_turn_finish_reasons": task_reasons,
            "final_finish_reason": final_reason,
            "answer_state": answer_state,
            "final_event_status": final_status,
            "final_event_text_chars": len(final_text or ""),
            "completion_guard_eligible": guard.get("eligible") if guard else None,
            "note": "answer_state answers only 'was a text answer observed', from the task turn's "
                    "final reason plus the final event's text ('mid_tool_loop' = no answer ever "
                    "offered; 'answered' needs both a 'stop' reason and non-empty text; anything else "
                    "is unknown). Whole-task acceptance is the separate natural_delivery verdict.",
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
