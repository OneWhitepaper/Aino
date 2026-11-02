"""Connector UI payload redaction.

Preserve authorization links while redacting credentials.
"""

from agent.redact import _key_has_secret_keyword, redact_sensitive_text


def connector_ui_payload(value, _path=()):
    if isinstance(value, dict):
        return {key: (item if _path == ("targets", "*", "mcp_config")
                      and key == "auth" and item in ("oauth", "none")
                      else "[REDACTED]" if (not isinstance(item, bool)
                      and (_key_has_secret_keyword(key)
                           or key.lower() in {"authorization", "proxy-authorization", "cookie", "set-cookie",
                                              "credentials"}))
                      else item if key == "connect_url" and isinstance(item, str)
                      else connector_ui_payload(item, (*_path, key))) for key, item in value.items()}
    if isinstance(value, list):
        return [connector_ui_payload(item, (*_path, "*")) for item in value]
    return redact_sensitive_text(value, force=True, redact_url_credentials=True) if isinstance(value, str) else value
