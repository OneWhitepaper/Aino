"""Prepare the existing support envelope, including bounded client text; no uploads."""
import base64

MAX_COMPRESSED_BYTES = 8 * 1024 * 1024


def _redact_client_text(text: str, cap: int) -> str:
    # Scrub before truncating so cutting a key cannot evade the redactor.
    from hermes_cli.debug_redaction import redact_debug_support_text
    cut = text.find("\n", 2 * cap, 3 * cap)
    window = text[:cut + 1] if cut >= 0 else text[:2 * cap]
    return redact_debug_support_text(window, max_chars=cap)


def _safe_client_label(label: str) -> str:
    safe = "".join(ch for ch in label if ch.isalnum() or ch in "._- ()").strip()[:64]
    while ".." in safe:
        safe = safe.replace("..", ".")
    return safe.lstrip(".").strip()


def collect_client_bundle(params: dict) -> bytes:
    """Reuse the CLI's forced-redaction pipeline and stable gzip envelope."""
    from hermes_cli.debug import build_nous_bundle, collect_share_bundle
    log_lines = params.get("log_lines")
    if not isinstance(log_lines, int) or not 10 <= log_lines <= 2000:
        log_lines = 200
    bundle = collect_share_bundle(log_lines=log_lines, redact=True)
    context = params.get("error_context")
    if isinstance(context, str) and context.strip():
        bundle["error-context.txt"] = _redact_client_text(context.strip(), 8_000)
    extras = params.get("extra_files")
    for label, text in list(extras.items())[:4] if isinstance(extras, dict) else ():
        safe = _safe_client_label(label) if isinstance(label, str) else ""
        if safe and isinstance(text, str) and text.strip():
            bundle[f"client/{safe}"] = _redact_client_text(text, 524_288)
    blob = build_nous_bundle(bundle, redact=True)
    if len(blob) > MAX_COMPRESSED_BYTES:
        raise ValueError("diagnostics_bundle_too_large")
    return blob


def collect_client_result(params: dict) -> dict:
    """The transport result carries bytes only; Electron owns authenticated upload."""
    from hermes_cli.debug_redaction import redact_debug_support_text
    try:
        return {"ok": True, "bundle_base64": base64.b64encode(collect_client_bundle(params)).decode("ascii")}
    except (OSError, ValueError, RuntimeError) as exc:
        return {"ok": False, "error": redact_debug_support_text(exc)}
