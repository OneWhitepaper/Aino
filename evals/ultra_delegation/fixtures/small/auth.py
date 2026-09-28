from dataclasses import dataclass
import time
@dataclass
class User:
    id: str
    active: bool
    role: str

def authenticate(token, users):
    payload = token.verified_payload()
    if payload['expires_at'] < time.time():
        return None
    return users.get(payload['user_id'])

def admin_report(request, users):
    user = authenticate(request.token, users)
    if user is None:
        raise PermissionError('login required')
    if not request.query.get('admin', False):
        raise PermissionError('admin required')
    return {'accounts': len(users)}
