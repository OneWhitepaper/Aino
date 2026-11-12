import type { Locale } from './types'

const copy = {
  en: { model_changed: 'Model changed', reply_received: 'Reply restored', history: 'View previous error' },
  zh: { model_changed: '已更换模型', reply_received: '已恢复回复', history: '查看原错误' },
  'zh-hant': { model_changed: '已更換模型', reply_received: '已恢復回覆', history: '檢視原錯誤' },
  ja: { model_changed: 'モデルを変更しました', reply_received: '応答が復旧しました', history: '以前のエラーを表示' },
  de: {
    model_changed: 'Modell geändert',
    reply_received: 'Antwort wiederhergestellt',
    history: 'Vorherigen Fehler anzeigen'
  },
  fr: { model_changed: 'Modèle modifié', reply_received: 'Réponse rétablie', history: 'Voir l’erreur précédente' },
  es: { model_changed: 'Modelo cambiado', reply_received: 'Respuesta restablecida', history: 'Ver el error anterior' },
  ru: { model_changed: 'Модель изменена', reply_received: 'Ответ восстановлен', history: 'Посмотреть прежнюю ошибку' },
  ar: { model_changed: 'تم تغيير النموذج', reply_received: 'تمت استعادة الرد', history: 'عرض الخطأ السابق' }
}

export function modelErrorRecoveryCopy(locale: Locale) {
  return copy[locale as keyof typeof copy] ?? copy.en
}
