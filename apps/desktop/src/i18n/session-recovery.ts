import type { Locale } from './types'

interface SessionRecoveryCopy {
  modelTitle: string
  modelUnbound: string
  ownerPending: string
  modelDescription: string
  apply: string
  later: string
  authTitle: string
  authBody: string
  authDeferred: string
  signIn: string
  changed: string
  reconnecting: string
  disconnected: string
  reconnect: string
  restored: string
}

const en: SessionRecoveryCopy = {
  modelTitle: 'Choose an available model',
  modelUnbound: 'This chat’s model has not been authorized yet.',
  ownerPending: 'This chat’s account could not be verified. Local history and your draft are kept.',
  modelDescription: 'Applies only to this chat. Your draft and default model stay as they are.',
  apply: 'Apply to this chat',
  later: 'Later',
  authTitle: 'Sign in again',
  authBody: 'Aino models are unavailable. Local history and your draft are kept.',
  authDeferred: 'Sign-in expired. Your draft is kept.',
  signIn: 'Sign in again',
  changed: 'This recovery belongs to another account or connection. Reopen it from the original chat.',
  reconnecting: 'Reconnecting. Your draft is kept; the original request result is not yet confirmed.',
  disconnected: 'Connection lost. Your draft is kept; the original request result is not yet confirmed.',
  reconnect: 'Reconnect',
  restored: 'Connection restored. The original request result may still need checking; nothing was resent.'
}

const zh: SessionRecoveryCopy = {
  modelTitle: '选择可用模型',
  modelUnbound: '此会话的模型尚未完成授权。',
  ownerPending: '暂时无法确认会话归属，本地内容和草稿会保留。',
  modelDescription: '仅应用到当前会话。保留草稿，不更改默认模型。',
  apply: '应用到当前会话',
  later: '稍后处理',
  authTitle: '需要重新登录',
  authBody: 'Aino 内置模型暂不可用。本地历史和草稿会保留。',
  authDeferred: '登录已过期，草稿仍在。',
  signIn: '重新登录',
  changed: '账号或连接已变化，请回到原会话重新打开此恢复入口。',
  reconnecting: '正在恢复连接。草稿保留，原请求结果仍待核对。',
  disconnected: '连接中断。草稿保留，原请求结果待核对。',
  reconnect: '重试连接',
  restored: '连接已恢复。原请求结果仍可能需要核对，没有重新发送。'
}

const translations: Partial<Record<Locale, SessionRecoveryCopy>> = {
  en,
  zh,
  fr: {
    ...en,
    modelTitle: 'Choisir un modèle disponible',
    modelDescription:
      'S’applique à cette conversation uniquement. Le brouillon et le modèle par défaut sont conservés.',
    apply: 'Appliquer à cette conversation',
    later: 'Plus tard',
    authTitle: 'Reconnectez-vous',
    authBody: 'Les modèles Aino sont indisponibles. L’historique local et le brouillon sont conservés.',
    authDeferred: 'Connexion expirée. Le brouillon est conservé.',
    signIn: 'Se reconnecter',
    changed: 'Le compte ou la connexion a changé. Rouvrez la récupération depuis la conversation d’origine.',
    reconnecting: 'Reconnexion en cours. Le brouillon est conservé ; le résultat initial n’est pas confirmé.',
    disconnected: 'Connexion perdue. Le brouillon est conservé ; le résultat initial n’est pas confirmé.',
    reconnect: 'Reconnecter',
    restored: 'Connexion rétablie. Le résultat initial peut encore nécessiter une vérification ; rien n’a été renvoyé.'
  },
  de: {
    ...en,
    modelTitle: 'Verfügbares Modell auswählen',
    modelDescription: 'Gilt nur für dieses Gespräch. Entwurf und Standardmodell bleiben erhalten.',
    apply: 'Auf dieses Gespräch anwenden',
    later: 'Später',
    authTitle: 'Erneut anmelden',
    authBody: 'Aino-Modelle sind nicht verfügbar. Lokaler Verlauf und Entwurf bleiben erhalten.',
    authDeferred: 'Anmeldung abgelaufen. Der Entwurf bleibt erhalten.',
    signIn: 'Erneut anmelden',
    changed: 'Konto oder Verbindung wurde geändert. Öffne die Wiederherstellung im ursprünglichen Gespräch erneut.',
    reconnecting:
      'Verbindung wird wiederhergestellt. Der Entwurf bleibt erhalten; das ursprüngliche Ergebnis ist unbestätigt.',
    disconnected: 'Verbindung getrennt. Der Entwurf bleibt erhalten; das ursprüngliche Ergebnis ist unbestätigt.',
    reconnect: 'Neu verbinden',
    restored:
      'Verbindung wiederhergestellt. Das ursprüngliche Ergebnis muss möglicherweise noch geprüft werden; nichts wurde erneut gesendet.'
  },
  es: {
    ...en,
    modelTitle: 'Elegir un modelo disponible',
    modelDescription: 'Solo se aplica a esta conversación. Se conservan el borrador y el modelo predeterminado.',
    apply: 'Aplicar a esta conversación',
    later: 'Más tarde',
    authTitle: 'Vuelve a iniciar sesión',
    authBody: 'Los modelos Aino no están disponibles. Se conservan el historial local y el borrador.',
    authDeferred: 'La sesión caducó. El borrador se conserva.',
    signIn: 'Iniciar sesión de nuevo',
    changed: 'La cuenta o la conexión cambió. Abre la recuperación desde la conversación original.',
    reconnecting: 'Reconectando. El borrador se conserva; el resultado original aún no está confirmado.',
    disconnected: 'Se perdió la conexión. El borrador se conserva; el resultado original aún no está confirmado.',
    reconnect: 'Reconectar',
    restored:
      'Conexión restablecida. Puede que aún sea necesario verificar el resultado original; no se ha reenviado nada.'
  },
  ru: {
    ...en,
    modelTitle: 'Выбрать доступную модель',
    modelDescription: 'Только для этого разговора. Черновик и модель по умолчанию сохраняются.',
    apply: 'Применить к этому разговору',
    later: 'Позже',
    authTitle: 'Войдите снова',
    authBody: 'Модели Aino недоступны. Локальная история и черновик сохраняются.',
    authDeferred: 'Срок входа истёк. Черновик сохранён.',
    signIn: 'Войти снова',
    changed: 'Аккаунт или подключение изменились. Откройте восстановление из исходного разговора.',
    reconnecting: 'Переподключение. Черновик сохранён; результат исходного запроса ещё не подтверждён.',
    disconnected: 'Соединение потеряно. Черновик сохранён; результат исходного запроса ещё не подтверждён.',
    reconnect: 'Подключить снова',
    restored:
      'Соединение восстановлено. Результат исходного запроса может требовать проверки; ничего не отправлено повторно.'
  },
  ar: {
    ...en,
    modelTitle: 'اختر نموذجًا متاحًا',
    modelDescription: 'يطبق على هذه المحادثة فقط. يتم الاحتفاظ بالمسودة والنموذج الافتراضي.',
    apply: 'تطبيق على هذه المحادثة',
    later: 'لاحقًا',
    authTitle: 'سجل الدخول مجددًا',
    authBody: 'نماذج Aino غير متاحة. يتم الاحتفاظ بالسجل المحلي والمسودة.',
    authDeferred: 'انتهت صلاحية الدخول. تم الاحتفاظ بالمسودة.',
    signIn: 'تسجيل الدخول مجددًا',
    changed: 'تغير الحساب أو الاتصال. أعد فتح الاسترداد من المحادثة الأصلية.',
    reconnecting: 'جارٍ إعادة الاتصال. المسودة محفوظة ونتيجة الطلب الأصلي غير مؤكدة بعد.',
    disconnected: 'انقطع الاتصال. المسودة محفوظة ونتيجة الطلب الأصلي غير مؤكدة بعد.',
    reconnect: 'إعادة الاتصال',
    restored: 'تمت استعادة الاتصال. قد تظل نتيجة الطلب الأصلي بحاجة إلى التحقق؛ لم تتم إعادة الإرسال.'
  },
  'zh-hant': {
    ...zh,
    modelTitle: '選擇可用模型',
    modelUnbound: '此對話的模型尚未完成授權。',
    ownerPending: '暫時無法確認對話歸屬，本機內容和草稿會保留。',
    modelDescription: '僅套用到目前對話。保留草稿，不變更預設模型。',
    apply: '套用到目前對話',
    later: '稍後處理',
    authTitle: '需要重新登入',
    authBody: 'Aino 內建模型暫不可用。本機歷史與草稿會保留。',
    authDeferred: '登入已過期，草稿仍在。',
    signIn: '重新登入',
    changed: '帳號或連線已變更，請回到原對話重新開啟此恢復入口。',
    reconnecting: '正在恢復連線。草稿保留，原請求結果仍待核對。',
    disconnected: '連線中斷。草稿保留，原請求結果待核對。',
    reconnect: '重試連線',
    restored: '連線已恢復。原請求結果仍可能需要核對，沒有重新傳送。'
  },
  ja: {
    ...en,
    modelTitle: '利用可能なモデルを選択',
    modelDescription: 'このチャットだけに適用します。下書きと既定モデルは保持されます。',
    apply: 'このチャットに適用',
    later: '後で',
    authTitle: '再ログインが必要です',
    authBody: 'Aino モデルを利用できません。履歴と下書きは保持されます。',
    authDeferred: 'ログイン期限が切れました。下書きは保持されています。',
    signIn: '再ログイン',
    changed: 'アカウントまたは接続が変わりました。元のチャットから開き直してください。',
    reconnecting: '再接続中。下書きは保持され、元のリクエスト結果は未確認です。',
    disconnected: '接続が切れました。下書きは保持され、元のリクエスト結果は未確認です。',
    reconnect: '再接続',
    restored: '接続が復旧しました。元のリクエスト結果は確認が必要な場合があります。再送していません。'
  }
}

export function sessionRecoveryCopy(locale: Locale): SessionRecoveryCopy {
  return translations[locale] ?? en
}
