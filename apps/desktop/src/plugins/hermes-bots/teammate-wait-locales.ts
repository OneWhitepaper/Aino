/**
 * Copy for the "Waiting on teammates" strip above a Bot Chat's composer
 * (`teammate-waits.tsx`). Its own bundle so the strip's keys sit together; wired
 * into `BotsMessages.waiting` for every locale Bot Mode ships.
 */

// A type alias, not an interface: the plugin bundle's index signature must accept it.
export type TeammateWaitMessages = {
  title: string
  queued: string
  claimed: string
  working: string
  waitingClarify: string
  waitingApproval: string
  failed: (reason: string) => string
  /** Plain words for the typed failure reasons (`tools/bot_failure_reasons.py`); `unknown` is the fallback. */
  reasons: Record<string, string> & { unknown: string }
  unknownOutcome: string
  open: string
  dismiss: string
  /** The do-not-resend rule, shown under a row whose outcome is unknown and as the strip's tooltip. */
  neverResent: string
  /** The last poll failed: the rows shown are the last ones the gateway answered. */
  stale: string
}

const en: TeammateWaitMessages = {
  title: 'Waiting on teammates',
  queued: 'Queued',
  claimed: 'Picked up',
  working: 'Working on it',
  waitingClarify: 'Waiting on you — answer its question',
  waitingApproval: 'Waiting on you — approve or deny',
  failed: reason => `Failed: ${reason}`,
  reasons: {
    provider_auth_or_access: 'its model provider rejected the key',
    provider_quota_limit: 'its provider is out of credits',
    provider_rate_limit: 'its provider is rate-limiting',
    provider_server_error: 'its provider is unreachable',
    missing_config: 'it has no model set up',
    model_unavailable: 'its model is unavailable',
    context_overflow: 'its context is full',
    runtime_offline: 'it is offline',
    queued_expired: 'it never picked it up',
    delivery_timeout: 'timed out',
    agent_blocked: 'it is blocked',
    cancelled: 'cancelled',
    unknown: 'unknown error'
  },
  unknownOutcome: 'Outcome unknown',
  open: 'Open',
  dismiss: 'Dismiss',
  neverResent:
    'Nothing here is ever resent. An unknown outcome means the teammate may already have acted — open its chat before asking again.',
  stale: "Couldn't refresh — showing the last known state."
}

const ja: TeammateWaitMessages = {
  title: 'チームメイトの応答待ち',
  queued: '待機中',
  claimed: '受付済み',
  working: '作業中',
  waitingClarify: 'あなたの回答待ち — 質問に答えてください',
  waitingApproval: 'あなたの承認待ち — 承認または拒否',
  failed: reason => `失敗: ${reason}`,
  reasons: {
    provider_auth_or_access: 'モデルプロバイダーがキーを拒否',
    provider_quota_limit: 'プロバイダーのクレジット切れ',
    provider_rate_limit: 'プロバイダーのレート制限',
    provider_server_error: 'プロバイダーに接続できません',
    missing_config: 'モデルが未設定',
    model_unavailable: 'モデルが利用できません',
    context_overflow: 'コンテキストが上限',
    runtime_offline: 'オフライン',
    queued_expired: '受け取られませんでした',
    delivery_timeout: 'タイムアウト',
    agent_blocked: 'ブロック中',
    cancelled: 'キャンセル',
    unknown: '不明なエラー'
  },
  unknownOutcome: '結果不明',
  open: '開く',
  dismiss: '閉じる',
  neverResent:
    'ここにある依頼は自動で再送されません。結果不明の場合、相手がすでに実行した可能性があります。もう一度頼む前にそのチャットを確認してください。',
  stale: '更新できませんでした — 最後に確認した状態を表示しています。'
}

const zh: TeammateWaitMessages = {
  title: '等待队友',
  queued: '排队中',
  claimed: '已接收',
  working: '处理中',
  waitingClarify: '等待你 — 请回答它的问题',
  waitingApproval: '等待你 — 请批准或拒绝',
  failed: reason => `失败：${reason}`,
  reasons: {
    provider_auth_or_access: '模型服务商拒绝了密钥',
    provider_quota_limit: '服务商额度已用完',
    provider_rate_limit: '服务商限流中',
    provider_server_error: '无法连接服务商',
    missing_config: '尚未配置模型',
    model_unavailable: '模型不可用',
    context_overflow: '上下文已满',
    runtime_offline: '已离线',
    queued_expired: '未被接收',
    delivery_timeout: '超时',
    agent_blocked: '已被阻止',
    cancelled: '已取消',
    unknown: '未知错误'
  },
  unknownOutcome: '结果未知',
  open: '打开',
  dismiss: '忽略',
  neverResent: '这里的请求永远不会自动重发。结果未知表示队友可能已经执行——再次请求前请先打开它的聊天查看。',
  stale: '无法刷新——显示的是上次已知的状态。'
}

const zhHant: TeammateWaitMessages = {
  title: '等待隊友',
  queued: '排隊中',
  claimed: '已接收',
  working: '處理中',
  waitingClarify: '等待你 — 請回答它的問題',
  waitingApproval: '等待你 — 請核准或拒絕',
  failed: reason => `失敗：${reason}`,
  reasons: {
    provider_auth_or_access: '模型服務商拒絕了金鑰',
    provider_quota_limit: '服務商額度已用完',
    provider_rate_limit: '服務商限流中',
    provider_server_error: '無法連線服務商',
    missing_config: '尚未設定模型',
    model_unavailable: '模型無法使用',
    context_overflow: '上下文已滿',
    runtime_offline: '已離線',
    queued_expired: '未被接收',
    delivery_timeout: '逾時',
    agent_blocked: '已被封鎖',
    cancelled: '已取消',
    unknown: '未知錯誤'
  },
  unknownOutcome: '結果未知',
  open: '開啟',
  dismiss: '忽略',
  neverResent: '這裡的請求永遠不會自動重送。結果未知表示隊友可能已經執行——再次請求前請先開啟它的聊天查看。',
  stale: '無法重新整理——顯示的是上次已知的狀態。'
}

const de: TeammateWaitMessages = {
  title: 'Warten auf Teammitglieder',
  queued: 'In Warteschlange',
  claimed: 'Angenommen',
  working: 'In Bearbeitung',
  waitingClarify: 'Wartet auf dich — beantworte die Frage',
  waitingApproval: 'Wartet auf dich — genehmigen oder ablehnen',
  unknownOutcome: 'Ergebnis unbekannt',
  open: 'Öffnen',
  dismiss: 'Ausblenden',
  neverResent:
    'Hier wird nichts erneut gesendet. Bei unbekanntem Ergebnis könnte das Teammitglied bereits gehandelt haben — öffne den Chat, bevor du erneut fragst.',
  stale: 'Aktualisierung fehlgeschlagen — der letzte bekannte Stand wird angezeigt.',
  failed: reason => `Fehlgeschlagen: ${reason}`,
  reasons: {
    provider_auth_or_access: 'der Modellanbieter hat den Schlüssel abgelehnt',
    provider_quota_limit: 'das Guthaben beim Anbieter ist aufgebraucht',
    provider_rate_limit: 'der Anbieter begrenzt die Anfragen',
    provider_server_error: 'der Anbieter ist nicht erreichbar',
    missing_config: 'es ist kein Modell eingerichtet',
    model_unavailable: 'das Modell ist nicht verfügbar',
    context_overflow: 'der Kontext ist voll',
    runtime_offline: 'offline',
    queued_expired: 'wurde nicht angenommen',
    delivery_timeout: 'Zeitüberschreitung',
    agent_blocked: 'blockiert',
    cancelled: 'abgebrochen',
    unknown: 'unbekannter Fehler'
  }
}

const fr: TeammateWaitMessages = {
  title: 'En attente des coéquipiers',
  queued: 'En file d’attente',
  claimed: 'Pris en charge',
  working: 'En cours',
  waitingClarify: 'Vous attend — répondez à sa question',
  waitingApproval: 'Vous attend — approuvez ou refusez',
  unknownOutcome: 'Résultat inconnu',
  open: 'Ouvrir',
  dismiss: 'Masquer',
  neverResent:
    'Rien n’est jamais renvoyé ici. Un résultat inconnu signifie que le coéquipier a peut-être déjà agi — ouvrez son chat avant de redemander.',
  stale: 'Actualisation impossible — affichage du dernier état connu.',
  failed: reason => `Échec : ${reason}`,
  reasons: {
    provider_auth_or_access: 'son fournisseur de modèle a refusé la clé',
    provider_quota_limit: 'son fournisseur n’a plus de crédits',
    provider_rate_limit: 'son fournisseur limite les requêtes',
    provider_server_error: 'son fournisseur est inaccessible',
    missing_config: 'aucun modèle n’est configuré',
    model_unavailable: 'son modèle est indisponible',
    context_overflow: 'son contexte est plein',
    runtime_offline: 'hors ligne',
    queued_expired: 'jamais pris en charge',
    delivery_timeout: 'délai dépassé',
    agent_blocked: 'bloqué',
    cancelled: 'annulé',
    unknown: 'erreur inconnue'
  }
}

const es: TeammateWaitMessages = {
  title: 'Esperando a los compañeros',
  queued: 'En cola',
  claimed: 'Recibido',
  working: 'En curso',
  waitingClarify: 'Te espera — responde a su pregunta',
  waitingApproval: 'Te espera — aprueba o rechaza',
  unknownOutcome: 'Resultado desconocido',
  open: 'Abrir',
  dismiss: 'Descartar',
  neverResent:
    'Aquí nunca se reenvía nada. Un resultado desconocido significa que el compañero quizá ya haya actuado — abre su chat antes de volver a pedirlo.',
  stale: 'No se pudo actualizar — se muestra el último estado conocido.',
  failed: reason => `Error: ${reason}`,
  reasons: {
    provider_auth_or_access: 'su proveedor de modelos rechazó la clave',
    provider_quota_limit: 'su proveedor no tiene créditos',
    provider_rate_limit: 'su proveedor está limitando las solicitudes',
    provider_server_error: 'no se puede acceder a su proveedor',
    missing_config: 'no tiene un modelo configurado',
    model_unavailable: 'su modelo no está disponible',
    context_overflow: 'su contexto está lleno',
    runtime_offline: 'sin conexión',
    queued_expired: 'no se recibió',
    delivery_timeout: 'tiempo agotado',
    agent_blocked: 'bloqueado',
    cancelled: 'cancelado',
    unknown: 'error desconocido'
  }
}

const ru: TeammateWaitMessages = {
  title: 'Ожидание участников команды',
  queued: 'В очереди',
  claimed: 'Принято',
  working: 'В работе',
  waitingClarify: 'Ожидает вас — ответьте на вопрос',
  waitingApproval: 'Ожидает вас — разрешите или отклоните',
  unknownOutcome: 'Результат неизвестен',
  open: 'Открыть',
  dismiss: 'Скрыть',
  neverResent:
    'Здесь ничего не отправляется повторно. Неизвестный результат означает, что участник команды уже мог выполнить действие — откройте его чат, прежде чем просить снова.',
  stale: 'Не удалось обновить — показано последнее известное состояние.',
  failed: reason => `Ошибка: ${reason}`,
  reasons: {
    provider_auth_or_access: 'провайдер модели отклонил ключ',
    provider_quota_limit: 'у провайдера закончились средства',
    provider_rate_limit: 'провайдер ограничивает частоту запросов',
    provider_server_error: 'провайдер недоступен',
    missing_config: 'модель не настроена',
    model_unavailable: 'модель недоступна',
    context_overflow: 'контекст заполнен',
    runtime_offline: 'не в сети',
    queued_expired: 'запрос не был принят',
    delivery_timeout: 'время ожидания истекло',
    agent_blocked: 'заблокирован',
    cancelled: 'отменено',
    unknown: 'неизвестная ошибка'
  }
}

const ar: TeammateWaitMessages = {
  title: 'في انتظار زملاء الفريق',
  queued: 'في قائمة الانتظار',
  claimed: 'تم الاستلام',
  working: 'قيد العمل',
  waitingClarify: 'بانتظارك — أجب عن سؤاله',
  waitingApproval: 'بانتظارك — وافق أو ارفض',
  unknownOutcome: 'النتيجة غير معروفة',
  open: 'فتح',
  dismiss: 'إخفاء',
  neverResent:
    'لا يُعاد إرسال أي شيء هنا. تعني النتيجة غير المعروفة أن الزميل ربما تصرف بالفعل — افتح محادثته قبل أن تطلب مجددًا.',
  stale: 'تعذر التحديث — تُعرض آخر حالة معروفة.',
  failed: reason => `فشل: ${reason}`,
  reasons: {
    provider_auth_or_access: 'رفض مزود النموذج المفتاح',
    provider_quota_limit: 'نفد رصيد المزود',
    provider_rate_limit: 'يحد المزود من معدل الطلبات',
    provider_server_error: 'يتعذر الوصول إلى المزود',
    missing_config: 'لم يتم إعداد نموذج',
    model_unavailable: 'النموذج غير متاح',
    context_overflow: 'السياق ممتلئ',
    runtime_offline: 'غير متصل',
    queued_expired: 'لم يتم استلامه',
    delivery_timeout: 'انتهت المهلة',
    agent_blocked: 'محظور',
    cancelled: 'أُلغي',
    unknown: 'خطأ غير معروف'
  }
}

export const TEAMMATE_WAIT_LOCALES = { en, ja, zh, 'zh-hant': zhHant, ar, ru, fr, de, es }
