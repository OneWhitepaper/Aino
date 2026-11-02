"""Context engine choices name actual engines in the requested profile."""

from contextlib import contextmanager
from textwrap import dedent

from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from hermes_cli.web_server_config import _schema_with_dynamic_provider_options


_ENGINE = dedent('''
    from agent.context_engine import ContextEngine

    class Engine(ContextEngine):
        name = "{name}"
        def update_from_response(self, usage):
            pass
        def should_compress(self, prompt_tokens=None):
            return False
        def compress(self, messages, current_tokens=None):
            return messages

    def register(ctx):
        ctx.register_context_engine(Engine())
''')


@contextmanager
def home_scope(home):
    token = set_hermes_home_override(home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def install_engine(home, name):
    path = home / "plugins" / name
    path.mkdir(parents=True)
    (path / "__init__.py").write_text(_ENGINE.format(name=name), encoding="utf-8")


def options():
    return _schema_with_dynamic_provider_options()["context.engine"]["options"]


def test_schema_lists_builtin_and_live_installed_engines_without_phantom_choices(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    install_engine(tmp_path, "schema_engine_a")
    unavailable = tmp_path / "plugins" / "schema_unavailable"
    unavailable.mkdir()
    (unavailable / "__init__.py").write_text(
        "from agent.context_engine import ContextEngine\nraise ImportError('missing engine dependency')\n",
        encoding="utf-8",
    )
    with home_scope(tmp_path):
        initial = options()
        assert "compressor" in initial
        assert "schema_engine_a" in initial
        assert "default" not in initial
        assert "custom" not in initial
        assert "schema_unavailable" not in initial
        install_engine(tmp_path, "schema_engine_b")
        assert "schema_engine_b" in options()


def test_schema_preserves_current_unknown_engine_without_rewriting_config(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    config_path = tmp_path / "config.yaml"
    text = "context:\n  engine: legacy_removed_engine\n"
    config_path.write_text(text, encoding="utf-8")
    with home_scope(tmp_path):
        assert "legacy_removed_engine" in options()
    assert config_path.read_text(encoding="utf-8") == text


def test_schema_discovers_only_the_requested_profile_engines(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    first = tmp_path / "first"
    second = tmp_path / "second"
    install_engine(first, "schema_first")
    install_engine(second, "schema_second")
    with home_scope(first):
        first_options = options()
    with home_scope(second):
        second_options = options()
    assert "schema_first" in first_options and "schema_second" not in first_options
    assert "schema_second" in second_options and "schema_first" not in second_options
