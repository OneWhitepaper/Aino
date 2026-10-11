"""Aino account, ephemeral model authority, and reply billing wire contracts."""

from typing import Literal

from pydantic import Field

from .base import Result
from .common import ProfileParams, SessionParams
from .registry import method


class PlatformOwner(Result):
    platform_origin: str
    user_id: str


class ManagedCapabilities(Result):
    tools: bool
    vision: bool
    reasoning: bool


class ManagedModelTicketParams(SessionParams):
    owner: PlatformOwner
    model_id: str


class ManagedModelTicketResult(Result):
    session_ticket: str
    managed_model_binding: int


class ClaimManagedModelParams(ManagedModelTicketParams):
    session_ticket: str


class ClaimManagedModelResult(Result):
    binding_revision: int
    managed_model_binding: int
    managed_model_context_window: bool = False


class BindManagedModelParams(ManagedModelTicketParams):
    binding_revision: int
    credential_id: str
    api_key: str
    base_url: str
    expires_at: str
    model: str
    api_mode: Literal["chat_completions", "responses", "anthropic_messages"]
    capabilities: ManagedCapabilities
    context_window: int | None = Field(default=None, gt=0, strict=True)


class BindManagedModelResult(Result):
    bound: bool
    model_id: str
    binding_revision: int


class ClearManagedModelParams(SessionParams):
    binding_revision: int


class ClearManagedModelResult(Result):
    cleared: bool


method("session.managed_model_ticket", params=ManagedModelTicketParams, result=ManagedModelTicketResult)
method("session.claim_managed_model", params=ClaimManagedModelParams, result=ClaimManagedModelResult)
method("session.bind_managed_model", params=BindManagedModelParams, result=BindManagedModelResult)
method("session.renew_managed_model", params=BindManagedModelParams, result=BindManagedModelResult)
method("session.clear_managed_model", params=ClearManagedModelParams, result=ClearManagedModelResult)


class AccountPublic(Result):
    id: str
    identifier: str
    display_name: str


class AccountCapabilities(Result):
    code_login: bool
    wechat_login: bool


class AccountStatusResult(Result):
    authenticated: bool
    account: AccountPublic | None
    mode: Literal["development", "unconfigured"]
    capabilities: AccountCapabilities


class AccountRequestCodeParams(ProfileParams):
    identifier: str


class AccountRequestCodeResult(Result):
    ok: bool
    delivery: Literal["development"]
    expires_in: int
    retry_after: int


class AccountVerifyCodeParams(AccountRequestCodeParams):
    code: str


class AccountVerifyCodeResult(AccountStatusResult):
    created: bool


class AccountUpdateProfileParams(ProfileParams):
    display_name: str


method("account.status", params=ProfileParams, result=AccountStatusResult)
method("account.logout", params=ProfileParams, result=AccountStatusResult)
method("account.request_code", params=AccountRequestCodeParams, result=AccountRequestCodeResult)
method("account.verify_code", params=AccountVerifyCodeParams, result=AccountVerifyCodeResult)
method("account.update_profile", params=AccountUpdateProfileParams, result=AccountStatusResult)


class ReplyBillingCall(Result):
    call_id: str
    purpose: str


class ReplyBilling(Result):
    source: Literal["aino"]
    user_id: str
    session_id: str
    turn_id: str
    status: Literal["pending"]
    calls: list[ReplyBillingCall] = Field(default_factory=list)
    calls_complete: bool = False
    revision: int = 0


class TurnMetrics(Result):
    duration_s: float
    session_elapsed_s: float | None = None
    total_tokens: float | None = None
    input_tokens: float | None = None
    output_tokens: float | None = None
    tokens_per_second: float | None = None
    cache_hit_pct: float | None = None
    context_percent: float | None = None
    context_used: float | None = None
    context_max: float | None = None
    context_estimated: bool | None = None
    non_aino_model_calls: bool | None = None
    billing: ReplyBilling | None = None
