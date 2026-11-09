"""Credential-free discovery and next-message selection for a desktop conversation."""
from typing import Literal

from pydantic import Field

from .aino_platform import PlatformOwner
from .base import Params, Result


class ConversationModel(Params):
    model_id: str = Field(min_length=1, max_length=256)
    model_source: Literal['aino', 'provider']
    provider: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=256)
    owner: PlatformOwner | None = None


class ConversationModelRequest(Params):
    request_id: str
    session_id: str
    profile: str
    action: Literal['list', 'select']
    query: str | None = Field(default=None, max_length=256)
    provider: str | None = Field(default=None, max_length=128)
    room_id: str | None = None
    member_id: str | None = None


class ConversationModelResult(Result):
    status: Literal['available', 'selected', 'scheduled', 'not_found', 'ambiguous', 'unavailable'] | None = None
    models: list[ConversationModel] | None = Field(default=None, max_length=2048)
    selection: ConversationModel | None = None
    effective: Literal['next_message'] | None = None


class ConversationModelParams(Params):
    session_id: str
    action: Literal['list', 'select', 'selection']
    query: str | None = Field(default=None, max_length=256)
    provider: str | None = Field(default=None, max_length=128)
