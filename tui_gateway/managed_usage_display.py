"""Persist late auxiliary receipts on their original reply, never model messages."""

from contextlib import nullcontext
import logging

from agent.auxiliary_billing_scope import billing_scope
from tui_gateway.managed_model_usage import current_usage_metadata

logger = logging.getLogger(__name__)


def finish_managed_metrics(agent, session, start, text, metrics, *, persist, on_update):
    scope = billing_scope.get()
    metadata = current_usage_metadata()
    if not scope or "billing" not in metadata:
        return None
    from tui_gateway.turn_metrics import _persist_metrics
    db = getattr(agent, "_session_db", None)
    stored_session = agent.session_id
    db_path = getattr(db, "db_path", None)
    through_row_id = None
    if db is not None and persist:
        try:
            through_row_id = db.latest_message_row_id(stored_session, role="assistant", require_text=False)
        except Exception:
            logger.debug("billing reply boundary unavailable", exc_info=True)
    initial = None
    stored_text = None
    identity = metadata["billing"]

    def update(receipts):
        nonlocal initial, stored_text
        receipt_fields = {key: value for key, value in receipts.items()
                          if key != "non_aino_model_calls"}
        billing = {**identity, **receipt_fields}
        updated = {**metrics, "billing": billing}
        if receipts.get("non_aino_model_calls") is True:
            updated["non_aino_model_calls"] = True
        if initial is None:
            initial = updated
            if persist and text:
                stored_text = _persist_metrics(agent, session, start, text, updated)
            return
        try:
            if db_path and through_row_id and stored_text and start.after_row_id >= 0:
                from hermes_state import SessionDB
                with SessionDB(db_path=db_path) as reopened:
                    reopened.merge_reply_display_metadata(
                        stored_session, stored_text, after_row_id=start.after_row_id,
                        through_row_id=through_row_id, metadata={"turn_metrics": updated})
            with session.get("history_lock", nullcontext()):
                history = session.get("history", [])
                for index, message in enumerate(history):
                    display = message.get("display_metadata") or {}
                    previous = display.get("turn_metrics") or {}
                    if previous.get("billing", {}).get("turn_id") == scope.turn_id:
                        session["history"] = [*history[:index], {**message, "display_metadata": {
                            **display, "turn_metrics": updated}}, *history[index + 1:]]
                        break
            if on_update:
                on_update(billing, receipts.get("non_aino_model_calls") is True)
        except Exception:
            # Receipt persistence must not abort an already-authorized HTTP dispatch.
            logger.warning("could not update managed reply receipts", exc_info=True)

    scope.calls.finish_and_watch(update)
    return initial
