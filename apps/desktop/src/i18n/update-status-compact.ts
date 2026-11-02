import type { BundledLocale } from './types'

export interface CompactUpdateCopy {
  details: string
  detailsTitle: string
  copyDetails: string
  failed: string
  dependency: string
  unknown: string
  network: string
  progress: string
  current: string
}

const copy: Record<BundledLocale, CompactUpdateCopy> = {
  en: {
    details: 'View details',
    detailsTitle: 'Update check details',
    copyDetails: 'Copy details',
    failed: 'Couldn’t check for updates',
    dependency: 'The update component is missing a local dependency.',
    unknown: 'The update check did not finish.',
    network: 'The update service could not be reached.',
    progress: 'View progress',
    current: 'You’re on the latest version.'
  },
  zh: {
    details: '查看详情',
    detailsTitle: '更新检查详情',
    copyDetails: '复制详情',
    failed: '暂时无法检查更新',
    dependency: '更新组件缺少本地依赖。',
    unknown: '更新检查未完成。',
    network: '暂时无法连接更新服务。',
    progress: '查看进度',
    current: '已是最新版本'
  },
  'zh-hant': {
    details: '查看詳情',
    detailsTitle: '更新檢查詳情',
    copyDetails: '複製詳情',
    failed: '暫時無法檢查更新',
    dependency: '更新元件缺少本機相依套件。',
    unknown: '更新檢查未完成。',
    network: '暫時無法連線至更新服務。',
    progress: '查看進度',
    current: '已是最新版本'
  },
  ja: {
    details: '詳細を表示',
    detailsTitle: '更新確認の詳細',
    copyDetails: '詳細をコピー',
    failed: '更新を確認できませんでした',
    dependency: '更新コンポーネントに必要なローカル依存関係がありません。',
    unknown: '更新の確認が完了しませんでした。',
    network: '更新サービスに接続できませんでした。',
    progress: '進行状況を表示',
    current: '最新バージョンです'
  },
  ar: {
    details: 'عرض التفاصيل',
    detailsTitle: 'تفاصيل التحقق من التحديث',
    copyDetails: 'نسخ التفاصيل',
    failed: 'تعذّر التحقق من التحديثات',
    dependency: 'يفتقد مكوّن التحديث تبعية محلية.',
    unknown: 'لم يكتمل التحقق من التحديث.',
    network: 'تعذّر الوصول إلى خدمة التحديث.',
    progress: 'عرض التقدم',
    current: 'أنت تستخدم أحدث إصدار.'
  },
  ru: {
    details: 'Подробнее',
    detailsTitle: 'Сведения о проверке обновлений',
    copyDetails: 'Копировать сведения',
    failed: 'Не удалось проверить обновления',
    dependency: 'Компоненту обновления не хватает локальной зависимости.',
    unknown: 'Проверка обновлений не завершена.',
    network: 'Не удалось связаться со службой обновлений.',
    progress: 'Показать ход обновления',
    current: 'Установлена последняя версия.'
  },
  fr: {
    details: 'Voir les détails',
    detailsTitle: 'Détails de la recherche de mise à jour',
    copyDetails: 'Copier les détails',
    failed: 'Impossible de rechercher les mises à jour',
    dependency: 'Une dépendance locale du composant de mise à jour manque.',
    unknown: 'La recherche de mise à jour n’a pas abouti.',
    network: 'Le service de mise à jour est inaccessible.',
    progress: 'Voir la progression',
    current: 'Vous utilisez la dernière version.'
  },
  de: {
    details: 'Details anzeigen',
    detailsTitle: 'Details zur Updateprüfung',
    copyDetails: 'Details kopieren',
    failed: 'Updates konnten nicht geprüft werden',
    dependency: 'Der Updatekomponente fehlt eine lokale Abhängigkeit.',
    unknown: 'Die Updateprüfung wurde nicht abgeschlossen.',
    network: 'Der Updatedienst ist nicht erreichbar.',
    progress: 'Fortschritt anzeigen',
    current: 'Die neueste Version ist installiert.'
  },
  es: {
    details: 'Ver detalles',
    detailsTitle: 'Detalles de la comprobación de actualizaciones',
    copyDetails: 'Copiar detalles',
    failed: 'No se pudieron buscar actualizaciones',
    dependency: 'Falta una dependencia local del componente de actualización.',
    unknown: 'La comprobación de actualizaciones no terminó.',
    network: 'No se pudo conectar con el servicio de actualización.',
    progress: 'Ver progreso',
    current: 'Tienes la última versión.'
  }
}

export function compactUpdateCopy(locale: string): CompactUpdateCopy {
  return Object.hasOwn(copy, locale) ? copy[locale as BundledLocale] : copy.en
}
