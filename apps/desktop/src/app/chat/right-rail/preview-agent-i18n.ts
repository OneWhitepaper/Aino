import type { BundledLocale } from '@/i18n'

const actionNames: Record<BundledLocale, readonly string[]> = {
  en: ['Click', 'Enter text', 'Press key', 'Drag', 'Double-click'],
  zh: ['点击', '输入文本', '按键', '拖拽', '双击'],
  'zh-hant': ['點擊', '輸入文字', '按鍵', '拖曳', '雙擊'],
  ja: ['クリック', 'テキスト入力', 'キー入力', 'ドラッグ', 'ダブルクリック'],
  ar: ['نقر', 'إدخال نص', 'ضغط مفتاح', 'سحب', 'نقر مزدوج'],
  de: ['Klicken', 'Text eingeben', 'Taste drücken', 'Ziehen', 'Doppelklicken'],
  es: ['Hacer clic', 'Introducir texto', 'Pulsar tecla', 'Arrastrar', 'Hacer doble clic'],
  fr: ['Cliquer', 'Saisir du texte', 'Appuyer sur une touche', 'Faire glisser', 'Double-cliquer'],
  ru: ['Нажать', 'Ввести текст', 'Нажать клавишу', 'Перетащить', 'Дважды нажать']
}

export function previewAgentActionLabel(locale: string, kind: string): string {
  const index = ['click', 'type', 'press', 'drag', 'double_click'].indexOf(kind)
  const labels = actionNames[locale as BundledLocale] ?? actionNames.en

  return labels[index] ?? kind
}

interface PreviewAgentCopy {
  ready: string
  observing: string
  acting: string
  confirmation: string
  human: string
  takeOver: string
  resume: string
  confirmTitle: string
  confirmDescription: string
  siteLabel: string
  actionLabel: string
  targetLabel: string
  allowLabel: string
  deniedText: string
  humanText: string
  changedText: string
}

const copy: Record<BundledLocale, PreviewAgentCopy> = {
  en: {
    ready: 'AI ready',
    observing: 'AI observing',
    acting: 'AI operating',
    confirmation: 'Awaiting approval',
    human: 'You are in control',
    takeOver: 'Take over',
    resume: 'Return to AI',
    confirmTitle: 'Allow this browser action?',
    confirmDescription: 'Review the website and target before continuing. Permission applies to this action only.',
    siteLabel: 'Website',
    actionLabel: 'Action',
    targetLabel: 'Target',
    allowLabel: 'Allow once',
    deniedText: 'The browser action was not approved.',
    humanText: 'You are in control of this tab. Return control to AI to continue.',
    changedText: 'The browser target changed. Observe the page again before continuing.'
  },
  zh: {
    ready: 'AI 已就绪',
    observing: 'AI 正在观察',
    acting: 'AI 正在操作',
    confirmation: '等待确认',
    human: '你正在操作',
    takeOver: '接管',
    resume: '交回 AI',
    confirmTitle: '允许执行此网页操作？',
    confirmDescription: '请核对网站和操作目标。此次授权仅对当前操作生效。',
    siteLabel: '网站',
    actionLabel: '操作',
    targetLabel: '目标',
    allowLabel: '允许本次',
    deniedText: '此次网页操作未获批准。',
    humanText: '此标签页由你接管，请交回 AI 后继续。',
    changedText: '浏览器操作目标已变化，请重新观察页面后继续。'
  },
  'zh-hant': {
    ready: 'AI 已就緒',
    observing: 'AI 正在觀察',
    acting: 'AI 正在操作',
    confirmation: '等待確認',
    human: '你正在操作',
    takeOver: '接管',
    resume: '交回 AI',
    confirmTitle: '允許執行此網頁操作？',
    confirmDescription: '請核對網站和操作目標。此次授權僅對目前操作生效。',
    siteLabel: '網站',
    actionLabel: '操作',
    targetLabel: '目標',
    allowLabel: '允許本次',
    deniedText: '此次網頁操作未獲批准。',
    humanText: '此分頁由你接管，請交回 AI 後繼續。',
    changedText: '瀏覽器操作目標已變更，請重新觀察頁面後繼續。'
  },
  ja: {
    ready: 'AI 準備完了',
    observing: 'AI が確認中',
    acting: 'AI が操作中',
    confirmation: '承認待ち',
    human: '手動操作中',
    takeOver: '引き継ぐ',
    resume: 'AI に戻す',
    confirmTitle: 'このブラウザー操作を許可しますか？',
    confirmDescription: '続行する前にサイトと対象を確認してください。許可は今回の操作にのみ適用されます。',
    siteLabel: 'サイト',
    actionLabel: '操作',
    targetLabel: '対象',
    allowLabel: '今回のみ許可',
    deniedText: 'ブラウザー操作は承認されませんでした。',
    humanText: 'このタブは手動操作中です。続行するには AI に操作を戻してください。',
    changedText: 'ブラウザーの対象が変わりました。続行する前にページを再確認してください。'
  },
  ar: {
    ready: 'الذكاء الاصطناعي جاهز',
    observing: 'يفحص الصفحة',
    acting: 'ينفذ الإجراء',
    confirmation: 'بانتظار الموافقة',
    human: 'أنت تتحكم',
    takeOver: 'تولّي التحكم',
    resume: 'إعادة التحكم',
    confirmTitle: 'السماح بهذا الإجراء في المتصفح؟',
    confirmDescription: 'راجع الموقع والهدف قبل المتابعة. ينطبق الإذن على هذا الإجراء فقط.',
    siteLabel: 'الموقع',
    actionLabel: 'الإجراء',
    targetLabel: 'الهدف',
    allowLabel: 'السماح مرة واحدة',
    deniedText: 'لم تتم الموافقة على إجراء المتصفح.',
    humanText: 'أنت تتحكم في علامة التبويب. أعد التحكم إلى الذكاء الاصطناعي للمتابعة.',
    changedText: 'تغير هدف المتصفح. افحص الصفحة مجددًا قبل المتابعة.'
  },
  ru: {
    ready: 'ИИ готов',
    observing: 'ИИ изучает страницу',
    acting: 'ИИ выполняет действие',
    confirmation: 'Ожидает подтверждения',
    human: 'Вы управляете',
    takeOver: 'Перехватить',
    resume: 'Вернуть ИИ',
    confirmTitle: 'Разрешить это действие в браузере?',
    confirmDescription: 'Проверьте сайт и цель перед продолжением. Разрешение действует только для этого действия.',
    siteLabel: 'Сайт',
    actionLabel: 'Действие',
    targetLabel: 'Цель',
    allowLabel: 'Разрешить один раз',
    deniedText: 'Действие в браузере не одобрено.',
    humanText: 'Вы управляете этой вкладкой. Верните управление ИИ, чтобы продолжить.',
    changedText: 'Цель в браузере изменилась. Проверьте страницу ещё раз перед продолжением.'
  },
  fr: {
    ready: 'IA prête',
    observing: 'L’IA observe',
    acting: 'L’IA agit',
    confirmation: 'En attente d’accord',
    human: 'Vous contrôlez',
    takeOver: 'Reprendre',
    resume: 'Rendre à l’IA',
    confirmTitle: 'Autoriser cette action dans le navigateur ?',
    confirmDescription:
      'Vérifiez le site et la cible avant de continuer. L’autorisation ne vaut que pour cette action.',
    siteLabel: 'Site',
    actionLabel: 'Action',
    targetLabel: 'Cible',
    allowLabel: 'Autoriser une fois',
    deniedText: 'L’action dans le navigateur n’a pas été approuvée.',
    humanText: 'Vous contrôlez cet onglet. Rendez le contrôle à l’IA pour continuer.',
    changedText: 'La cible du navigateur a changé. Observez à nouveau la page avant de continuer.'
  },
  de: {
    ready: 'KI bereit',
    observing: 'KI beobachtet',
    acting: 'KI führt aus',
    confirmation: 'Freigabe ausstehend',
    human: 'Sie steuern',
    takeOver: 'Übernehmen',
    resume: 'An KI abgeben',
    confirmTitle: 'Diese Browseraktion erlauben?',
    confirmDescription: 'Prüfen Sie Website und Ziel vor dem Fortfahren. Die Erlaubnis gilt nur für diese Aktion.',
    siteLabel: 'Website',
    actionLabel: 'Aktion',
    targetLabel: 'Ziel',
    allowLabel: 'Einmal erlauben',
    deniedText: 'Die Browseraktion wurde nicht genehmigt.',
    humanText: 'Sie steuern diesen Tab. Geben Sie die Steuerung an die KI zurück, um fortzufahren.',
    changedText: 'Das Browserziel hat sich geändert. Prüfen Sie die Seite erneut, bevor Sie fortfahren.'
  },
  es: {
    ready: 'IA lista',
    observing: 'La IA observa',
    acting: 'La IA está actuando',
    confirmation: 'Esperando permiso',
    human: 'Tienes el control',
    takeOver: 'Tomar control',
    resume: 'Devolver a IA',
    confirmTitle: '¿Permitir esta acción en el navegador?',
    confirmDescription: 'Revisa el sitio y el destino antes de continuar. El permiso solo se aplica a esta acción.',
    siteLabel: 'Sitio web',
    actionLabel: 'Acción',
    targetLabel: 'Destino',
    allowLabel: 'Permitir una vez',
    deniedText: 'La acción en el navegador no se ha aprobado.',
    humanText: 'Tienes el control de esta pestaña. Devuélvelo a la IA para continuar.',
    changedText: 'El destino del navegador ha cambiado. Vuelve a observar la página antes de continuar.'
  }
}

export function previewAgentCopy(locale: string): PreviewAgentCopy {
  return Object.hasOwn(copy, locale) ? copy[locale as BundledLocale] : copy.en
}
