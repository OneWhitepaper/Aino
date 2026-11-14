#!/usr/bin/env python3
"""Interact with the in-app browser / preview pane in the Hermes desktop GUI (click, type, scroll).

Elements are addressed by legible refs from ``action="elements"`` (``btn-sign-in``); a ref survives
re-renders and only a navigation retires it, so the renderer answers with a *delta* instead of
re-sending the inventory. Round-trips through the gateway's blocking-prompt bridge
(``preview.act.request`` / ``preview.act.respond``); this module is schema + a thin dispatcher over
the platform-injected callback. ``desktop_ui`` toolset: desktop-sourced sessions only.
"""

from typing import Any, Callable, Optional

from hermes_cli.product_identity import PRODUCT_NAME
from tools.browser_vault_preview import redact_preview_result
from tools.drive_preview_visual import preview_visual_result, validate_visual_action
from tools.registry import registry, tool_error

ACTIONS = (
    "elements", "screenshot", "click", "double_click", "hover", "type", "scroll", "press", "drag", "strobe",
    "back", "forward", "reload", "tabs", "select_tab", "dialog_status", "dialog_respond", "upload_files",
    "downloads_status", "download_cancel",
)
SCROLL_TO = ("top", "bottom")

# Verbs that need something to act on — a ref from the last inventory, or a
# raw CSS selector. `scroll` is deliberately absent: bare, it scrolls the page.
NEEDS_TARGET = ("click", "double_click", "hover", "type", "press", "upload_files")


def drive_preview_tool(
    action: str = "", ref: Optional[str] = None, selector: Optional[str] = None, text: Optional[str] = None,
    key: Optional[str] = None, submit: Optional[bool] = None, amount: Optional[int] = None,
    to: Optional[str] = None, limit: Optional[int] = None, full: Optional[bool] = None,
    allow_shortcut: Optional[bool] = None, tab_id: Optional[str] = None, observation_id: Optional[str] = None,
    coordinate: Optional[list[float]] = None, to_coordinate: Optional[list[float]] = None,
    sensitive: Optional[bool] = None, dialog_id: Optional[str] = None, accept: Optional[bool] = None,
    prompt_text: Optional[str] = None, paths: Optional[list[str]] = None,
    download_id: Optional[str] = None, download_path: Optional[str] = None, chooser_id: Optional[str] = None,
    callback: Optional[Callable] = None) -> str | dict[str, Any]:
    """Dispatch one interaction to the desktop renderer and return its outcome."""
    if callback is None:
        return tool_error(f"drive_preview is only available in the {PRODUCT_NAME} desktop app.")
    verb = (action or "").strip().lower()
    if verb not in ACTIONS:
        return tool_error(f"action must be one of: {', '.join(ACTIONS)}.")
    if verb in NEEDS_TARGET and not (ref or selector or coordinate is not None or (verb == "upload_files" and chooser_id)):
        return tool_error(f"{verb} needs a ref from action='elements' (e.g. 'btn-sign-in'), a CSS selector or screenshot coordinates.")
    if verb == "type" and text is None:
        return tool_error("type needs the text to enter.")
    if verb == "press" and not key:
        return tool_error("press needs a key, e.g. 'Enter' or 'Escape'.")
    if verb == "select_tab" and not tab_id:
        return tool_error("select_tab needs an exact tab_id from action='tabs'.")
    if verb == "dialog_respond" and (not dialog_id or not isinstance(accept, bool)):
        return tool_error("dialog_respond needs the current dialog_id and boolean accept.")
    if verb == "upload_files" and (not isinstance(paths, list) or not paths or any(not isinstance(path, str) or not path for path in paths)):
        return tool_error("upload_files needs a nonempty paths list of absolute local file paths.")
    if verb == "download_cancel" and not download_id:
        return tool_error("download_cancel needs a download_id from downloads_status.")
    if to is not None and to not in SCROLL_TO:
        return tool_error(f"to must be one of: {', '.join(SCROLL_TO)}.")
    try:
        fields = (
            ("action", verb), ("ref", ref), ("selector", selector), ("text", text), ("key", key),
            ("submit", submit), ("full", full), ("to", to), ("allow_shortcut", allow_shortcut),
            ("tab_id", tab_id), ("observation_id", observation_id), ("coordinate", coordinate),
            ("to_coordinate", to_coordinate), ("sensitive", sensitive),
            ("dialog_id", dialog_id), ("accept", accept), ("prompt_text", prompt_text), ("paths", paths),
            ("download_id", download_id), ("download_path", download_path),
            ("chooser_id", chooser_id),
            ("amount", None if amount is None else int(amount)), ("max", None if limit is None else int(limit)),
        )
    except (TypeError, ValueError):
        return tool_error("amount and max must be integers.")
    payload = {name: val for name, val in fields if val is not None}
    if error := validate_visual_action(payload):
        return tool_error(error)
    try:
        raw = callback(payload)
    except Exception as exc:
        return redact_preview_result(tool_error(f"Failed to act on the in-app browser: {exc}"))
    if not raw:
        return tool_error(
            "No GUI window answered with a page: no preview tab is open. "
            "Open a page with open_preview first. If the pane IS open, the desktop app "
            "may be older than this backend — its bridge-unavailable error names that case.")
    return preview_visual_result(raw, screenshot_required=verb == "screenshot")


ACT_PREVIEW_SCHEMA = {
    "name": "drive_preview",
    # Response-shape teaching kept only where skipping it wastes calls (delta
    # semantics, rebound refs, strobe's burst): a model that doesn't know them
    # re-reads pages or loops strobe.
    # See #95681.
    "description": (
        "Use the desktop preview-pane page: log in, fill forms, click through flows. "
        "It is the page `desktop_preview` opens. Prefer "
        "action='elements' — it inventories clickable/typable "
        "things as refs ('btn-sign-in') with role/label/value; act by ref, "
        "not guessed selectors. Refs survive re-renders and only die on "
        "navigation (you'll be told they're stale — call elements again). "
        "After the first full inventory, actions answer with a DELTA: "
        "'added' in full, 'changed' as ref + moved fields, 'removed'/"
        "'rebound' as ref lists ('rebound' needs nothing from you — the ref "
        "already follows the rebuilt element). Anything unmentioned is "
        "unchanged; do not re-read to check. Input is real (pointer travels, "
        "hover menus open). Actions: elements, click, double_click, hover (park the "
        "pointer — opens dropdowns before clicking in), type (submit=true "
        "also presses Enter), scroll, press, strobe (visual flourish only — "
        "one call runs a multi-second burst; never loop it), back/forward/"
        "reload. screenshot returns the selected tab's pixels, tab_id and observation_id. "
        "tabs lists only this conversation's Browser tabs and shared profile pins; select_tab chooses an exact "
        "tab_id without reloading its page. After selection, observe again before using refs or coordinates. "
        "dialog_status inspects a pending native dialog; dialog_respond answers its exact dialog_id with accept "
        "and optional prompt_text. upload_files selects approved absolute local paths for a file input or its "
        "associated upload label. After an Attach button opens a file chooser, use dialog_status and its "
        "file_chooser.id as chooser_id instead of guessing a hidden input selector. "
        "downloads_status inspects downloads; with download_path it requests user permission for ONE next "
        "download to that nonexisting local path. download_cancel cancels an exact download_id. "
        "Use screenshot pixel coordinates only when semantic refs cannot identify the target; "
        "coordinate actions require that tab_id and observation_id, and drag also needs to_coordinate. "
        "Capture again after navigation, tab changes or stale-observation errors; never guess coordinates "
        "when the screenshot image was omitted. Set sensitive=true to request user confirmation before "
        "submitting, deleting, paying or changing account/security settings; it never grants approval. "
        "Moves draw live and fade; annotate_preview leaves a lasting "
        "mark. A printable press on body/html is refused unless allow_shortcut "
        "is true. Page text only: desktop_preview action=read. Separate automated "
        "browser: browser_* tools."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": list(ACTIONS),
                "description": "Prefer 'elements'; use 'screenshot' for visual observation.",
            },
            "tab_id": {"type": "string", "description": "Exact owned preview tab; required for select_tab and coordinate actions."},
            "dialog_id": {"type": "string", "description": "dialog_respond: current dialog identifier returned by dialog_status."},
            "accept": {"type": "boolean", "description": "dialog_respond: accept or dismiss the exact pending dialog. Not user approval."},
            "prompt_text": {"type": "string", "description": "dialog_respond: optional text for a native prompt."},
            "paths": {"type": "array", "items": {"type": "string"}, "minItems": 1,
                      "description": "upload_files: absolute file paths on the native desktop computer; user confirmation is required."},
            "chooser_id": {"type": "string", "description": "upload_files: exact pending chooser ID from dialog_status; replaces ref/selector for a website Attach button."},
            "download_id": {"type": "string", "description": "download_cancel: exact ID from downloads_status."},
            "download_path": {"type": "string", "description": "downloads_status: authorize one next download to this exact nonexisting absolute local path, after user confirmation."},
            "observation_id": {"type": "string", "description": "Screenshot observation token; required for coordinate actions."},
            "coordinate": {
                "type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2,
                "description": "Target [x,y] in the returned screenshot's pixel space. Prefer semantic refs.",
            },
            "to_coordinate": {
                "type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2,
                "description": "drag: destination [x,y] in the same screenshot's pixel space.",
            },
            "sensitive": {
                "type": "boolean",
                "description": "Request user confirmation for a consequential action. Never bypasses approval.",
            },
            "ref": {
                "type": "string",
                "description": "Element ref from an earlier elements call.",
            },
            "selector": {
                "type": "string",
                "description": "CSS selector fallback. Prefer ref.",
            },
            "text": {"type": "string", "description": "type: the text."},
            "submit": {
                "type": "boolean",
                "description": "type: press Enter + submit the form after.",
            },
            "key": {
                "type": "string",
                "description": "press: key name ('Enter', 'Escape', 'ArrowDown').",
            },
            "allow_shortcut": {
                "type": "boolean",
                "description": "press: allow a printable key on body/html. Off by default.",
            },
            "amount": {
                "type": "integer",
                "description": "scroll: pixels (negative = up; default ~one screen).",
            },
            "to": {
                "type": "string",
                "enum": list(SCROLL_TO),
                "description": "scroll: jump to top/bottom instead.",
            },
            "max": {
                "type": "integer",
                "description": "elements: cap the inventory (maximum 120). A capped result notes omitted controls; scroll and inspect again.",
            },
            "full": {
                "type": "boolean",
                "description": "elements: re-read the inventory instead of a delta; still capped at 120, not the entire document. Rarely needed.",
            },
        },
        "required": ["action"],
    },
}


registry.register(
    name="drive_preview",
    toolset="desktop_ui",
    schema=ACT_PREVIEW_SCHEMA,
    handler=lambda args, **kw: drive_preview_tool(
        action=args.get("action", ""), limit=args.get("max"), callback=kw.get("callback"),
        **{k: args.get(k) for k in (
            "ref", "selector", "text", "key", "submit", "amount", "to", "full", "allow_shortcut",
            "tab_id", "observation_id", "coordinate", "to_coordinate", "sensitive", "dialog_id", "accept",
            "prompt_text", "paths", "download_id", "download_path", "chooser_id")},
    ),
    emoji="🖱️")
