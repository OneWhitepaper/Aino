import type { BundledLocale } from './types'

export interface SessionRemovalCopy {
  object: string
  workspace: string
  defaultWorkspace: string
  unknownWorkspace: string
  scope: string
  impact: string
  archiveHint: string
  remove: string
  removing: string
  removed: string
  kept: (title: string) => string
  undo: string
  unavailable: string
}

const copy: Record<BundledLocale, SessionRemovalCopy> = {
  en: {
    object: 'Conversation',
    workspace: 'Workspace',
    defaultWorkspace: 'Default workspace',
    unknownWorkspace: 'Owner not yet resolved',
    scope: 'What will be deleted',
    impact:
      'This conversation, its compressed history and delegated subtask history. Project files and other conversations are kept.',
    archiveHint:
      'To keep the messages, remove the conversation from the sidebar instead. You can restore it from Archived chats.',
    remove: 'Remove from sidebar',
    removing: 'Removing…',
    removed: 'Removed from sidebar',
    kept: title => `“${title}” and its messages are kept in Archived chats.`,
    undo: 'Undo',
    unavailable: 'The account, workspace or connection changed. Reopen this conversation’s menu before continuing.'
  },
  zh: {
    object: '会话',
    workspace: '所属工作区',
    defaultWorkspace: '默认工作区',
    unknownWorkspace: '尚未确认所属工作区',
    scope: '删除范围',
    impact: '此会话及其压缩前的历史、委派子任务历史。保留项目文件和其他会话。',
    archiveHint: '如果只是暂时不想显示，可以从侧边栏移除，保留消息；以后可在“已归档的聊天”中恢复。',
    remove: '从侧边栏移除',
    removing: '正在移除…',
    removed: '已从侧边栏移除',
    kept: title => `“${title}”及其消息已保留在“已归档的聊天”中。`,
    undo: '撤销',
    unavailable: '账号、工作区或连接已切换，请重新打开此会话的菜单再操作。'
  },
  'zh-hant': {
    object: '對話',
    workspace: '所屬工作區',
    defaultWorkspace: '預設工作區',
    unknownWorkspace: '尚未確認所屬工作區',
    scope: '刪除範圍',
    impact: '此對話及其壓縮前的歷史、委派子任務歷史。保留專案檔案和其他對話。',
    archiveHint: '若只是暫時不想顯示，可以從側邊欄移除並保留訊息；之後可在「已封存的對話」中還原。',
    remove: '從側邊欄移除',
    removing: '正在移除…',
    removed: '已從側邊欄移除',
    kept: title => `「${title}」及其訊息已保留在「已封存的對話」中。`,
    undo: '復原',
    unavailable: '帳號、工作區或連線已切換，請重新開啟此對話的選單再操作。'
  },
  ja: {
    object: '会話',
    workspace: 'ワークスペース',
    defaultWorkspace: '既定のワークスペース',
    unknownWorkspace: '所有元は未確認です',
    scope: '削除される内容',
    impact: 'この会話、圧縮前の履歴、委任したサブタスクの履歴。プロジェクトのファイルと他の会話は残ります。',
    archiveHint: 'メッセージを残すにはサイドバーから取り除いてください。「アーカイブ済みの会話」から復元できます。',
    remove: 'サイドバーから取り除く',
    removing: '取り除いています…',
    removed: 'サイドバーから取り除きました',
    kept: title => `「${title}」とメッセージはアーカイブ済みの会話に残っています。`,
    undo: '元に戻す',
    unavailable: 'アカウント、ワークスペース、または接続が変わりました。この会話のメニューを開き直してください。'
  },
  fr: {
    object: 'Conversation',
    workspace: 'Espace de travail',
    defaultWorkspace: 'Espace par défaut',
    unknownWorkspace: 'Propriétaire non résolu',
    scope: 'Contenu supprimé',
    impact:
      'Cette conversation, son historique compressé et celui des sous-tâches déléguées. Les fichiers du projet et les autres conversations sont conservés.',
    archiveHint:
      'Pour conserver les messages, retirez la conversation de la barre latérale. Vous pourrez la restaurer depuis les conversations archivées.',
    remove: 'Retirer de la barre latérale',
    removing: 'Retrait…',
    removed: 'Retirée de la barre latérale',
    kept: title => `« ${title} » et ses messages sont conservés dans les conversations archivées.`,
    undo: 'Annuler',
    unavailable: 'Le compte, l’espace de travail ou la connexion a changé. Rouvrez le menu de cette conversation.'
  },
  de: {
    object: 'Unterhaltung',
    workspace: 'Arbeitsbereich',
    defaultWorkspace: 'Standardarbeitsbereich',
    unknownWorkspace: 'Eigentümer noch nicht ermittelt',
    scope: 'Was gelöscht wird',
    impact:
      'Diese Unterhaltung, ihr komprimierter Verlauf und der Verlauf delegierter Teilaufgaben. Projektdateien und andere Unterhaltungen bleiben erhalten.',
    archiveHint:
      'Entferne die Unterhaltung aus der Seitenleiste, um Nachrichten zu behalten. Du kannst sie aus den archivierten Chats wiederherstellen.',
    remove: 'Aus Seitenleiste entfernen',
    removing: 'Wird entfernt…',
    removed: 'Aus Seitenleiste entfernt',
    kept: title => `„${title}“ und die Nachrichten bleiben in den archivierten Chats erhalten.`,
    undo: 'Rückgängig',
    unavailable: 'Konto, Arbeitsbereich oder Verbindung haben sich geändert. Öffne das Menü dieser Unterhaltung erneut.'
  },
  es: {
    object: 'Conversación',
    workspace: 'Espacio de trabajo',
    defaultWorkspace: 'Espacio predeterminado',
    unknownWorkspace: 'Propietario sin resolver',
    scope: 'Contenido que se eliminará',
    impact:
      'Esta conversación, su historial comprimido y el historial de las subtareas delegadas. Se conservan los archivos del proyecto y las demás conversaciones.',
    archiveHint:
      'Para conservar los mensajes, quita la conversación de la barra lateral. Podrás restaurarla desde las conversaciones archivadas.',
    remove: 'Quitar de la barra lateral',
    removing: 'Quitando…',
    removed: 'Quitada de la barra lateral',
    kept: title => `“${title}” y sus mensajes se conservan en las conversaciones archivadas.`,
    undo: 'Deshacer',
    unavailable: 'La cuenta, el espacio de trabajo o la conexión cambió. Vuelve a abrir el menú de esta conversación.'
  },
  ru: {
    object: 'Беседа',
    workspace: 'Рабочая область',
    defaultWorkspace: 'Рабочая область по умолчанию',
    unknownWorkspace: 'Владелец пока не определён',
    scope: 'Что будет удалено',
    impact:
      'Эта беседа, её история до сжатия и история делегированных подзадач. Файлы проекта и другие беседы сохранятся.',
    archiveHint: 'Чтобы сохранить сообщения, уберите беседу из боковой панели. Её можно восстановить из архива.',
    remove: 'Убрать из боковой панели',
    removing: 'Удаление из панели…',
    removed: 'Убрано из боковой панели',
    kept: title => `«${title}» и сообщения сохранены в архиве бесед.`,
    undo: 'Отменить',
    unavailable: 'Учётная запись, рабочая область или подключение изменились. Заново откройте меню этой беседы.'
  },
  ar: {
    object: 'المحادثة',
    workspace: 'مساحة العمل',
    defaultWorkspace: 'مساحة العمل الافتراضية',
    unknownWorkspace: 'لم يُحدَّد المالك بعد',
    scope: 'ما سيتم حذفه',
    impact: 'هذه المحادثة وسجلها المضغوط وسجل المهام الفرعية المفوضة. تُحفظ ملفات المشروع والمحادثات الأخرى.',
    archiveHint: 'للاحتفاظ بالرسائل، أزل المحادثة من الشريط الجانبي. يمكنك استعادتها من المحادثات المؤرشفة.',
    remove: 'إزالة من الشريط الجانبي',
    removing: 'جارٍ الإزالة…',
    removed: 'تمت الإزالة من الشريط الجانبي',
    kept: title => `تم الاحتفاظ بـ «${title}» ورسائلها في المحادثات المؤرشفة.`,
    undo: 'تراجع',
    unavailable: 'تغير الحساب أو مساحة العمل أو الاتصال. أعد فتح قائمة هذه المحادثة قبل المتابعة.'
  }
}

export function sessionRemovalCopy(locale: string): SessionRemovalCopy {
  return copy[locale as BundledLocale] ?? copy.en
}
