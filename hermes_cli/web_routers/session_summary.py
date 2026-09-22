"""Independent semantic summaries for the session inspector."""
import asyncio
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from hermes_cli.web_session_summary import session_summary

router = APIRouter()


class SummaryRequest(BaseModel):
    profile: Optional[str] = None
    retry: bool = False
    language: Literal["zh", "en", "zh-hant", "ja"] = "zh"


@router.get("/api/sessions/{session_id}/summary")
async def get_session_summary(session_id: str, profile: Optional[str] = None, language: str = "zh"):
    return await asyncio.to_thread(session_summary, session_id, profile, language)


@router.post("/api/sessions/{session_id}/summary")
async def generate_session_summary(session_id: str, body: SummaryRequest, profile: Optional[str] = None):
    return await asyncio.to_thread(session_summary, session_id, body.profile or profile, body.language, generate=True, retry=body.retry)
