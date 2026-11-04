import type { BundledLocale } from './types'

export interface AppearancePageCopy {
  description: string
  categories: { theme: string; layout: string; chat: string; habits: string; pets: string }
  reading: string
  uiScaleDescription: string
  chatTextDescription: string
  uiFontTitle: string
  uiFontDescription: string
  uiFontPlaceholder: string
  uiFontReset: string
  uiFontSample: string
  petCatalog: string
  petCurrent: string
  windowBehavior: string
  transparency: string
  toolResults: string
  interactions: string
  languageStartup: string
  guidance: string
  preview: string
  previewCaption: string
  previewThemeNote: string
  previewLayoutNote: string
  previewChatNote: string
  habitsPreview: {
    label: string
    resumeTitle: string
    freshTitle: string
    resumeDescription: string
    freshDescription: string
    welcome: string
    tip: string
    tour: string
  }
  sample: {
    project: string
    session: string
    user: string
    assistant: string
    tool: string
    reasoningTitle: string
    reasoning: string
    composer: string
    detail: string
    time: string
    files: string
    summary: string
    diffAdd: string
    diffRemove: string
  }
  defaultSuffix: string
  tabsLabel: string
}

export const appearancePage: Record<BundledLocale, AppearancePageCopy> = {
  en: {
    description: 'Make Aino suit the way you read and work.',
    categories: {
      theme: 'Theme & text',
      layout: 'Window & layout',
      chat: 'Chat display',
      habits: 'Habits & guidance',
      pets: 'Desktop pets'
    },
    reading: 'Reading & scaling',
    uiScaleDescription: 'Scale the entire app, including navigation, settings, controls and chat text.',
    chatTextDescription:
      'Adjust message and composer text independently. Use Global UI Scale for navigation and settings.',
    uiFontTitle: 'Interface & chat font',
    uiFontDescription: 'Use a font installed on this device. Leave blank for the system font.',
    uiFontPlaceholder: 'System default font',
    uiFontReset: 'Restore default',
    uiFontSample: 'Clearer ideas, easier work. Aa 0123456789',
    petCatalog: 'Browse pet catalog',
    petCurrent: 'Currently in use',
    windowBehavior: 'Window behavior',
    transparency: 'Transparency & background',
    toolResults: 'Tool & file results',
    interactions: 'Reactions & content previews',
    languageStartup: 'Language & startup',
    guidance: 'Tips & tours',
    preview: 'Live preview',
    previewCaption: 'Change an option to see the preview update.',
    previewThemeNote:
      'Font, chat text size and color mode update independently in this preview. UI scale changes the whole application.',
    previewLayoutNote:
      'The file browser requires an open project. Native window transparency depends on your operating system.',
    previewChatNote: 'Only the presentation changes. Reasoning, tool execution and file operations remain available.',
    habitsPreview: {
      label: 'Startup and guidance preview',
      resumeTitle: 'Continue your last work',
      freshTitle: 'Start with a new chat',
      resumeDescription: 'Aino restores your last conversation when it opens.',
      freshDescription: 'Aino opens an empty conversation.',
      welcome: 'What would you like to work on today?',
      tip: 'Tip: Drag a panel tab to view chat and files side by side.',
      tour: 'Tour: Sidebar → Project files → Message composer'
    },
    sample: {
      project: 'Project docs',
      session: 'Interface polish',
      user: 'Organize the project docs and list the next steps.',
      assistant:
        'The documentation is organized. Next, add installation instructions and make the example formatting consistent.',
      tool: 'Reviewed project files',
      reasoningTitle: 'Reasoning',
      reasoning: 'Check the directory first, then organize the instructions and next steps.',
      composer: 'Describe what you have in mind…',
      detail: 'Organize files and instructions',
      time: 'Just now · In progress',
      files: 'Project files',
      summary: 'Chat',
      diffAdd: '+ Add installation instructions',
      diffRemove: '− Remove duplicate examples'
    },
    defaultSuffix: 'Default',
    tabsLabel: 'Appearance categories'
  },
  zh: {
    description: '让 Aino 更适合你的阅读和工作习惯。',
    categories: { theme: '主题与文字', layout: '窗口与布局', chat: '聊天显示', habits: '习惯与引导', pets: '桌面宠物' },
    reading: '阅读与缩放',
    uiScaleDescription: '统一调整导航、设置、控件和聊天文字的大小。',
    chatTextDescription: '单独调整消息和输入框文字；导航与设置请使用上方的全局界面缩放。',
    uiFontTitle: '界面与聊天字体',
    uiFontDescription: '使用此设备已安装的字体，留空沿用系统字体。',
    uiFontPlaceholder: '系统默认字体',
    uiFontReset: '恢复默认',
    uiFontSample: '让想法更清晰，让工作更轻松。Aa 0123456789',
    petCatalog: '浏览宠物目录',
    petCurrent: '当前使用',
    windowBehavior: '窗口行为',
    transparency: '透明度与背景',
    toolResults: '工具与文件结果',
    interactions: '互动与内容预览',
    languageStartup: '语言与启动',
    guidance: '提示与引导',
    preview: '实时预览',
    previewCaption: '修改左侧选项，预览会同步更新。',
    previewThemeNote: '字体、聊天字号与颜色模式会独立呈现在预览中。界面缩放调整整个应用的大小。',
    previewLayoutNote: '文件浏览器需要先打开项目。窗口透明效果由操作系统提供。',
    previewChatNote: '仅改变展示方式。推理内容、工具执行与文件操作都保留。',
    habitsPreview: {
      label: '启动与引导预览',
      resumeTitle: '继续上次的工作',
      freshTitle: '从新对话开始',
      resumeDescription: '打开 Aino 后恢复上次的会话。',
      freshDescription: '打开 Aino 后进入空白会话。',
      welcome: '今天想一起完成什么？',
      tip: '提示：拖动面板标签，可以并排查看聊天与文件。',
      tour: '导览：侧边栏 → 项目文件 → 对话输入框'
    },
    sample: {
      project: '项目文档',
      session: '界面优化',
      user: '整理项目文档，列出下一步。',
      assistant: '文档结构已经梳理好了。接下来可以补充安装说明，再统一示例的格式。',
      tool: '已查看项目文件',
      reasoningTitle: '思考过程',
      reasoning: '先确认目录，再整理说明与待办。',
      composer: '继续描述你的想法…',
      detail: '梳理目录与说明',
      time: '刚刚 · 进行中',
      files: '项目文件',
      summary: '聊天',
      diffAdd: '+ 补充安装说明',
      diffRemove: '− 删除重复示例'
    },
    defaultSuffix: '默认',
    tabsLabel: '外观设置分类'
  },
  'zh-hant': {
    description: '讓 Aino 更適合你的閱讀和工作習慣。',
    categories: { theme: '主題與文字', layout: '視窗與版面', chat: '聊天顯示', habits: '習慣與引導', pets: '桌面寵物' },
    reading: '閱讀與縮放',
    uiScaleDescription: '統一調整導覽、設定、控制項與聊天文字的大小。',
    chatTextDescription: '單獨調整訊息與輸入框文字；導覽與設定請使用上方的全域介面縮放。',
    uiFontTitle: '介面與聊天字型',
    uiFontDescription: '使用此裝置已安裝的字型，留空沿用系統字型。',
    uiFontPlaceholder: '系統預設字型',
    uiFontReset: '恢復預設',
    uiFontSample: '讓想法更清晰，讓工作更輕鬆。Aa 0123456789',
    petCatalog: '瀏覽寵物目錄',
    petCurrent: '目前使用',
    windowBehavior: '視窗行為',
    transparency: '透明度與背景',
    toolResults: '工具與檔案結果',
    interactions: '互動與內容預覽',
    languageStartup: '語言與啟動',
    guidance: '提示與導覽',
    preview: '即時預覽',
    previewCaption: '修改左側選項，預覽會同步更新。',
    previewThemeNote: '字型、聊天字級與顏色模式會獨立呈現在預覽中。介面縮放調整整個應用程式的大小。',
    previewLayoutNote: '檔案瀏覽器需要先開啟專案。視窗透明效果由作業系統提供。',
    previewChatNote: '僅改變顯示方式。推理內容、工具執行與檔案操作都保留。',
    habitsPreview: {
      label: '啟動與導覽預覽',
      resumeTitle: '繼續上次的工作',
      freshTitle: '從新對話開始',
      resumeDescription: '開啟 Aino 後恢復上次的對話。',
      freshDescription: '開啟 Aino 後進入空白對話。',
      welcome: '今天想一起完成什麼？',
      tip: '提示：拖曳面板標籤，可以並排查看聊天與檔案。',
      tour: '導覽：側邊欄 → 專案檔案 → 對話輸入框'
    },
    sample: {
      project: '專案文件',
      session: '介面最佳化',
      user: '整理專案文件，列出下一步。',
      assistant: '文件結構已經整理好了。接下來可以補充安裝說明，再統一範例的格式。',
      tool: '已查看專案檔案',
      reasoningTitle: '思考過程',
      reasoning: '先確認目錄，再整理說明與待辦。',
      composer: '繼續描述你的想法…',
      detail: '整理目錄與說明',
      time: '剛剛 · 進行中',
      files: '專案檔案',
      summary: '聊天',
      diffAdd: '+ 補充安裝說明',
      diffRemove: '− 刪除重複範例'
    },
    defaultSuffix: '預設',
    tabsLabel: '外觀設定分類'
  },
  ja: {
    description: '読み方や作業の習慣に合わせて Aino を整えます。',
    categories: {
      theme: 'テーマと文字',
      layout: 'ウィンドウと配置',
      chat: 'チャット表示',
      habits: '起動とガイド',
      pets: 'デスクトップペット'
    },
    reading: '文字と表示倍率',
    uiScaleDescription: 'ナビゲーション、設定、操作ボタン、チャットをまとめて拡大・縮小します。',
    chatTextDescription:
      'メッセージと入力欄の文字を個別に調整します。ナビゲーションや設定にはアプリ全体の表示倍率を使います。',
    uiFontTitle: '画面とチャットのフォント',
    uiFontDescription: 'この端末にあるフォントを使用します。空欄ではシステムフォントを使います。',
    uiFontPlaceholder: 'システム標準のフォント',
    uiFontReset: '既定に戻す',
    uiFontSample: '考えを明確に、作業を快適に。Aa 0123456789',
    petCatalog: 'ペットカタログを見る',
    petCurrent: '使用中',
    windowBehavior: 'ウィンドウの動作',
    transparency: '透明度と背景',
    toolResults: 'ツールとファイルの結果',
    interactions: 'リアクションとプレビュー',
    languageStartup: '言語と起動',
    guidance: 'ヒントとガイド',
    preview: 'ライブプレビュー',
    previewCaption: '設定を変えるとプレビューも更新されます。',
    previewThemeNote:
      'フォント、チャット文字サイズ、カラーモードを個別に確認できます。表示倍率はアプリ全体に適用されます。',
    previewLayoutNote:
      'ファイルブラウザーには開いているプロジェクトが必要です。ウィンドウの透明効果は OS によって異なります。',
    previewChatNote: '表示方法だけを変更します。推論内容、ツール実行、ファイル操作は保持されます。',
    habitsPreview: {
      label: '起動とガイドのプレビュー',
      resumeTitle: '前の作業を続ける',
      freshTitle: '新しいチャットから開始',
      resumeDescription: 'Aino を開くと前回の会話が復元されます。',
      freshDescription: 'Aino を開くと空の会話が表示されます。',
      welcome: '今日は何を一緒に進めましょうか？',
      tip: 'ヒント：パネルのタブをドラッグするとチャットとファイルを並べて表示できます。',
      tour: 'ガイド：サイドバー → プロジェクトファイル → メッセージ入力欄'
    },
    sample: {
      project: 'プロジェクト文書',
      session: '画面の改善',
      user: 'プロジェクト文書を整理して、次の作業を挙げて。',
      assistant: '文書の構成を整理しました。次にインストール手順を追加して、サンプルの書式を統一できます。',
      tool: 'プロジェクトファイルを確認済み',
      reasoningTitle: '思考過程',
      reasoning: 'まずディレクトリを確認し、説明と次の作業を整理します。',
      composer: 'やりたいことを入力…',
      detail: '構成と説明を整理',
      time: 'たった今 · 進行中',
      files: 'プロジェクトファイル',
      summary: 'チャット',
      diffAdd: '+ インストール手順を追加',
      diffRemove: '− 重複するサンプルを削除'
    },
    defaultSuffix: '既定',
    tabsLabel: '外観設定の分類'
  },
  ar: {
    description: 'اجعل Aino مناسبًا لطريقتك في القراءة والعمل.',
    categories: {
      theme: 'المظهر والنص',
      layout: 'النافذة والتخطيط',
      chat: 'عرض المحادثة',
      habits: 'العادات والإرشاد',
      pets: 'حيوانات سطح المكتب'
    },
    reading: 'القراءة والتكبير',
    uiScaleDescription: 'اضبط حجم التطبيق بالكامل، بما فيه التنقل والإعدادات وعناصر التحكم ونص المحادثة.',
    chatTextDescription: 'اضبط نص الرسائل وحقل الكتابة بشكل مستقل. استخدم مقياس الواجهة للتنقل والإعدادات.',
    uiFontTitle: 'خط الواجهة والمحادثة',
    uiFontDescription: 'استخدم خطًا مثبتًا على هذا الجهاز. اترك الحقل فارغًا لخط النظام.',
    uiFontPlaceholder: 'خط النظام الافتراضي',
    uiFontReset: 'استعادة الافتراضي',
    uiFontSample: 'أفكار أوضح وعمل أسهل. Aa 0123456789',
    petCatalog: 'تصفح كتالوج الحيوانات',
    petCurrent: 'مستخدم حاليًا',
    windowBehavior: 'سلوك النافذة',
    transparency: 'الشفافية والخلفية',
    toolResults: 'نتائج الأدوات والملفات',
    interactions: 'التفاعلات ومعاينة المحتوى',
    languageStartup: 'اللغة وبدء التشغيل',
    guidance: 'النصائح والجولات',
    preview: 'معاينة مباشرة',
    previewCaption: 'غيّر خيارًا لتحديث المعاينة.',
    previewThemeNote:
      'تظهر تغييرات الخط وحجم نص المحادثة ونمط الألوان بشكل مستقل. يغيّر تكبير الواجهة حجم التطبيق كله.',
    previewLayoutNote: 'يتطلب متصفح الملفات مشروعًا مفتوحًا. تعتمد شفافية النافذة على نظام التشغيل.',
    previewChatNote: 'يتغير العرض فقط. تبقى محتويات التفكير وتنفيذ الأدوات وعمليات الملفات متاحة.',
    habitsPreview: {
      label: 'معاينة بدء التشغيل والإرشاد',
      resumeTitle: 'تابع عملك السابق',
      freshTitle: 'ابدأ بمحادثة جديدة',
      resumeDescription: 'يستعيد Aino المحادثة الأخيرة عند فتحه.',
      freshDescription: 'يفتح Aino محادثة فارغة.',
      welcome: 'ماذا تريد أن ننجز معًا اليوم؟',
      tip: 'نصيحة: اسحب علامة تبويب اللوحة لعرض المحادثة والملفات جنبًا إلى جنب.',
      tour: 'جولة: الشريط الجانبي ← ملفات المشروع ← حقل الرسائل'
    },
    sample: {
      project: 'وثائق المشروع',
      session: 'تحسين الواجهة',
      user: 'نظّم وثائق المشروع وحدّد الخطوات التالية.',
      assistant: 'تم تنظيم الوثائق. يمكنك الآن إضافة تعليمات التثبيت وتوحيد تنسيق الأمثلة.',
      tool: 'تمت مراجعة ملفات المشروع',
      reasoningTitle: 'التفكير',
      reasoning: 'أراجع المجلد أولًا، ثم أنظّم التعليمات والخطوات التالية.',
      composer: 'صف ما تفكر فيه…',
      detail: 'تنظيم المجلدات والتعليمات',
      time: 'الآن · جارٍ العمل',
      files: 'ملفات المشروع',
      summary: 'المحادثة',
      diffAdd: '+ إضافة تعليمات التثبيت',
      diffRemove: '− إزالة الأمثلة المكررة'
    },
    defaultSuffix: 'الافتراضي',
    tabsLabel: 'فئات إعدادات المظهر'
  },
  ru: {
    description: 'Настройте Aino под свои привычки чтения и работы.',
    categories: {
      theme: 'Тема и текст',
      layout: 'Окно и компоновка',
      chat: 'Вид чата',
      habits: 'Привычки и подсказки',
      pets: 'Питомцы'
    },
    reading: 'Чтение и масштаб',
    uiScaleDescription: 'Измените размер всего приложения: навигации, настроек, элементов управления и чата.',
    chatTextDescription:
      'Отдельно измените текст сообщений и поля ввода. Для навигации и настроек используйте масштаб всего интерфейса.',
    uiFontTitle: 'Шрифт интерфейса и чата',
    uiFontDescription: 'Используйте установленный на устройстве шрифт. Пустое поле означает системный шрифт.',
    uiFontPlaceholder: 'Системный шрифт',
    uiFontReset: 'Восстановить стандартный',
    uiFontSample: 'Яснее мысли, легче работа. Aa 0123456789',
    petCatalog: 'Открыть каталог питомцев',
    petCurrent: 'Используется',
    windowBehavior: 'Поведение окна',
    transparency: 'Прозрачность и фон',
    toolResults: 'Результаты инструментов и файлов',
    interactions: 'Реакции и предпросмотр',
    languageStartup: 'Язык и запуск',
    guidance: 'Подсказки и туры',
    preview: 'Предпросмотр',
    previewCaption: 'Измените параметр, чтобы обновить предпросмотр.',
    previewThemeNote:
      'Шрифт, размер текста чата и цветовая схема меняются независимо. Масштаб интерфейса действует на всё приложение.',
    previewLayoutNote:
      'Для файлового браузера нужен открытый проект. Прозрачность окна зависит от операционной системы.',
    previewChatNote:
      'Меняется только отображение. Рассуждения, выполнение инструментов и операции с файлами сохраняются.',
    habitsPreview: {
      label: 'Предпросмотр запуска и подсказок',
      resumeTitle: 'Продолжить прежнюю работу',
      freshTitle: 'Начать с нового чата',
      resumeDescription: 'При запуске Aino восстанавливает последний разговор.',
      freshDescription: 'При запуске Aino открывает пустой разговор.',
      welcome: 'Над чем поработаем сегодня?',
      tip: 'Совет: перетащите вкладку панели, чтобы видеть чат и файлы рядом.',
      tour: 'Тур: Боковая панель → Файлы проекта → Поле сообщения'
    },
    sample: {
      project: 'Документация',
      session: 'Улучшение интерфейса',
      user: 'Упорядочи документацию проекта и перечисли следующие шаги.',
      assistant:
        'Документация упорядочена. Далее можно добавить инструкции по установке и унифицировать оформление примеров.',
      tool: 'Файлы проекта просмотрены',
      reasoningTitle: 'Рассуждения',
      reasoning: 'Сначала проверю каталог, затем упорядочу инструкции и задачи.',
      composer: 'Опишите свою идею…',
      detail: 'Упорядочить каталог и инструкции',
      time: 'Только что · В работе',
      files: 'Файлы проекта',
      summary: 'Чат',
      diffAdd: '+ Добавить инструкции по установке',
      diffRemove: '− Удалить повторяющиеся примеры'
    },
    defaultSuffix: 'По умолчанию',
    tabsLabel: 'Категории оформления'
  },
  fr: {
    description: 'Adaptez Aino à vos habitudes de lecture et de travail.',
    categories: {
      theme: 'Thème et texte',
      layout: 'Fenêtre et disposition',
      chat: 'Affichage du chat',
      habits: 'Habitudes et guides',
      pets: 'Compagnons de bureau'
    },
    reading: 'Lecture et échelle',
    uiScaleDescription: 'Redimensionnez toute l’application : navigation, paramètres, commandes et texte du chat.',
    chatTextDescription:
      'Réglez séparément le texte des messages et de la saisie. Pour la navigation et les paramètres, utilisez l’échelle globale.',
    uiFontTitle: 'Police de l’interface et du chat',
    uiFontDescription: 'Utilisez une police installée sur cet appareil. Laissez vide pour la police système.',
    uiFontPlaceholder: 'Police système par défaut',
    uiFontReset: 'Rétablir par défaut',
    uiFontSample: 'Des idées plus claires, un travail plus simple. Aa 0123456789',
    petCatalog: 'Parcourir le catalogue de compagnons',
    petCurrent: 'En cours d’utilisation',
    windowBehavior: 'Comportement de la fenêtre',
    transparency: 'Transparence et arrière-plan',
    toolResults: 'Résultats des outils et fichiers',
    interactions: 'Réactions et aperçus',
    languageStartup: 'Langue et démarrage',
    guidance: 'Conseils et visites guidées',
    preview: 'Aperçu en direct',
    previewCaption: 'Modifiez une option pour actualiser l’aperçu.',
    previewThemeNote:
      'La police, la taille du texte du chat et les couleurs changent indépendamment. Le zoom agit sur toute l’application.',
    previewLayoutNote:
      'L’explorateur de fichiers nécessite un projet ouvert. La transparence de la fenêtre dépend du système d’exploitation.',
    previewChatNote:
      'Seul l’affichage change. Le raisonnement, l’exécution des outils et les opérations sur les fichiers sont conservés.',
    habitsPreview: {
      label: 'Aperçu du démarrage et des guides',
      resumeTitle: 'Reprendre votre travail',
      freshTitle: 'Commencer une nouvelle discussion',
      resumeDescription: 'Aino restaure votre dernière conversation à l’ouverture.',
      freshDescription: 'Aino ouvre une conversation vide.',
      welcome: 'Sur quoi souhaitez-vous travailler aujourd’hui ?',
      tip: 'Conseil : faites glisser un onglet pour afficher le chat et les fichiers côte à côte.',
      tour: 'Visite : Barre latérale → Fichiers du projet → Saisie de message'
    },
    sample: {
      project: 'Documentation',
      session: 'Amélioration de l’interface',
      user: 'Organise la documentation du projet et liste les prochaines étapes.',
      assistant:
        'La documentation est organisée. Vous pouvez maintenant ajouter les instructions d’installation et harmoniser les exemples.',
      tool: 'Fichiers du projet consultés',
      reasoningTitle: 'Raisonnement',
      reasoning: 'Vérifier d’abord le dossier, puis organiser les instructions et les tâches.',
      composer: 'Décrivez votre idée…',
      detail: 'Organiser les dossiers et instructions',
      time: 'À l’instant · En cours',
      files: 'Fichiers du projet',
      summary: 'Chat',
      diffAdd: '+ Ajouter les instructions d’installation',
      diffRemove: '− Supprimer les exemples en double'
    },
    defaultSuffix: 'Par défaut',
    tabsLabel: 'Catégories d’apparence'
  },
  de: {
    description: 'Passen Sie Aino an Ihre Lese- und Arbeitsgewohnheiten an.',
    categories: {
      theme: 'Design und Text',
      layout: 'Fenster und Layout',
      chat: 'Chatdarstellung',
      habits: 'Start und Hilfen',
      pets: 'Desktop-Begleiter'
    },
    reading: 'Lesen und Skalierung',
    uiScaleDescription:
      'Skalieren Sie die gesamte App, einschließlich Navigation, Einstellungen, Bedienelementen und Chattext.',
    chatTextDescription:
      'Passen Sie Nachrichten und Eingabefeld separat an. Verwenden Sie die globale UI-Skalierung für Navigation und Einstellungen.',
    uiFontTitle: 'Schrift für Oberfläche und Chat',
    uiFontDescription: 'Verwenden Sie eine auf diesem Gerät installierte Schrift. Leer bedeutet Systemschrift.',
    uiFontPlaceholder: 'Standardschrift des Systems',
    uiFontReset: 'Standard wiederherstellen',
    uiFontSample: 'Klarere Gedanken, leichteres Arbeiten. Aa 0123456789',
    petCatalog: 'Begleiterkatalog durchsuchen',
    petCurrent: 'Aktuell verwendet',
    windowBehavior: 'Fensterverhalten',
    transparency: 'Transparenz und Hintergrund',
    toolResults: 'Werkzeug- und Dateiergebnisse',
    interactions: 'Reaktionen und Vorschauen',
    languageStartup: 'Sprache und Start',
    guidance: 'Tipps und Rundgänge',
    preview: 'Live-Vorschau',
    previewCaption: 'Ändern Sie eine Option, um die Vorschau zu aktualisieren.',
    previewThemeNote:
      'Schrift, Chattextgröße und Farbmodus ändern sich unabhängig. Die Oberflächenskalierung wirkt auf die gesamte Anwendung.',
    previewLayoutNote:
      'Der Dateibrowser benötigt ein geöffnetes Projekt. Die Fenstertransparenz hängt vom Betriebssystem ab.',
    previewChatNote:
      'Nur die Darstellung ändert sich. Denkprozesse, Werkzeugausführung und Dateioperationen bleiben erhalten.',
    habitsPreview: {
      label: 'Vorschau für Start und Hilfen',
      resumeTitle: 'Letzte Arbeit fortsetzen',
      freshTitle: 'Mit einem neuen Chat beginnen',
      resumeDescription: 'Aino stellt beim Öffnen das letzte Gespräch wieder her.',
      freshDescription: 'Aino öffnet ein leeres Gespräch.',
      welcome: 'Woran möchten Sie heute arbeiten?',
      tip: 'Tipp: Ziehen Sie einen Panel-Tab, um Chat und Dateien nebeneinander anzuzeigen.',
      tour: 'Rundgang: Seitenleiste → Projektdateien → Nachrichteneingabe'
    },
    sample: {
      project: 'Projektdokumentation',
      session: 'Oberfläche verbessern',
      user: 'Ordne die Projektdokumentation und liste die nächsten Schritte auf.',
      assistant:
        'Die Dokumentation ist geordnet. Als Nächstes können Sie Installationshinweise ergänzen und die Beispiele einheitlich formatieren.',
      tool: 'Projektdateien geprüft',
      reasoningTitle: 'Denkprozess',
      reasoning: 'Zuerst das Verzeichnis prüfen, dann Anleitungen und Aufgaben ordnen.',
      composer: 'Beschreiben Sie Ihre Idee…',
      detail: 'Verzeichnisse und Anleitungen ordnen',
      time: 'Gerade eben · In Arbeit',
      files: 'Projektdateien',
      summary: 'Chat',
      diffAdd: '+ Installationshinweise ergänzen',
      diffRemove: '− Doppelte Beispiele entfernen'
    },
    defaultSuffix: 'Standard',
    tabsLabel: 'Darstellungskategorien'
  },
  es: {
    description: 'Adapta Aino a tus hábitos de lectura y trabajo.',
    categories: {
      theme: 'Tema y texto',
      layout: 'Ventana y diseño',
      chat: 'Vista del chat',
      habits: 'Hábitos y guías',
      pets: 'Mascotas de escritorio'
    },
    reading: 'Lectura y escala',
    uiScaleDescription:
      'Ajusta toda la aplicación, incluida la navegación, los ajustes, los controles y el texto del chat.',
    chatTextDescription:
      'Ajusta los mensajes y el cuadro de entrada por separado. Para la navegación y los ajustes, usa la escala global.',
    uiFontTitle: 'Fuente de interfaz y chat',
    uiFontDescription: 'Usa una fuente instalada en este dispositivo. Déjalo vacío para usar la del sistema.',
    uiFontPlaceholder: 'Fuente predeterminada del sistema',
    uiFontReset: 'Restaurar predeterminada',
    uiFontSample: 'Ideas más claras, trabajo más sencillo. Aa 0123456789',
    petCatalog: 'Explorar el catálogo de mascotas',
    petCurrent: 'En uso',
    windowBehavior: 'Comportamiento de la ventana',
    transparency: 'Transparencia y fondo',
    toolResults: 'Resultados de herramientas y archivos',
    interactions: 'Reacciones y vistas previas',
    languageStartup: 'Idioma e inicio',
    guidance: 'Consejos y recorridos',
    preview: 'Vista previa en directo',
    previewCaption: 'Cambia una opción para actualizar la vista previa.',
    previewThemeNote:
      'La fuente, el tamaño del texto del chat y el modo de color cambian de forma independiente. La escala afecta a toda la aplicación.',
    previewLayoutNote:
      'El explorador de archivos necesita un proyecto abierto. La transparencia de la ventana depende del sistema operativo.',
    previewChatNote:
      'Solo cambia la presentación. Se conservan el razonamiento, la ejecución de herramientas y las operaciones con archivos.',
    habitsPreview: {
      label: 'Vista previa de inicio y guías',
      resumeTitle: 'Continúa el trabajo anterior',
      freshTitle: 'Empieza con una nueva conversación',
      resumeDescription: 'Aino restaura la última conversación al abrirse.',
      freshDescription: 'Aino abre una conversación vacía.',
      welcome: '¿En qué quieres que trabajemos hoy?',
      tip: 'Consejo: arrastra una pestaña del panel para ver el chat y los archivos en paralelo.',
      tour: 'Recorrido: Barra lateral → Archivos del proyecto → Cuadro de mensaje'
    },
    sample: {
      project: 'Documentación',
      session: 'Mejoras de interfaz',
      user: 'Organiza la documentación del proyecto y enumera los próximos pasos.',
      assistant:
        'La documentación está organizada. Ahora puedes añadir las instrucciones de instalación y unificar el formato de los ejemplos.',
      tool: 'Archivos del proyecto revisados',
      reasoningTitle: 'Razonamiento',
      reasoning: 'Primero reviso el directorio y luego organizo las instrucciones y tareas.',
      composer: 'Describe lo que tienes en mente…',
      detail: 'Organizar directorios e instrucciones',
      time: 'Ahora · En curso',
      files: 'Archivos del proyecto',
      summary: 'Chat',
      diffAdd: '+ Añadir instrucciones de instalación',
      diffRemove: '− Eliminar ejemplos duplicados'
    },
    defaultSuffix: 'Predeterminado',
    tabsLabel: 'Categorías de apariencia'
  }
}
