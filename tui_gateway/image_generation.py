"""The image RPC's provider dispatch and bounded inline result, shared by both transports."""
import json
import logging

logger = logging.getLogger(__name__)


def generate_image(params):
    from tools.image_generation_tool import _handle_image_generate, check_image_generation_requirements
    from tui_gateway.server import _image_to_data_url
    from utils import is_truthy_value

    try:
        available = bool(check_image_generation_requirements())
    except Exception:
        logger.exception('Image generation availability probe failed')
        available = False
    if is_truthy_value(params.get('probe', False)):
        return {'available': available}
    if not available:
        return {'available': False, 'success': False,
                'error': 'No image generation backend configured (run `hermes tools` to enable one).'}
    prompt = str(params.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('prompt required')
    try:
        cap = min(int(params.get('max_bytes', 8_000_000) or 8_000_000), 16_000_000)
    except (TypeError, ValueError):
        cap = 8_000_000
    result = json.loads(_handle_image_generate({'prompt': prompt, 'aspect_ratio': str(params.get('aspect_ratio') or 'square').strip().lower()}))
    if not result.get('success'):
        return {'available': True, 'success': False, 'error': str(result.get('error') or 'generation failed')}
    image_ref = str(result.get('image') or '')
    data_url = _image_to_data_url(image_ref, cap) if image_ref else None
    return {'available': True, 'success': True, 'image': image_ref, **({'image_data': data_url} if data_url else {})}
