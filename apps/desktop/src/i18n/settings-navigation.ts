import type { BundledLocale } from './types'

export interface SettingsNavigationCopy {
  groups: Record<'personal' | 'conversation' | 'connections' | 'system', string>
  search: string
  clearSearch: string
  noResults: string
  searchAll: string
  searchHint: string
}

const navigationCopy: Record<BundledLocale, SettingsNavigationCopy> = {
  en: {
    groups: {
      personal: 'Personal & appearance',
      conversation: 'Conversation & intelligence',
      connections: 'Work & connections',
      system: 'Security & system'
    },
    search: 'Search settings',
    clearSearch: 'Clear search',
    noResults: 'No matching settings',
    searchAll: 'Search all settings',
    searchHint: 'Search a setting, API key or plugin'
  },
  zh: {
    groups: {
      personal: '个人与界面',
      conversation: '对话与智能',
      connections: '工作与连接',
      system: '安全与系统'
    },
    search: '搜索设置',
    clearSearch: '清空搜索',
    noResults: '没有匹配的设置',
    searchAll: '搜索全部设置',
    searchHint: '搜索具体设置、密钥或插件'
  },
  'zh-hant': {
    groups: {
      personal: '個人與介面',
      conversation: '對話與智慧',
      connections: '工作與連線',
      system: '安全與系統'
    },
    search: '搜尋設定',
    clearSearch: '清除搜尋',
    noResults: '沒有符合的設定',
    searchAll: '搜尋全部設定',
    searchHint: '搜尋具體設定、金鑰或外掛程式'
  },
  ja: {
    groups: {
      personal: '個人設定と外観',
      conversation: '会話と AI',
      connections: '作業と接続',
      system: 'セキュリティとシステム'
    },
    search: '設定を検索',
    clearSearch: '検索をクリア',
    noResults: '一致する設定がありません',
    searchAll: 'すべての設定を検索',
    searchHint: '設定、API キー、プラグインを検索'
  },
  ar: {
    groups: {
      personal: 'الإعدادات الشخصية والمظهر',
      conversation: 'المحادثة والذكاء',
      connections: 'العمل والاتصالات',
      system: 'الأمان والنظام'
    },
    search: 'البحث في الإعدادات',
    clearSearch: 'مسح البحث',
    noResults: 'لا توجد إعدادات مطابقة',
    searchAll: 'البحث في جميع الإعدادات',
    searchHint: 'ابحث عن إعداد أو مفتاح API أو إضافة'
  },
  ru: {
    groups: {
      personal: 'Личные настройки и оформление',
      conversation: 'Общение и интеллект',
      connections: 'Работа и подключения',
      system: 'Безопасность и система'
    },
    search: 'Поиск настроек',
    clearSearch: 'Очистить поиск',
    noResults: 'Подходящие настройки не найдены',
    searchAll: 'Искать во всех настройках',
    searchHint: 'Найдите настройку, ключ API или плагин'
  },
  fr: {
    groups: {
      personal: 'Personnel et apparence',
      conversation: 'Conversation et intelligence',
      connections: 'Travail et connexions',
      system: 'Sécurité et système'
    },
    search: 'Rechercher un paramètre',
    clearSearch: 'Effacer la recherche',
    noResults: 'Aucun paramètre correspondant',
    searchAll: 'Rechercher dans tous les paramètres',
    searchHint: 'Rechercher un paramètre, une clé API ou un plugin'
  },
  de: {
    groups: {
      personal: 'Persönliches und Darstellung',
      conversation: 'Unterhaltung und Intelligenz',
      connections: 'Arbeit und Verbindungen',
      system: 'Sicherheit und System'
    },
    search: 'Einstellungen suchen',
    clearSearch: 'Suche löschen',
    noResults: 'Keine passenden Einstellungen',
    searchAll: 'Alle Einstellungen durchsuchen',
    searchHint: 'Einstellung, API-Schlüssel oder Plugin suchen'
  },
  es: {
    groups: {
      personal: 'Personal y apariencia',
      conversation: 'Conversación e inteligencia',
      connections: 'Trabajo y conexiones',
      system: 'Seguridad y sistema'
    },
    search: 'Buscar ajustes',
    clearSearch: 'Borrar búsqueda',
    noResults: 'No hay ajustes coincidentes',
    searchAll: 'Buscar en todos los ajustes',
    searchHint: 'Buscar un ajuste, una clave API o un plugin'
  }
}

export function settingsNavigationCopy(locale: string): SettingsNavigationCopy {
  return Object.hasOwn(navigationCopy, locale) ? navigationCopy[locale as BundledLocale] : navigationCopy.en
}
