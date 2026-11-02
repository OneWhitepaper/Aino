import type { BundledLocale } from './types'

interface ModelSourceCopy {
  providerSource: string
  customSource: string
  customApiTitle: string
  providerDescription: string
  customDescription: string
  configureCustom: string
  configureProvider: string
  fetchModels: string
  refreshModels: string
  noProviders: string
  customEmpty: string
  modelsReady: (count: number) => string
  noModels: string
  keySaved: string
  saveFailed: string
}

const COPY: Record<BundledLocale, ModelSourceCopy> = {
  zh: {
    providerSource: '第三方服务',
    customSource: '自定义模型',
    customApiTitle: '自定义 API 模型',
    providerDescription: '选择服务商，填写 API Key 获取可用模型。',
    customDescription: '连接中转或私有服务，自行填写 API 地址和密钥。',
    configureCustom: '配置自定义模型',
    configureProvider: '配置第三方服务',
    fetchModels: '获取模型',
    refreshModels: '刷新模型',
    noProviders: '当前运行服务没有提供可用的 API 服务商目录。',
    customEmpty: '尚未连接自定义模型，添加后即可在这里选择。',
    modelsReady: count => `已获取 ${count} 个模型，可在对话或默认模型中选择。`,
    noModels: '服务已保存，但暂未获取到模型。可重试，或使用自定义 API 模型手动配置。',
    keySaved: '已保存 API Key，留空沿用',
    saveFailed: '连接服务商失败'
  },
  'zh-hant': {
    providerSource: '第三方服務',
    customSource: '自訂模型',
    customApiTitle: '自訂 API 模型',
    providerDescription: '選擇服務商，填寫 API Key 取得可用模型。',
    customDescription: '連接轉接或私人服務，自行填寫 API 位址和金鑰。',
    configureCustom: '設定自訂模型',
    configureProvider: '設定第三方服務',
    fetchModels: '取得模型',
    refreshModels: '重新整理模型',
    noProviders: '目前執行的服務未提供可用的 API 服務商目錄。',
    customEmpty: '尚未連接自訂模型，新增後即可在這裡選擇。',
    modelsReady: count => `已取得 ${count} 個模型，可在對話或預設模型中選擇。`,
    noModels: '服務已儲存，但暫未取得模型。請重試，或使用自訂 API 模型手動設定。',
    keySaved: '已儲存 API Key，留空即可沿用',
    saveFailed: '連接服務商失敗'
  },
  en: {
    providerSource: 'Third-party service',
    customSource: 'Custom models',
    customApiTitle: 'Custom API models',
    providerDescription: 'Choose a provider and enter an API key to load its models.',
    customDescription: 'Connect a proxy or private service with your own API address and key.',
    configureCustom: 'Configure custom models',
    configureProvider: 'Configure a provider',
    fetchModels: 'Get models',
    refreshModels: 'Refresh models',
    noProviders: 'The running service has not provided an API provider catalog.',
    customEmpty: 'Connect a custom model service to select its models here.',
    modelsReady: count => `${count} models loaded. Choose them in a conversation or as the default.`,
    noModels: 'The service was saved, but no models were returned. Retry or configure a custom API model manually.',
    keySaved: 'API key saved. Leave blank to keep it.',
    saveFailed: 'Could not connect to the provider'
  },
  ja: {
    providerSource: '外部サービス',
    customSource: 'カスタムモデル',
    customApiTitle: 'カスタム API モデル',
    providerDescription: 'プロバイダーを選び、API キーを入力してモデルを取得します。',
    customDescription: '独自の API アドレスとキーで中継・プライベートサービスに接続します。',
    configureCustom: 'カスタムモデルを設定',
    configureProvider: 'プロバイダーを設定',
    fetchModels: 'モデルを取得',
    refreshModels: 'モデルを更新',
    noProviders: '実行中のサービスから API プロバイダー一覧が提供されていません。',
    customEmpty: 'カスタムサービスを接続すると、ここでモデルを選べます。',
    modelsReady: count => `${count} 個のモデルを取得しました。会話や既定のモデルとして選択できます。`,
    noModels:
      'サービスは保存されましたが、モデルを取得できませんでした。再試行するか、カスタム API モデルを手動設定してください。',
    keySaved: 'API キーは保存済みです。空欄で現在のキーを使用します。',
    saveFailed: 'プロバイダーに接続できませんでした'
  },
  ar: {
    providerSource: 'خدمة خارجية',
    customSource: 'نماذج مخصّصة',
    customApiTitle: 'نماذج API مخصّصة',
    providerDescription: 'اختر مزوّدًا وأدخل مفتاح API للحصول على النماذج المتاحة.',
    customDescription: 'اربط خدمة وسيطة أو خاصة باستخدام عنوان API ومفتاحك.',
    configureCustom: 'إعداد نماذج مخصّصة',
    configureProvider: 'إعداد مزوّد',
    fetchModels: 'جلب النماذج',
    refreshModels: 'تحديث النماذج',
    noProviders: 'لم تقدّم الخدمة الحالية دليلًا لمزوّدي API.',
    customEmpty: 'اربط خدمة نماذج مخصّصة لاختيار نماذجها هنا.',
    modelsReady: count => `تم جلب ${count} من النماذج. يمكنك اختيارها في المحادثة أو كنموذج افتراضي.`,
    noModels: 'تم حفظ الخدمة، لكن لم تُرجع نماذج. أعد المحاولة أو أعدّ نموذج API مخصّصًا يدويًا.',
    keySaved: 'مفتاح API محفوظ. اترك الحقل فارغًا للاحتفاظ به.',
    saveFailed: 'تعذّر الاتصال بالمزوّد'
  },
  ru: {
    providerSource: 'Сторонний сервис',
    customSource: 'Свои модели',
    customApiTitle: 'Свои API-модели',
    providerDescription: 'Выберите провайдера и введите ключ API, чтобы загрузить модели.',
    customDescription: 'Подключите прокси или частный сервис со своим адресом API и ключом.',
    configureCustom: 'Настроить свои модели',
    configureProvider: 'Настроить провайдера',
    fetchModels: 'Получить модели',
    refreshModels: 'Обновить модели',
    noProviders: 'Текущий сервис не предоставил каталог API-провайдеров.',
    customEmpty: 'Подключите свой сервис, чтобы выбирать его модели здесь.',
    modelsReady: count => `Загружено моделей: ${count}. Выберите их в диалоге или как модель по умолчанию.`,
    noModels: 'Сервис сохранён, но модели не получены. Повторите попытку или настройте свою API-модель вручную.',
    keySaved: 'Ключ API сохранён. Оставьте поле пустым, чтобы сохранить его.',
    saveFailed: 'Не удалось подключиться к провайдеру'
  },
  fr: {
    providerSource: 'Service tiers',
    customSource: 'Modèles personnalisés',
    customApiTitle: 'Modèles API personnalisés',
    providerDescription: 'Choisissez un fournisseur et saisissez une clé API pour charger ses modèles.',
    customDescription: 'Connectez un relais ou un service privé avec votre adresse API et votre clé.',
    configureCustom: 'Configurer des modèles',
    configureProvider: 'Configurer un fournisseur',
    fetchModels: 'Obtenir les modèles',
    refreshModels: 'Actualiser les modèles',
    noProviders: 'Le service actuel ne fournit pas de catalogue de fournisseurs API.',
    customEmpty: 'Connectez un service personnalisé pour choisir ses modèles ici.',
    modelsReady: count => `${count} modèles chargés. Choisissez-les dans une conversation ou par défaut.`,
    noModels:
      'Le service a été enregistré, mais aucun modèle n’a été obtenu. Réessayez ou configurez un modèle API personnalisé.',
    keySaved: 'Clé API enregistrée. Laissez vide pour la conserver.',
    saveFailed: 'Impossible de se connecter au fournisseur'
  },
  de: {
    providerSource: 'Drittanbieterdienst',
    customSource: 'Eigene Modelle',
    customApiTitle: 'Eigene API-Modelle',
    providerDescription: 'Wählen Sie einen Anbieter und geben Sie einen API-Schlüssel ein, um Modelle zu laden.',
    customDescription: 'Verbinden Sie einen Proxy oder privaten Dienst mit eigener API-Adresse und eigenem Schlüssel.',
    configureCustom: 'Eigene Modelle einrichten',
    configureProvider: 'Anbieter einrichten',
    fetchModels: 'Modelle abrufen',
    refreshModels: 'Modelle aktualisieren',
    noProviders: 'Der aktuelle Dienst hat keinen API-Anbieterkatalog bereitgestellt.',
    customEmpty: 'Verbinden Sie einen eigenen Dienst, um hier seine Modelle auszuwählen.',
    modelsReady: count => `${count} Modelle geladen. Wählen Sie sie im Gespräch oder als Standardmodell.`,
    noModels:
      'Der Dienst wurde gespeichert, hat aber keine Modelle geliefert. Erneut versuchen oder ein eigenes API-Modell einrichten.',
    keySaved: 'API-Schlüssel gespeichert. Zum Beibehalten leer lassen.',
    saveFailed: 'Verbindung zum Anbieter fehlgeschlagen'
  },
  es: {
    providerSource: 'Servicio externo',
    customSource: 'Modelos personalizados',
    customApiTitle: 'Modelos API personalizados',
    providerDescription: 'Elige un proveedor e introduce una clave API para obtener sus modelos.',
    customDescription: 'Conecta un proxy o servicio privado con tu dirección API y tu clave.',
    configureCustom: 'Configurar modelos propios',
    configureProvider: 'Configurar proveedor',
    fetchModels: 'Obtener modelos',
    refreshModels: 'Actualizar modelos',
    noProviders: 'El servicio actual no proporciona un catálogo de proveedores API.',
    customEmpty: 'Conecta un servicio personalizado para elegir aquí sus modelos.',
    modelsReady: count => `${count} modelos obtenidos. Elígelos en una conversación o como predeterminados.`,
    noModels: 'El servicio se guardó, pero no devolvió modelos. Reintenta o configura un modelo API personalizado.',
    keySaved: 'Clave API guardada. Deja el campo vacío para conservarla.',
    saveFailed: 'No se pudo conectar con el proveedor'
  }
}

export function modelSourceCopy(locale: string): ModelSourceCopy {
  return COPY[locale as BundledLocale] ?? COPY.en
}
