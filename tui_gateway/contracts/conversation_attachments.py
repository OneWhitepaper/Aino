"""Conversation-owned durable attachments and paged public content."""
from pydantic import Field
from .base import Params, Result
from .registry import method


class ConversationContentRef(Result):
    id: str
    sha256: str
    size_bytes: int
    mime_type: str


class ConversationAttachment(Result):
    id: str
    filename: str
    content_ref: ConversationContentRef


class ConversationAttachParams(Params):
    conversation_id: str
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=255)
    data_base64: str


class ConversationAttachResult(Result):
    attachment: ConversationAttachment


class ConversationContentParams(Params):
    conversation_id: str
    content_id: str
    offset_bytes: int = Field(default=0, ge=0)
    limit_bytes: int = Field(default=65536, ge=1, le=262144)


class ConversationContentResult(Result):
    data_base64: str
    next_offset: int
    has_more: bool
    sha256: str


method('conversations.attach', params=ConversationAttachParams, result=ConversationAttachResult,
       doc='Upload immutable conversation-owned bytes without admitting a user input.')
method('conversations.content', params=ConversationContentParams, result=ConversationContentResult,
       doc='Read an authorized byte page of content owned by this conversation.')
