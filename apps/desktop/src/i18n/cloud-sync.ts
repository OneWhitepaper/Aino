import type { BundledLocale } from './types'
export interface CloudSyncCopy {
  storageFull: string
  attachmentTooLarge: string
  title: string
  synced: string
  syncing: string
  pending: string
  offline: string
  failed: string
  unavailable: string
  retry: string
}
export const cloudSync: Record<BundledLocale, CloudSyncCopy> = {
  en: {
    storageFull: 'Cloud storage is full. Your local history is retained.',
    attachmentTooLarge: 'An attachment exceeds 8 MiB. Your local history is retained.',
    title: 'Cloud history',
    synced: 'History is synchronized',
    syncing: 'Synchronizing history…',
    pending: 'Local changes are waiting to sync',
    offline: 'Offline — local history is available',
    failed: 'Some history could not be synchronized',
    unavailable: 'Cloud history is not available yet',
    retry: 'Retry sync'
  },
  zh: {
    storageFull: '云端存储已满，本地历史记录已保留。',
    attachmentTooLarge: '附件超过 8 MiB，本地历史记录已保留。',
    title: '云端历史',
    synced: '历史记录已同步',
    syncing: '正在同步历史记录…',
    pending: '本地更改等待同步',
    offline: '离线，本地历史记录仍可用',
    failed: '部分历史记录未能同步',
    unavailable: '云端历史暂不可用',
    retry: '重试同步'
  },
  'zh-hant': {
    storageFull: '雲端儲存空間已滿，本機歷史記錄已保留。',
    attachmentTooLarge: '附件超過 8 MiB，本機歷史記錄已保留。',
    title: '雲端歷史',
    synced: '歷史記錄已同步',
    syncing: '正在同步歷史記錄…',
    pending: '本機變更等待同步',
    offline: '離線，本機歷史記錄仍可用',
    failed: '部分歷史記錄無法同步',
    unavailable: '雲端歷史暫不可用',
    retry: '重試同步'
  },
  ja: {
    storageFull: 'クラウド容量が不足しています。ローカル履歴は保持されています。',
    attachmentTooLarge: '8 MiB を超える添付があります。ローカル履歴は保持されています。',
    title: 'クラウド履歴',
    synced: '履歴は同期済みです',
    syncing: '履歴を同期中…',
    pending: 'ローカルの変更は同期待ちです',
    offline: 'オフライン — ローカル履歴を利用できます',
    failed: '一部の履歴を同期できませんでした',
    unavailable: 'クラウド履歴はまだ利用できません',
    retry: '同期を再試行'
  },
  fr: {
    storageFull: 'Le stockage cloud est plein. Votre historique local est conservé.',
    attachmentTooLarge: 'Une pièce jointe dépasse 8 Mio. Votre historique local est conservé.',
    title: 'Historique cloud',
    synced: 'Historique synchronisé',
    syncing: 'Synchronisation de l’historique…',
    pending: 'Modifications locales en attente',
    offline: 'Hors ligne — historique local disponible',
    failed: 'Une partie de l’historique n’a pas pu être synchronisée',
    unavailable: 'L’historique cloud n’est pas encore disponible',
    retry: 'Réessayer'
  },
  de: {
    storageFull: 'Der Cloud-Speicher ist voll. Ihr lokaler Verlauf bleibt erhalten.',
    attachmentTooLarge: 'Ein Anhang überschreitet 8 MiB. Ihr lokaler Verlauf bleibt erhalten.',
    title: 'Cloud-Verlauf',
    synced: 'Verlauf synchronisiert',
    syncing: 'Verlauf wird synchronisiert…',
    pending: 'Lokale Änderungen warten auf Synchronisierung',
    offline: 'Offline — lokaler Verlauf verfügbar',
    failed: 'Ein Teil des Verlaufs konnte nicht synchronisiert werden',
    unavailable: 'Cloud-Verlauf ist noch nicht verfügbar',
    retry: 'Erneut versuchen'
  },
  es: {
    storageFull: 'El almacenamiento en la nube está lleno. El historial local se conserva.',
    attachmentTooLarge: 'Un archivo adjunto supera 8 MiB. El historial local se conserva.',
    title: 'Historial en la nube',
    synced: 'Historial sincronizado',
    syncing: 'Sincronizando historial…',
    pending: 'Cambios locales pendientes',
    offline: 'Sin conexión — historial local disponible',
    failed: 'Parte del historial no pudo sincronizarse',
    unavailable: 'El historial en la nube aún no está disponible',
    retry: 'Reintentar'
  },
  ru: {
    storageFull: 'Облачное хранилище заполнено. Локальная история сохранена.',
    attachmentTooLarge: 'Вложение превышает 8 МиБ. Локальная история сохранена.',
    title: 'Облачная история',
    synced: 'История синхронизирована',
    syncing: 'Синхронизация истории…',
    pending: 'Локальные изменения ожидают синхронизации',
    offline: 'Нет сети — локальная история доступна',
    failed: 'Часть истории не удалось синхронизировать',
    unavailable: 'Облачная история пока недоступна',
    retry: 'Повторить'
  },
  ar: {
    storageFull: 'التخزين السحابي ممتلئ. تم الاحتفاظ بالسجل المحلي.',
    attachmentTooLarge: 'يتجاوز أحد المرفقات 8 ميبيبايت. تم الاحتفاظ بالسجل المحلي.',
    title: 'السجل السحابي',
    synced: 'تمت مزامنة السجل',
    syncing: 'جارٍ مزامنة السجل…',
    pending: 'تغييرات محلية تنتظر المزامنة',
    offline: 'غير متصل — السجل المحلي متاح',
    failed: 'تعذرت مزامنة بعض السجل',
    unavailable: 'السجل السحابي غير متاح بعد',
    retry: 'إعادة المحاولة'
  }
}
