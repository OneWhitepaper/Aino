"""Session-authorized semantic summaries on the canonical owner's bounded auxiliary pool."""
from functools import partial

from gateway.session_busy_controls import authorize
from gateway.session_llm_oneshot import DeferredReply, _session_runtime
from hermes_state_runtime import RuntimeStoreError


def handlers(connection):
    return {'session.summary': partial(summary, connection)}


async def summary(connection, ref, params):
    from gateway.session_ancillary import physical_target
    from gateway.session_authorities import owner_scope
    from hermes_cli.web_session_summary import SummaryBusy, authorized_summary, summary_for_db

    authorize(connection, ref, params, 'session:control')
    authority = connection.authority
    live = authority.sessions[ref.session_id]
    captured = authority._handle(ref)
    target = physical_target(authority, ref)
    runtime = _session_runtime(authority, ref)

    def should_yield():
        current = authority._handle(ref)
        return current.execution_state != 'idle' or current.execution_generation != captured.execution_generation

    def check():
        authorize(connection, ref, params, 'session:control')
        if (authority.sessions.get(ref.session_id) is not live
                or connection.actor.transport_id not in authority.events):
            raise RuntimeStoreError('permission_denied')
        if should_yield():
            raise SummaryBusy()
        if authority._handle(ref).revision != captured.revision:
            raise RuntimeStoreError('stale_revision')

    def work():
        with owner_scope(authority):
            try:
                check()
            except SummaryBusy:
                cached = summary_for_db(authority.db, target, params.get('language', 'zh'))
                return {**cached, 'busy': True, 'error_code': 'busy'}
            selected = runtime()
            return authorized_summary(authority.db, target, params.get('language', 'zh'),
                                      runtime=selected, retry=params.get('retry', False),
                                      authority_check=check, should_yield=should_yield)
    return DeferredReply(work)
