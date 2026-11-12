import type { BundledLocale } from './types'

interface DeviceAuthorizationCopy {
  current: string
  inUse: string
  active: string
  otherActive: string
  history: (count: number) => string
  details: string
  unnamed: string
  development: string
  production: string
  browser: string
  permanent: string
  legacy: string
  version: string
}

const copy: Record<BundledLocale, DeviceAuthorizationCopy> = {
  en: {
    current: 'This device',
    inUse: 'In use',
    active: 'Active devices',
    otherActive: 'Other active devices',
    history: count => `Authorization history (${count})`,
    details: 'Details',
    unnamed: 'Unnamed device',
    development: 'development',
    production: 'release',
    browser: 'web',
    permanent: 'Device authorization',
    legacy: 'Legacy authorization',
    version: 'Version'
  },
  zh: {
    current: '此设备',
    inUse: '正在使用',
    active: '有效设备',
    otherActive: '其他有效设备',
    history: count => `历史授权（${count}）`,
    details: '详情',
    unnamed: '未命名设备',
    development: '开发版',
    production: '正式版',
    browser: '网页版',
    permanent: '设备授权',
    legacy: '旧版授权',
    version: '版本'
  },
  'zh-hant': {
    current: '此裝置',
    inUse: '正在使用',
    active: '有效裝置',
    otherActive: '其他有效裝置',
    history: count => `歷史授權（${count}）`,
    details: '詳細資料',
    unnamed: '未命名裝置',
    development: '開發版',
    production: '正式版',
    browser: '網頁版',
    permanent: '裝置授權',
    legacy: '舊版授權',
    version: '版本'
  },
  ja: {
    current: 'このデバイス',
    inUse: '使用中',
    active: '有効なデバイス',
    otherActive: 'その他の有効なデバイス',
    history: count => `認証履歴（${count}）`,
    details: '詳細',
    unnamed: '名前のないデバイス',
    development: '開発版',
    production: '正式版',
    browser: 'ウェブ版',
    permanent: 'デバイス認証',
    legacy: '旧形式の認証',
    version: 'バージョン'
  },
  fr: {
    current: 'Cet appareil',
    inUse: 'En cours d’utilisation',
    active: 'Appareils actifs',
    otherActive: 'Autres appareils actifs',
    history: count => `Historique des autorisations (${count})`,
    details: 'Détails',
    unnamed: 'Appareil sans nom',
    development: 'développement',
    production: 'stable',
    browser: 'web',
    permanent: 'Autorisation d’appareil',
    legacy: 'Ancienne autorisation',
    version: 'Version'
  },
  de: {
    current: 'Dieses Gerät',
    inUse: 'In Verwendung',
    active: 'Aktive Geräte',
    otherActive: 'Weitere aktive Geräte',
    history: count => `Autorisierungsverlauf (${count})`,
    details: 'Details',
    unnamed: 'Unbenanntes Gerät',
    development: 'Entwicklung',
    production: 'stabil',
    browser: 'Web',
    permanent: 'Geräteautorisierung',
    legacy: 'Ältere Autorisierung',
    version: 'Version'
  },
  es: {
    current: 'Este dispositivo',
    inUse: 'En uso',
    active: 'Dispositivos activos',
    otherActive: 'Otros dispositivos activos',
    history: count => `Historial de autorizaciones (${count})`,
    details: 'Detalles',
    unnamed: 'Dispositivo sin nombre',
    development: 'desarrollo',
    production: 'estable',
    browser: 'web',
    permanent: 'Autorización del dispositivo',
    legacy: 'Autorización anterior',
    version: 'Versión'
  },
  ru: {
    current: 'Это устройство',
    inUse: 'Используется',
    active: 'Активные устройства',
    otherActive: 'Другие активные устройства',
    history: count => `История авторизаций (${count})`,
    details: 'Подробнее',
    unnamed: 'Устройство без имени',
    development: 'для разработки',
    production: 'стабильная',
    browser: 'веб',
    permanent: 'Авторизация устройства',
    legacy: 'Старая авторизация',
    version: 'Версия'
  },
  ar: {
    current: 'هذا الجهاز',
    inUse: 'قيد الاستخدام',
    active: 'الأجهزة النشطة',
    otherActive: 'الأجهزة النشطة الأخرى',
    history: count => `سجل التفويضات (${count})`,
    details: 'التفاصيل',
    unnamed: 'جهاز بلا اسم',
    development: 'التطوير',
    production: 'المستقرة',
    browser: 'الويب',
    permanent: 'تفويض الجهاز',
    legacy: 'تفويض قديم',
    version: 'الإصدار'
  }
}

export function deviceAuthorizationCopy(locale: string): DeviceAuthorizationCopy {
  return copy[locale as BundledLocale] ?? copy.en
}
