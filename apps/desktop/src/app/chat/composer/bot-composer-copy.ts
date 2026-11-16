import type { BundledLocale } from '@/i18n/types'

interface BotComposerCopy {
  referenceFiles: string
  moreAttachments: string
  skillsTools: string
  openBrowser: string
  filesTerminal: string
  useSkills: string
  modelHint: string
  placeholder: (name: string) => string
}

const COPY: Record<BundledLocale, BotComposerCopy> = {
  en: {
    referenceFiles: 'Reference project files',
    moreAttachments: 'More attachments',
    skillsTools: 'Skills & tools',
    openBrowser: 'Open browser',
    filesTerminal: 'Files & terminal',
    useSkills: 'Use a skill',
    modelHint: 'Model applies to this chat',
    placeholder: name => `Ask ${name}, or give me a task…`
  },
  zh: {
    referenceFiles: '引用项目文件',
    moreAttachments: '更多附件',
    skillsTools: '技能与工具',
    openBrowser: '打开浏览器',
    filesTerminal: '文件与终端',
    useSkills: '使用技能',
    modelHint: '模型仅用于当前聊天',
    placeholder: name => `向 ${name} 提问，或交给我一个任务…`
  },
  'zh-hant': {
    referenceFiles: '引用專案檔案',
    moreAttachments: '更多附件',
    skillsTools: '技能與工具',
    openBrowser: '開啟瀏覽器',
    filesTerminal: '檔案與終端',
    useSkills: '使用技能',
    modelHint: '模型僅用於目前聊天',
    placeholder: name => `向 ${name} 提問，或交給我一個任務…`
  },
  ja: {
    referenceFiles: 'プロジェクトファイルを参照',
    moreAttachments: 'その他の添付',
    skillsTools: 'スキルとツール',
    openBrowser: 'ブラウザーを開く',
    filesTerminal: 'ファイルとターミナル',
    useSkills: 'スキルを使う',
    modelHint: 'モデルはこのチャットに適用',
    placeholder: name => `${name} に質問するか、タスクを任せてください…`
  },
  fr: {
    referenceFiles: 'Référencer des fichiers du projet',
    moreAttachments: 'Autres pièces jointes',
    skillsTools: 'Skills et outils',
    openBrowser: 'Ouvrir le navigateur',
    filesTerminal: 'Fichiers et terminal',
    useSkills: 'Utiliser un skill',
    modelHint: 'Modèle utilisé pour ce chat',
    placeholder: name => `Posez une question à ${name}, ou confiez-moi une tâche…`
  },
  de: {
    referenceFiles: 'Projektdateien referenzieren',
    moreAttachments: 'Weitere Anhänge',
    skillsTools: 'Skills und Werkzeuge',
    openBrowser: 'Browser öffnen',
    filesTerminal: 'Dateien und Terminal',
    useSkills: 'Skill verwenden',
    modelHint: 'Modell gilt für diesen Chat',
    placeholder: name => `Frage ${name} etwas oder gib mir eine Aufgabe…`
  },
  es: {
    referenceFiles: 'Referenciar archivos del proyecto',
    moreAttachments: 'Más adjuntos',
    skillsTools: 'Skills y herramientas',
    openBrowser: 'Abrir navegador',
    filesTerminal: 'Archivos y terminal',
    useSkills: 'Usar un skill',
    modelHint: 'Modelo para este chat',
    placeholder: name => `Pregunta a ${name} o dame una tarea…`
  },
  ru: {
    referenceFiles: 'Сослаться на файлы проекта',
    moreAttachments: 'Другие вложения',
    skillsTools: 'Навыки и инструменты',
    openBrowser: 'Открыть браузер',
    filesTerminal: 'Файлы и терминал',
    useSkills: 'Использовать навык',
    modelHint: 'Модель только для этого чата',
    placeholder: name => `Спросите ${name} или поручите мне задачу…`
  },
  ar: {
    referenceFiles: 'الإشارة إلى ملفات المشروع',
    moreAttachments: 'مرفقات إضافية',
    skillsTools: 'المهارات والأدوات',
    openBrowser: 'فتح المتصفح',
    filesTerminal: 'الملفات والطرفية',
    useSkills: 'استخدام مهارة',
    modelHint: 'النموذج لهذه المحادثة',
    placeholder: name => `اسأل ${name} أو كلفني بمهمة…`
  }
}

export const botComposerCopy = (locale: string): BotComposerCopy => COPY[locale as BundledLocale] ?? COPY.en
