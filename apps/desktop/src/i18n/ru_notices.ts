import type { TranslationOverrides } from './define-locale'
import { ruDesktopCommands } from './ru_desktop_commands'
import { ruSessionCommands } from './ru_session_commands'

// Shell notices (remote-display toast, butterbar, keep-awake offer), spread into ru.ts.
export const ruNotices = {
  sendDiagnostics: {
    title: 'Отправить диагностику в Aino',
    privacyNotice:
      'Закрытый пакет отправляется в сервис вашей учётной записи Aino. Он содержит сведения о системе, состояние настроек (без самих ключей) и журналы агента, шлюза и приложения (до 512 КБ каждый). Журналы могут содержать переписку, вывод инструментов и пути к файлам. Ключи скрываются, но другие конфиденциальные данные могут остаться. Доступ есть только у уполномоченных администраторов Aino. Через 14 дней доступ прекращается, в течение следующего часа данные удаляются из рабочей базы. Существующие резервные копии подчиняются политике хранения развёртывания.',
    upload: 'Отправить',
    uploading: 'Отправка…',
    cancel: 'Отмена',
    close: 'Закрыть',
    copyLink: 'Копировать ID диагностики',
    uploadIdFallback: id => `ID диагностики: ${id}`,
    doneTitle: 'Диагностика отправлена',
    doneDescription: 'Пакет отправлен в Aino в закрытом режиме. Укажите этот ID в обращении; не публикуйте журналы.',
    failedTitle: 'Ошибка отправки',
    failedHint:
      'Войдите в Aino и повторите попытку. Сначала обновите устаревшую среду выполнения. Для локального отчёта без отправки: `hermes debug share --local`.',
    handoffLead: 'Связаться с Aino:',
    links: { github: 'GitHub Issues' },
    gatewayUnavailable: 'Шлюз Aino недоступен',
    uploadFailed: 'Не удалось отправить диагностику'
  },
  remoteDisplayBanner: {
    message: reason =>
      `Включён программный рендеринг — обнаружен удалённый дисплей (${reason}). GPU-ускорение отключено, чтобы избежать мерцания.`
  },
  butterbar: {
    goTo: (index, total) => `Показать уведомление ${index} из ${total}`,
    legal: {
      before: 'Использование Hermes Agent регулируется нашими ',
      terms: 'Условиями обслуживания',
      between: ' и ',
      privacy: 'Политикой конфиденциальности',
      after: '.'
    }
  },
  promptNotices: {
    legacySendUnconfirmed:
      'Этот сервер не смог подтвердить предыдущую отправку этого сообщения, поэтому оно, возможно, уже выполнено. Проверьте беседу, прежде чем отправлять его снова.',
    mcpReloadDeferred:
      'Чат занят: изменение MCP применится, когда завершится текущий ход и MCP будет перезагружен снова, или при повторном открытии чата',
    mcpReloadUnavailable: servers => `Не удалось подключиться: ${servers}`,
    compactedTurnUnavailable:
      'Это сообщение было сжато в краткое изложение при сжатии чата, поэтому его больше нельзя восстановить или изменить.',
    staleTurnUnavailable: 'Этого сообщения больше нет в истории этого чата.',
    sessionCommands: ruSessionCommands,
    desktopCommands: ruDesktopCommands
  },
  keepAwakeOffer: {
    title: 'Компьютер ушёл в сон, пока Hermes работал',
    message:
      'Hermes может не давать компьютеру засыпать, пока выполняется задача. Экран по-прежнему выключается, а от батареи компьютер всё равно может уснуть.',
    action: 'Не засыпать во время работы'
  },
  billingBlock: {
    titleNous: 'Кредиты Nous закончились',
    titleProvider: provider => `Кредиты закончились — ${provider}`,
    fallbackMessage: 'В вашем аккаунте закончились кредиты. Пополните баланс, чтобы продолжить.',
    openBilling: 'Открыть биллинг',
    addCredits: 'Пополнить кредиты',
    dismiss: 'Скрыть'
  }
} satisfies Pick<
  TranslationOverrides,
  'sendDiagnostics' | 'remoteDisplayBanner' | 'butterbar' | 'promptNotices' | 'keepAwakeOffer' | 'billingBlock'
>
