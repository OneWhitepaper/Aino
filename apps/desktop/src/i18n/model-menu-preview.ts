import type { BundledLocale } from './types'

export interface ModelMenuPreviewCopy {
  refresh: string
  add: string
  manage: string
  configureCustom: string
  customModels: string
  title: string
  currentChat: string
  sessionHint: string
  details: string
  back: string
  previewHint: string
  currentHint: string
  builtinDescription: string
  customDescription: string
  billing: string
  providerAccount: string
  mode: string
  standard: string
  deepThinking: string
  currentUse: string
  previewOnly: string
  pricingAndCapabilities: string
}

const copy: Record<BundledLocale, ModelMenuPreviewCopy> = {
  en: {
    refresh: 'Refresh',
    add: 'Add model',
    manage: 'Manage',
    configureCustom: 'Configure custom models',
    customModels: 'Custom models',
    title: 'Switch model',
    currentChat: 'Current chat',
    sessionHint: 'Applies to this chat; the default model stays unchanged',
    details: 'Model details',
    back: 'Back to models',
    previewHint: 'Viewing details does not switch models. Select a model in the list to apply it.',
    currentHint: 'Options apply to future replies in this chat.',
    builtinDescription: 'Use your Aino account without configuring a separate API service.',
    customDescription: 'Connect through your configured provider, using its credentials and allowance.',
    billing: 'Billing',
    providerAccount: 'Provider account',
    mode: 'Conversation mode',
    standard: 'Standard chat',
    deepThinking: 'Supports reasoning',
    currentUse: 'In use',
    previewOnly: 'Preview only',
    pricingAndCapabilities: 'Pricing & capabilities'
  },
  zh: {
    refresh: '刷新',
    add: '添加模型',
    manage: '管理',
    configureCustom: '配置自定义模型',
    customModels: '自定义模型',
    title: '切换模型',
    currentChat: '当前会话',
    sessionHint: '仅切换当前会话，不改变默认模型',
    details: '模型详情',
    back: '返回模型列表',
    previewHint: '查看详情不会切换，点击左侧模型后生效。',
    currentHint: '选项会用于当前会话的后续回复。',
    builtinDescription: '使用 Aino 账户即可对话，无需单独配置 API。',
    customDescription: '通过你已配置的服务商连接，使用对应的 API 密钥和额度。',
    billing: '计费方式',
    providerAccount: '服务商账户',
    mode: '对话模式',
    standard: '标准对话',
    deepThinking: '支持深度思考',
    currentUse: '当前使用',
    previewOnly: '仅查看',
    pricingAndCapabilities: '价格与能力'
  },
  'zh-hant': {
    refresh: '重新整理',
    add: '新增模型',
    manage: '管理',
    configureCustom: '設定自訂模型',
    customModels: '自訂模型',
    title: '切換模型',
    currentChat: '目前對話',
    sessionHint: '僅切換目前對話，不變更預設模型',
    details: '模型詳情',
    back: '返回模型清單',
    previewHint: '查看詳情不會切換，點選左側模型後生效。',
    currentHint: '選項會用於目前對話的後續回覆。',
    builtinDescription: '使用 Aino 帳戶即可對話，無需另外設定 API。',
    customDescription: '透過你已設定的服務商連線，使用對應的 API 金鑰和額度。',
    billing: '計費方式',
    providerAccount: '服務商帳戶',
    mode: '對話模式',
    standard: '標準對話',
    deepThinking: '支援深度思考',
    currentUse: '目前使用',
    previewOnly: '僅查看',
    pricingAndCapabilities: '價格與能力'
  },
  ja: {
    refresh: '更新',
    add: 'モデル追加',
    manage: '管理',
    configureCustom: 'カスタムモデルを設定',
    customModels: 'カスタムモデル',
    title: 'モデルを切り替え',
    currentChat: '現在のチャット',
    sessionHint: 'このチャットだけに適用し、既定のモデルは変更しません',
    details: 'モデルの詳細',
    back: 'モデル一覧に戻る',
    previewHint: '詳細の表示では切り替わりません。一覧からモデルを選ぶと適用されます。',
    currentHint: '設定はこのチャットの今後の返信に適用されます。',
    builtinDescription: '別の API 設定なしで Aino アカウントから利用できます。',
    customDescription: '設定済みプロバイダーの認証情報と利用枠を使用します。',
    billing: '課金方法',
    providerAccount: 'プロバイダーアカウント',
    mode: '会話モード',
    standard: '標準チャット',
    deepThinking: '推論に対応',
    currentUse: '使用中',
    previewOnly: 'プレビュー',
    pricingAndCapabilities: '料金と機能'
  },
  ar: {
    refresh: 'تحديث',
    add: 'إضافة نموذج',
    manage: 'إدارة',
    configureCustom: 'إعداد النماذج المخصصة',
    customModels: 'نماذج مخصصة',
    title: 'تبديل النموذج',
    currentChat: 'المحادثة الحالية',
    sessionHint: 'يُطبّق على هذه المحادثة دون تغيير النموذج الافتراضي',
    details: 'تفاصيل النموذج',
    back: 'العودة إلى النماذج',
    previewHint: 'عرض التفاصيل لا يبدّل النموذج. اختر نموذجًا من القائمة لتطبيقه.',
    currentHint: 'تُطبّق الخيارات على الردود اللاحقة في هذه المحادثة.',
    builtinDescription: 'استخدم حساب Aino دون إعداد خدمة API منفصلة.',
    customDescription: 'اتصل عبر المزوّد الذي أعددته باستخدام بيانات اعتماده وحصته.',
    billing: 'الفوترة',
    providerAccount: 'حساب المزوّد',
    mode: 'وضع المحادثة',
    standard: 'محادثة قياسية',
    deepThinking: 'يدعم الاستدلال',
    currentUse: 'مُستخدم حاليًا',
    previewOnly: 'معاينة فقط',
    pricingAndCapabilities: 'الأسعار والإمكانات'
  },
  ru: {
    refresh: 'Обновить',
    add: 'Добавить',
    manage: 'Управлять',
    configureCustom: 'Настроить свои модели',
    customModels: 'Свои модели',
    title: 'Сменить модель',
    currentChat: 'Текущий чат',
    sessionHint: 'Только для этого чата; модель по умолчанию не изменится',
    details: 'Сведения о модели',
    back: 'К списку моделей',
    previewHint: 'Просмотр сведений не меняет модель. Выберите модель в списке, чтобы применить её.',
    currentHint: 'Параметры применяются к следующим ответам в этом чате.',
    builtinDescription: 'Используйте аккаунт Aino без настройки отдельного API.',
    customDescription: 'Подключение через настроенного провайдера с его учётными данными и лимитами.',
    billing: 'Оплата',
    providerAccount: 'Аккаунт провайдера',
    mode: 'Режим общения',
    standard: 'Обычный чат',
    deepThinking: 'Поддерживает рассуждения',
    currentUse: 'Используется',
    previewOnly: 'Просмотр',
    pricingAndCapabilities: 'Цены и возможности'
  },
  fr: {
    refresh: 'Actualiser',
    add: 'Ajouter',
    manage: 'Gérer',
    configureCustom: 'Configurer les modèles personnalisés',
    customModels: 'Modèles personnalisés',
    title: 'Changer de modèle',
    currentChat: 'Discussion actuelle',
    sessionHint: 'Uniquement pour cette discussion ; le modèle par défaut reste inchangé',
    details: 'Détails du modèle',
    back: 'Retour aux modèles',
    previewHint:
      'Consulter les détails ne change pas de modèle. Sélectionnez un modèle dans la liste pour l’appliquer.',
    currentHint: 'Les options s’appliquent aux prochaines réponses de cette discussion.',
    builtinDescription: 'Utilisez votre compte Aino sans configurer de service API distinct.',
    customDescription: 'Connexion via le fournisseur configuré, avec ses identifiants et son quota.',
    billing: 'Facturation',
    providerAccount: 'Compte fournisseur',
    mode: 'Mode de discussion',
    standard: 'Discussion standard',
    deepThinking: 'Raisonnement pris en charge',
    currentUse: 'Utilisé',
    previewOnly: 'Aperçu',
    pricingAndCapabilities: 'Tarifs et fonctionnalités'
  },
  de: {
    refresh: 'Aktualisieren',
    add: 'Hinzufügen',
    manage: 'Verwalten',
    configureCustom: 'Eigene Modelle konfigurieren',
    customModels: 'Eigene Modelle',
    title: 'Modell wechseln',
    currentChat: 'Aktueller Chat',
    sessionHint: 'Gilt nur für diesen Chat; das Standardmodell bleibt unverändert',
    details: 'Modelldetails',
    back: 'Zur Modellliste',
    previewHint:
      'Das Anzeigen von Details wechselt das Modell nicht. Wählen Sie ein Modell in der Liste aus, um es anzuwenden.',
    currentHint: 'Die Optionen gelten für kommende Antworten in diesem Chat.',
    builtinDescription: 'Verwenden Sie Ihr Aino-Konto ohne einen separaten API-Dienst einzurichten.',
    customDescription: 'Verbindung über Ihren eingerichteten Anbieter mit dessen Zugangsdaten und Kontingent.',
    billing: 'Abrechnung',
    providerAccount: 'Anbieterkonto',
    mode: 'Chatmodus',
    standard: 'Standardchat',
    deepThinking: 'Unterstützt Schlussfolgern',
    currentUse: 'Aktiv',
    previewOnly: 'Nur Vorschau',
    pricingAndCapabilities: 'Preise und Funktionen'
  },
  es: {
    refresh: 'Actualizar',
    add: 'Añadir',
    manage: 'Gestionar',
    configureCustom: 'Configurar modelos personalizados',
    customModels: 'Modelos personalizados',
    title: 'Cambiar modelo',
    currentChat: 'Chat actual',
    sessionHint: 'Solo para este chat; el modelo predeterminado no cambia',
    details: 'Detalles del modelo',
    back: 'Volver a los modelos',
    previewHint: 'Ver los detalles no cambia el modelo. Seleccione uno en la lista para aplicarlo.',
    currentHint: 'Las opciones se aplican a las próximas respuestas de este chat.',
    builtinDescription: 'Use su cuenta de Aino sin configurar un servicio API por separado.',
    customDescription: 'Conexión mediante su proveedor configurado, con sus credenciales y cuota.',
    billing: 'Facturación',
    providerAccount: 'Cuenta del proveedor',
    mode: 'Modo de conversación',
    standard: 'Chat estándar',
    deepThinking: 'Admite razonamiento',
    currentUse: 'En uso',
    previewOnly: 'Solo vista previa',
    pricingAndCapabilities: 'Precios y capacidades'
  }
}

export function modelMenuPreviewCopy(locale: string): ModelMenuPreviewCopy {
  return Object.hasOwn(copy, locale) ? copy[locale as BundledLocale] : copy.en
}
