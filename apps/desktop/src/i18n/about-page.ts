import { LEGAL_COPYRIGHT } from '@/lib/brand'

import type { BundledLocale } from './types'

export interface AboutPageCopy {
  website: string
  installationInfo: string
  uninstall: string
  close: string
  copyInfo: string
  technicalDetails: string
  copySuccess: string
  remoteAttention: string
  copyright: string
}

const aboutCopy: Record<BundledLocale, AboutPageCopy> = {
  en: {
    website: 'Official website',
    installationInfo: 'Installation info',
    uninstall: 'Uninstall Aino',
    close: 'Close',
    copyInfo: 'Copy info',
    technicalDetails: 'Technical details',
    copySuccess: 'Installation info copied',
    remoteAttention: 'The remote runtime needs attention',
    copyright: LEGAL_COPYRIGHT
  },
  zh: {
    website: '官方网站',
    installationInfo: '安装信息',
    uninstall: '卸载 Aino',
    close: '关闭',
    copyInfo: '复制信息',
    technicalDetails: '更多技术信息',
    copySuccess: '安装信息已复制',
    remoteAttention: '远程运行服务需要处理',
    copyright: LEGAL_COPYRIGHT
  },
  'zh-hant': {
    website: '官方網站',
    installationInfo: '安裝資訊',
    uninstall: '解除安裝 Aino',
    close: '關閉',
    copyInfo: '複製資訊',
    technicalDetails: '更多技術資訊',
    copySuccess: '已複製安裝資訊',
    remoteAttention: '遠端執行服務需要處理',
    copyright: LEGAL_COPYRIGHT
  },
  ja: {
    website: '公式サイト',
    installationInfo: 'インストール情報',
    uninstall: 'Aino をアンインストール',
    close: '閉じる',
    copyInfo: '情報をコピー',
    technicalDetails: '技術情報の詳細',
    copySuccess: 'インストール情報をコピーしました',
    remoteAttention: 'リモートランタイムの確認が必要です',
    copyright: LEGAL_COPYRIGHT
  },
  ar: {
    website: 'الموقع الرسمي',
    installationInfo: 'معلومات التثبيت',
    uninstall: 'إلغاء تثبيت Aino',
    close: 'إغلاق',
    copyInfo: 'نسخ المعلومات',
    technicalDetails: 'التفاصيل التقنية',
    copySuccess: 'تم نسخ معلومات التثبيت',
    remoteAttention: 'تحتاج بيئة التشغيل البعيدة إلى المراجعة',
    copyright: LEGAL_COPYRIGHT
  },
  ru: {
    website: 'Официальный сайт',
    installationInfo: 'Сведения об установке',
    uninstall: 'Удалить Aino',
    close: 'Закрыть',
    copyInfo: 'Копировать сведения',
    technicalDetails: 'Технические подробности',
    copySuccess: 'Сведения об установке скопированы',
    remoteAttention: 'Удалённая среда выполнения требует внимания',
    copyright: LEGAL_COPYRIGHT
  },
  fr: {
    website: 'Site officiel',
    installationInfo: 'Informations d’installation',
    uninstall: 'Désinstaller Aino',
    close: 'Fermer',
    copyInfo: 'Copier les informations',
    technicalDetails: 'Détails techniques',
    copySuccess: 'Informations d’installation copiées',
    remoteAttention: 'L’environnement distant nécessite votre attention',
    copyright: LEGAL_COPYRIGHT
  },
  de: {
    website: 'Offizielle Website',
    installationInfo: 'Installationsinformationen',
    uninstall: 'Aino deinstallieren',
    close: 'Schließen',
    copyInfo: 'Informationen kopieren',
    technicalDetails: 'Technische Details',
    copySuccess: 'Installationsinformationen kopiert',
    remoteAttention: 'Die Remote-Laufzeit erfordert Aufmerksamkeit',
    copyright: LEGAL_COPYRIGHT
  },
  es: {
    website: 'Sitio web oficial',
    installationInfo: 'Información de instalación',
    uninstall: 'Desinstalar Aino',
    close: 'Cerrar',
    copyInfo: 'Copiar información',
    technicalDetails: 'Detalles técnicos',
    copySuccess: 'Información de instalación copiada',
    remoteAttention: 'El entorno remoto requiere atención',
    copyright: LEGAL_COPYRIGHT
  }
}

export function aboutPageCopy(locale: string): AboutPageCopy {
  return Object.hasOwn(aboutCopy, locale) ? aboutCopy[locale as BundledLocale] : aboutCopy.en
}
