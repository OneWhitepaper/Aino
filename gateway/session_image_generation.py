"""UI image work borrows an exact GUI session's existing image binding, never ambient keys."""
from agent.managed_image_provider import managed_image_scope
from gateway.session_busy_controls import authorize
from gateway.session_llm_oneshot import DeferredReply
from hermes_state_runtime import RuntimeStoreError


async def generate(connection, ref, params):
    from tui_gateway.image_generation import generate_image
    from utils import is_truthy_value

    if set(params) - {'session_id', 'profile', 'prompt', 'aspect_ratio', 'probe', 'max_bytes'}:
        raise RuntimeStoreError('invalid_params')
    from gateway.session_authorities import require_serving
    require_serving(connection.authority)
    if 'session:control' not in connection.actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    if is_truthy_value(params.get('probe', False)):
        return DeferredReply(lambda: generate_image(params))
    if not isinstance(params.get('prompt'), str) or not params['prompt'].strip():
        raise RuntimeStoreError('invalid_params', field='prompt')
    if not ref.session_id:
        # Non-managed backends retain their original sessionless image RPC.
        return DeferredReply(lambda: generate_image(params))

    authorize(connection, ref, params, 'session:control')
    from gateway.session_platform_model import _owned, binding_key, managed_state
    from tui_gateway.managed_model_runtime import get_registry
    live, state = _owned(connection, ref, issuer=True, purpose='image')
    key = binding_key(connection.authority, ref.session_id)
    initial = get_registry().get(key, state, purpose='image')
    if initial is None:
        raise RuntimeStoreError('awaiting_managed_image_credentials')

    def body():
        active = [True]

        def resolve():
            if (not active[0] or ref.session_id not in connection.subscriptions
                    or connection.authority.sessions.get(ref.session_id) is not live
                    or getattr(connection.authority, 'retiring', False)):
                return None
            try:
                current = managed_state(connection.authority, ref.session_id, purpose='image')
            except RuntimeStoreError:
                return None
            binding = get_registry().get(key, current, purpose='image')
            return binding if binding and (binding.owner, binding.model_id, binding.binding_revision) == (
                initial.owner, initial.model_id, initial.binding_revision) else None

        with managed_image_scope(resolve):
            try:
                return generate_image(params)
            finally:
                active[0] = False

    return DeferredReply(body)
