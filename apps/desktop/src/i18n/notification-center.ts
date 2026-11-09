export interface NotificationCenterTranslations {
  title: string
  empty: string
  hideSummary: string
  technical: string
  repeated: (count: number) => string
  diskTitle: string
  diskBody: string
  diskAdvice: string
  diskLimits: string
  snooze: string
  sourceUnavailable: string
}

export const notificationCenterCopy: Record<string, NotificationCenterTranslations> = {
  en: {
    sourceUnavailable: 'Switch to the workspace and connection that sent this notification before continuing.',
    title: 'Notifications and status',
    empty: 'No pending notifications',
    hideSummary: 'Hide summary',
    technical: 'Technical details',
    repeated: count => `Repeated ${count} times`,
    diskTitle: 'Disk space is running low',
    diskBody: 'Check your system storage. Cleaning Aino history may not free enough space.',
    diskAdvice: 'Review large downloads and unused applications in your system storage settings.',
    diskLimits:
      'History cleanup only removes eligible old, completed sessions. Pinned and open sessions are kept. Review the details before enabling automatic cleanup.',
    snooze: 'Remind me in 7 days'
  },
  zh: {
    sourceUnavailable: '请先切换到这条提醒所属的工作区和连接，再继续操作。',
    title: '通知与状态',
    empty: '暂无待处理提醒',
    hideSummary: '收起提示',
    technical: '技术详情',
    repeated: count => `已合并 ${count} 次提醒`,
    diskTitle: '磁盘可用空间较少',
    diskBody: '建议检查系统储存空间，清理 Aino 会话不一定能释放足够空间。',
    diskAdvice: '在系统储存管理中检查大型下载文件或未使用的应用。',
    diskLimits: '自动整理只删除符合条件的已结束旧会话，保留置顶和仍打开的会话。请先核对详情，再决定是否开启。',
    snooze: '7 天后提醒'
  },
  'zh-hant': {
    sourceUnavailable: '請先切換到這則提醒所屬的工作區與連線，再繼續操作。',
    title: '通知與狀態',
    empty: '暫無待處理提醒',
    hideSummary: '收起提示',
    technical: '技術詳情',
    repeated: count => `已合併 ${count} 次提醒`,
    diskTitle: '磁碟可用空間較少',
    diskBody: '建議檢查系統儲存空間，清理 Aino 對話不一定能釋放足夠空間。',
    diskAdvice: '在系統儲存管理中檢查大型下載檔案或未使用的應用程式。',
    diskLimits: '自動整理只刪除符合條件的已結束舊對話，保留置頂和仍開啟的對話。請先核對詳情，再決定是否啟用。',
    snooze: '7 天後提醒'
  },
  ja: {
    sourceUnavailable: 'この通知を送信したワークスペースと接続に切り替えてから操作してください。',
    title: '通知と状態',
    empty: '対応が必要な通知はありません',
    hideSummary: '通知を折りたたむ',
    technical: '技術情報',
    repeated: count => `${count} 件の通知を統合`,
    diskTitle: 'ディスクの空き容量が少なくなっています',
    diskBody:
      'システムのストレージを確認してください。Aino の履歴整理だけでは十分に空き容量を確保できない場合があります。',
    diskAdvice: 'ストレージ設定で大きなダウンロードや使っていないアプリを確認してください。',
    diskLimits:
      '履歴整理の対象は条件を満たす古い完了済み会話のみです。固定中や開いている会話は保持されます。自動整理を有効にする前に詳細を確認してください。',
    snooze: '7 日後に通知'
  },
  fr: {
    sourceUnavailable: 'Revenez à l’espace de travail et à la connexion de cette notification avant de continuer.',
    title: 'Notifications et état',
    empty: 'Aucune notification en attente',
    hideSummary: 'Réduire la notification',
    technical: 'Détails techniques',
    repeated: count => `${count} notifications regroupées`,
    diskTitle: 'Espace disque faible',
    diskBody: 'Vérifiez le stockage du système. Nettoyer l’historique Aino peut ne pas libérer assez d’espace.',
    diskAdvice:
      'Vérifiez les téléchargements volumineux et les applications inutilisées dans les réglages de stockage.',
    diskLimits:
      'Le nettoyage supprime uniquement les anciennes conversations terminées et admissibles. Les conversations épinglées ou ouvertes sont conservées. Vérifiez les détails avant d’activer le nettoyage automatique.',
    snooze: 'Rappeler dans 7 jours'
  },
  de: {
    sourceUnavailable: 'Wechsle vor dem Fortfahren zum Arbeitsbereich und zur Verbindung dieser Benachrichtigung.',
    title: 'Benachrichtigungen und Status',
    empty: 'Keine ausstehenden Hinweise',
    hideSummary: 'Hinweis einklappen',
    technical: 'Technische Details',
    repeated: count => `${count} Hinweise zusammengefasst`,
    diskTitle: 'Wenig freier Speicherplatz',
    diskBody: 'Prüfe den Systemspeicher. Das Bereinigen des Aino-Verlaufs schafft möglicherweise nicht genug Platz.',
    diskAdvice: 'Prüfe große Downloads und ungenutzte Apps in den Speichereinstellungen.',
    diskLimits:
      'Es werden nur geeignete alte, abgeschlossene Gespräche entfernt. Angeheftete und offene Gespräche bleiben erhalten. Prüfe die Details vor dem Aktivieren der automatischen Bereinigung.',
    snooze: 'In 7 Tagen erinnern'
  },
  es: {
    sourceUnavailable: 'Cambia al espacio de trabajo y la conexión de este aviso antes de continuar.',
    title: 'Notificaciones y estado',
    empty: 'No hay avisos pendientes',
    hideSummary: 'Contraer aviso',
    technical: 'Detalles técnicos',
    repeated: count => `${count} avisos agrupados`,
    diskTitle: 'Queda poco espacio en disco',
    diskBody: 'Revisa el almacenamiento del sistema. Limpiar el historial de Aino puede no liberar suficiente espacio.',
    diskAdvice: 'Revisa las descargas grandes y las aplicaciones sin usar en los ajustes de almacenamiento.',
    diskLimits:
      'Solo se eliminan las conversaciones antiguas finalizadas que cumplan los requisitos. Se conservan las fijadas y abiertas. Revisa los detalles antes de activar la limpieza automática.',
    snooze: 'Recordar en 7 días'
  },
  ru: {
    sourceUnavailable: 'Перед продолжением переключитесь на рабочую область и подключение этого уведомления.',
    title: 'Уведомления и состояние',
    empty: 'Нет ожидающих уведомлений',
    hideSummary: 'Свернуть уведомление',
    technical: 'Технические сведения',
    repeated: count => `Объединено уведомлений: ${count}`,
    diskTitle: 'Мало свободного места на диске',
    diskBody: 'Проверьте хранилище системы. Очистка истории Aino может не освободить достаточно места.',
    diskAdvice: 'Проверьте большие загрузки и неиспользуемые приложения в настройках хранилища.',
    diskLimits:
      'Очистка удаляет только подходящие старые завершённые разговоры. Закреплённые и открытые разговоры сохраняются. Проверьте сведения перед включением автоматической очистки.',
    snooze: 'Напомнить через 7 дней'
  },
  ar: {
    sourceUnavailable: 'انتقل إلى مساحة العمل والاتصال اللذين أرسلا هذا الإشعار قبل المتابعة.',
    title: 'الإشعارات والحالة',
    empty: 'لا توجد إشعارات معلقة',
    hideSummary: 'طي الإشعار',
    technical: 'التفاصيل التقنية',
    repeated: count => `تم دمج ${count} إشعارات`,
    diskTitle: 'مساحة القرص المتاحة منخفضة',
    diskBody: 'راجع مساحة تخزين النظام. قد لا يوفر تنظيف سجل Aino مساحة كافية.',
    diskAdvice: 'راجع التنزيلات الكبيرة والتطبيقات غير المستخدمة في إعدادات التخزين.',
    diskLimits:
      'يحذف التنظيف المحادثات القديمة المكتملة المؤهلة فقط. يتم الاحتفاظ بالمحادثات المثبتة والمفتوحة. راجع التفاصيل قبل تفعيل التنظيف التلقائي.',
    snooze: 'التذكير بعد 7 أيام'
  }
}
