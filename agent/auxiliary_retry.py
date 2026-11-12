"""Same-provider retry eligibility at the auxiliary dispatch boundary."""

from typing import Any, Optional


def stop_managed_auxiliary_replay(client, error):
    """Internal negotiation and budget recovery must obey the managed boundary too."""
    from agent.managed_inference_errors import raise_managed_operation_error
    if getattr(client, "_hermes_aux_effective_provider", "") == "aino":
        raise_managed_operation_error(error, managed=True)
        raise error


def should_retry_same_provider(task: Optional[str], failure, tag: str, *, managed=False) -> bool:
    """True when ``failure`` is a transient transport blip worth a same-provider retry; critical-path
    tasks skip it on a full-budget timeout (``_should_skip_same_provider_retry``) and go straight
    to fallback."""
    from agent import auxiliary_client as aux
    from agent import auxiliary_error_policy as aux_errors
    from agent.managed_inference_errors import raise_managed_operation_error
    raise_managed_operation_error(failure.error, managed=managed)
    if not aux_errors.same_provider_retry(failure.verdict):
        return False
    if aux._should_skip_same_provider_retry(task, failure):
        aux.logger.info("Auxiliary %s%s: timeout on the critical path; "
                    "skipping same-provider retry and falling back: %s", task, tag, failure.error)
        return False
    return True


def ladder_step_call(
    step: Any, req: Any, retry_kwargs: dict[str, Any], candidate_kwargs: dict[str, Any],
) -> tuple[str, tuple, dict[str, Any]]:
    """Resolve a ladder step into ``(kind, args, kwargs)`` for the sync/async performer."""
    if step.kind == "call":
        return "call", step.args, dict(provider=req.resolved_provider, api_mode=req.resolved_api_mode)
    if step.kind == "retry_same_provider":
        retry_provider, retry_model, repairs = step.args
        return "retry", (), dict(retry_kwargs, resolved_provider=retry_provider, resolved_model=retry_model,
                                 repairs=repairs)
    return "fallback", step.args, candidate_kwargs


