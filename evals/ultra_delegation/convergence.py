#!/usr/bin/env python3
"""Convergence metrics for a saved Ultra-delegation acceptance run.

Why this exists
---------------
The whole-task question is not "did the model do work" but "did the parent DELIVER inside
the whole-task budget". A saved ``report.json`` answers that with a handful of numbers that
are easy to misread by hand (the parent's own budget is not ``limits.approx_cumulative_input``
— that cap covers parent and children together). This prints them in one block so a later
holder can compare runs without re-deriving the arithmetic.

The CLI is read-only: it opens the report and sibling events log and prints JSON.
It never runs a model, executes tools, or writes files. The shared usage normalizer
lazily imports agent.usage_pricing when normalizing raw Responses usage.

Usage
-----
    python3 evals/ultra_delegation/convergence.py /path/to/run/report.json [more.json ...]
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import sys
from pathlib import Path

# Same token accounting the harness observer applies: every request the parent AND its
# children issue counts against the one cumulative figure.
APPROX_INPUT_FIELD = "approx_input_tokens"


def normalize_observed_usage(usage, source):
    """Compare completed usage only; absent detail remains unknown, never a zero claim."""
    if source not in ('aino_hook', 'responses_raw'):
        raise ValueError('unknown usage source')
    if usage is None or usage == {}:
        return None
    if not isinstance(usage, dict):
        raise ValueError('usage must be an object')
    def count(mapping, key, required=False):
        value = mapping.get(key)
        if value is None and not required:
            return None
        if type(value) is not int or value < 0:
            raise ValueError('invalid or missing token count: ' + key)
        return value
    if source == 'aino_hook':
        prompt = count(usage, 'prompt_tokens', True)
        output = count(usage, 'output_tokens', True)
        cached = count(usage, 'cache_read_tokens')
        written = count(usage, 'cache_write_tokens')
        uncached = count(usage, 'input_tokens')
        reasoning = count(usage, 'reasoning_tokens')
    else:
        from agent.usage_pricing import normalize_usage
        prompt = count(usage, 'input_tokens', True)
        output = count(usage, 'output_tokens', True)
        details = usage.get('input_tokens_details', {})
        output_details = usage.get('output_tokens_details', {})
        if not isinstance(details, dict) or not isinstance(output_details, dict):
            raise ValueError('usage details must be objects')
        cached = count(details, 'cached_tokens')
        written = count(details, 'cache_write_tokens')
        legacy_written = count(details, 'cache_creation_tokens')
        if written is None:
            written = legacy_written
        elif legacy_written is not None and written != legacy_written:
            raise ValueError('conflicting cache write aliases')
        reasoning = count(output_details, 'reasoning_tokens')
        # Reuse production normalization, but do not inherit its silent zero defaults.
        canonical = normalize_usage(usage, provider='aino', api_mode='codex_responses')
        uncached = canonical.input_tokens if cached is not None and written is not None else None
    if sum(value for value in (cached, written) if value is not None) > prompt:
        raise ValueError('cache tokens exceed prompt tokens')
    if all(value is not None for value in (uncached, cached, written)) and uncached + cached + written != prompt:
        raise ValueError('input buckets do not equal prompt tokens')
    if uncached is not None and uncached > prompt:
        raise ValueError('uncached tokens exceed prompt tokens')
    if reasoning is not None and reasoning > output:
        raise ValueError('reasoning tokens exceed output tokens')
    total = count(usage, 'total_tokens')
    if total is not None and total != prompt + output:
        raise ValueError('total tokens do not equal prompt plus output')
    return {'prompt_tokens':prompt, 'cache_read_tokens':cached, 'cache_write_tokens':written,
            'uncached_input_tokens':uncached, 'output_tokens':output, 'reasoning_tokens':reasoning,
            'total_tokens':prompt + output}

def cumulative_input_excluding_cache_reads(requests, responses, *, usage_source='aino_hook'):
    """Count complete input buckets, retaining estimates until usage is usable.

    Excluding cache reads is a distinct, looser acceptance policy than summing
    whole-context estimates. This is neither token novelty nor monetary cost.
    A missing bucket is unknown, including when the other buckets are zero.
    Conflicting, partial, or invalid duplicate responses cannot release a reserve.
    Duplicate request estimates retain their largest valid value. Unkeyed rows
    and IDs without either complete usage or a valid reserve make accounting
    incomplete; the numeric result alone must never authorize continuation.
    """
    req_rows, resp_rows = list(requests), list(responses)
    requested, estimates = set(), collections.defaultdict(set)
    invalid_estimate_ids, invalid_estimate_rows = set(), []
    unkeyed_requests = unkeyed_reserved = 0
    for index, row in enumerate(req_rows):
        rid = row.get('api_request_id') if isinstance(row, dict) else None
        keyed = isinstance(rid, str) and bool(rid.strip())
        estimate = row.get(APPROX_INPUT_FIELD) if isinstance(row, dict) else None
        valid_estimate = type(estimate) is int and estimate >= 0
        if keyed:
            requested.add(rid)
        else:
            unkeyed_requests += 1
        if not valid_estimate:
            invalid_estimate_rows.append({'row_index': index, 'api_request_id': rid})
            if keyed:
                invalid_estimate_ids.add(rid)
        elif keyed:
            estimates[rid].add(estimate)
        else:
            # No ID means duplicates cannot be resolved, but a known estimate
            # still reserves capacity while the incomplete-accounting stop fires.
            unkeyed_reserved += estimate
    approx_by_id = {rid: max(values) for rid, values in estimates.items()}
    conflicting_estimates = {rid: sorted(values) for rid, values in estimates.items() if len(values) > 1}

    grouped = collections.defaultdict(list)
    unkeyed_responses = 0
    for row in resp_rows:
        rid = row.get('api_request_id') if isinstance(row, dict) else None
        if not isinstance(rid, str) or not rid.strip():
            unkeyed_responses += 1
        else:
            grouped[rid].append(row)
    settled, conflicting = {}, []
    invalid_usage_ids, incomplete_usage_ids = set(), set()
    input_fields = ('uncached_input_tokens', 'cache_read_tokens', 'cache_write_tokens')
    for rid, rows in grouped.items():
        values = []
        for row in rows:
            try:
                usage = normalize_observed_usage(row.get('usage'), usage_source)
            except ValueError:
                invalid_usage_ids.add(rid)
                continue
            if usage is None or any(usage[field] is None for field in input_fields):
                incomplete_usage_ids.add(rid)
                continue
            # normalize_observed_usage checks conservation once every bucket
            # exists; its partial-observation semantics remain unchanged.
            values.append(usage)
        if values and any(value != values[0] for value in values[1:]):
            conflicting.append(rid)
        elif values and rid not in invalid_usage_ids and rid not in incomplete_usage_ids:
            settled[rid] = values[0]

    uncached = sum(usage['uncached_input_tokens'] for usage in settled.values())
    written = sum(usage['cache_write_tokens'] for usage in settled.values())
    read = sum(usage['cache_read_tokens'] for usage in settled.values())
    reserved_ids = sorted((requested | grouped.keys()) - settled.keys())
    unaccounted_ids = [rid for rid in reserved_ids if rid not in approx_by_id]
    reserved = unkeyed_reserved + sum(approx_by_id[rid] for rid in reserved_ids if rid in approx_by_id)
    return {
        'basis': 'input_excluding_cache_reads',
        'input_excluding_cache_reads': uncached + written + reserved,
        'uncached_input_tokens': uncached,
        'cache_write_tokens': written,
        'reserved_for_requests_without_usable_usage': reserved,
        'excluded_cache_read_tokens': read,
        'settled_requests': len(settled),
        'requested_requests': len(requested),
        'reserved_request_ids': reserved_ids,
        'conflicting_response_ids': sorted(conflicting),
        'unmatched_response_ids': sorted(grouped.keys() - requested),
        'unkeyed_response_rows': unkeyed_responses,
        'accounting_complete': not (unaccounted_ids or unkeyed_requests or unkeyed_responses),
        'unaccounted_request_ids': unaccounted_ids,
        'unkeyed_request_rows': unkeyed_requests,
        'unkeyed_request_reserved_tokens': unkeyed_reserved,
        'invalid_request_estimate_ids': sorted(invalid_estimate_ids),
        'invalid_request_estimate_rows': invalid_estimate_rows,
        'conflicting_request_estimate_ids': sorted(conflicting_estimates),
        'conflicting_request_estimates': conflicting_estimates,
        'invalid_usage_response_ids': sorted(invalid_usage_ids),
        'incomplete_usage_response_ids': sorted(incomplete_usage_ids),
        'request_rows': len(req_rows),
        'response_rows': len(resp_rows),
    }


def observe_input_ceiling(requests, responses, observations, *, limit, phase, api_request_id, seconds, usage_source='aino_hook'):
    """Append one accounting snapshot; caller holds the live observer's lock.

    The same function accepts chronological offline prefixes. A stop caused by
    a crossing or incomplete accounting stays latched after reservations settle.
    Snapshot counts come from the counter, never a second read of caller lists.
    """
    snapshot = cumulative_input_excluding_cache_reads(requests, responses, usage_source=usage_source)
    crossed = snapshot['input_excluding_cache_reads'] >= limit
    stopped_before = any(
        row.get('stop_required') or row.get('crossed') or row.get('accounting_complete') is False
        for row in observations
    )
    observation = {
        **snapshot,
        'phase': phase,
        'api_request_id': api_request_id,
        'seconds': seconds,
        'requests_recorded': snapshot['request_rows'],
        'responses_recorded': snapshot['response_rows'],
        'value': snapshot['input_excluding_cache_reads'],
        'reserved': snapshot['reserved_for_requests_without_usable_usage'],
        'crossed': crossed,
        'stop_required': bool(stopped_before or crossed or not snapshot['accounting_complete']),
    }
    observations.append(observation)
    return observation



def _ceiling_basis(report):
    """Describe the aggregate-input ceiling basis THIS report was actually scored under.

    A report is read on its own recorded terms. Reports written before the basis became
    configurable carry no ``input_accounting`` and no ``limits.cumulative_input_basis``;
    for them the basis was the re-presented-context sum, and saying so is not a
    reinterpretation of their result. A historical run's stop reason, caps and verdict are
    never restated here.

    Legacy Codex reports used a separate budget policy. New reports can record the shared
    input metric; its definition alone does not establish equal observation scope or costs.
    """
    limits = report.get("limits") or {}
    accounting = report.get("input_accounting")
    driver = (report.get("diagnostic") or {}).get("driver") or report.get("driver")
    is_codex = driver == "codex" or bool(report.get("codex_native_comparison"))
    if not isinstance(accounting, dict):
        return {
            "basis": "approx_represented_input",
            "recorded_in_report": False,
            "policy": "pre_change_default",
            "driver": driver or ("codex" if is_codex else "aino"),
            "value": sum(int(r.get(APPROX_INPUT_FIELD) or 0)
                         for r in (report.get("requests") or [])),
            "limit": limits.get("approx_cumulative_input"),
            "note": "No input_accounting block: this run was scored when the ceiling summed each "
                    "request's whole re-presented context. Its recorded outcome stands as-is and "
                    "is NOT comparable with runs scored on a cache-read-excluding basis."
                    + (" Native Codex driver: separate budget policy, not the Aino observer's."
                       if is_codex else ""),
        }
    return {
        "basis": accounting.get("basis"),
        "recorded_in_report": True,
        "policy": accounting.get("policy") or limits.get("cumulative_input_policy"),
        "driver": driver or "aino",
        "value": accounting.get("final_value"),
        "peak_value": accounting.get("peak_value"),
        "peak_at": accounting.get("peak_at"),
        "ever_crossed": accounting.get("ever_crossed"),
        "first_crossing": accounting.get("first_crossing"),
        "accounting_complete": accounting.get("accounting_complete"),
        "ever_incomplete": accounting.get("ever_incomplete"),
        "first_incomplete": accounting.get("first_incomplete"),
        "unaccounted_request_ids": accounting.get("unaccounted_request_ids"),
        "unkeyed_request_rows": accounting.get("unkeyed_request_rows"),
        "unkeyed_response_rows": accounting.get("unkeyed_response_rows"),
        "limit": accounting.get("limit", limits.get("approx_cumulative_input")),
        "superseded_value": accounting.get("approx_represented_input"),
        "note": "Scored on the basis named above. The value is non-monotonic (a reserved rough "
                "estimate can be replaced by a smaller settled figure), so ever_crossed and "
                "peak_value decide whether the ceiling was reached, not the final value. "
                "Incomplete accounting requires an independent stop even below the ceiling; "
                "a peak below the limit cannot establish complete accounting."
                + (" Native Codex records the shared input metric through its own transport; "
                   "matching units do not establish identical request coverage or costs."
                   if is_codex else ""),
    }


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
    if report.get('root_session_id'):
        root = str(report['root_session_id'])
        return root if root in requests else None
    if (report.get('driver') or (report.get('diagnostic') or {}).get('driver')) == 'codex':
        return None
    for entry in report.get("sessions") or []:
        if isinstance(entry, dict) and not entry.get("parent_session_id") and entry.get("id"):
            candidate = str(entry["id"])
            if candidate in requests:
                return candidate
    if not requests:
        return None
    return max(requests, key=lambda sid: len(requests[sid]))


def _read_events(events_path: Path | None) -> list[dict] | None:
    if events_path is None:
        return None
    try:
        lines = events_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    events = []
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _evidence_parent_session_id(report: dict) -> str | None:
    """New evidence metrics require a stored identity or one explicitly declared root."""
    if report.get('root_session_id'):
        return str(report['root_session_id'])
    if report.get("stored_session_id"):
        return str(report["stored_session_id"])
    roots = {str(row["id"]) for row in report.get("sessions") or []
             if isinstance(row, dict) and row.get("id") and not row.get("parent_session_id")}
    return next(iter(roots)) if len(roots) == 1 else None


def _parent_starts_before_delivery(events: list[dict] | None, ui_session_id: str | None) -> tuple[int, float] | None:
    """``(parent turns started before the last child finished, that finish moment)``.

    The report carries no per-request wall-clock stamp, so the events log is the only faithful way
    to split the parent's requests into dispatch work and delivery work. A turn that started but
    never produced a response — the interrupted last one — has no entry in ``responses``, so the
    caller treats this count as a ceiling on the tail rather than an index into it. ``None`` when
    the sibling events file is absent: callers must say the split is unknown rather than substitute
    a number that looks like data.
    """
    if events is None:
        return None
    starts: list[float] = []
    child_done: list[float] = []
    for event in events:
        name = event.get("event")
        if name == "message.start" and ui_session_id and str(event.get("session_id")) == ui_session_id:
            if isinstance(event.get("time"), (int, float)):
                starts.append(float(event["time"]))
        elif name == "subagent.complete" and isinstance(event.get("time"), (int, float)):
            child_done.append(float(event["time"]))
    if not child_done:
        return None
    delivery_at = max(child_done)
    return len([moment for moment in starts if moment < delivery_at]), round(delivery_at, 3)


def _seconds(value) -> float | None:
    return (float(value) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0 else None)


def _duration_stats(values: list) -> dict:
    measured = [seconds for value in values if (seconds := _seconds(value)) is not None]
    return {
        "count": len(measured), "sum_seconds": round(sum(measured), 3),
        "mean_seconds": round(sum(measured) / len(measured), 3) if measured else None,
        "unmeasured_count": len(values) - len(measured),
    }


def _completed_api_durations(report: dict, parent_id: str | None, responses: dict[str, list[dict]]) -> dict:
    child_ids = {str(row["id"]) for row in report.get("sessions") or []
                 if isinstance(row, dict) and row.get("id") and parent_id
                 and row.get("parent_session_id") == parent_id}
    groups: dict[str, list] = {"parent": [], "children": [], "unattributed": []}
    for session_id, rows in responses.items():
        group = "parent" if session_id == parent_id else "children" if session_id in child_ids else "unattributed"
        groups[group].extend(row.get("api_duration") for row in rows)
    return {
        "parent_session_id": parent_id,
        **{name: _duration_stats(values) for name, values in groups.items()},
        "note": "Completed response durations only; concurrent calls overlap, so sums are not wall time. "
                "Request purposes remain unknown.",
    }


def _parent_tool_results(report: dict, parent_id: str | None) -> dict:
    rows = report.get("db_messages")
    if not isinstance(rows, list) or not parent_id:
        return {"available": False, "session_id": parent_id, "count": None, "content_chars": None}
    tools = [row for row in rows if isinstance(row, dict)
             and row.get("session_id") == parent_id and row.get("role") == "tool"]
    return {
        "available": True, "session_id": parent_id, "count": len(tools),
        "content_chars": sum(len(row["content"]) for row in tools if isinstance(row.get("content"), str)),
    }


def _parent_tool_timing(events: list[dict] | None, ui_session_id: str | None) -> dict:
    """Pair parent UI events by tool identity; arguments and results remain uninterpreted."""
    if events is None or not ui_session_id:
        return {"available": False}
    calls, durations, pending = [], [], {}
    unmatched_completions = 0
    for event in events:
        if event.get("session_id") != ui_session_id or event.get("event") not in ("tool.start", "tool.complete"):
            continue
        payload = event.get("payload") or {}
        if not isinstance(payload, dict):
            continue
        tool_id = payload.get("tool_id")
        if event["event"] == "tool.start":
            call = {"tool_id": tool_id, "name": payload.get("name"),
                    "start_seconds": _seconds(event.get("time")), "complete_seconds": None,
                    "duration_seconds": None, "duration_source": None}
            calls.append(call)
            if tool_id:
                pending[tool_id] = call
            continue
        call = pending.pop(tool_id, None)
        if call is None:
            unmatched_completions += 1
            continue
        call["complete_seconds"] = _seconds(event.get("time"))
        duration = _seconds(payload.get("duration_s"))
        if duration is not None:
            call["duration_source"] = "tool.complete.duration_s"
        elif (call["start_seconds"] is not None and call["complete_seconds"] is not None
              and call["complete_seconds"] >= call["start_seconds"]):
            duration = call["complete_seconds"] - call["start_seconds"]
            call["duration_source"] = "paired_event_times"
        call["duration_seconds"] = round(duration, 3) if duration is not None else None
        durations.append(duration)
    return {
        "available": True, "started_count": len(calls), "paired_count": len(durations),
        "unpaired_start_count": len(calls) - len(durations),
        "unpaired_complete_count": unmatched_completions,
        "durations": _duration_stats(durations),
        "execute_code_calls": [call for call in calls if call["name"] == "execute_code"],
        "note": "Paired per-tool durations; parallel calls overlap. No phase or answer is inferred from tool code.",
    }


def _stream_message_id_compatible(message_id, event_id) -> bool:
    """Optional IDs constrain an already-bound parent/request window."""
    if message_id is None:
        return event_id is None
    return isinstance(message_id, str) and bool(message_id) and event_id == message_id


def _stream_request_matches(event: dict, last_request: dict) -> bool:
    """Only the report's last explicit parent request can own the interrupted stream."""
    request_id, turn_id = last_request.get("api_request_id"), last_request.get("turn_id")
    return (isinstance(request_id, str) and bool(request_id)
            and event.get("api_request_id") == request_id
            and event.get("session_id") == last_request.get("session_id")
            and (not turn_id or event.get("turn_id") == turn_id))


def _interrupted_parent_text_chars(events: list[dict] | None, ui_session_id: str | None,
                                   parent_id: str | None, last_request: dict | None) -> int | None:
    """Confirm real deltas from the last parent/request window, not an interruption notice.

    This transport may omit message IDs. In that case identity comes from the explicit parent
    session plus start/report-request boundaries, never from treating missing IDs as a match.
    """
    if events is None or not ui_session_id or not parent_id or not last_request:
        return None
    start_at = request_at = last_delta_at = None
    message_id = None
    chunks: list[str] = []
    observed = None
    for event in events:
        at = _seconds(event.get("time"))
        if event.get("kind") == "pre_api_request" and event.get("session_id") == parent_id:
            chunks, observed, last_delta_at = [], None, None
            request_at = (at if start_at is not None and at is not None and at >= start_at
                          and _stream_request_matches(event, last_request) else None)
            continue
        if event.get("session_id") != ui_session_id:
            continue
        name, payload = event.get("event"), event.get("payload")
        if not isinstance(payload, dict):
            continue
        if name == "message.start":
            start_at, request_at, last_delta_at = at, None, None
            message_id, chunks, observed = payload.get("message_id"), [], None
            continue
        if name in ("message.interim", "tool.start"):
            request_at, chunks = None, []
            continue
        if name not in ("message.delta", "message.complete"):
            continue
        if request_at is None or at is None or at < request_at:
            continue
        # No-ID events use the parent/request window above; a supplied ID may not mix into it.
        if not _stream_message_id_compatible(message_id, payload.get("message_id")):
            request_at, chunks = None, []
            continue
        text = payload.get("text")
        if name == "message.delta":
            if isinstance(text, str):
                chunks.append(text)
                last_delta_at = at
            continue
        if (payload.get("status") == "interrupted" and isinstance(text, str) and text.strip()
                and chunks and last_delta_at is not None and at >= last_delta_at
                and "".join(chunks).lstrip() == text.lstrip()):
            observed = len(text)
        start_at = request_at = None
    return observed


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


def _native_delivery_evidence(report):
    """Require native CLI final identity and final responses for observed agent sessions."""
    missing, failed = [], []
    if not report.get('stop_reason'):
        missing.append('no stop_reason recorded')
    elif report.get('stop_reason') != 'normal_final':
        failed.append(f"stop_reason={report.get('stop_reason')!r} is not normal_final")
    code = report.get('returncode')
    if code is None:
        missing.append('no CLI returncode recorded')
    elif code != 0:
        failed.append(f'CLI exited with {code!r}')
    final = report.get('final_text')
    if not isinstance(final, str) or not final.strip():
        missing.append('no nonempty native final_text recorded')
    events = report.get('cli_events') or []
    starts = [i for i, e in enumerate(events) if e.get('type') == 'turn.started']
    final_turn = events[starts[-1]:] if starts else []
    turns = [e.get('type') for e in final_turn if e.get('type') in ('turn.started', 'turn.completed', 'turn.failed')]
    if not final_turn:
        missing.append('no native turn completion recorded')
    elif turns[-1] != 'turn.completed':
        failed.append('last native turn did not complete')
    messages = [e.get('item', {}).get('text') for e in final_turn
                if e.get('type') == 'item.completed' and (e.get('item') or {}).get('type') == 'agent_message']
    if not messages or not isinstance(final, str) or not isinstance(messages[-1], str) or messages[-1].strip() != final.strip():
        missing.append('native final_text does not match the final CLI agent message')
    root = report.get('root_session_id')
    if not root:
        missing.append('no native root_session_id recorded')
    thread_ids = {e.get('thread_id') for e in events if e.get('type') == 'thread.started'}
    if not root or thread_ids != {root}:
        missing.append('native root identity is not established by CLI thread.started')
    latest = {}
    for request in report.get('requests') or []:
        if request.get('purpose') in ('compression', 'title', 'other_auxiliary'):
            continue
        if request.get('purpose') not in ('chat', 'delegation'):
            missing.append('an observed request has no mapped agent purpose')
            continue
        sid = request.get('session_id')
        if not sid or not request.get('api_request_id'):
            missing.append('an observed agent request has no session/request identity')
            continue
        latest[sid] = request
    if root not in latest:
        missing.append('no request for the recorded root session')
    by_request = collections.defaultdict(list)
    for response in report.get('responses') or []:
        by_request[response.get('api_request_id')].append(response)
    for sid, request in latest.items():
        rows = by_request[request['api_request_id']]
        if len(rows) != 1 or rows[0].get('session_id') != sid:
            missing.append(f'no unique final response for agent session {sid}')
            continue
        row = rows[0]
        status, tools, chars = row.get('response_status'), row.get('has_tool_calls'), row.get('final_text_chars')
        if status is None or type(tools) is not bool or type(chars) is not int:
            missing.append(f'final response facts unavailable for agent session {sid}')
        elif status != 'completed' or tools or chars <= 0:
            failed.append(f'agent session {sid} did not end with a completed text answer')
    return {'driver': 'codex', 'basis': 'native_cli_final_and_observed_agent_responses',
            'state': 'not_delivered' if failed else 'unknown' if missing else 'delivered',
            'reasons': failed + missing, 'observed_agent_sessions': len(latest),
            'boundary': 'Recorded native final and observed agent completions, not task coverage, factual accuracy or runtime equality.'}


def summarize(report: dict, *, path: str | None = None, events_path: Path | None = None) -> dict:
    limits = report.get("limits") or {}
    requests, responses = _group_requests(report)
    parent_id = _parent_session_id(report, requests)
    events_path = events_path or (Path(path).parent / "events.jsonl" if path else None)
    events = _read_events(events_path)
    starts = _parent_starts_before_delivery(events, report.get("session_id"))
    evidence_parent_id = _evidence_parent_session_id(report)

    parent_requests = requests.get(parent_id or "", [])
    parent_responses = responses.get(parent_id or "", [])
    cumulative_total = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for rs in requests.values() for r in rs)
    parent_cumulative = sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in parent_requests)

    # The budget is whole-task: subtract what the children had already spent when their
    # results were handed over, or the parent looks richer than it was.
    child_cumulative = cumulative_total - parent_cumulative if parent_id else None
    child_request_count = sum(len(rs) for sid, rs in requests.items() if sid != parent_id) if parent_id else None

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
    # (a) Was text observed at all? A missing response can hide a real interrupted stream, so
    #     matched parent stream events are independent evidence. ``responses`` is grouped per turn and ``api_call_count`` restarts each
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
    evidence_requests = requests.get(evidence_parent_id or "", [])
    interrupted_chars = _interrupted_parent_text_chars(
        events, report.get("session_id"), evidence_parent_id,
        evidence_requests[-1] if evidence_requests else None,
    )
    if interrupted_chars is not None:
        answer_state = "interrupted_with_streamed_text"
    elif final_reason is None:
        # No response was recorded for the task turn at all. If the run still recorded a completed
        # final with text, say what is actually known rather than implying the parent never spoke.
        answer_state = ("answered_from_final_event_only"
                        if final_status == "complete" and (final_text or "").strip()
                        else "unknown_no_recorded_response")
    elif final_reason == "tool_calls":
        # A pending request may already have streamed text absent from the completed responses.
        answer_state = "unknown_after_tool_calls" if unanswered_requests else "mid_tool_loop"
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
    driver = report.get('driver') or (report.get('diagnostic') or {}).get('driver') or 'aino'
    delivery_evidence = {'driver': driver, 'basis': 'desktop_final_event_and_completion_guard',
                         'state': 'delivered' if natural_delivery else 'not_delivered',
                         'reasons': delivery_reasons, 'boundary': 'Recorded desktop delivery, not answer quality.'}
    if driver == 'codex':
        delivery_evidence = _native_delivery_evidence(report)
    elif driver not in ('aino', 'hermes'):
        delivery_evidence = {'driver': driver, 'basis': None, 'state': 'unsupported',
                             'reasons': ['no delivery evidence mapping for this driver']}
    if driver != 'aino':
        natural_delivery = {'delivered': True, 'not_delivered': False}.get(delivery_evidence['state'])
        delivery_reasons = delivery_evidence['reasons']

    parent_turns_before_delivery: int | None = None
    delivery_at: float | None = None
    if starts is not None:
        parent_turns_before_delivery, delivery_at = starts

    diagnostic = dict(report.get("diagnostic") or {})
    diagnostic.setdefault("original_acceptance_eligible", None)
    return {
        "report": path,
        "scenario": report.get("scenario"),
        "live": report.get("live"),
        "stop_reason": report.get("stop_reason"),
        "natural_final": report.get("stop_reason") == "normal_final",
        "natural_delivery": natural_delivery,
        "delivery_evidence": delivery_evidence,
        "diagnostic": diagnostic,
        "not_delivered_because": delivery_reasons,
        "caps": report.get("caps") or [],
        "elapsed_seconds": report.get("elapsed_seconds"),
        "limits": {
            "seconds": limits.get("seconds"),
            "requests": limits.get("requests"),
            "approx_cumulative_input": limits.get("approx_cumulative_input"),
            "monetary_hard_cap": limits.get("monetary_hard_cap"),
        },
        "ceiling_basis": _ceiling_basis(report),
        "delivery": {
            "parent_session_id": parent_id,
            "children_finished": len(report.get("children_finished") or []),
            # Two different clocks: each child's own runtime, versus the wall-clock moment the last
            # result landed. They are not interchangeable — the children start after dispatch.
            "children_own_seconds_max": _delivery_seconds(report),
            "last_child_wall_seconds": delivery_at,
            "parent_requests_total": len(parent_requests) if parent_id else None,
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
            "parent_cumulative_approx_input": parent_cumulative if parent_id else None,
            "parent_answered_approx_input": sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in answered_requests),
            "parent_unanswered_approx_input": sum(int(r.get(APPROX_INPUT_FIELD) or 0) for r in unanswered_requests),
            "children_cumulative_approx_input": child_cumulative,
            "note": "limits.approx_cumulative_input is the HARNESS's own ceiling over parent and "
                    "children, not a server-side or product limit. The approx figures in this split "
                    "are always re-presented-context sums, which is the basis this report was scored "
                    "under unless ceiling_basis below says otherwise. The split is derived "
                    "arithmetic, not an observed per-session allowance.",
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
            "interrupted_streamed_text_chars": interrupted_chars,
            "final_event_status": final_status,
            "final_event_text_chars": len(final_text or ""),
            "completion_guard_eligible": guard.get("eligible") if guard else None,
            "note": "answer_state describes observed evidence, not whether an answer was attempted. "
                    "interrupted_with_streamed_text requires matching parent/request-scoped deltas "
                    "and an interrupted completion. mid_tool_loop describes the last completed "
                    "tool response with no pending parent request; an unconfirmed pending request "
                    "remains unknown. natural_delivery records completed delivery, not answer quality "
                    "or original-task acceptance; diagnostic records any changed task policy.",
        },
        "parent_tools": report.get("parent_all_tool_counts") or report.get("parent_tool_counts") or {},
        "completed_api_durations": _completed_api_durations(report, evidence_parent_id, responses),
        "parent_tool_results": _parent_tool_results(report, evidence_parent_id),
        "parent_tool_timing": _parent_tool_timing(events, report.get("session_id")),
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
        for key in ("scenario", "live", "stop_reason", "natural_final", "natural_delivery", "caps", "elapsed_seconds"):
            print(f"   {key}: {summary[key]}")
        for section in ("diagnostic", "delivery_evidence", "limits", "ceiling_basis", "delivery", "budget_split",
                        "parent_cost_shape",
                        "parent_delivery_behaviour", "parent_tools", "completed_api_durations",
                        "parent_tool_results", "parent_tool_timing"):
            print(f"   {section}:")
            for name, value in summary[section].items():
                print(f"      {name}: {value}")
        print(f"   parent_exact_duplicate_tools: {summary['parent_exact_duplicate_tools']}")
        print(f"   parent_character_count_calls: {summary['parent_character_count_calls']}")
        print(f"   fixture_changed_count: {summary['fixture_changed_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
