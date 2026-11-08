import type { BundledLocale } from './types'

interface FailedTurnNoticeCopy {
  unprocessed: string
  partial: string
  automation: string
}

// Only the fixed boundaries authored in agent/turn_failure_copy.py. Unknown
// boundary bodies can contain partial model output or diagnostics and stay intact.
const NOTICE_KEYS: Record<string, keyof FailedTurnNoticeCopy> = {
  'Your request was not processed. Send it again if you still want me to carry it out.': 'unprocessed',
  'This turn did not complete. Some actions may already have run; verify their effects before resending.': 'partial',
  'An automated delivery was interrupted and was not run again. Some actions may already have run; verify their effects.':
    'automation'
}

const COPY: Record<BundledLocale, FailedTurnNoticeCopy> = {
  en: {
    unprocessed: 'Your request was not processed. Send it again if you still want me to carry it out.',
    partial: 'This turn did not complete. Some actions may already have run; verify their effects before resending.',
    automation:
      'An automated delivery was interrupted and was not run again. Some actions may already have run; verify their effects.'
  },
  zh: {
    unprocessed: '本次请求未得到处理。如仍需执行，请重新发送。',
    partial: '本回合未完成。部分操作可能已经执行，请先核实结果，再决定是否重新发送。',
    automation: '一次自动投递已中断，未再次执行。部分操作可能已经执行，请先核实其结果。'
  },
  'zh-hant': {
    unprocessed: '本次請求未獲得處理。如仍需執行，請重新傳送。',
    partial: '本回合未完成。部分操作可能已經執行，請先核實結果，再決定是否重新傳送。',
    automation: '一次自動投遞已中斷，未再次執行。部分操作可能已經執行，請先核實其結果。'
  },
  ja: {
    unprocessed: 'このリクエストは処理されませんでした。実行が必要な場合は、もう一度送信してください。',
    partial:
      'このターンは完了しませんでした。一部の操作はすでに実行された可能性があります。再送信の前に結果を確認してください。',
    automation:
      '自動配信が中断され、再実行されませんでした。一部の操作はすでに実行された可能性があります。結果を確認してください。'
  },
  ar: {
    unprocessed: 'لم تتم معالجة طلبك. أرسله مرة أخرى إذا كنت لا تزال تريد تنفيذه.',
    partial: 'لم تكتمل هذه الجولة. قد تكون بعض الإجراءات قد نُفذت بالفعل؛ تحقّق من نتائجها قبل إعادة الإرسال.',
    automation: 'انقطعت عملية تسليم آلية ولم تُنفذ مرة أخرى. قد تكون بعض الإجراءات قد نُفذت بالفعل؛ تحقّق من نتائجها.'
  },
  ru: {
    unprocessed: 'Ваш запрос не был обработан. Отправьте его ещё раз, если его всё ещё нужно выполнить.',
    partial:
      'Этот ход не завершён. Некоторые действия могли быть выполнены; проверьте их результаты перед повторной отправкой.',
    automation:
      'Автоматическая доставка была прервана и не запускалась повторно. Некоторые действия могли быть выполнены; проверьте их результаты.'
  },
  fr: {
    unprocessed: 'Votre demande n’a pas été traitée. Renvoyez-la si vous souhaitez toujours qu’elle soit exécutée.',
    partial:
      'Ce tour n’a pas abouti. Certaines actions ont peut-être déjà été exécutées ; vérifiez leurs effets avant de renvoyer la demande.',
    automation:
      'Une livraison automatique a été interrompue et n’a pas été relancée. Certaines actions ont peut-être déjà été exécutées ; vérifiez leurs effets.'
  },
  de: {
    unprocessed: 'Deine Anfrage wurde nicht verarbeitet. Sende sie erneut, wenn sie weiterhin ausgeführt werden soll.',
    partial:
      'Dieser Durchlauf wurde nicht abgeschlossen. Einige Aktionen wurden möglicherweise bereits ausgeführt. Prüfe ihre Auswirkungen vor dem erneuten Senden.',
    automation:
      'Eine automatische Zustellung wurde unterbrochen und nicht erneut ausgeführt. Einige Aktionen wurden möglicherweise bereits ausgeführt. Prüfe ihre Auswirkungen.'
  },
  es: {
    unprocessed: 'Tu solicitud no se procesó. Vuelve a enviarla si todavía quieres que se lleve a cabo.',
    partial:
      'Este turno no se completó. Es posible que algunas acciones ya se hayan ejecutado; verifica sus efectos antes de reenviar la solicitud.',
    automation:
      'Se interrumpió una entrega automática y no se volvió a ejecutar. Es posible que algunas acciones ya se hayan ejecutado; verifica sus efectos.'
  }
}

/** Called only for a typed failed-turn system row, never for ordinary model text. */
export function localizedFailedTurnNotice(locale: string, text: string, ownedBoundary: boolean): string {
  const source = text.trim()

  if (!ownedBoundary || !Object.hasOwn(NOTICE_KEYS, source)) {
    return text
  }

  return (COPY[locale as BundledLocale] ?? COPY.en)[NOTICE_KEYS[source]]
}
