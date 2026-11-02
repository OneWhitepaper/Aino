"""Image quality is independent of text reasoning and bounded by the live model catalog."""
import base64
import json
import httpx
import pytest
from tests.plugins.image_gen import test_aino_provider as existing

@pytest.fixture
def quality_rig(tmp_path, monkeypatch):
    yield from existing.rig.__wrapped__(tmp_path, monkeypatch)

@pytest.mark.parametrize('quality,options,allowed,expected', [
    ('high', ['auto','low','high'], True, 'high'),
    (None, ['auto','high'], True, 'auto'),
    (None, [], True, None),
    (None, ['low','high'], True, None),
    ('high', [], False, None),
    ('max', ['low'], False, None)])
def test_only_declared_quality_reaches_images_request(quality_rig, monkeypatch, quality, options, allowed, expected):
    document = {'image_gen': {'provider': 'aino', 'model': 'image-catalog-id'}}
    if quality is not None:
        document['image_gen']['quality'] = quality
    (quality_rig.home/'config.yaml').write_text(json.dumps(document))
    quality_rig.binding.capabilities['image_quality_options'] = options
    requests = []
    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={'data':[{'b64_json':base64.b64encode(existing.PNG).decode()}]})
    monkeypatch.setattr('agent.process_bootstrap.build_keepalive_http_client',lambda *_a,**_k:httpx.Client(transport=httpx.MockTransport(serve)))
    with existing.image_scope(quality_rig.binding):
        result = existing.plugin().generate('一只小猫')
    assert bool(result.get('success')) is allowed, result
    if not allowed:
        assert requests == []
        assert '画质' in result['error']
    else:
        sent = json.loads(requests[0].content)
        assert sent.get('quality') == expected
        if expected is None:
            assert 'quality' not in sent
