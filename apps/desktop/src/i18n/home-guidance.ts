import type { BundledLocale } from './types'

export interface HomeGuidanceCopy {
  hints: { referenceFiles: string; commandsAndSkills: string; newLine: string }
  footnote: string
}

export const homeGuidance: Record<BundledLocale, HomeGuidanceCopy> = {
  en: {
    hints: { referenceFiles: 'Reference files', commandsAndSkills: 'Commands & skills', newLine: 'New line' },
    footnote: 'Aino uses tools to follow your instructions. Important operations may require confirmation.'
  },
  zh: {
    hints: { referenceFiles: '引用文件', commandsAndSkills: '使用命令与技能', newLine: '换行' },
    footnote: 'Aino 会根据你的指令调用工具，重要操作可能需要确认。'
  },
  'zh-hant': {
    hints: { referenceFiles: '引用檔案', commandsAndSkills: '使用指令與技能', newLine: '換行' },
    footnote: 'Aino 會依照你的指令呼叫工具，重要操作可能需要確認。'
  },
  ja: {
    hints: { referenceFiles: 'ファイルを参照', commandsAndSkills: 'コマンドとスキル', newLine: '改行' },
    footnote: 'Aino は指示に従ってツールを使います。重要な操作には確認が必要な場合があります。'
  },
  ar: {
    hints: { referenceFiles: 'الإشارة إلى الملفات', commandsAndSkills: 'الأوامر والمهارات', newLine: 'سطر جديد' },
    footnote: 'يستخدم Aino الأدوات لتنفيذ تعليماتك. قد تتطلب العمليات المهمة تأكيدًا.'
  },
  ru: {
    hints: { referenceFiles: 'Ссылки на файлы', commandsAndSkills: 'Команды и навыки', newLine: 'Новая строка' },
    footnote:
      'Aino использует инструменты для выполнения ваших указаний. Важные операции могут требовать подтверждения.'
  },
  fr: {
    hints: {
      referenceFiles: 'Référencer des fichiers',
      commandsAndSkills: 'Commandes et skills',
      newLine: 'Nouvelle ligne'
    },
    footnote:
      'Aino utilise des outils pour suivre vos instructions. Les opérations importantes peuvent nécessiter une confirmation.'
  },
  de: {
    hints: { referenceFiles: 'Dateien referenzieren', commandsAndSkills: 'Befehle & Skills', newLine: 'Neue Zeile' },
    footnote:
      'Aino nutzt Werkzeuge, um Ihren Anweisungen zu folgen. Wichtige Vorgänge können eine Bestätigung erfordern.'
  },
  es: {
    hints: { referenceFiles: 'Referenciar archivos', commandsAndSkills: 'Comandos y skills', newLine: 'Nueva línea' },
    footnote:
      'Aino usa herramientas para seguir tus instrucciones. Las operaciones importantes pueden requerir confirmación.'
  }
}
