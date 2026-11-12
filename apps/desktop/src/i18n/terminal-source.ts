import type { BundledLocale, Locale } from './types'

interface TerminalSourceCopy {
  title: string
  sourceUnavailable: string
  sourceChanged: string
  noShell: string
}

const translations: Record<BundledLocale, TerminalSourceCopy> = {
  en: {
    title: 'Could not open terminal',
    sourceUnavailable: 'Reopen this chat on its original connection, then try again.',
    sourceChanged:
      'This terminal’s connection changed. Return to its original connection and press Enter, or open a new terminal.',
    noShell: 'This connection does not provide a terminal. Use this device or an SSH connection.'
  },
  zh: {
    title: '无法打开终端',
    sourceUnavailable: '请切回此会话所属的连接，重新打开会话后重试。',
    sourceChanged: '此终端的连接已变化。请切回原连接后按 Enter 重试，或新建终端。',
    noShell: '当前连接不提供终端，请使用本机或 SSH 连接。'
  },
  'zh-hant': {
    title: '無法開啟終端機',
    sourceUnavailable: '請切回此對話所屬的連線，重新開啟對話後重試。',
    sourceChanged: '此終端機的連線已變更。請切回原連線後按 Enter 重試，或新增終端機。',
    noShell: '目前連線不提供終端機，請使用本機或 SSH 連線。'
  },
  ja: {
    title: 'ターミナルを開けません',
    sourceUnavailable: '元の接続でこのチャットを開き直して、再試行してください。',
    sourceChanged: '接続が変わりました。元の接続に戻って Enter を押すか、新しいターミナルを開いてください。',
    noShell: 'この接続ではターミナルを利用できません。このデバイスまたは SSH 接続を使用してください。'
  },
  ar: {
    title: 'تعذّر فتح الطرفية',
    sourceUnavailable: 'أعد فتح هذه المحادثة عبر اتصالها الأصلي، ثم حاول مجددًا.',
    sourceChanged: 'تغيّر اتصال هذه الطرفية. ارجع إلى الاتصال الأصلي واضغط Enter، أو افتح طرفية جديدة.',
    noShell: 'هذا الاتصال لا يوفّر طرفية. استخدم هذا الجهاز أو اتصال SSH.'
  },
  ru: {
    title: 'Не удалось открыть терминал',
    sourceUnavailable: 'Снова откройте этот чат через исходное подключение и повторите попытку.',
    sourceChanged:
      'Подключение терминала изменилось. Вернитесь к исходному подключению и нажмите Enter или откройте новый терминал.',
    noShell: 'Это подключение не предоставляет терминал. Используйте это устройство или SSH.'
  },
  fr: {
    title: 'Impossible d’ouvrir le terminal',
    sourceUnavailable: 'Rouvrez cette conversation sur sa connexion d’origine, puis réessayez.',
    sourceChanged:
      'La connexion du terminal a changé. Revenez à sa connexion d’origine et appuyez sur Entrée, ou ouvrez un nouveau terminal.',
    noShell: 'Cette connexion ne propose pas de terminal. Utilisez cet appareil ou une connexion SSH.'
  },
  de: {
    title: 'Terminal konnte nicht geöffnet werden',
    sourceUnavailable: 'Öffne diesen Chat über seine ursprüngliche Verbindung erneut und versuche es noch einmal.',
    sourceChanged:
      'Die Terminalverbindung wurde geändert. Kehre zur ursprünglichen Verbindung zurück und drücke Enter, oder öffne ein neues Terminal.',
    noShell: 'Diese Verbindung bietet kein Terminal. Verwende dieses Gerät oder eine SSH-Verbindung.'
  },
  es: {
    title: 'No se pudo abrir el terminal',
    sourceUnavailable: 'Vuelve a abrir este chat en su conexión original e inténtalo de nuevo.',
    sourceChanged:
      'La conexión del terminal cambió. Vuelve a la conexión original y pulsa Intro, o abre un terminal nuevo.',
    noShell: 'Esta conexión no ofrece terminal. Usa este dispositivo o una conexión SSH.'
  }
}

export function terminalSourceCopy(locale: Locale): TerminalSourceCopy {
  return translations[locale as BundledLocale] ?? translations.en
}
