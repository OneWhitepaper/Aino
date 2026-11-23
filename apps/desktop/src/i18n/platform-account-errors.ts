export const enAccountErrors: Record<string, string> = {
  INVALID_PHONE: 'Enter a valid phone number.',
  PHONE_REGION_UNSUPPORTED: 'Phone numbers from this region are not supported.',
  SMS_UNAVAILABLE: 'SMS sign-in is temporarily unavailable.',
  SMS_DELIVERY_UNKNOWN: 'Delivery could not be confirmed. Wait before requesting another code.',
  PHONE_CODE_INVALID: 'The verification code is incorrect.',
  PHONE_CODE_EXPIRED: 'The verification code has expired. Request a new one.',
  PHONE_CODE_EXHAUSTED: 'Too many incorrect attempts. Request a new code.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  invalid_credentials: 'The email or password is incorrect.',
  second_factor_invalid: 'The authenticator code is incorrect.',
  captcha_cancelled: 'Verification was canceled.',
  captcha_provider_unsupported: 'This site captcha provider is not supported by the desktop app.',
  captcha_browser_unavailable:
    'This site requires verification in the Aino desktop app. Open the desktop app to sign in.',
  network_timeout: 'The account service timed out. Try again.',
  network_unavailable: 'The account service is offline. Check your connection and retry.',
  secure_store_read_failed:
    'Could not read your previous sign-in credentials. Enter your email and password to sign in again.',
  secure_store_write_failed:
    'Could not update saved sign-in credentials. Check your system keychain or credential manager and storage permissions, then retry.',
  RECENT_AUTH_REQUIRED: 'Sign in again to continue.',
  reauthentication_required: 'Sign in again to continue.'
}

export const zhAccountErrors: Record<string, string> = {
  INVALID_PHONE: '请输入有效的手机号。',
  PHONE_REGION_UNSUPPORTED: '暂不支持该地区的手机号。',
  SMS_UNAVAILABLE: '短信登录暂时不可用。',
  SMS_DELIVERY_UNKNOWN: '暂时无法确认短信是否送达，请稍后再试。',
  PHONE_CODE_INVALID: '验证码不正确。',
  PHONE_CODE_EXPIRED: '验证码已过期，请重新获取。',
  PHONE_CODE_EXHAUSTED: '验证码错误次数过多，请重新获取。',
  INVALID_CREDENTIALS: '邮箱或密码不正确。',
  invalid_credentials: '邮箱或密码不正确。',
  second_factor_invalid: '身份验证器验证码不正确。',
  captcha_cancelled: '已取消人机验证。',
  captcha_provider_unsupported: '桌面端暂不支持站点当前的人机验证方式。',
  captcha_browser_unavailable: '当前站点需要通过 Aino 桌面端完成人机验证，请打开桌面端登录。',
  network_timeout: '账户服务响应超时，请重试。',
  network_unavailable: '无法连接账户服务，请检查网络后重试。',
  secure_store_read_failed: '无法读取此设备原有的登录凭据。请重新输入邮箱和密码登录。',
  secure_store_write_failed: '无法更新此设备保存的登录凭据。请检查系统钥匙串或凭据管理器及存储权限，然后重试。',
  RECENT_AUTH_REQUIRED: '请重新登录以继续。',
  reauthentication_required: '请重新登录以继续。'
}
