import type { BundledLocale, Locale } from './types'

interface NotificationPresentationCopy {
  source: string
  received: string
  deferred: string
  application: string
  runtime: string
  storage: string
  free: string
  total: string
  history: string
  prunable: string
  estimate: string
  retention: string
  unknown: string
  factsUnavailable: string
}

const copy: Record<BundledLocale, NotificationPresentationCopy> = {
  en: {
    source: 'Source',
    received: 'Received',
    deferred: 'Deferred until',
    application: 'Aino',
    runtime: 'Runtime service',
    storage: 'Storage',
    free: 'Available space',
    total: 'Disk capacity',
    history: 'Conversation history',
    prunable: 'Eligible old conversations',
    estimate: 'Estimated recoverable space',
    retention: 'Retention days',
    unknown: 'Not available',
    factsUnavailable:
      'This service has not supplied storage measurements. Open Technical details for its original report.'
  },
  zh: {
    source: '来源',
    received: '收到时间',
    deferred: '已延后至',
    application: 'Aino',
    runtime: '运行服务',
    storage: '储存空间',
    free: '可用空间',
    total: '磁盘容量',
    history: '会话历史',
    prunable: '可整理的旧会话',
    estimate: '预计可释放空间',
    retention: '保留天数',
    unknown: '暂未提供',
    factsUnavailable: '运行服务暂未提供结构化储存数据，可展开技术详情查看原始报告。'
  },
  'zh-hant': {
    source: '來源',
    received: '收到時間',
    deferred: '已延後至',
    application: 'Aino',
    runtime: '執行服務',
    storage: '儲存空間',
    free: '可用空間',
    total: '磁碟容量',
    history: '對話歷史',
    prunable: '可整理的舊對話',
    estimate: '預計可釋放空間',
    retention: '保留天數',
    unknown: '暫未提供',
    factsUnavailable: '執行服務暫未提供結構化儲存資料，可展開技術詳情查看原始報告。'
  },
  ja: {
    source: '送信元',
    received: '受信日時',
    deferred: '次回通知',
    application: 'Aino',
    runtime: '実行サービス',
    storage: 'ストレージ',
    free: '空き容量',
    total: 'ディスク容量',
    history: '会話履歴',
    prunable: '整理対象の古い会話',
    estimate: '回復容量の見積もり',
    retention: '保存日数',
    unknown: '未提供',
    factsUnavailable: '実行サービスはストレージ測定値を提供していません。技術情報で元の報告を確認できます。'
  },
  fr: {
    source: 'Source',
    received: 'Reçu le',
    deferred: 'Reporté au',
    application: 'Aino',
    runtime: 'Service d’exécution',
    storage: 'Stockage',
    free: 'Espace disponible',
    total: 'Capacité du disque',
    history: 'Historique des conversations',
    prunable: 'Anciennes conversations admissibles',
    estimate: 'Espace récupérable estimé',
    retention: 'Jours de conservation',
    unknown: 'Non fourni',
    factsUnavailable:
      'Le service n’a pas fourni de mesures de stockage. Consultez les détails techniques pour le rapport original.'
  },
  de: {
    source: 'Quelle',
    received: 'Empfangen',
    deferred: 'Verschoben bis',
    application: 'Aino',
    runtime: 'Laufzeitdienst',
    storage: 'Speicher',
    free: 'Freier Speicher',
    total: 'Datenträgerkapazität',
    history: 'Gesprächsverlauf',
    prunable: 'Geeignete alte Gespräche',
    estimate: 'Geschätzt freigebbarer Speicher',
    retention: 'Aufbewahrungstage',
    unknown: 'Nicht verfügbar',
    factsUnavailable:
      'Der Dienst hat keine Speichermesswerte geliefert. Den Originalbericht findest du in den technischen Details.'
  },
  es: {
    source: 'Origen',
    received: 'Recibido',
    deferred: 'Pospuesto hasta',
    application: 'Aino',
    runtime: 'Servicio de ejecución',
    storage: 'Almacenamiento',
    free: 'Espacio disponible',
    total: 'Capacidad del disco',
    history: 'Historial de conversaciones',
    prunable: 'Conversaciones antiguas aptas',
    estimate: 'Espacio recuperable estimado',
    retention: 'Días de conservación',
    unknown: 'No disponible',
    factsUnavailable:
      'El servicio no ha enviado mediciones de almacenamiento. Consulta el informe original en los detalles técnicos.'
  },
  ru: {
    source: 'Источник',
    received: 'Получено',
    deferred: 'Отложено до',
    application: 'Aino',
    runtime: 'Служба выполнения',
    storage: 'Хранилище',
    free: 'Свободное место',
    total: 'Ёмкость диска',
    history: 'История разговоров',
    prunable: 'Подходящие старые разговоры',
    estimate: 'Оценка освобождаемого места',
    retention: 'Срок хранения в днях',
    unknown: 'Нет данных',
    factsUnavailable: 'Служба не предоставила измерения хранилища. Исходный отчёт доступен в технических сведениях.'
  },
  ar: {
    source: 'المصدر',
    received: 'وقت الاستلام',
    deferred: 'مؤجل حتى',
    application: 'Aino',
    runtime: 'خدمة التشغيل',
    storage: 'التخزين',
    free: 'المساحة المتاحة',
    total: 'سعة القرص',
    history: 'سجل المحادثات',
    prunable: 'المحادثات القديمة المؤهلة',
    estimate: 'المساحة المقدرة للاسترداد',
    retention: 'أيام الاحتفاظ',
    unknown: 'غير متاح',
    factsUnavailable: 'لم توفر الخدمة قياسات التخزين. راجع التقرير الأصلي في التفاصيل التقنية.'
  }
}

export function notificationPresentationCopy(locale: Locale): NotificationPresentationCopy {
  return copy[locale as BundledLocale] ?? copy.en
}
