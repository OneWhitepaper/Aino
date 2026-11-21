"""Session-managed catalog rows require a live binding, never ambient BYOK credentials."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tests.e2e.core.providers._catalog_helpers import (
    FINAL, Row, credential_values, decoy_keys, discover_catalog, drive_turn, evaluate, hermetic_env,
    provider_hosts, run_hermes, write_home,
)
from tests.fakes.providers.catalog_fake import CatalogFake

MANAGED_ROWS = [row for row in discover_catalog() if row.auth_type == "session_managed"]

_RESOLVE = """
import json, sys
from hermes_cli.config import load_config
from hermes_cli.runtime_provider import resolve_runtime_with_fallback
try:
    runtime, fallback = resolve_runtime_with_fallback(load_config(), **json.loads(sys.argv[1]))
    result = dict(ok=True, provider=runtime['provider'], base_url=runtime['base_url'], fallback=fallback)
except Exception as exc:
    result = dict(ok=False, error=str(exc), error_type=type(exc).__name__)
print('RESULT=' + json.dumps(result))
"""


@pytest.mark.parametrize("row", MANAGED_ROWS, ids=lambda row: row.name)
@pytest.mark.parametrize("request_kind", ["configured", "explicit", "auto", "override"])
def test_unbound_managed_runtime_fails_closed(row: Row, request_kind: str, tmp_path: Path) -> None:
    """Real resolution must refuse even with unrelated keys and a configured paid fallback."""
    with CatalogFake() as fake:
        home = write_home(tmp_path, {"provider": row.name}, {
            "model_catalog": {"enabled": False},
            "plugins": {"auto_update_check_hours": 0},
            "security": {"allow_lazy_installs": False},
            "fallback_providers": [{"provider": "custom", "model": "fallback-model",
                                    "base_url": fake.origin + "/fallback/v1", "api_key": "sk-fallback-decoy"}],
        })
        kwargs = {} if request_kind == "configured" else {"requested": row.name}
        if request_kind == "auto":
            kwargs = {"requested": "auto"}
        elif request_kind == "override":
            kwargs.update(explicit_base_url=fake.origin + "/override/v1", explicit_api_key="sk-override-decoy")
        proc = subprocess.run(
            [sys.executable, "-c", _RESOLVE, json.dumps(kwargs)], cwd=tmp_path,
            env=hermetic_env(home, {**decoy_keys(discover_catalog()), **fake.proxy_env()}),
            capture_output=True, text=True, timeout=30, check=False,
        )
        line = next((line for line in proc.stdout.splitlines() if line.startswith("RESULT=")), None)
        assert proc.returncode == 0 and line, (proc.stdout, proc.stderr)
        result = json.loads(line.removeprefix("RESULT="))
        assert result["ok"] is False, result
        assert result["error_type"] == "ValueError", result
        assert "session" in result["error"].lower() and "binding" in result["error"].lower(), result
        assert not fake.requests and not fake.egress, (fake.requests, fake.egress_hosts())
        print("UNBOUND-RUNTIME " + json.dumps({"row": row.name, "request_kind": request_kind,
                                             "result": result, "requests": [], "egress": []}))


@pytest.mark.parametrize("row", MANAGED_ROWS, ids=lambda row: row.name)
def test_unbound_managed_cli_does_not_infer_or_fallback(row: Row, tmp_path: Path) -> None:
    with CatalogFake() as fake:
        home = write_home(tmp_path, {"provider": row.name}, {
            "model_catalog": {"enabled": False},
            # No unrelated release checks or detached default-plugin installs in this offline home.
            "plugins": {"auto_update_check_hours": 0},
            "security": {"allow_lazy_installs": False},
            "fallback_providers": [{"provider": "custom", "model": "fallback-model",
                                    "base_url": fake.origin + "/fallback/v1", "api_key": "sk-fallback-decoy"}],
        })
        proc = run_hermes(home, tmp_path, {**decoy_keys(discover_catalog()), **fake.proxy_env()},
                          "-z", "Report whether this managed session is connected.")
        detail = proc.stdout + proc.stderr
        assert proc.returncode != 0 and FINAL not in detail, detail
        assert "binding" in detail.lower() and "session" in detail.lower(), detail
        assert not fake.inference(), fake.requests
        assert not set(fake.egress_hosts()).intersection(provider_hosts(discover_catalog())), fake.egress_hosts()
        secrets = {*decoy_keys(discover_catalog()).values(), "sk-fallback-decoy"}
        assert not any(credential_values(rec, secrets)
                       for rec in [*fake.requests, *fake.egress]), fake.egress_hosts()
        assert not fake.egress, fake.egress_hosts()
        print("UNBOUND-CLI " + json.dumps({"row": row.name, "exit_code": proc.returncode,
                                         "inference": [], "egress": fake.egress_hosts()}))


@pytest.mark.parametrize("row", MANAGED_ROWS, ids=lambda row: row.name)
def test_managed_catalog_row_uses_real_websocket_binding(row: Row, tmp_path: Path) -> None:
    turn = drive_turn(row, tmp_path, discover_catalog())
    assert turn.completion is not None, "managed coverage must complete through the real WS transport"
    assert turn.rc is None, "the backend must still be alive when it publishes completion"
    cells = evaluate(turn, discover_catalog())
    assert all(cells.values()), (cells, turn.detail())
    print("BOUND-WS " + json.dumps({"row": row.name, "backend_exit_code": turn.rc,
                                   "completion": turn.completion, "cells": cells,
                                   "paths": [rec.path for rec in turn.requests], "egress": turn.egress,
                                   "usage": turn.usage}))
