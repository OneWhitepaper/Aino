"""Pure Responses request conversion contracts; no provider clients or network."""

from copy import deepcopy
from dataclasses import FrozenInstanceError

import pytest


def prepare(payload, mode="chat_completions", *, replay=None, base_url="https://route.example/v1"):
    from agent.transports.aino_code.protocol_request import prepare_request

    return prepare_request(payload, mode, base_url=base_url, replay=replay)


@pytest.fixture
def function():
    return {
        "type": "function", "name": "read_file", "description": "Read a file",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}},
                       "required": ["path"], "additionalProperties": False},
        "strict": True,
    }


def test_chat_string_request_allowlists_fields_and_keeps_selected_model():
    payload = {
        "model": "vendor/model.1", "input": "hello", "instructions": "Be precise.",
        "stream": False, "max_output_tokens": 120, "temperature": 0.25, "top_p": 0.8,
        "store": True, "include": ["reasoning.encrypted_content"],
        "prompt_cache_key": "session", "metadata": {"session": "a"},
        "reasoning": {"summary": "auto"}, "text": {"verbosity": "low"},
        "base_url": "https://untrusted.example", "api_key": "not-a-key",
    }
    original = deepcopy(payload)
    request = prepare(payload)
    assert request.path == "/chat/completions"
    assert request.body == {
        "model": "vendor/model.1", "stream": True,
        "messages": [{"role": "system", "content": "Be precise."},
                     {"role": "user", "content": "hello"}],
        "max_tokens": 120, "temperature": 0.25, "top_p": 0.8,
    }
    assert request.tools == {}
    assert payload == original
    with pytest.raises(FrozenInstanceError):
        request.path = "/responses"


def test_message_roles_and_image_parts_are_preserved_without_mutation():
    payload = {"model": "exact", "input": [
        {"role": "system", "content": "s"},
        {"role": "developer", "content": [{"type": "input_text", "text": "d"}]},
        {"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": "look"},
            {"type": "input_image", "image_url": "data:image/png;base64,YQ==", "detail": "high"},
        ]},
        {"type": "message", "role": "assistant", "content": [
            {"type": "output_text", "text": "yes", "annotations": [], "logprobs": []},
        ], "id": "msg_a", "phase": "commentary"},
        {"role": "user", "content": "continue"},
    ]}
    original = deepcopy(payload)
    request = prepare(payload)
    assert request.body["messages"] == [
        {"role": "system", "content": "s"},
        {"role": "developer", "content": [{"type": "text", "text": "d"}]},
        {"role": "user", "content": [{"type": "text", "text": "look"},
         {"type": "image_url", "image_url": {"url": "data:image/png;base64,YQ==", "detail": "high"}}]},
        {"role": "assistant", "content": [{"type": "text", "text": "yes"}]},
        {"role": "user", "content": "continue"},
    ]
    request.body["messages"][2]["content"][0]["text"] = "changed"
    assert payload == original


def test_parallel_function_and_freeform_calls_merge_with_assistant_text(function):
    patch = "*** Begin Patch\n*** Add File: a\n+世界\n*** End Patch"
    payload = {"model": "same", "tools": [function, {
        "type": "custom", "name": "apply_patch", "description": "Apply a patch",
        "format": {"type": "grammar", "syntax": "lark", "definition": "start: /.+/"},
    }], "parallel_tool_calls": True, "tool_choice": "required", "input": [
        {"role": "user", "content": "edit"},
        {"role": "assistant", "content": "Checking. "},
        {"role": "assistant", "content": "Editing."},
        {"type": "function_call", "name": "read_file", "arguments": '{ "path": "a" }', "call_id": "call_a"},
        {"type": "custom_tool_call", "name": "apply_patch", "input": patch, "call_id": "call_b"},
        {"type": "custom_tool_call_output", "call_id": "call_b", "output": "ok"},
        {"type": "function_call_output", "call_id": "call_a", "output": [{"type": "input_text", "text": "old"}]},
    ]}
    original = deepcopy(payload)
    request = prepare(payload)
    assert request.body == {
        "model": "same", "stream": True, "parallel_tool_calls": True, "tool_choice": "required",
        "tools": [
            {"type": "function", "function": {k: v for k, v in function.items() if k != "type"}},
            {"type": "function", "function": {"name": "apply_patch", "description": "Apply a patch",
             "parameters": {"type": "object", "properties": {"input": {"type": "string"}},
                            "required": ["input"], "additionalProperties": False}}},
        ],
        "messages": [
            {"role": "user", "content": "edit"},
            {"role": "assistant", "content": "Checking. Editing.", "tool_calls": [
                {"type": "function", "id": "call_a", "function": {"name": "read_file", "arguments": '{ "path": "a" }'}},
                {"type": "function", "id": "call_b", "function": {
                    "name": "apply_patch", "arguments": '{"input":"*** Begin Patch\\n*** Add File: a\\n+世界\\n*** End Patch"}'}},
            ]},
            {"role": "tool", "tool_call_id": "call_b", "content": "ok"},
            {"role": "tool", "tool_call_id": "call_a", "content": [{"type": "text", "text": "old"}]},
        ],
    }
    assert request.tools == {"read_file": {"name": "read_file", "type": "function"},
                             "apply_patch": {"name": "apply_patch", "type": "custom"}}
    request.body["tools"][0]["function"]["parameters"]["properties"]["path"]["type"] = "number"
    assert payload == original


def test_namespaces_and_dotted_tools_use_stable_safe_aliases(function):
    dotted = {**function, "name": "files.read"}
    payload = {"model": "same", "tools": [{"type": "namespace", "name": "repo", "tools": [dotted]}],
               "tool_choice": {"type": "function", "name": "files.read", "namespace": "repo"}, "input": [
                   {"role": "user", "content": "read"},
                   {"type": "function_call", "name": "files.read", "namespace": "repo",
                    "arguments": "{}", "call_id": "a"},
                   {"type": "function_call_output", "call_id": "a", "output": "ok"},
               ]}
    request = prepare(payload)
    assert request.tools == {"repo__files_read": {"name": "files.read", "namespace": "repo", "type": "function"}}
    assert request.body["tools"][0]["function"]["name"] == "repo__files_read"
    assert request.body["tool_choice"] == {"type": "function", "function": {"name": "repo__files_read"}}
    assert request.body["messages"][1]["tool_calls"][0]["function"]["name"] == "repo__files_read"
    payload["tools"].insert(0, function)
    assert prepare(payload).body["tools"][1]["function"]["name"] == "repo__files_read"


@pytest.mark.parametrize("tools", [
    [{"type": "function", "name": "a.b"}, {"type": "function", "name": "a_b"}],
    [{"type": "function", "name": "a"}, {"type": "custom", "name": "a"}],
    [{"type": "function", "name": "repo__a"}, {"type": "namespace", "name": "repo", "tools": [{"type": "function", "name": "a"}]}],
])
def test_ambiguous_tool_aliases_reject_instead_of_dropping(tools):
    with pytest.raises(ValueError, match="collision|duplicate"):
        prepare({"model": "same", "input": "hello", "tools": tools})


@pytest.mark.parametrize("patch", [
    {"previous_response_id": "resp_hidden"},
    {"tools": [{"type": "web_search"}]},
    {"tools": [{"type": "code_interpreter"}]},
    {"input": [{"type": "item_reference", "id": "msg_hidden"}]},
    {"input": [{"type": "computer_call", "call_id": "a"}]},
    {"input": [{"type": "web_search_call", "status": "in_progress"}, {"role": "user", "content": "continue"}]},
    {"input": [{"role": "user", "content": [{"type": "input_audio", "data": "abc"}]}]},
    {"input": [{"role": "user", "content": [{"type": "input_image", "file_id": "file_hidden"}]}]},
    {"input": [{"role": "tool", "content": "unpaired"}]},
    {"input": [{"role": "user", "content": [{"type": "input_text", "text": 7}]}]},
    {"input": [{"type": "function_call_output", "call_id": "missing", "output": "ok"}]},
    {"input": {}}, {"input": [None]}, {"tools": {}}, {"model": ""},
    {"max_output_tokens": 0}, {"max_output_tokens": True}, {"parallel_tool_calls": "yes"},
])
def test_malformed_and_unsupported_requests_reject_locally(patch):
    with pytest.raises(ValueError):
        prepare({"model": "same", "input": "hello", **patch})


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_completed_hosted_search_is_not_replayed_when_bridging_history(mode):
    payload = {"model": "same", "input": [
        {"role": "user", "content": "Look up the marker."},
        {"type": "web_search_call", "status": "completed", "id": "ws_fixture",
         "action": {"type": "open_page", "url": "https://trace.example/raw"},
         "encrypted_content": "opaque-search-state"},
        {"role": "assistant", "content": "The marker is amber."},
        {"role": "user", "content": "Which marker?"},
    ]}
    original = deepcopy(payload)
    reference = {**payload, "input": [item for item in payload["input"] if item.get("type") != "web_search_call"]}
    assert prepare(payload, mode).body == prepare(reference, mode).body
    assert payload == original


def test_previous_response_id_is_removed_when_explicit_history_is_supplied():
    request = prepare({"model": "same", "previous_response_id": "resp_old", "input": [
        {"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "continue"},
    ]})
    assert "previous_response_id" not in request.body
    assert len(request.body["messages"]) == 3


@pytest.fixture
def replay_key():
    from cryptography.fernet import Fernet

    return Fernet.generate_key()


@pytest.fixture
def replay(replay_key):
    from agent.transports.aino_code.replay import ReplayCodec

    return ReplayCodec(replay_key, "profile/session/route/model")


def test_chat_signed_metadata_is_whitelisted_and_merged_after_text(function, replay):
    metadata = {"chat": {
        "reasoning_content": "private thought", "reasoning": "provider thought",
        "reasoning_details": [{"type": "reasoning.encrypted", "data": "opaque", "signature": "sig"}],
        "api_key": "do-not-use", "base_url": "https://other.example", "role": "system",
        "content": "injected", "model": "other",
    }, "api_key": "do-not-use", "base_url": "https://other.example"}
    payload = {"model": "same", "tools": [function], "input": [
        {"role": "user", "content": "read"},
        {"role": "assistant", "content": "Checking."},
        {"type": "reasoning", "encrypted_content": replay.seal(metadata),
         "summary": [{"type": "summary_text", "text": "summary must not replace signed state"}]},
        {"type": "function_call", "name": "read_file", "arguments": "{}", "call_id": "call_a"},
        {"type": "function_call_output", "call_id": "call_a", "output": "ok"},
    ]}
    original = deepcopy(payload)
    request = prepare(payload, replay=replay)
    assert request.body["messages"][1] == {
        "role": "assistant", "content": "Checking.",
        "reasoning_content": "private thought", "reasoning": "provider thought",
        "reasoning_details": [{"type": "reasoning.encrypted", "data": "opaque", "signature": "sig"}],
        "tool_calls": [{"type": "function", "id": "call_a", "function": {"name": "read_file", "arguments": "{}"}}],
    }
    assert request.body["model"] == "same"
    assert payload == original


@pytest.mark.parametrize("native", [True, False])
def test_native_or_other_scope_encrypted_reasoning_uses_summary(native, replay, replay_key):
    from agent.transports.aino_code.replay import ReplayCodec

    token = "gAAAAA_native_codex_blob" if native else ReplayCodec(replay_key, "other").seal(
        {"chat": {"reasoning_content": "must not escape scope"}})
    request = prepare({"model": "same", "input": [
        {"role": "user", "content": "hello"},
        {"type": "reasoning", "encrypted_content": token,
         "summary": [{"type": "summary_text", "text": "First. "}, {"type": "summary_text", "text": "Second."}]},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "continue"},
    ]}, replay=replay)
    assert request.body["messages"][1] == {"role": "assistant", "content": "answer", "reasoning_content": "First. Second."}


@pytest.mark.parametrize("base, path", [
    ("https://api.anthropic.com", "/v1/messages"),
    ("https://route.example/v1", "/messages"),
    ("https://route.example/v1/", "/messages"),
    ("https://route.example/anthropic", "/v1/messages"),
    ("https://route.example/anthropic/v1", "/messages"),
])
def test_anthropic_body_preserves_model_and_all_system_instructions(base, path):
    payload = {"model": "anthropic/claude-opus-4.6", "instructions": "first", "input": [
        {"role": "system", "content": "second"},
        {"role": "developer", "content": [{"type": "input_text", "text": "third"}]},
        {"role": "user", "content": [{"type": "input_text", "text": "look"},
          {"type": "input_image", "image_url": "data:image/png;base64,YQ=="}]},
    ], "max_output_tokens": 500, "temperature": 0.4, "top_p": 0.9,
        "stream": False, "store": True, "text": {"verbosity": "low"}}
    original = deepcopy(payload)
    request = prepare(payload, "anthropic_messages", base_url=base)
    assert request.path == path
    assert request.body == {
        "model": "anthropic/claude-opus-4.6", "stream": True, "max_tokens": 500,
        "temperature": 0.4, "top_p": 0.9, "system": "first\n\nsecond\n\nthird",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "look"},
          {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "YQ=="}}]}],
    }
    assert payload == original


@pytest.mark.parametrize("choice, expected", [
    ("auto", {"type": "auto", "disable_parallel_tool_use": True}),
    ("required", {"type": "any", "disable_parallel_tool_use": True}),
    ("none", {"type": "none"}),
    ({"type": "custom", "name": "apply.patch"}, {"type": "tool", "name": "apply_patch", "disable_parallel_tool_use": True}),
])
def test_anthropic_freeform_history_and_forced_choice_preserve_tools(choice, expected):
    payload = {"model": "unknown-code-model.9", "max_output_tokens": 300, "tools": [
        {"type": "custom", "name": "apply.patch", "description": "Patch", "format": {"type": "text"}},
    ], "tool_choice": choice, "parallel_tool_calls": False, "input": [
        {"role": "user", "content": "edit"},
        {"type": "custom_tool_call", "name": "apply.patch", "call_id": "patch1", "input": "+a\n+b"},
        {"type": "custom_tool_call_output", "call_id": "patch1", "output": [{"type": "input_text", "text": "ok"}]},
    ]}
    request = prepare(payload, "anthropic_messages")
    assert request.body == {
        "model": "unknown-code-model.9", "max_tokens": 300, "stream": True, "tool_choice": expected,
        "tools": [{"name": "apply_patch", "description": "Patch", "input_schema": {
            "type": "object", "properties": {"input": {"type": "string"}},
            "required": ["input"], "additionalProperties": False}}],
        "messages": [
            {"role": "user", "content": "edit"},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "patch1", "name": "apply_patch", "input": {"input": "+a\n+b"}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "patch1", "content": [{"type": "text", "text": "ok"}]}]},
        ],
    }
    assert request.tools == {"apply_patch": {"name": "apply.patch", "type": "custom"}}


def test_anthropic_preserves_nullable_schema_instead_of_normalizing(function):
    function["parameters"]["properties"]["path"] = {"anyOf": [{"type": "string"}, {"type": "null"}]}
    function["parameters"]["allOf"] = [{"required": ["path"]}]
    original = deepcopy(function)
    request = prepare({"model": "same", "input": "hello", "tools": [function]}, "anthropic_messages")
    assert request.body["tools"] == [{"name": "read_file", "description": "Read a file",
                                     "input_schema": original["parameters"], "strict": True}]
    assert function == original


@pytest.mark.parametrize("text_first", [False, True])
def test_anthropic_scoped_signed_replay_keeps_order_on_custom_endpoint(function, replay, text_first):
    function["name"] = "fs.read"
    blocks = [
        {"type": "thinking", "thinking": "step one", "signature": "signed-one"},
        {"type": "text", "text": "Reading."},
        {"type": "tool_use", "id": "read1", "name": "repo__fs_read", "input": {"path": "a"}},
        {"type": "redacted_thinking", "data": "sealed-redacted"},
        {"type": "thinking", "thinking": "step two", "signature": "signed-two"},
        {"type": "tool_use", "id": "read2", "name": "repo__fs_read", "input": {"path": "b"}},
    ]
    reasoning = {"type": "reasoning", "encrypted_content": replay.seal({"anthropic": {"content": blocks}}), "summary": []}
    text = {"role": "assistant", "content": [{"type": "output_text", "text": "Reading."}]}
    payload = {"model": "anthropic/claude-opus-4.6", "tools": [{"type": "namespace", "name": "repo", "tools": [function]}],
               "input": [{"role": "user", "content": "read"}, *([text, reasoning] if text_first else [reasoning, text]),
                    {"type": "function_call", "namespace": "repo", "name": "fs.read", "call_id": "read1", "arguments": '{"path":"a"}'},
                    {"type": "function_call", "namespace": "repo", "name": "fs.read", "call_id": "read2", "arguments": '{"path":"b"}'},
                    {"type": "function_call_output", "call_id": "read2", "output": "b"},
                    {"type": "function_call_output", "call_id": "read1", "output": "a"},
               ]}
    original = deepcopy(payload)
    request = prepare(payload, "anthropic_messages", replay=replay)
    assert request.body["model"] == "anthropic/claude-opus-4.6"
    assert request.body["messages"] == [
        {"role": "user", "content": "read"}, {"role": "assistant", "content": blocks},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "read2", "content": "b"},
            {"type": "tool_result", "tool_use_id": "read1", "content": "a"},
        ]},
    ]
    assert "anthropic_content_blocks" not in str(request.body)
    assert payload == original


@pytest.mark.parametrize("metadata", [
    {"chat": []}, {"chat": {"reasoning_content": 1}}, {"chat": {"reasoning_details": "bad"}},
    {"anthropic": {"content": "bad"}},
    {"anthropic": {"content": [{"type": "server_tool_use", "name": "web_search"}]}},
    {"anthropic": {"content": [{"type": "thinking", "thinking": 1, "signature": "sig"}]}},
])
def test_malformed_authenticated_replay_fails_before_inference(metadata, replay):
    with pytest.raises(ValueError):
        prepare({"model": "same", "input": [
            {"role": "user", "content": "hello"},
            {"type": "reasoning", "encrypted_content": replay.seal(metadata)},
            {"role": "assistant", "content": "answer"},
        ]}, replay=replay)


def test_tampered_tagged_replay_is_not_treated_as_native_reasoning(replay):
    with pytest.raises(ValueError):
        prepare({"model": "same", "input": [
            {"role": "user", "content": "hello"},
            {"type": "reasoning", "encrypted_content": "aino_bridge_v1:invalid"},
        ]}, replay=replay)


@pytest.mark.parametrize("current_tools", [[], [{"type": "function", "name": "new_tool"}]])
def test_history_survives_compaction_or_retired_toolsets(current_tools):
    request = prepare({"model": "same", "tools": current_tools, "input": [
        {"role": "user", "content": "edit"},
        {"type": "custom_tool_call", "name": "apply.patch", "namespace": "repo", "call_id": "p1", "input": "+ok"},
        {"type": "custom_tool_call_output", "call_id": "p1", "output": "done"},
        {"type": "function_call", "name": "files.read", "call_id": "r1", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "r1", "output": "ok"},
        {"role": "user", "content": "summarize"},
    ]})
    assert request.body["messages"][1:5] == [
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "p1", "type": "function", "function": {"name": "repo__apply_patch", "arguments": '{"input":"+ok"}'}}]},
        {"role": "tool", "tool_call_id": "p1", "content": "done"},
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "r1", "type": "function", "function": {"name": "files_read", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "r1", "content": "ok"},
    ]
    assert "repo__apply_patch" not in request.tools
    assert "files_read" not in request.tools


def test_anthropic_tools_free_compaction_uses_existing_history_as_text_policy():
    request = prepare({"model": "same", "tools": [], "input": [
        {"role": "user", "content": "read"},
        {"type": "function_call", "name": "read_file", "call_id": "r1", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "r1", "output": "ok"},
        {"type": "function_call", "name": "read_file", "call_id": "r2", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "r2", "output": "again"},
        {"role": "user", "content": "summarize"},
    ]}, "anthropic_messages")
    assert "tools" not in request.body
    assert request.body["messages"] == [
        {"role": "user", "content": "read"},
        {"role": "assistant", "content": [
            {"type": "text", "text": "[Tool calls:\n  read_file({})\n]"},
            {"type": "text", "text": "[Tool result r1]: ok"},
            {"type": "text", "text": "[Tool calls:\n  read_file({})\n]"},
            {"type": "text", "text": "[Tool result r2]: again"},
        ]},
        {"role": "user", "content": "summarize"},
    ]


def test_historical_tools_are_not_eligible_for_forced_tool_choice():
    with pytest.raises(ValueError, match="declared"):
        prepare({"model": "same", "tools": [], "tool_choice": {"type": "function", "name": "old"}, "input": [
            {"role": "user", "content": "continue"},
            {"type": "function_call", "name": "old", "call_id": "a", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "a", "output": "ok"},
        ]})


@pytest.mark.parametrize("declared", [False, True])
def test_historical_alias_collisions_are_rejected(declared):
    history = [{"role": "user", "content": "read"}]
    if not declared:
        history.extend([
            {"type": "function_call", "name": "a_b", "call_id": "a", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "a", "output": "ok"},
        ])
    history.extend([
        {"type": "function_call", "name": "a.b", "call_id": "b", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "b", "output": "ok"},
    ])
    with pytest.raises(ValueError, match="collision"):
        prepare({"model": "same", "tools": [{"type": "function", "name": "a_b"}] if declared else [], "input": history})


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_call_ids_are_not_silently_normalized(function, mode):
    request = prepare({"model": "same", "tools": [function], "input": [
        {"role": "user", "content": "read"},
        {"type": "function_call", "name": "read_file", "call_id": "call.a", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "call.a", "output": "ok"},
    ]}, mode)
    if mode == "chat_completions":
        assert request.body["messages"][1]["tool_calls"][0]["id"] == "call.a"
        assert request.body["messages"][2]["tool_call_id"] == "call.a"
    else:
        assert request.body["messages"][1]["content"][0]["id"] == "call.a"
        assert request.body["messages"][2]["content"][0]["tool_use_id"] == "call.a"


def test_reasoning_without_readable_or_bridge_data_adds_no_empty_assistant(replay):
    request = prepare({"model": "same", "instructions": "", "input": [
        {"role": "user", "content": "hello"},
        {"type": "reasoning", "encrypted_content": "native_opaque", "summary": []},
        {"role": "user", "content": "continue"},
    ]}, replay=replay)
    assert request.body["messages"] == [
        {"role": "system", "content": ""}, {"role": "user", "content": "hello"},
        {"role": "user", "content": "continue"},
    ]


@pytest.mark.parametrize("base", ["https://route.example/v1", "https://api.anthropic.com"])
@pytest.mark.parametrize("tools_field", [{}, {"tools": []}])
def test_signed_anthropic_tool_free_compaction_preserves_readable_history_without_mutation(
    replay, function, base, tools_field,
):
    blocks = [
        {"type": "thinking", "thinking": "first plan", "signature": "sig-1"},
        {"type": "text", "text": "Reading."},
        {"type": "tool_use", "id": "a", "name": "read_file", "input": {}},
        {"type": "redacted_thinking", "data": "opaque-native-state"},
        {"type": "thinking", "thinking": "second plan", "signature": "sig-2"},
    ]
    token = replay.seal({"anthropic": {"content": blocks}})
    payload = {"model": "anthropic/claude-opus-4.6", "max_output_tokens": 400, **tools_field, "input": [
        {"role": "user", "content": "read"},
        {"role": "assistant", "content": "Reading."},
        {"type": "reasoning", "encrypted_content": token,
         "summary": [{"type": "summary_text", "text": "first plansecond plan"}]},
        {"type": "function_call", "name": "read_file", "call_id": "a", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "a", "output": "ok"},
        {"role": "user", "content": "Continue"},
    ]}
    original = deepcopy(payload)
    request = prepare(payload, "anthropic_messages", replay=replay, base_url=base)
    assert request.body == {
        "model": "anthropic/claude-opus-4.6", "max_tokens": 400, "stream": True,
        "messages": [
            {"role": "user", "content": "read"},
            {"role": "assistant", "content": [
                {"type": "text", "text": "first plan\nsecond plan\nReading.\n[Tool calls:\n  read_file({})\n]"},
                {"type": "text", "text": "[Tool result a]: ok"},
            ]},
            {"role": "user", "content": "Continue"},
        ],
    }
    assert request.tools == {}
    assert payload == original
    live = prepare({**payload, "tools": [function]}, "anthropic_messages", replay=replay, base_url=base)
    assert live.body["messages"][1] == {"role": "assistant", "content": blocks}
    assert payload == original


def test_tool_free_compaction_preserves_chat_reasoning_as_text(replay):
    token = replay.seal({"chat": {"reasoning_content": "readable plan", "reasoning_details": [
        {"type": "reasoning.encrypted", "data": "opaque"},
    ]}})
    request = prepare({"model": "same", "tools": [], "input": [
        {"role": "user", "content": "read"},
        {"type": "reasoning", "encrypted_content": token},
        {"type": "function_call", "name": "old", "call_id": "a", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "a", "output": "ok"},
    ]}, "anthropic_messages", replay=replay)
    assert request.body["messages"][1] == {"role": "assistant", "content": [
        {"type": "text", "text": "readable plan\n[Tool calls:\n  old({})\n]"},
        {"type": "text", "text": "[Tool result a]: ok"},
    ]}


@pytest.mark.parametrize("mutation", ["name", "input", "extra_call", "text"])
def test_signed_replay_cannot_silently_replace_or_invent_visible_history(function, replay, mutation):
    blocks = [{"type": "thinking", "thinking": "plan", "signature": "sig"},
              {"type": "text", "text": "Read."},
              {"type": "tool_use", "id": "a", "name": "read_file", "input": {"path": "a"}}]
    if mutation == "name":
        blocks[2]["name"] = "other"
    elif mutation == "input":
        blocks[2]["input"] = {"path": "other"}
    elif mutation == "extra_call":
        blocks.append({"type": "tool_use", "id": "b", "name": "read_file", "input": {}})
    else:
        blocks[1]["text"] = "Invented text."
    with pytest.raises(ValueError, match="replay.*history"):
        prepare({"model": "same", "tools": [function], "input": [
            {"role": "user", "content": "read"},
            {"role": "assistant", "content": "Read."},
            {"type": "reasoning", "encrypted_content": replay.seal({"anthropic": {"content": blocks}})},
            {"type": "function_call", "name": "read_file", "call_id": "a", "arguments": '{"path":"a"}'},
            {"type": "function_call_output", "call_id": "a", "output": "ok"},
        ]}, "anthropic_messages", replay=replay)


@pytest.mark.parametrize("patch", [
    {"input": [{"type": [], "role": "user", "content": "bad"}]},
    {"input": [{"role": [], "content": "bad"}]},
    {"input": [{"role": "user", "content": [{"type": [], "text": "bad"}]}]},
    {"tools": [{"type": []}]},
    {"tool_choice": {"type": []}},
    {"tool_choice": "required"},
    {"input": [{"type": "function_call", "name": "f", "call_id": "a", "arguments": '{"x":NaN}'},
               {"type": "function_call_output", "call_id": "a", "output": "ok"}]},
])
def test_bad_discriminators_and_invalid_json_are_validation_errors(patch):
    with pytest.raises(ValueError):
        prepare({"model": "same", "input": "hello", **patch})


def test_unsupported_inline_image_is_rejected_without_rasterization():
    with pytest.raises(ValueError, match="image"):
        prepare({"model": "same", "input": [{"role": "user", "content": [
            {"type": "input_image", "image_url": "data:image/svg+xml;base64,YQ=="},
        ]}]}, "anthropic_messages")


def test_anthropic_allows_native_text_and_image_tool_results(function):
    request = prepare({"model": "same", "tools": [function], "input": [
        {"role": "user", "content": "read"},
        {"type": "function_call", "name": "read_file", "call_id": "a", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "a", "output": [
            {"type": "input_text", "text": "screenshot"},
            {"type": "input_image", "image_url": "https://images.example/a.png"},
        ]},
    ]}, "anthropic_messages")
    assert request.body["messages"][2]["content"] == [{
        "type": "tool_result", "tool_use_id": "a", "content": [
            {"type": "text", "text": "screenshot"},
            {"type": "image", "source": {"type": "url", "url": "https://images.example/a.png"}},
        ],
    }]
