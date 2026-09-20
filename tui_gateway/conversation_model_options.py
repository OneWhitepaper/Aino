"""Validate generation-local options through existing model capability resolvers."""
import json

from gateway.hosted_room_conversation_bindings import ConversationBindingError


def option_selection(reasoning_effort=None, fast=None):
    from hermes_constants import VALID_REASONING_EFFORTS
    if reasoning_effort is not None and reasoning_effort not in ('none', *VALID_REASONING_EFFORTS):
        raise ConversationBindingError('invalid reasoning effort')
    if fast is not None and type(fast) is not bool:
        raise ConversationBindingError('fast must be a boolean')
    return {key: value for key, value in {'reasoning_effort': reasoning_effort, 'fast': fast}.items()
            if value is not None}


def merge_selection(previous, requested):
    previous = dict(previous)
    source_changed = 'model_source' in requested and requested['model_source'] != previous.get('model_source')
    model_changed = 'model_id' in requested and requested['model_id'] != previous.get('model_id')
    if source_changed:
        previous.pop('model_id', None)
    if source_changed or model_changed:
        previous.pop('reasoning_effort', None)
        previous.pop('fast', None)
    return {**previous, **requested}


def managed_capabilities(server, stored, model_id):
    """Only the authenticated binding supplies the meaning of an opaque platform ID."""
    if not stored:
        return None
    snapshot = json.loads(stored['model_snapshot'])
    if snapshot.get('model_source') != 'aino' or snapshot.get('model_id') != model_id:
        return None
    from .managed_model_runtime import get_registry
    with server._sessions_lock:
        sessions = tuple(server._sessions.items())
    for sid, session in sessions:
        meta = session.get('_conversation_binding') or {}
        if (meta.get('conversation_id'), meta.get('participant_id'), meta.get('session_generation')) == (
                stored['conversation_id'], stored['participant_id'], stored['session_generation']):
            binding = get_registry().get(sid, session)
            if binding and binding.model_id == model_id:
                return {'model': binding.model, 'provider': 'aino', 'api_mode': binding.api_mode,
                        'reasoning': binding.capabilities.get('reasoning'),
                        'fast': binding.capabilities.get('fast') is True,
                        'can_disable_reasoning': _managed_can_disable(binding)}
    return snapshot.get('option_capabilities')


def validate_options(server, profile_home, selection, stored=None):
    effort, fast = selection.get('reasoning_effort'), selection.get('fast')
    if effort is None and fast is not True:
        return
    with server._profile_build_scope(profile_home):
        if selection.get('model_source') == 'aino':
            caps = managed_capabilities(server, stored, selection.get('model_id'))
            if not caps:
                raise ConversationBindingError('Model options unavailable until its authenticated capabilities are known')
            if fast is True and caps.get('fast') is not True:
                raise ConversationBindingError('Fast mode is unavailable for this authenticated platform route')
            if effort == 'none' and caps.get('can_disable_reasoning') is not True:
                raise ConversationBindingError('Disabling reasoning is unavailable for this platform model')
            if effort is not None and caps.get('reasoning') is not True:
                raise ConversationBindingError('Reasoning options are unavailable for this platform model')
            return
        prepared = prepared_byok_options(server, selection)
        caps = prepared['option_capabilities']
        if fast is True and caps['fast'] is not True:
            raise ConversationBindingError('Fast mode is unsupported for this model and provider route')
        if effort is None:
            return
        if caps['reasoning'] is not True:
            raise ConversationBindingError('Reasoning options unavailable: model capability is unsupported or unverified')
        if effort == 'none' and caps['can_disable_reasoning'] is not True:
            raise ConversationBindingError('This model cannot disable reasoning')
        declared = caps['supported_efforts']
        if declared is not None and effort not in declared:
            raise ConversationBindingError('Reasoning effort is unsupported for this model and provider')



def prepared_byok_options(server, selection):
    """A validated draft display, distinct from the later built-agent capability proof."""
    from hermes_cli.runtime_provider import resolve_runtime_provider
    model = selection.get('model_id') or server._resolve_model()
    try:
        runtime = resolve_runtime_provider(target_model=model)
    except (RuntimeError, ValueError) as exc:
        raise ConversationBindingError('Model options unavailable: provider route could not be resolved') from exc
    provider = runtime.get('provider')
    if provider == 'custom':
        from hermes_cli.runtime_provider import canonical_custom_identity
        provider = canonical_custom_identity(base_url=runtime.get('base_url'), model=model) or provider
    return {'model': model, 'provider': provider,
            'option_capabilities': byok_capabilities(model, provider, runtime.get('base_url'), allow_fetch=True)}

def _managed_can_disable(binding):
    if type(binding.capabilities.get('can_disable_reasoning')) is bool:
        return binding.capabilities['can_disable_reasoning']
    if binding.api_mode == 'responses' and binding.model.startswith(('gpt-', 'openai/gpt-')):
        from agent.reasoning_effort import codex_supported_efforts
        return 'none' in codex_supported_efforts(binding.model)
    return None


def byok_capabilities(model, provider, base_url, *, allow_fetch=False):
    from hermes_cli.models import resolve_fast_mode_overrides
    from agent.models_dev import get_model_capabilities
    from hermes_cli.models_reasoning_caps import openrouter_model_reasoning_capabilities, nous_model_reasoning_capabilities
    readers = {'openrouter': openrouter_model_reasoning_capabilities, 'nous': nous_model_reasoning_capabilities}
    detail = readers[provider](model, allow_fetch=allow_fetch) if provider in readers else None
    meta = get_model_capabilities(provider, model)
    reasoning = detail.get('supports_reasoning') if detail is not None else (meta.supports_reasoning if meta else None)
    can_disable = not detail.get('mandatory') if detail and reasoning else reasoning
    from providers import get_provider_profile
    profile = get_provider_profile(provider)
    declared = profile.supported_reasoning_efforts(model) if profile else None
    if declared is not None:
        can_disable = 'none' in declared
    return {'reasoning': reasoning, 'can_disable_reasoning': can_disable,
            'supported_efforts': list(declared) if declared is not None else None,
            'fast': bool(resolve_fast_mode_overrides(model, provider=provider, base_url=base_url))}
