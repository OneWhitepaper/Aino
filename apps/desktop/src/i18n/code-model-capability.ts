import type { BundledLocale } from './types'

interface CodeModelCapabilityCopy {
  compatible: string
  adapted: string
  adaptedHint: string
  'work-only': string
  unverified: string
  protocolOnly: string
  workOnlyHint: string
  unverifiedHint: string
  settings: string
  changed: string
}

const COPY: Record<BundledLocale, CodeModelCapabilityCopy> = {
  en: {
    adapted: 'Code auto-adapted',
    adaptedHint:
      'Aino automatically adapts this protocol for Code using the same model, provider and billing. Tool use and long-running tasks are not verified.',
    compatible: 'Code compatible',
    'work-only': 'Work only',
    unverified: 'Code unverified',
    protocolOnly: 'Native Responses route configured. Tool use and long-running Code tasks are not verified.',
    workOnlyHint:
      'This backend cannot use this route for Code. Update it for Chat Completions/Anthropic auto-adaptation, choose a Responses model, or use Work. Your draft is kept.',
    unverifiedHint:
      'Code protocol support is unverified. Check the backend connection and API mode in Settings → Models.',
    settings: 'Model settings',
    changed: 'The model or its owner changed. Review your selection and send again.'
  },
  zh: {
    adapted: 'Code 自动适配',
    adaptedHint: 'Aino 自动适配此协议以供 Code 使用，模型、服务商和计费方式不变。工具调用及长时间任务尚未验证。',
    compatible: '兼容 Code',
    'work-only': '仅限 Work',
    unverified: 'Code 未验证',
    protocolOnly: '已配置原生 Responses 路由；工具调用及长时间 Code 任务尚未验证。',
    workOnlyHint:
      '当前后端无法让此路由用于 Code。可更新后端以自动适配 Chat Completions/Anthropic，选择 Responses 模型，或使用 Work。草稿已保留。',
    unverifiedHint: 'Code 协议支持尚未验证。请检查后端连接及「设置 → 模型」中的 API 模式。',
    settings: '模型设置',
    changed: '模型或所属账户、连接已变化。请检查选择后重新发送。'
  },
  'zh-hant': {
    adapted: 'Code 自動適配',
    adaptedHint: 'Aino 自動適配此協定供 Code 使用，模型、服務商與計費方式不變。工具呼叫及長時間任務尚未驗證。',
    compatible: '相容 Code',
    'work-only': '僅限 Work',
    unverified: 'Code 未驗證',
    protocolOnly: '已設定原生 Responses 路由；工具呼叫及長時間 Code 任務尚未驗證。',
    workOnlyHint:
      '目前後端無法讓此路由用於 Code。可更新後端以自動適配 Chat Completions/Anthropic，選擇 Responses 模型，或使用 Work。草稿已保留。',
    unverifiedHint: 'Code 協定支援尚未驗證。請檢查後端連線及「設定 → 模型」中的 API 模式。',
    settings: '模型設定',
    changed: '模型或所屬帳戶、連線已變更。請檢查選擇後重新傳送。'
  },
  ja: {
    adapted: 'Code 自動変換',
    adaptedHint:
      'Aino がこのプロトコルを Code 用に自動変換します。モデル、プロバイダー、課金方法は変わりません。ツール使用と長時間タスクは未検証です。',
    compatible: 'Code 対応',
    'work-only': 'Work のみ',
    unverified: 'Code 未検証',
    protocolOnly: 'ネイティブ Responses ルートが設定されています。ツール使用と長時間の Code タスクは未検証です。',
    workOnlyHint:
      '現在のバックエンドではこのルートを Code に使えません。Chat Completions/Anthropic の自動変換に対応するよう更新するか、Responses モデルまたは Work を選んでください。下書きは保持されます。',
    unverifiedHint:
      'Code のプロトコル対応は未確認です。バックエンド接続と「設定 → モデル」の API モードを確認してください。',
    settings: 'モデル設定',
    changed: 'モデルまたは所有元が変わりました。選択を確認して再送してください。'
  },
  de: {
    adapted: 'Code automatisch angepasst',
    adaptedHint:
      'Aino passt dieses Protokoll automatisch für Code an. Modell, Anbieter und Abrechnung bleiben gleich. Werkzeugnutzung und lange Aufgaben sind nicht geprüft.',
    compatible: 'Code-kompatibel',
    'work-only': 'Nur Work',
    unverified: 'Code ungeprüft',
    protocolOnly: 'Native Responses-Route konfiguriert. Werkzeugnutzung und lange Code-Aufgaben wurden nicht geprüft.',
    workOnlyHint:
      'Dieses Backend unterstützt diese Code-Route nicht. Aktualisieren Sie es für Chat Completions/Anthropic-Anpassung, wählen Sie ein Responses-Modell oder nutzen Sie Work. Ihr Entwurf bleibt erhalten.',
    unverifiedHint:
      'Code-Protokollunterstützung ungeprüft. Prüfen Sie die Backend-Verbindung und den API-Modus unter Einstellungen → Modelle.',
    settings: 'Modelleinstellungen',
    changed: 'Modell oder Eigentümer hat sich geändert. Prüfen Sie die Auswahl und senden Sie erneut.'
  },
  fr: {
    adapted: 'Code adapté automatiquement',
    adaptedHint:
      'Aino adapte automatiquement ce protocole pour Code, sans changer de modèle, de fournisseur ni de facturation. Les outils et les tâches prolongées ne sont pas vérifiés.',
    compatible: 'Compatible Code',
    'work-only': 'Work uniquement',
    unverified: 'Code non vérifié',
    protocolOnly: 'Route Responses native configurée. Les outils et les tâches Code prolongées ne sont pas vérifiés.',
    workOnlyHint:
      'Ce serveur ne prend pas en charge cette route pour Code. Mettez-le à jour pour l’adaptation Chat Completions/Anthropic, choisissez un modèle Responses ou utilisez Work. Votre brouillon est conservé.',
    unverifiedHint:
      'Prise en charge du protocole Code non vérifiée. Vérifiez la connexion au serveur et le mode API dans Paramètres → Modèles.',
    settings: 'Paramètres des modèles',
    changed: 'Le modèle ou son propriétaire a changé. Vérifiez votre sélection avant de renvoyer.'
  },
  es: {
    adapted: 'Code adaptado automáticamente',
    adaptedHint:
      'Aino adapta automáticamente este protocolo para Code, sin cambiar de modelo, proveedor ni facturación. No se han verificado las herramientas ni las tareas prolongadas.',
    compatible: 'Compatible con Code',
    'work-only': 'Solo Work',
    unverified: 'Code sin verificar',
    protocolOnly:
      'Ruta Responses nativa configurada. No se han verificado las herramientas ni las tareas Code prolongadas.',
    workOnlyHint:
      'Este servidor no admite esta ruta para Code. Actualízalo para adaptar Chat Completions/Anthropic, elige un modelo Responses o usa Work. Tu borrador se conserva.',
    unverifiedHint:
      'El protocolo para Code no está verificado. Revisa la conexión al servidor y el modo API en Ajustes → Modelos.',
    settings: 'Ajustes de modelos',
    changed: 'El modelo o su propietario cambió. Revisa la selección y vuelve a enviar.'
  },
  ru: {
    adapted: 'Code с автоадаптацией',
    adaptedHint:
      'Aino автоматически адаптирует этот протокол для Code. Модель, провайдер и способ оплаты не меняются. Работа инструментов и длительных задач не проверена.',
    compatible: 'Совместим с Code',
    'work-only': 'Только Work',
    unverified: 'Code не проверен',
    protocolOnly: 'Настроен нативный маршрут Responses. Работа инструментов и длительных задач Code не проверена.',
    workOnlyHint:
      'Этот сервер не поддерживает данный маршрут для Code. Обновите его для адаптации Chat Completions/Anthropic, выберите модель Responses или используйте Work. Черновик сохранён.',
    unverifiedHint:
      'Поддержка протокола Code не проверена. Проверьте подключение к серверу и режим API в «Настройки → Модели».',
    settings: 'Настройки моделей',
    changed: 'Модель или её владелец изменились. Проверьте выбор и отправьте снова.'
  },
  ar: {
    adapted: 'Code بتكييف تلقائي',
    adaptedHint:
      'يكيّف Aino هذا البروتوكول تلقائيًا لـ Code مع إبقاء النموذج والمزوّد والفوترة كما هي. لم يُتحقق من استخدام الأدوات أو المهام الطويلة.',
    compatible: 'متوافق مع Code',
    'work-only': 'Work فقط',
    unverified: 'Code غير متحقق',
    protocolOnly: 'تم إعداد مسار Responses الأصلي. لم يُتحقق من استخدام الأدوات أو مهام Code الطويلة.',
    workOnlyHint:
      'لا يدعم هذا الخادم المسار لـ Code. حدّثه لتكييف Chat Completions/Anthropic تلقائيًا، أو اختر نموذج Responses أو استخدم Work. تم الاحتفاظ بالمسودة.',
    unverifiedHint: 'لم يُتحقق من دعم بروتوكول Code. تحقق من الاتصال بالخادم ووضع API في الإعدادات ← النماذج.',
    settings: 'إعدادات النماذج',
    changed: 'تغير النموذج أو مالكه. راجع الاختيار وأعد الإرسال.'
  }
}

export function codeModelCapabilityCopy(locale: string): CodeModelCapabilityCopy {
  return COPY[locale as BundledLocale] ?? COPY.en
}
