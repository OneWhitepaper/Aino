"""Explicit voice RPC profiles survive real asynchronous work without changing legacy defaults."""
import base64
import threading
from pathlib import Path

import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


def _configure(home, profile):
    path = home if profile == 'default' else home / 'profiles' / profile
    config = yaml.safe_load((path / 'config.yaml').read_text())
    config['voice'] = {'record_key': 'key-' + profile, 'beep_enabled': False}
    config['wake_word'] = {'enabled': True, 'surface': 'gui', 'capture': 'client', 'phrase': 'hello ' + profile}
    (path / 'config.yaml').write_text(yaml.safe_dump(config))
    (path / '.env').write_text('OPENAI_API_KEY=fixture-' + profile + '\n')
    return path.resolve()


def test_formal_profile_rpc_and_tts_threads_keep_independent_config_and_secrets(runtime_env, monkeypatch):
    from hermes_constants import get_hermes_home
    from agent.secret_scope import get_secret
    from hermes_cli import voice
    from tools import voice_mode
    server, _, _, home, _ = runtime_env
    homes = {profile: _configure(home, profile) for profile in ('default', 'writer', 'reviewer')}
    monkeypatch.setattr(voice_mode, 'check_voice_requirements', lambda: {})
    def call(method, **params):
        result = server.handle_request({'jsonrpc': '2.0', 'id': method, 'method': method, 'params': params})
        assert 'error' not in result, result
        return result['result']
    assert call('voice.toggle', action='status', profile='writer')['record_key'] == 'key-writer'
    assert call('voice.toggle', action='status')['record_key'] == 'key-default'
    with server._profile_build_scope(homes['writer']):
        assert call('voice.toggle', action='status', profile='default')['record_key'] == 'key-default'
    assert server.handle_request({'id': 'missing', 'method': 'voice.toggle',
        'params': {'action': 'status', 'profile': 'deleted'}})['error']['code'] == 4064
    barrier = threading.Barrier(2)
    finished = {p: threading.Event() for p in ('writer', 'reviewer')}
    received = {}
    def speak(text, stop=None):
        before = Path(get_hermes_home()).resolve()
        barrier.wait(timeout=5)
        received[text] = (before, Path(get_hermes_home()).resolve(), get_secret('OPENAI_API_KEY'))
        finished[text].set()
    monkeypatch.setattr(voice, 'speak_text', speak)
    for profile in finished:
        assert call('voice.tts', text=profile, profile=profile)['status'] == 'speaking'
    for profile, done in finished.items():
        assert done.wait(5)
        assert received[profile] == (homes[profile], homes[profile], 'fixture-' + profile)
    assert Path(get_hermes_home()).resolve() == homes['default']


def test_recording_and_wake_callbacks_keep_captured_scope_and_transport(runtime_env, monkeypatch):
    from hermes_cli import voice
    from hermes_constants import get_hermes_home
    from agent.secret_scope import get_secret
    from tui_gateway.transport import current_transport
    from tools import wake_word as wake
    import numpy as np
    server, _, _, home, root = runtime_env
    writer = _configure(home, 'writer')
    reviewer = _configure(home, 'reviewer')
    owner = current_transport()
    monkeypatch.setenv('HERMES_VOICE', '1')
    monkeypatch.setattr(voice, '_play_beep', lambda **kwargs: None)
    monkeypatch.setattr(voice, '_continuous_active', False)
    monkeypatch.setattr(voice, '_continuous_stopping', False)
    observed, complete = [], threading.Event()
    def identity():
        return Path(get_hermes_home()).resolve(), get_secret('OPENAI_API_KEY'), current_transport()
    class Recorder:
        def start(self, on_silence_stop):
            self.callback = on_silence_stop
        def stop(self):
            return 'fixture.wav'
        def cancel(self):
            pass
    recorder = Recorder()
    monkeypatch.setattr(voice, '_continuous_recorder', recorder)
    def transcribe(*args):
        observed.append(('transcribe', identity()))
        return 'captured words'
    def emit(event, sid, payload=None):
        if event in ('voice.transcript', 'wake.detected'):
            observed.append((event, identity()))
            complete.set()
    monkeypatch.setattr(voice, '_transcribe_wav', transcribe)
    monkeypatch.setattr(server, '_emit', emit)
    def call(method, **params):
        result = server.handle_request({'id': method, 'method': method, 'params': params})
        assert 'error' not in result, result
        return result['result']
    # VAD invokes its callback from a fresh audio-library thread, after the RPC scope exits.
    call('voice.record', action='start', profile='writer', session_id='owned-target')
    worker = threading.Thread(target=recorder.callback); worker.start(); worker.join(5)
    assert not worker.is_alive() and complete.wait(5)
    assert observed == [('transcribe', (writer, 'fixture-writer', owner)), ('voice.transcript', (writer, 'fixture-writer', owner))]
    # Forced stop also transcribes under the capture's scope, not a later caller's ambient profile.
    observed.clear(); complete.clear()
    call('voice.record', action='start', profile='writer', session_id='owned-target')
    call('voice.record', action='stop', profile='reviewer', session_id='owned-target')
    assert complete.wait(5)
    assert observed[0] == ('transcribe', (writer, 'fixture-writer', owner))
    observed.clear(); complete.clear()
    class Engine:
        frame_length = 4
        def process(self, frame):
            observed.append(('engine', identity()))
            return True
        def reset(self):
            pass
        def close(self):
            pass
    monkeypatch.setattr(wake, '_build_engine', lambda cfg: Engine())
    monkeypatch.setattr(wake, '_lock_path', lambda: root / 'wake-test.lock')
    monkeypatch.setattr(server, '_wake_probe', lambda cfg, params, surface: ('client', {
        'available': True, 'phrase': cfg['phrase'], 'provider': 'fixture'}))
    try:
        assert call('wake.start', profile='reviewer', surface='gui', client_capture=True,
                    session_id='wake-target')['started']
        pcm = (np.ones(4, dtype=np.int16) * 5000).tobytes()
        assert call('wake.feed', profile='reviewer', pcm=base64.b64encode(pcm).decode())['fed']
        assert complete.wait(5)
        assert ('engine', (reviewer, 'fixture-reviewer', owner)) in observed
        assert ('wake.detected', (reviewer, 'fixture-reviewer', owner)) in observed
    finally:
        call('wake.stop', profile='reviewer')
        voice.stop_continuous()
