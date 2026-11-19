import type { BundledLocale } from './types'

export interface ExecutionModeCopy {
  work: string
  code: string
  workLabel: string
  codeLabel: string
  workDescription: string
  codeDescription: string
  switchMode: string
  sessionFilter: string
  currentMode: string
  allModes: string
  otherModeActive: string
  folderRequired: string
  unsupportedGateway: string
}

const names = { work: 'Aino Work', code: 'Aino Code', workLabel: 'Work', codeLabel: 'Code' }

export const executionModeCopy: Record<BundledLocale, ExecutionModeCopy> = {
  en: {
    ...names,
    sessionFilter: 'Session modes',
    currentMode: 'Current mode',
    allModes: 'All modes',
    otherModeActive: 'Running or waiting in the other mode',
    workDescription: 'Documents, research and everyday work',
    codeDescription: 'Build and change code with Codex',
    switchMode: 'Switch Aino mode',
    folderRequired: 'Choose a project folder before starting Aino Code.',
    unsupportedGateway: 'This service does not support Aino Code yet. Update the service and try again.'
  },
  zh: {
    ...names,
    sessionFilter: '会话模式',
    currentMode: '当前模式',
    allModes: '所有模式',
    otherModeActive: '另一模式中运行或等待处理的任务',
    workDescription: '处理文档、研究和日常工作',
    codeDescription: '使用 Codex 开发和修改代码',
    switchMode: '切换 Aino 模式',
    folderRequired: '请先选择项目文件夹，再开始 Aino Code 任务。',
    unsupportedGateway: '当前服务尚不支持 Aino Code，请更新服务后重试。'
  },
  'zh-hant': {
    ...names,
    sessionFilter: '對話模式',
    currentMode: '目前模式',
    allModes: '所有模式',
    otherModeActive: '另一模式中執行或等待處理的任務',
    workDescription: '處理文件、研究和日常工作',
    codeDescription: '使用 Codex 開發和修改程式碼',
    switchMode: '切換 Aino 模式',
    folderRequired: '請先選擇專案資料夾，再開始 Aino Code 任務。',
    unsupportedGateway: '目前服務尚不支援 Aino Code，請更新服務後重試。'
  },
  ja: {
    ...names,
    sessionFilter: 'セッションのモード',
    currentMode: '現在のモード',
    allModes: 'すべてのモード',
    otherModeActive: '別のモードで実行中または入力待ち',
    workDescription: '文書、調査、日常の仕事',
    codeDescription: 'Codex でコードを開発・変更',
    switchMode: 'Aino のモードを切り替え',
    folderRequired: 'Aino Code を開始する前にプロジェクトフォルダーを選択してください。',
    unsupportedGateway: 'このサービスはまだ Aino Code に対応していません。更新して再試行してください。'
  },
  ar: {
    ...names,
    sessionFilter: 'أوضاع المحادثات',
    currentMode: 'الوضع الحالي',
    allModes: 'كل الأوضاع',
    otherModeActive: 'مهام قيد التشغيل أو الانتظار في الوضع الآخر',
    workDescription: 'المستندات والبحث والعمل اليومي',
    codeDescription: 'تطوير الشيفرة وتعديلها باستخدام Codex',
    switchMode: 'تبديل وضع Aino',
    folderRequired: 'اختر مجلد مشروع قبل بدء Aino Code.',
    unsupportedGateway: 'هذه الخدمة لا تدعم Aino Code بعد. حدّث الخدمة وحاول مجددًا.'
  },
  ru: {
    ...names,
    sessionFilter: 'Режимы чатов',
    currentMode: 'Текущий режим',
    allModes: 'Все режимы',
    otherModeActive: 'Выполняются или ожидают в другом режиме',
    workDescription: 'Документы, исследования и повседневная работа',
    codeDescription: 'Разработка и изменение кода с Codex',
    switchMode: 'Переключить режим Aino',
    folderRequired: 'Выберите папку проекта перед запуском Aino Code.',
    unsupportedGateway: 'Этот сервис пока не поддерживает Aino Code. Обновите его и повторите попытку.'
  },
  fr: {
    ...names,
    sessionFilter: 'Modes des conversations',
    currentMode: 'Mode actuel',
    allModes: 'Tous les modes',
    otherModeActive: 'En cours ou en attente dans l’autre mode',
    workDescription: 'Documents, recherches et travail quotidien',
    codeDescription: 'Développer et modifier du code avec Codex',
    switchMode: 'Changer de mode Aino',
    folderRequired: 'Choisissez un dossier de projet avant de démarrer Aino Code.',
    unsupportedGateway: 'Ce service ne prend pas encore en charge Aino Code. Mettez-le à jour puis réessayez.'
  },
  de: {
    ...names,
    sessionFilter: 'Gesprächsmodi',
    currentMode: 'Aktueller Modus',
    allModes: 'Alle Modi',
    otherModeActive: 'Im anderen Modus aktiv oder wartend',
    workDescription: 'Dokumente, Recherche und tägliche Arbeit',
    codeDescription: 'Code mit Codex entwickeln und ändern',
    switchMode: 'Aino-Modus wechseln',
    folderRequired: 'Wählen Sie vor dem Start von Aino Code einen Projektordner.',
    unsupportedGateway:
      'Dieser Dienst unterstützt Aino Code noch nicht. Aktualisieren Sie ihn und versuchen Sie es erneut.'
  },
  es: {
    ...names,
    sessionFilter: 'Modos de conversación',
    currentMode: 'Modo actual',
    allModes: 'Todos los modos',
    otherModeActive: 'En curso o en espera en el otro modo',
    workDescription: 'Documentos, investigación y trabajo diario',
    codeDescription: 'Desarrollar y modificar código con Codex',
    switchMode: 'Cambiar modo de Aino',
    folderRequired: 'Elige una carpeta de proyecto antes de iniciar Aino Code.',
    unsupportedGateway: 'Este servicio aún no admite Aino Code. Actualízalo e inténtalo de nuevo.'
  }
}
