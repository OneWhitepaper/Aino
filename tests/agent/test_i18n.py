"""Tests for agent.i18n -- catalog parity, fallback, language resolution."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agent import i18n


LOCALES_DIR = Path(__file__).resolve().parents[2] / "locales"


def _load_raw(lang: str) -> dict:
    with (LOCALES_DIR / f"{lang}.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _flatten(d, prefix="") -> dict:
    flat = {}
    for k, v in (d or {}).items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            flat.update(_flatten(v, key))
        else:
            flat[key] = v
    return flat


# ---------------------------------------------------------------------------
# Catalog completeness -- this is the key invariant test.  If someone adds a
# new key to en.yaml they MUST add it to every other locale, else runtime
# falls back to English for those users and defeats the feature.
# ---------------------------------------------------------------------------



@pytest.mark.parametrize("lang", [l for l in i18n.SUPPORTED_LANGUAGES if l != "en"])
def test_catalog_keys_match_english(lang: str):
    """Every non-English catalog must have exactly the same key set as English."""
    en_keys = set(_flatten(_load_raw("en")).keys())
    lang_keys = set(_flatten(_load_raw(lang)).keys())
    missing = en_keys - lang_keys
    extra = lang_keys - en_keys
    assert not missing, f"{lang}.yaml missing keys: {sorted(missing)}"
    assert not extra, f"{lang}.yaml has keys not in en.yaml: {sorted(extra)}"


@pytest.mark.parametrize("lang", list(i18n.SUPPORTED_LANGUAGES))
def test_catalog_placeholders_match_english(lang: str):
    """Every translated value must use the same {placeholder} tokens as English.

    A mistranslated placeholder (e.g. ``{description}`` typoed as ``{descricao}``)
    would either raise KeyError at runtime or silently drop the interpolated
    value.  Pin parity at the test layer.
    """
    import re
    placeholder_re = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
    en_flat = _flatten(_load_raw("en"))
    lang_flat = _flatten(_load_raw(lang))
    for key, en_value in en_flat.items():
        en_placeholders = set(placeholder_re.findall(en_value))
        lang_value = lang_flat.get(key, "")
        lang_placeholders = set(placeholder_re.findall(lang_value))
        assert en_placeholders == lang_placeholders, (
            f"{lang}.yaml key={key!r}: placeholders {lang_placeholders} "
            f"don't match English {en_placeholders}"
        )


def test_simplified_chinese_localizes_gateway_context_and_status_copy():
    """High-traffic gateway diagnostics must not fall through to English."""
    assert i18n.t("gateway.context.header", lang="zh") == "🧠 **上下文窗口**"
    assert i18n.t("gateway.context.model", lang="zh", model="gpt") == "模型：`gpt`"
    assert i18n.t("gateway.context.window", lang="zh", total=4096) == "窗口：4096 个词元"
    assert i18n.t("gateway.context.in_use", lang="zh", used=12, total=100, pct=12) == "已使用：12 / 100（12%）"
    assert i18n.t("gateway.context.headroom", lang="zh", headroom=88) == "距离上限还剩：88 个词元"
    assert i18n.t("gateway.context.compressions", lang="zh", count=3) == "本会话压缩次数：3"
    assert i18n.t("gateway.context.totals_header", lang="zh", calls=4) == "会话总计（累计 4 次 API 调用）"
    assert i18n.t("gateway.context.estimated", lang="zh", count=1200, messages=8) == "估计上下文：约 1200 个词元，分布在 8 条消息中"
    assert i18n.t("gateway.status.matrix_scope_header", lang="zh") == "**Matrix 作用域：**"
    assert i18n.t("gateway.status.matrix_scope_room", lang="zh", room="room-a") == "  房间：room-a"
    assert i18n.t("gateway.status.matrix_scope_room_id", lang="zh", room_id="r1") == "  房间 ID：r1"
    assert i18n.t("gateway.status.matrix_scope_thread", lang="zh", thread_id="t1") == "  线程 ID：t1"
    assert i18n.t("gateway.status.matrix_scope_mode", lang="zh", scope="room") == "  会话作用域：room"
    assert i18n.t("gateway.status.matrix_scope_key", lang="zh", session_key="k1") == "  会话键：k1"
    assert i18n.t("gateway.status.model", lang="zh", model="gpt") == "**模型：** `gpt`"
    assert i18n.t("gateway.status.model_provider", lang="zh", model="gpt", provider="OpenAI") == "**模型：** `gpt`（OpenAI）"
    assert i18n.t("gateway.status.context", lang="zh", used=12, total=100, pct=12) == "**上下文：** 12 / 100（12%）"
    assert i18n.t("gateway.status.context_used", lang="zh", used=12) == "**上下文：** 约 12 个词元"
    assert i18n.t("gateway.status.tokens", lang="zh", tokens=500) == "**累计计费词元：** 500 _（不是当前上下文大小；使用 `/context` 查看）_"


def test_simplified_chinese_localizes_model_token_labels():
    """Model detail labels should use the established Chinese token term."""
    assert i18n.t("gateway.model.context_label", lang="zh", tokens=4096) == "上下文：4096 个词元"
    assert i18n.t("gateway.model.max_output_label", lang="zh", tokens=1024) == "最大输出：1024 个词元"


def test_simplified_chinese_uses_consistent_agent_terminology():
    """User-facing backend status copy should call the model an 智能体."""
    assert i18n.t("gateway.agents.header", lang="zh") == "🤖 **活跃智能体与任务**"
    assert i18n.t("gateway.agents.active_agents", lang="zh", count=2) == "**活跃智能体：** 2"
    assert i18n.t("gateway.agents.none", lang="zh") == "没有活跃的智能体或运行中的任务。"
    assert i18n.t("gateway.approve.once_singular", lang="zh") == "✅ 命令已批准。智能体正在恢复…"
    assert i18n.t("gateway.deny.denied_reason_singular", lang="zh", reason="请重试") == (
        '❌ 命令已拒绝。 已将原因转达给智能体: "请重试"'
    )
    assert i18n.t("gateway.stop.stopped_pending", lang="zh") == "⚡ 已停止。智能体尚未启动 — 你可以继续此会话。"
    assert i18n.t("gateway.personality.cleared", lang="zh") == "🎭 已清除人格 — 使用基础智能体行为。\n_（在下一条消息时生效）_"
    assert i18n.t("gateway.usage.detailed_after_first", lang="zh") == "_（首次智能体响应后可查看详细使用情况）_"
    assert i18n.t("gateway.profile.header", lang="zh", profile="工作") == "👤 **工作区：** `工作`"


def test_simplified_chinese_localizes_telegram_topic_guidance():
    """Telegram topic guidance should be Chinese while retaining menu identifiers."""
    assert i18n.t("gateway.topic.unauthorized", lang="zh") == "您无权在此机器人上使用 /topic。"
    assert i18n.t("gateway.topic.restore_needs_topic", lang="zh") == (
        "若要恢复会话，请先创建或打开一个 Telegram 主题，然后在该主题中发送 /topic <session-id>。"
        "要创建新主题，请打开“所有消息（All Messages）”并在其中发送任意消息。"
    )
    assert i18n.t("gateway.topic.enable_failed", lang="zh", error="权限不足") == "启用 Telegram 主题模式失败：权限不足"
    assert i18n.t("gateway.topic.bound_status", lang="zh", label="工作", session_id="s1") == (
        "此主题已关联到：\n会话：工作\nID：s1\n\n使用 /new 将此主题替换为新会话。"
        "\n如需并行工作，请打开“所有消息（All Messages）”并在其中发送消息以创建另一个主题。"
    )
    assert i18n.t("gateway.topic.thread_ready", lang="zh") == (
        "Telegram 多会话主题已启用。\n\n此主题将作为独立的 Hermes 会话使用。"
        "使用 /new 替换此主题的当前会话。如需并行工作，请打开“所有消息（All Messages）”并在其中发送消息以创建另一个主题。"
    )


def test_simplified_chinese_localizes_kanban_worker_notifications():
    """Kanban notifications should explain worker and dispatcher states in Chinese."""
    assert i18n.t("gateway.kanban.error_prefix", lang="zh", error="连接失败") == "⚠ 看板错误：连接失败"
    assert i18n.t("gateway.kanban.wake.crashed", lang="zh") == "崩溃（工作进程异常退出），任务调度器将重试"
    assert i18n.t("gateway.kanban.wake.timed_out", lang="zh") == "超时，任务调度器将重试"
    assert i18n.t("gateway.kanban.wake.changes_requested", lang="zh") == "评审要求修改（BLOCK/阻塞），实现未获批准"
    assert i18n.t("gateway.kanban.wake.review_detail", lang="zh", reason="缺少测试") == (
        "评审反馈：缺少测试\n请检查现有卡片及其当前评审运行；将工作返回同一实现任务。"
        "不要把此 BLOCK 视为批准，也不要创建重复任务。"
    )


def test_simplified_chinese_localizes_gateway_mode_state_labels():
    """Gateway mode labels should be Chinese while preserving enum values."""
    assert i18n.t("gateway.fast.label_fast", lang="zh") == "快速"
    assert i18n.t("gateway.fast.label_normal", lang="zh") == "标准"
    assert i18n.t("gateway.fast.status_fast", lang="zh") == "fast（快速）"
    assert i18n.t("gateway.fast.status_normal", lang="zh") == "normal（标准）"
    assert i18n.t("gateway.footer.state_on", lang="zh") == "开启"
    assert i18n.t("gateway.footer.state_off", lang="zh") == "关闭"


def test_simplified_chinese_localizes_resume_and_matrix_recovery_copy():
    """Resume recovery guidance should be readable in Simplified Chinese."""
    assert i18n.t("gateway.resume.db_unavailable", lang="zh") == "会话数据库不可用。"
    assert i18n.t("gateway.resume.parse_error", lang="zh", error="bad args") == (
        "⚠️ 无法解析 `/resume` 参数：bad args。\n标题包含空格时请使用引号，例如：`/resume \"项目 A 计划\"`。"
    )
    assert i18n.t("gateway.resume.matrix_no_named_sessions", lang="zh") == (
        "此 Matrix 房间中没有已命名的会话。\n使用 `/title <会话名称>` 为当前房间会话命名，使用 `/resume --all` 列出所有 Matrix 会话，"
        "或使用 `/resume --cross-room <会话名称>` 明确跨越房间边界。"
    )
    assert i18n.t("gateway.resume.matrix_blocked_no_origin", lang="zh", name="session-a") == (
        "⚠️ Matrix /resume 已阻止：此已命名会话没有记录房间来源，因此 Hermes 默认不会在当前房间内恢复它。"
        "如果你确实要跨房间恢复，请使用 `/resume --cross-room session-a`。"
    )
    assert i18n.t("gateway.resume.matrix_blocked_other_room", lang="zh", room="room-b", name="session-a") == (
        "⚠️ Matrix /resume 已阻止：该会话属于其他 Matrix 房间（room-b）。"
        "如果你确实要在此处恢复，请使用 `/resume --cross-room session-a`。"
    )
    assert i18n.t(
        "gateway.resume.matrix_cross_room_success", lang="zh", title="工作", room="room-b", msg_part=""
    ) == (
        "⚠️ 跨房间恢复：已在 Matrix 房间 **room-b** 内恢复 **工作**。"
        "\n在使用 `/reset` 或其他 `/resume` 之前，此房间的后续消息都会使用该记录。"
    )
    assert i18n.t("gateway.resume.blocked_not_owner", lang="zh", name="工作") == (
        "⚠️ /resume 已阻止：'**工作**' 属于其他用户或聊天。你只能恢复此聊天中的会话。"
    )


# ---------------------------------------------------------------------------
# Language resolution
# ---------------------------------------------------------------------------











def test_default_when_nothing_set(monkeypatch):
    """With no env var and no config override, falls back to English."""
    monkeypatch.delenv("HERMES_LANGUAGE", raising=False)
    # Force config lookup to return None -- patch the cached reader.
    i18n.reset_language_cache()
    monkeypatch.setattr(i18n, "_config_language", lambda: None)
    assert i18n.get_language() == "en"


def test_language_is_per_profile_under_multiplex(monkeypatch, tmp_path):
    """HERMES_LANGUAGE in the DEFAULT profile's environ must not leak into a secondary profile's
    turn, and the config-language cache must not freeze one profile's ``display.language`` for all."""
    from agent import secret_scope
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    default_home = tmp_path / "default"; default_home.mkdir()
    prof_b = tmp_path / "b"; prof_b.mkdir()
    (default_home / "config.yaml").write_text("display:\n  language: fr\n")
    (prof_b / "config.yaml").write_text("display:\n  language: de\n")
    monkeypatch.setenv("HERMES_LANGUAGE", "zh")  # default profile's .env, bridged into environ
    monkeypatch.setenv("HERMES_HOME", str(default_home))
    i18n.reset_language_cache()
    secret_scope.set_multiplex_active(True)  # pins the launch home; a served turn binds an override
    token = secret_scope.set_secret_scope({})
    try:
        assert i18n.get_language() == "fr"  # scoped miss: env ignored, this profile's config wins
        home_token = set_hermes_home_override(prof_b)
        try:
            assert i18n.get_language() == "de"  # not the first profile's cached "fr"
        finally:
            reset_hermes_home_override(home_token)
    finally:
        secret_scope.reset_secret_scope(token)
        secret_scope.set_multiplex_active(False)
        i18n.reset_language_cache()


# ---------------------------------------------------------------------------
# t() semantics
# ---------------------------------------------------------------------------







def test_t_missing_key_in_non_english_falls_back_to_english(tmp_path, monkeypatch):
    """If a key exists in English but not in the target locale, fall back."""
    # Stand up a fake incomplete locale under a temp locales dir.
    fake_locales = tmp_path / "locales"
    fake_locales.mkdir()
    (fake_locales / "en.yaml").write_text("foo: English Foo\n", encoding="utf-8")
    (fake_locales / "zh.yaml").write_text("# intentionally empty\n", encoding="utf-8")
    monkeypatch.setattr(i18n, "_locales_dir", lambda: fake_locales)
    i18n.reset_language_cache()
    try:
        assert i18n.t("foo", lang="zh") == "English Foo"
    finally:
        # Clear the cache on teardown so subsequent tests don't see the
        # fake "foo: English Foo" catalog instead of the real locales/*.yaml.
        i18n.reset_language_cache()




# ---------------------------------------------------------------------------
# _locales_dir resolution ladder -- regression for #23943 / #27632 / #35374.
# Sealed installs (Nix store venv, pip wheel) have no source tree next to
# agent/, so _locales_dir must resolve via env override or the data scheme.
# ---------------------------------------------------------------------------



def test_locales_dir_env_override_ignored_when_missing(tmp_path, monkeypatch):
    """A bogus HERMES_BUNDLED_LOCALES falls through to source/wheel resolution
    instead of returning a path that doesn't exist."""
    monkeypatch.setenv("HERMES_BUNDLED_LOCALES", str(tmp_path / "does-not-exist"))
    result = i18n._locales_dir()
    assert result != tmp_path / "does-not-exist"
    # In a source checkout this is the repo-root locales dir.
    assert result.name == "locales"
