import type { BundledLocale } from './types'
import type { AccountLoginCopy, AccountPageTranslations } from './types_account_page'

export const accountPage = {
  en: {
    description: 'Manage your profile, balance and usage history.',
    profileDescription: 'Your Aino account',
    serviceDescription: 'Account information is provided by Aino account services.',
    editNameDescription: 'Choose the name displayed in Aino.',
    signOutTitle: 'Sign out',
    signOutDescription: 'Sign out of your current Aino account?',
    exactBalance: 'View exact balance',
    noSubscriptionsDescription: 'You have no active subscriptions. Active subscriptions will appear here.',
    remaining: 'Remaining quota',
    subscriptionActive: 'Active',
    devicesDescription: 'Review device access and revoke devices you no longer use.',
    deviceIdentifier: 'Devices are identified by ID.',
    historyTitle: 'Billing history',
    historyDescription: 'Amounts reflect actual settlement.',
    refreshHistory: 'Refresh billing history',
    filters: 'Filter',
    toggleFilters: 'Show or hide usage filters',
    columns: { order: 'Order number', created: 'Created', amount: 'Paid amount', status: 'Status', actions: 'Actions' },
    viewOrder: 'View'
  },
  zh: {
    description: '管理账户资料，查看余额与使用记录。',
    profileDescription: '你的 Aino 账户',
    serviceDescription: '账户信息由 Aino 账户服务提供',
    editNameDescription: '设置你在 Aino 中显示的名字。',
    signOutTitle: '退出登录',
    signOutDescription: '退出当前 Aino 账户？',
    exactBalance: '查看精确余额',
    noSubscriptionsDescription: '当前没有生效中的订阅，已生效的订阅将在这里显示。',
    remaining: '剩余额度',
    subscriptionActive: '生效中',
    devicesDescription: '查看设备授权，撤销不再使用的设备',
    deviceIdentifier: '设备以 ID 标识',
    historyTitle: '账单记录',
    historyDescription: '金额以实际结算为准',
    refreshHistory: '刷新账单',
    filters: '筛选',
    toggleFilters: '展开或收起消费筛选',
    columns: { order: '订单号', created: '创建时间', amount: '实付金额', status: '状态', actions: '操作' },
    viewOrder: '查看'
  },
  'zh-hant': {
    description: '管理帳戶資料，查看餘額與使用紀錄。',
    profileDescription: '你的 Aino 帳戶',
    serviceDescription: '帳戶資訊由 Aino 帳戶服務提供',
    editNameDescription: '設定你在 Aino 中顯示的名字。',
    signOutTitle: '登出',
    signOutDescription: '登出目前的 Aino 帳戶？',
    exactBalance: '查看精確餘額',
    noSubscriptionsDescription: '目前沒有生效中的訂閱，已生效的訂閱將在這裡顯示。',
    remaining: '剩餘額度',
    subscriptionActive: '生效中',
    devicesDescription: '查看裝置授權，撤銷不再使用的裝置',
    deviceIdentifier: '裝置以 ID 識別',
    historyTitle: '帳單紀錄',
    historyDescription: '金額以實際結算為準',
    refreshHistory: '重新整理帳單',
    filters: '篩選',
    toggleFilters: '展開或收起消費篩選',
    columns: { order: '訂單號', created: '建立時間', amount: '實付金額', status: '狀態', actions: '操作' },
    viewOrder: '查看'
  },
  ja: {
    description: 'アカウント情報、残高、利用履歴を管理します。',
    profileDescription: 'あなたの Aino アカウント',
    serviceDescription: 'アカウント情報は Aino アカウントサービスから提供されます。',
    editNameDescription: 'Aino に表示する名前を設定します。',
    signOutTitle: 'ログアウト',
    signOutDescription: '現在の Aino アカウントからログアウトしますか？',
    exactBalance: '正確な残高を表示',
    noSubscriptionsDescription: '有効なサブスクリプションはありません。有効になるとここに表示されます。',
    remaining: '残りの利用枠',
    subscriptionActive: '有効',
    devicesDescription: 'デバイスの認証を確認し、使用しないデバイスの認証を取り消します。',
    deviceIdentifier: 'デバイスは ID で識別されます。',
    historyTitle: '請求履歴',
    historyDescription: '金額は実際の精算結果に基づきます。',
    refreshHistory: '請求履歴を更新',
    filters: '絞り込み',
    toggleFilters: '利用履歴の絞り込みを表示・非表示',
    columns: { order: '注文番号', created: '作成日時', amount: '支払額', status: '状態', actions: '操作' },
    viewOrder: '表示'
  },
  ar: {
    description: 'أدر ملفك الشخصي ورصيدك وسجل الاستخدام.',
    profileDescription: 'حسابك في Aino',
    serviceDescription: 'تُقدَّم معلومات الحساب من خدمات حساب Aino.',
    editNameDescription: 'اختر الاسم الذي يظهر في Aino.',
    signOutTitle: 'تسجيل الخروج',
    signOutDescription: 'هل تريد تسجيل الخروج من حساب Aino الحالي؟',
    exactBalance: 'عرض الرصيد الدقيق',
    noSubscriptionsDescription: 'ليس لديك اشتراكات سارية. ستظهر الاشتراكات هنا عند سريانها.',
    remaining: 'الحصة المتبقية',
    subscriptionActive: 'سارٍ',
    devicesDescription: 'راجع صلاحيات الأجهزة وألغِ صلاحيات الأجهزة التي لم تعد تستخدمها.',
    deviceIdentifier: 'تُعرَّف الأجهزة بواسطة المعرّف.',
    historyTitle: 'سجل الفوترة',
    historyDescription: 'تعكس المبالغ التسوية الفعلية.',
    refreshHistory: 'تحديث سجل الفوترة',
    filters: 'تصفية',
    toggleFilters: 'إظهار عوامل تصفية الاستخدام أو إخفاؤها',
    columns: {
      order: 'رقم الطلب',
      created: 'تاريخ الإنشاء',
      amount: 'المبلغ المدفوع',
      status: 'الحالة',
      actions: 'الإجراءات'
    },
    viewOrder: 'عرض'
  },
  ru: {
    description: 'Управляйте профилем, балансом и историей использования.',
    profileDescription: 'Ваша учётная запись Aino',
    serviceDescription: 'Данные предоставлены службой учётных записей Aino.',
    editNameDescription: 'Выберите имя, которое будет отображаться в Aino.',
    signOutTitle: 'Выйти',
    signOutDescription: 'Выйти из текущей учётной записи Aino?',
    exactBalance: 'Показать точный баланс',
    noSubscriptionsDescription: 'Активных подписок нет. После активации они появятся здесь.',
    remaining: 'Остаток квоты',
    subscriptionActive: 'Активна',
    devicesDescription: 'Проверяйте доступ устройств и отзывайте его у неиспользуемых устройств.',
    deviceIdentifier: 'Устройства обозначены идентификаторами.',
    historyTitle: 'История платежей',
    historyDescription: 'Суммы соответствуют фактическому расчёту.',
    refreshHistory: 'Обновить историю платежей',
    filters: 'Фильтры',
    toggleFilters: 'Показать или скрыть фильтры использования',
    columns: {
      order: 'Номер заказа',
      created: 'Дата создания',
      amount: 'Оплачено',
      status: 'Статус',
      actions: 'Действия'
    },
    viewOrder: 'Открыть'
  },
  fr: {
    description: 'Gérez votre profil, votre solde et votre historique d’utilisation.',
    profileDescription: 'Votre compte Aino',
    serviceDescription: 'Les informations sont fournies par le service de compte Aino.',
    editNameDescription: 'Choisissez le nom affiché dans Aino.',
    signOutTitle: 'Se déconnecter',
    signOutDescription: 'Se déconnecter du compte Aino actuel ?',
    exactBalance: 'Voir le solde exact',
    noSubscriptionsDescription: 'Aucun abonnement actif. Les abonnements apparaîtront ici une fois activés.',
    remaining: 'Quota restant',
    subscriptionActive: 'Actif',
    devicesDescription: 'Consultez les accès des appareils et révoquez ceux que vous n’utilisez plus.',
    deviceIdentifier: 'Les appareils sont identifiés par leur ID.',
    historyTitle: 'Historique de facturation',
    historyDescription: 'Les montants reflètent le règlement réel.',
    refreshHistory: 'Actualiser l’historique de facturation',
    filters: 'Filtrer',
    toggleFilters: 'Afficher ou masquer les filtres d’utilisation',
    columns: {
      order: 'N° de commande',
      created: 'Création',
      amount: 'Montant payé',
      status: 'Statut',
      actions: 'Actions'
    },
    viewOrder: 'Voir'
  },
  de: {
    description: 'Verwalte dein Profil, dein Guthaben und deinen Nutzungsverlauf.',
    profileDescription: 'Dein Aino-Konto',
    serviceDescription: 'Kontoinformationen werden vom Aino-Kontodienst bereitgestellt.',
    editNameDescription: 'Wähle den Namen, der in Aino angezeigt wird.',
    signOutTitle: 'Abmelden',
    signOutDescription: 'Vom aktuellen Aino-Konto abmelden?',
    exactBalance: 'Genaues Guthaben anzeigen',
    noSubscriptionsDescription: 'Keine aktiven Abonnements. Aktive Abonnements werden hier angezeigt.',
    remaining: 'Verbleibendes Kontingent',
    subscriptionActive: 'Aktiv',
    devicesDescription: 'Prüfe Gerätezugriffe und widerrufe den Zugriff nicht mehr verwendeter Geräte.',
    deviceIdentifier: 'Geräte werden anhand ihrer ID angezeigt.',
    historyTitle: 'Abrechnungsverlauf',
    historyDescription: 'Es gelten die tatsächlich abgerechneten Beträge.',
    refreshHistory: 'Abrechnungsverlauf aktualisieren',
    filters: 'Filtern',
    toggleFilters: 'Nutzungsfilter ein- oder ausblenden',
    columns: {
      order: 'Bestellnummer',
      created: 'Erstellt',
      amount: 'Gezahlter Betrag',
      status: 'Status',
      actions: 'Aktionen'
    },
    viewOrder: 'Ansehen'
  },
  es: {
    description: 'Gestiona tu perfil, tu saldo y tu historial de uso.',
    profileDescription: 'Tu cuenta de Aino',
    serviceDescription: 'El servicio de cuentas de Aino proporciona esta información.',
    editNameDescription: 'Elige el nombre que se muestra en Aino.',
    signOutTitle: 'Cerrar sesión',
    signOutDescription: '¿Cerrar sesión en la cuenta actual de Aino?',
    exactBalance: 'Ver saldo exacto',
    noSubscriptionsDescription: 'No tienes suscripciones activas. Aparecerán aquí cuando se activen.',
    remaining: 'Cuota restante',
    subscriptionActive: 'Activa',
    devicesDescription: 'Revisa el acceso de los dispositivos y revoca los que ya no uses.',
    deviceIdentifier: 'Los dispositivos se identifican por su ID.',
    historyTitle: 'Historial de facturación',
    historyDescription: 'Los importes reflejan la liquidación real.',
    refreshHistory: 'Actualizar el historial de facturación',
    filters: 'Filtrar',
    toggleFilters: 'Mostrar u ocultar los filtros de uso',
    columns: {
      order: 'N.º de pedido',
      created: 'Fecha de creación',
      amount: 'Importe pagado',
      status: 'Estado',
      actions: 'Acciones'
    },
    viewOrder: 'Ver'
  }
} satisfies Record<BundledLocale, AccountPageTranslations>

export const accountLogin = {
  en: {
    loginHelp: 'Sign-in help'
  },
  zh: {
    loginHelp: '登录说明'
  },
  'zh-hant': {
    loginHelp: '登入說明'
  },
  ja: {
    loginHelp: 'ログインのヘルプ'
  },
  de: {
    loginHelp: 'Hilfe zur Anmeldung'
  },
  es: {
    loginHelp: 'Ayuda para iniciar sesión'
  },
  fr: {
    loginHelp: 'Aide à la connexion'
  },
  ar: {
    loginHelp: 'مساعدة تسجيل الدخول'
  },
  ru: {
    loginHelp: 'Помощь со входом'
  }
} satisfies Record<BundledLocale, AccountLoginCopy>
