import type { BundledLocale } from '@/i18n/types'

const ENGLISH = {
  title: 'Configure custom models',
  description:
    'Enter the API address, key, and model name; the protocol is detected automatically. Testing or saving sends a short verification request and may incur provider charges.',
  savedConfigurations: 'Saved configurations',
  newConfiguration: 'New configuration',
  savedExplanation: 'Choose a saved custom connection to edit. This does not switch the current model.',
  connectionLabel: 'Custom connection',
  provider: 'Provider',
  customProvider: 'Custom service',
  modelName: 'Model name',
  modelHint: 'Test the connection to find models, or enter a model name directly.',
  advanced: 'Advanced settings',
  advancedHint: 'Keep the defaults unless the API or service requires a specific setting.',
  showKey: 'Show key',
  hideKey: 'Hide key',
  testConnection: 'Test connection',
  automaticAdapter:
    'Code can automatically adapt this protocol on supported backends, using the same model, provider and billing.',
  autoDetectionRequired:
    'The API mode could not be verified. Select an API mode manually in Advanced settings, or update the backend and test again.',
  keepKey: 'Key saved. Leave blank to keep it.',
  configured: 'Connected services'
}

const COPY: Record<BundledLocale, typeof ENGLISH> = {
  en: ENGLISH,
  zh: {
    title: '配置自定义模型',
    description: '填写 API 地址、密钥和模型名称，协议自动检测。测试或保存时会发送简短验证请求，可能产生服务商费用。',
    savedConfigurations: '已保存配置',
    newConfiguration: '新建配置',
    savedExplanation: '选择一份已保存的自定义连接进行编辑，不会切换当前模型。',
    connectionLabel: '自定义连接',
    provider: '服务商',
    customProvider: '自定义服务',
    modelName: '模型名称',
    modelHint: '测试连接后选择模型，也可以直接输入模型名称。',
    advanced: '高级设置',
    advancedHint: '通常无需修改；仅在接口或服务有特殊要求时调整。',
    showKey: '显示密钥',
    hideKey: '隐藏密钥',
    testConnection: '测试连接',
    automaticAdapter: '支持适配的后端可让 Code 自动使用此协议，模型、服务商和计费方式不变。',
    autoDetectionRequired: '无法验证 API 模式。请在高级设置中手动选择 API 模式，或更新后端后重新测试。',
    keepKey: '已保存密钥，留空即可继续使用',
    configured: '已连接的服务'
  },
  'zh-hant': {
    title: '設定自訂模型',
    description: '填寫 API 位址、金鑰與模型名稱，協定自動偵測。測試或儲存時會傳送簡短驗證請求，可能產生服務商費用。',
    savedConfigurations: '已儲存設定',
    newConfiguration: '新增設定',
    savedExplanation: '選擇一份已儲存的自訂連線進行編輯，不會切換目前模型。',
    connectionLabel: '自訂連線',
    provider: '服務商',
    customProvider: '自訂服務',
    modelName: '模型名稱',
    modelHint: '測試連線後選擇模型，也可以直接輸入模型名稱。',
    advanced: '進階設定',
    advancedHint: '通常無需修改；僅在介面或服務有特殊要求時調整。',
    showKey: '顯示金鑰',
    hideKey: '隱藏金鑰',
    testConnection: '測試連線',
    automaticAdapter: '支援適配的後端可讓 Code 自動使用此協定，模型、服務商與計費方式不變。',
    autoDetectionRequired: '無法驗證 API 模式。請在進階設定中手動選擇 API 模式，或更新後端後重新測試。',
    keepKey: '已儲存金鑰，留空即可繼續使用',
    configured: '已連接的服務'
  },
  ja: {
    title: 'カスタムモデルを設定',
    description:
      'API アドレス、キー、モデル名を入力すると、プロトコルを自動検出します。テストや保存時に短い確認リクエストを送信するため、利用料金が発生する場合があります。',
    savedConfigurations: '保存済みの設定',
    newConfiguration: '新しい設定',
    savedExplanation: '保存済みのカスタム接続を選択して編集します。現在のモデルは切り替わりません。',
    connectionLabel: 'カスタム接続',
    provider: 'プロバイダー',
    customProvider: 'カスタムサービス',
    modelName: 'モデル名',
    modelHint: '接続をテストしてモデルを選ぶか、モデル名を直接入力してください。',
    advanced: '詳細設定',
    advancedHint: 'API やサービスから指定がない限り、既定値のままにしてください。',
    showKey: 'キーを表示',
    hideKey: 'キーを隠す',
    testConnection: '接続をテスト',
    automaticAdapter:
      '対応バックエンドでは Code がこのプロトコルを自動変換します。モデル、プロバイダー、課金方法は変わりません。',
    autoDetectionRequired:
      'API モードを確認できませんでした。詳細設定で API モードを手動で選択するか、バックエンドを更新して再テストしてください。',
    keepKey: 'キーは保存済みです。空欄にすると現在のキーを使用します。',
    configured: '接続済みのサービス'
  },
  ar: {
    title: 'إعداد نماذج مخصّصة',
    description:
      'أدخل عنوان API والمفتاح واسم النموذج؛ يُكتشف البروتوكول تلقائيًا. يرسل الاختبار أو الحفظ طلب تحقق قصيرًا قد تترتب عليه رسوم لدى مزوّد الخدمة.',
    savedConfigurations: 'الإعدادات المحفوظة',
    newConfiguration: 'إعداد جديد',
    savedExplanation: 'اختر اتصالًا مخصّصًا محفوظًا لتعديله. لن يتغيّر النموذج الحالي.',
    connectionLabel: 'اتصال مخصّص',
    provider: 'المزوّد',
    customProvider: 'خدمة مخصّصة',
    modelName: 'اسم النموذج',
    modelHint: 'اختبر الاتصال لاختيار نموذج، أو أدخل اسم النموذج مباشرةً.',
    advanced: 'إعدادات متقدمة',
    advancedHint: 'اترك القيم الافتراضية ما لم تتطلب واجهة API أو الخدمة إعدادًا محددًا.',
    showKey: 'إظهار المفتاح',
    hideKey: 'إخفاء المفتاح',
    testConnection: 'اختبار الاتصال',
    automaticAdapter:
      'يمكن لـ Code تكييف هذا البروتوكول تلقائيًا على الخوادم الداعمة، مع إبقاء النموذج والمزوّد والفوترة كما هي.',
    autoDetectionRequired:
      'تعذّر التحقق من وضع API. اختر وضع API يدويًا في الإعدادات المتقدمة، أو حدّث الخادم الخلفي وأعد الاختبار.',
    keepKey: 'المفتاح محفوظ. اترك الحقل فارغًا للاحتفاظ به.',
    configured: 'الخدمات المتصلة'
  },
  ru: {
    title: 'Настроить свои модели',
    description:
      'Введите адрес API, ключ и название модели — протокол определяется автоматически. Проверка или сохранение отправляет короткий запрос, за который провайдер может взимать плату.',
    savedConfigurations: 'Сохранённые настройки',
    newConfiguration: 'Новая настройка',
    savedExplanation: 'Выберите сохранённое собственное подключение для редактирования. Текущая модель не изменится.',
    connectionLabel: 'Своё подключение',
    provider: 'Провайдер',
    customProvider: 'Свой сервис',
    modelName: 'Название модели',
    modelHint: 'Проверьте подключение и выберите модель или введите её название.',
    advanced: 'Дополнительные настройки',
    advancedHint: 'Оставьте значения по умолчанию, если API или сервис не требуют других.',
    showKey: 'Показать ключ',
    hideKey: 'Скрыть ключ',
    testConnection: 'Проверить связь',
    automaticAdapter:
      'Code автоматически адаптирует этот протокол на поддерживаемом сервере. Модель, провайдер и способ оплаты не меняются.',
    autoDetectionRequired:
      'Не удалось проверить режим API. Выберите режим API вручную в дополнительных настройках или обновите сервер и повторите проверку.',
    keepKey: 'Ключ сохранён. Оставьте поле пустым, чтобы использовать его.',
    configured: 'Подключённые сервисы'
  },
  fr: {
    title: 'Configurer des modèles personnalisés',
    description:
      'Saisissez l’adresse API, la clé et le modèle ; le protocole est détecté automatiquement. Tester ou enregistrer envoie une courte requête de vérification, éventuellement facturée par le fournisseur.',
    savedConfigurations: 'Configurations enregistrées',
    newConfiguration: 'Nouvelle configuration',
    savedExplanation:
      'Choisissez une connexion personnalisée enregistrée à modifier. Le modèle actuel ne changera pas.',
    connectionLabel: 'Connexion personnalisée',
    provider: 'Fournisseur',
    customProvider: 'Service personnalisé',
    modelName: 'Nom du modèle',
    modelHint: 'Testez la connexion pour choisir un modèle, ou saisissez son nom.',
    advanced: 'Paramètres avancés',
    advancedHint: 'Gardez les valeurs par défaut, sauf exigence particulière de l’API ou du service.',
    showKey: 'Afficher la clé',
    hideKey: 'Masquer la clé',
    testConnection: 'Tester la connexion',
    automaticAdapter:
      'Code peut adapter automatiquement ce protocole sur les serveurs compatibles, sans changer de modèle, de fournisseur ni de facturation.',
    autoDetectionRequired:
      'Le mode API n’a pas pu être vérifié. Choisissez-le manuellement dans les paramètres avancés, ou mettez à jour le serveur et relancez le test.',
    keepKey: 'Clé enregistrée. Laissez ce champ vide pour la conserver.',
    configured: 'Services connectés'
  },
  de: {
    title: 'Eigene Modelle einrichten',
    description:
      'Geben Sie API-Adresse, Schlüssel und Modellnamen ein; das Protokoll wird automatisch erkannt. Testen oder Speichern sendet eine kurze Prüfanfrage, für die der Anbieter Gebühren erheben kann.',
    savedConfigurations: 'Gespeicherte Konfigurationen',
    newConfiguration: 'Neue Konfiguration',
    savedExplanation:
      'Wählen Sie eine gespeicherte eigene Verbindung zum Bearbeiten. Das aktuelle Modell wird nicht gewechselt.',
    connectionLabel: 'Eigene Verbindung',
    provider: 'Anbieter',
    customProvider: 'Eigener Dienst',
    modelName: 'Modellname',
    modelHint: 'Testen Sie die Verbindung und wählen Sie ein Modell oder geben Sie seinen Namen ein.',
    advanced: 'Erweiterte Einstellungen',
    advancedHint: 'Behalten Sie die Standardwerte bei, sofern die API oder der Dienst nichts anderes erfordert.',
    showKey: 'Schlüssel anzeigen',
    hideKey: 'Schlüssel ausblenden',
    testConnection: 'Verbindung testen',
    automaticAdapter:
      'Code kann dieses Protokoll auf unterstützten Backends automatisch anpassen. Modell, Anbieter und Abrechnung bleiben gleich.',
    autoDetectionRequired:
      'Der API-Modus konnte nicht bestätigt werden. Wählen Sie ihn in den erweiterten Einstellungen manuell aus oder aktualisieren Sie das Backend und testen Sie erneut.',
    keepKey: 'Schlüssel gespeichert. Leer lassen, um ihn beizubehalten.',
    configured: 'Verbundene Dienste'
  },
  es: {
    title: 'Configurar modelos personalizados',
    description:
      'Introduce la dirección API, la clave y el modelo; el protocolo se detecta automáticamente. Probar o guardar envía una breve solicitud de verificación que puede generar cargos del proveedor.',
    savedConfigurations: 'Configuraciones guardadas',
    newConfiguration: 'Nueva configuración',
    savedExplanation: 'Elige una conexión personalizada guardada para editarla. El modelo actual no cambiará.',
    connectionLabel: 'Conexión personalizada',
    provider: 'Proveedor',
    customProvider: 'Servicio personalizado',
    modelName: 'Nombre del modelo',
    modelHint: 'Prueba la conexión para elegir un modelo o introduce su nombre.',
    advanced: 'Ajustes avanzados',
    advancedHint: 'Mantén los valores predeterminados, salvo que la API o el servicio requieran otros.',
    showKey: 'Mostrar clave',
    hideKey: 'Ocultar clave',
    testConnection: 'Probar conexión',
    automaticAdapter:
      'Code puede adaptar automáticamente este protocolo en servidores compatibles, sin cambiar de modelo, proveedor ni facturación.',
    autoDetectionRequired:
      'No se pudo verificar el modo API. Selecciónalo manualmente en los ajustes avanzados, o actualiza el backend y vuelve a probar.',
    keepKey: 'Clave guardada. Deja el campo vacío para conservarla.',
    configured: 'Servicios conectados'
  }
}

export function customModelConfigCopy(locale: string) {
  return COPY[locale as BundledLocale] ?? ENGLISH
}
