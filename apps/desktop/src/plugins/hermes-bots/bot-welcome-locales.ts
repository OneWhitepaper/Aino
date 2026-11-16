export type BotWelcomeMessages = {
  heading: string
  description: (name: string) => string
  research: string
  researchPrompt: string
  file: string
  filePrompt: string
  code: string
  codePrompt: string
}

export const BOT_WELCOME_LOCALES: Record<string, BotWelcomeMessages> = {
  en: {
    heading: 'What shall we work on together?',
    description: name => `Leave it with ${name}. Let’s start here.`,
    research: 'Research a topic',
    researchPrompt: 'Please research a topic for me and include your sources.',
    file: 'Analyze a file',
    filePrompt: 'Please analyze the document I will share next.',
    code: 'Review project code',
    codePrompt: 'Please review the current project code. Start with your findings and recommendations.'
  },
  zh: {
    heading: '有什么想一起完成？',
    description: name => `交给 ${name}，我们从这里开始。`,
    research: '研究一个主题',
    researchPrompt: '请帮我研究一个主题，并列出信息来源。',
    file: '分析一份文件',
    filePrompt: '请分析我接下来提供的文档。',
    code: '检查项目代码',
    codePrompt: '请审查当前项目代码，先给出发现与建议。'
  },
  'zh-hant': {
    heading: '有什麼想一起完成？',
    description: name => `交給 ${name}，我們從這裡開始。`,
    research: '研究一個主題',
    researchPrompt: '請幫我研究一個主題，並列出資訊來源。',
    file: '分析一份檔案',
    filePrompt: '請分析我接下來提供的文件。',
    code: '檢查專案程式碼',
    codePrompt: '請審查目前專案程式碼，先提出發現與建議。'
  },
  ja: {
    heading: '一緒に何をしましょうか？',
    description: name => `${name} に任せて、ここから始めましょう。`,
    research: 'テーマを調べる',
    researchPrompt: 'テーマを調査し、情報源を示してください。',
    file: 'ファイルを分析',
    filePrompt: 'これから共有するドキュメントを分析してください。',
    code: 'プロジェクトを確認',
    codePrompt: '現在のプロジェクトコードをレビューし、発見と提案を示してください。'
  },
  fr: {
    heading: 'Que faire ensemble ?',
    description: name => `Confiez-le à ${name}. Commençons ici.`,
    research: 'Étudier un sujet',
    researchPrompt: 'Étudiez un sujet pour moi et indiquez vos sources.',
    file: 'Analyser un fichier',
    filePrompt: 'Analysez le document que je vais partager.',
    code: 'Examiner le projet',
    codePrompt: 'Examinez le code du projet actuel et présentez vos constats et recommandations.'
  },
  de: {
    heading: 'Was wollen wir gemeinsam angehen?',
    description: name => `Überlass es ${name}. Fangen wir hier an.`,
    research: 'Ein Thema recherchieren',
    researchPrompt: 'Recherchiere ein Thema für mich und nenne deine Quellen.',
    file: 'Datei analysieren',
    filePrompt: 'Analysiere das Dokument, das ich als Nächstes teile.',
    code: 'Projektcode prüfen',
    codePrompt: 'Prüfe den aktuellen Projektcode und beginne mit Ergebnissen und Empfehlungen.'
  },
  es: {
    heading: '¿Qué hacemos juntos?',
    description: name => `Déjaselo a ${name}. Empecemos aquí.`,
    research: 'Investigar un tema',
    researchPrompt: 'Investiga un tema para mí e incluye las fuentes.',
    file: 'Analizar un archivo',
    filePrompt: 'Analiza el documento que compartiré a continuación.',
    code: 'Revisar el proyecto',
    codePrompt: 'Revisa el código del proyecto actual y presenta tus hallazgos y recomendaciones.'
  },
  ru: {
    heading: 'Что сделаем вместе?',
    description: name => `Поручите это ${name}. Начнём здесь.`,
    research: 'Исследовать тему',
    researchPrompt: 'Исследуй тему и укажи источники информации.',
    file: 'Разобрать файл',
    filePrompt: 'Проанализируй документ, которым я поделюсь далее.',
    code: 'Проверить код проекта',
    codePrompt: 'Проверь код текущего проекта. Начни с результатов и рекомендаций.'
  },
  ar: {
    heading: 'ما الذي ننجزه معًا؟',
    description: name => `اترك الأمر لـ ${name}. لنبدأ من هنا.`,
    research: 'بحث موضوع',
    researchPrompt: 'ابحث لي في موضوع واذكر مصادر المعلومات.',
    file: 'تحليل ملف',
    filePrompt: 'حلل المستند الذي سأشاركه لاحقًا.',
    code: 'مراجعة شيفرة المشروع',
    codePrompt: 'راجع شيفرة المشروع الحالي وابدأ بالنتائج والتوصيات.'
  }
}
