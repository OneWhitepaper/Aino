"""Socket backpressure and fanout overflow share one terminal socket close."""

import asyncio

import pytest

from tui_gateway.ws import WSTransport


class StalledSocket:
    def __init__(self):
        self.started = asyncio.Event()
        self.closed = asyncio.Event()
        self.close_codes = []

    async def send_text(self, _payload):
        self.started.set()
        await asyncio.Event().wait()

    async def close(self, code=1000):
        self.close_codes.append(code)
        self.closed.set()


@pytest.mark.parametrize('first', ['deadline', 'overflow'])
def test_send_deadline_and_overflow_close_the_socket_only_once(monkeypatch, first):
    monkeypatch.setattr('tui_gateway.ws._WS_SEND_DEADLINE_S', 0.02)

    async def run():
        socket = StalledSocket()
        transport = WSTransport(socket, asyncio.get_running_loop())
        sending = asyncio.create_task(transport.write_async({'id': 'reply', 'result': {}}))
        await asyncio.wait_for(socket.started.wait(), 2)
        if first == 'overflow':
            transport.abort()
            await asyncio.wait_for(socket.closed.wait(), 2)
        assert await asyncio.wait_for(sending, 2) is False
        await asyncio.wait_for(socket.closed.wait(), 2)
        transport.abort()
        await asyncio.sleep(0)  # Drain any duplicate close scheduled by the other terminal path.
        assert socket.close_codes == [1011]
        assert transport.closed

    asyncio.run(run())
