import type { BundledLocale } from './types'

interface ImageOutputCopy {
  actual: string
  requested: string
  unverified: string
  mismatch: string
  billingHelp: string
  billingLink: string
  count: string
  output: string
  tier: string
  basis: string
  sources: Record<string, string>
}

const COPY: Record<BundledLocale, ImageOutputCopy> = {
  zh: {
    actual: '实际尺寸',
    requested: '请求尺寸',
    unverified: '未核实',
    mismatch: '上游返回的尺寸与请求不同，已保留原图。',
    billingHelp: '实际费用及计费方式以账单为准；画质名称不等同于图片尺寸档位。',
    billingLink: '实际费用与计费依据可在「我的账户 → 账单记录」查看。',
    count: '图片数量',
    output: '实际输出尺寸',
    tier: '图片尺寸档位',
    basis: '尺寸记录依据',
    sources: {
      output: '实际输出尺寸',
      input: '请求尺寸（输出未核实）',
      default: '默认档位（尺寸未核实）',
      legacy: '历史记录（依据未记录）'
    }
  },
  en: {
    actual: 'Actual size',
    requested: 'Requested size',
    unverified: 'Unverified',
    mismatch: 'The provider returned a different size. The original image is preserved.',
    billingHelp: 'Your bill determines the actual charge and billing method. Quality names are not image size tiers.',
    billingLink: 'See My Account → Billing history for the actual charge and billing basis.',
    count: 'Image count',
    output: 'Actual output size',
    tier: 'Image size tier',
    basis: 'Recorded size source',
    sources: {
      output: 'Actual output size',
      input: 'Requested size (output unverified)',
      default: 'Default tier (size unverified)',
      legacy: 'Historical record (source not recorded)'
    }
  },
  'zh-hant': {
    actual: '實際尺寸',
    requested: '請求尺寸',
    unverified: '未核實',
    mismatch: '上游回傳的尺寸與請求不同，已保留原圖。',
    billingHelp: '實際費用及計費方式以帳單為準；畫質名稱不等同於圖片尺寸級距。',
    billingLink: '實際費用與計費依據可在「我的帳戶 → 帳單紀錄」查看。',
    count: '圖片數量',
    output: '實際輸出尺寸',
    tier: '圖片尺寸級距',
    basis: '尺寸記錄依據',
    sources: {
      output: '實際輸出尺寸',
      input: '請求尺寸（輸出未核實）',
      default: '預設級距（尺寸未核實）',
      legacy: '歷史紀錄（依據未記錄）'
    }
  },
  ja: {
    actual: '実際のサイズ',
    requested: 'リクエストサイズ',
    unverified: '未確認',
    mismatch: 'プロバイダーが異なるサイズを返しました。元の画像を保持しています。',
    billingHelp: '実際の料金と課金方法は請求記録に従います。画質名と画像サイズ区分は異なります。',
    billingLink: '実際の料金と課金根拠は「マイアカウント → 請求履歴」で確認できます。',
    count: '画像数',
    output: '実際の出力サイズ',
    tier: '画像サイズ区分',
    basis: 'サイズ記録の根拠',
    sources: {
      output: '実際の出力サイズ',
      input: 'リクエストサイズ（出力未確認）',
      default: '既定区分（サイズ未確認）',
      legacy: '過去の記録（根拠未記録）'
    }
  },
  ar: {
    actual: 'الحجم الفعلي',
    requested: 'الحجم المطلوب',
    unverified: 'غير متحقق منه',
    mismatch: 'أعاد المزوّد حجماً مختلفاً. تم الاحتفاظ بالصورة الأصلية.',
    billingHelp: 'تحدد الفاتورة التكلفة الفعلية وطريقة الفوترة. أسماء الجودة ليست فئات حجم الصور.',
    billingLink: 'راجع حسابي ← سجل الفوترة لمعرفة التكلفة الفعلية وأساس الفوترة.',
    count: 'عدد الصور',
    output: 'حجم الإخراج الفعلي',
    tier: 'فئة حجم الصورة',
    basis: 'مصدر الحجم المسجل',
    sources: {
      output: 'حجم الإخراج الفعلي',
      input: 'الحجم المطلوب (الإخراج غير متحقق منه)',
      default: 'الفئة الافتراضية (الحجم غير متحقق منه)',
      legacy: 'سجل قديم (المصدر غير مسجل)'
    }
  },
  ru: {
    actual: 'Фактический размер',
    requested: 'Запрошенный размер',
    unverified: 'Не проверено',
    mismatch: 'Поставщик вернул другой размер. Исходное изображение сохранено.',
    billingHelp:
      'Фактическая сумма и способ расчёта указаны в счёте. Названия качества не являются категориями размера изображения.',
    billingLink: 'Фактическая сумма и основание расчёта доступны в «Моя учётная запись → История платежей».',
    count: 'Количество изображений',
    output: 'Фактический размер результата',
    tier: 'Категория размера изображения',
    basis: 'Источник записанного размера',
    sources: {
      output: 'Фактический размер результата',
      input: 'Запрошенный размер (результат не проверен)',
      default: 'Категория по умолчанию (размер не проверен)',
      legacy: 'Историческая запись (источник не записан)'
    }
  },
  fr: {
    actual: 'Taille réelle',
    requested: 'Taille demandée',
    unverified: 'Non vérifiée',
    mismatch: 'Le fournisseur a renvoyé une taille différente. L’image originale est conservée.',
    billingHelp:
      'La facture détermine le montant réel et le mode de facturation. Les noms de qualité ne sont pas des catégories de taille d’image.',
    billingLink: 'Consultez Mon compte → Historique de facturation pour le montant réel et sa base de calcul.',
    count: 'Nombre d’images',
    output: 'Taille réelle de sortie',
    tier: 'Catégorie de taille d’image',
    basis: 'Source de taille enregistrée',
    sources: {
      output: 'Taille réelle de sortie',
      input: 'Taille demandée (sortie non vérifiée)',
      default: 'Catégorie par défaut (taille non vérifiée)',
      legacy: 'Ancien enregistrement (source non enregistrée)'
    }
  },
  de: {
    actual: 'Tatsächliche Größe',
    requested: 'Angeforderte Größe',
    unverified: 'Nicht bestätigt',
    mismatch: 'Der Anbieter hat eine andere Größe geliefert. Das Originalbild bleibt erhalten.',
    billingHelp: 'Die Rechnung bestimmt Kosten und Abrechnungsart. Qualitätsnamen sind keine Bildgrößenstufen.',
    billingLink: 'Tatsächliche Kosten und Berechnungsgrundlage stehen unter Mein Konto → Abrechnungsverlauf.',
    count: 'Bildanzahl',
    output: 'Tatsächliche Ausgabegröße',
    tier: 'Bildgrößenstufe',
    basis: 'Quelle der erfassten Größe',
    sources: {
      output: 'Tatsächliche Ausgabegröße',
      input: 'Angeforderte Größe (Ausgabe unbestätigt)',
      default: 'Standardstufe (Größe unbestätigt)',
      legacy: 'Historischer Eintrag (Grundlage nicht erfasst)'
    }
  },
  es: {
    actual: 'Tamaño real',
    requested: 'Tamaño solicitado',
    unverified: 'Sin verificar',
    mismatch: 'El proveedor devolvió un tamaño diferente. Se conserva la imagen original.',
    billingHelp:
      'La factura determina el cargo real y el método de facturación. Los nombres de calidad no son niveles de tamaño de imagen.',
    billingLink: 'Consulta Mi cuenta → Historial de facturación para ver el cargo real y su base de cálculo.',
    count: 'Número de imágenes',
    output: 'Tamaño real de salida',
    tier: 'Nivel de tamaño de imagen',
    basis: 'Fuente del tamaño registrado',
    sources: {
      output: 'Tamaño real de salida',
      input: 'Tamaño solicitado (salida sin verificar)',
      default: 'Nivel predeterminado (tamaño sin verificar)',
      legacy: 'Registro histórico (fuente no registrada)'
    }
  }
}

export function imageOutputCopy(locale: string): ImageOutputCopy {
  return COPY[locale as BundledLocale] ?? COPY.en
}
