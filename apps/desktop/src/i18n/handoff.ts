import type { BundledLocale } from './types'

interface HandoffCopy {
  toCode: string
  toWork: string
  returnResult: string
  review: string
  summary: string
  files: string
  pathsOnly: string
  create: string
  prepareReturn: string
  source: string
  child: string
  unsupported: string
  changed: string
  unproven: string
  draftExists: string
  invalid: string
  hint: string
  model: string
}

const copy: Record<BundledLocale, HandoffCopy> = {
  en: {
    toCode: 'Continue in Code',
    toWork: 'Continue in Work',
    returnResult: 'Return result to Work',
    review: 'Review handoff',
    summary: 'Summary',
    files: 'Selected file paths',
    pathsOnly: 'One path per line. Only these references are shared; file contents are not sent.',
    create: 'Create linked conversation',
    prepareReturn: 'Add reviewed result to Work draft',
    source: 'Source conversation',
    child: 'Linked conversation',
    unsupported: 'This gateway does not support Work/Code handoffs. Update it and try again.',
    changed: 'The conversation, owner or model changed. Reopen the handoff to review it again.',
    unproven: 'The gateway did not confirm this handoff. No draft was opened.',
    draftExists: 'Work already has an unsent draft. Open it and save or send it before returning this result.',
    invalid: 'Enter a summary (up to 32,000 characters) and at most 32 file paths (4,096 characters each).',
    hint: 'This prepares an editable draft. Nothing runs until you press Send in the destination conversation.',
    model: 'Retained model'
  },
  zh: {
    toCode: '转到 Code 继续',
    toWork: '转到 Work 继续',
    returnResult: '将结果返回 Work',
    review: '确认交接内容',
    summary: '需求摘要',
    files: '选中的文件路径',
    pathsOnly: '每行一个路径。只分享路径引用，不发送文件内容。',
    create: '创建关联会话',
    prepareReturn: '将已确认的结果加入 Work 草稿',
    source: '来源会话',
    child: '关联会话',
    unsupported: '此网关不支持 Work/Code 交接，请更新后重试。',
    changed: '会话、所属账户或模型已变化，请重新打开并确认交接内容。',
    unproven: '网关未确认此次交接，未打开草稿。',
    draftExists: 'Work 已有未发送的草稿，请先打开并保存或发送，再返回此结果。',
    invalid: '请输入摘要（最多 32,000 字符）及最多 32 个文件路径（每个最多 4,096 字符）。',
    hint: '这里只准备可编辑草稿。在目标会话中点击发送后才会开始执行。',
    model: '保留的模型'
  },
  'zh-hant': {
    toCode: '轉到 Code 繼續',
    toWork: '轉到 Work 繼續',
    returnResult: '將結果返回 Work',
    review: '確認交接內容',
    summary: '需求摘要',
    files: '選取的檔案路徑',
    pathsOnly: '每行一個路徑。只分享路徑參照，不傳送檔案內容。',
    create: '建立關聯對話',
    prepareReturn: '將已確認的結果加入 Work 草稿',
    source: '來源對話',
    child: '關聯對話',
    unsupported: '此閘道不支援 Work/Code 交接，請更新後重試。',
    changed: '對話、所屬帳戶或模型已變更，請重新開啟並確認交接內容。',
    unproven: '閘道未確認此次交接，未開啟草稿。',
    draftExists: 'Work 已有未傳送的草稿，請先開啟並儲存或傳送，再返回此結果。',
    invalid: '請輸入摘要（最多 32,000 字元）及最多 32 個檔案路徑（每個最多 4,096 字元）。',
    hint: '這裡只準備可編輯草稿。在目標對話中按下傳送後才會開始執行。',
    model: '保留的模型'
  },
  ja: {
    toCode: 'Code で続ける',
    toWork: 'Work で続ける',
    returnResult: '結果を Work に戻す',
    review: '引き継ぎを確認',
    summary: '要約',
    files: '選択したファイルパス',
    pathsOnly: '1 行に 1 パス。パスのみを共有し、ファイルの内容は送信しません。',
    create: '関連する会話を作成',
    prepareReturn: '確認した結果を Work の下書きに追加',
    source: '元の会話',
    child: '関連する会話',
    unsupported: 'このゲートウェイは Work/Code の引き継ぎに対応していません。更新して再試行してください。',
    changed: '会話、所有者またはモデルが変わりました。引き継ぎを開き直して確認してください。',
    unproven: 'ゲートウェイが引き継ぎを確認できなかったため、下書きは開いていません。',
    draftExists: 'Work に未送信の下書きがあります。先に保存または送信してください。',
    invalid: '要約は 32,000 文字以内、パスは各 4,096 文字以内で 32 件まで入力してください。',
    hint: '編集可能な下書きを用意します。移動先で送信するまで実行されません。',
    model: '維持するモデル'
  },
  fr: {
    toCode: 'Continuer dans Code',
    toWork: 'Continuer dans Work',
    returnResult: 'Renvoyer le résultat à Work',
    review: 'Vérifier le transfert',
    summary: 'Résumé',
    files: 'Chemins de fichiers sélectionnés',
    pathsOnly: 'Un chemin par ligne. Seules les références sont partagées, pas le contenu des fichiers.',
    create: 'Créer une conversation liée',
    prepareReturn: 'Ajouter le résultat vérifié au brouillon Work',
    source: 'Conversation source',
    child: 'Conversation liée',
    unsupported: 'Cette passerelle ne prend pas en charge les transferts Work/Code. Mettez-la à jour.',
    changed: 'La conversation, le propriétaire ou le modèle a changé. Rouvrez le transfert pour le vérifier.',
    unproven: 'La passerelle n’a pas confirmé ce transfert. Aucun brouillon n’a été ouvert.',
    draftExists: 'Work contient déjà un brouillon. Enregistrez-le ou envoyez-le avant de renvoyer le résultat.',
    invalid: 'Saisissez un résumé de 32 000 caractères maximum et jusqu’à 32 chemins de 4 096 caractères chacun.',
    hint: 'Un brouillon modifiable sera préparé. Rien ne démarre avant votre envoi dans la conversation cible.',
    model: 'Modèle conservé'
  },
  de: {
    toCode: 'In Code fortfahren',
    toWork: 'In Work fortfahren',
    returnResult: 'Ergebnis an Work zurückgeben',
    review: 'Übergabe prüfen',
    summary: 'Zusammenfassung',
    files: 'Ausgewählte Dateipfade',
    pathsOnly: 'Ein Pfad pro Zeile. Nur Pfade werden geteilt, keine Dateiinhalte.',
    create: 'Verknüpftes Gespräch erstellen',
    prepareReturn: 'Geprüftes Ergebnis zum Work-Entwurf hinzufügen',
    source: 'Ursprungsgespräch',
    child: 'Verknüpftes Gespräch',
    unsupported: 'Dieses Gateway unterstützt keine Work/Code-Übergaben. Bitte aktualisieren.',
    changed: 'Gespräch, Eigentümer oder Modell hat sich geändert. Übergabe erneut öffnen und prüfen.',
    unproven: 'Das Gateway hat die Übergabe nicht bestätigt. Kein Entwurf wurde geöffnet.',
    draftExists: 'Work enthält bereits einen Entwurf. Bitte zuerst speichern oder senden.',
    invalid: 'Zusammenfassung: höchstens 32.000 Zeichen. Bis zu 32 Pfade mit jeweils höchstens 4.096 Zeichen.',
    hint: 'Ein bearbeitbarer Entwurf wird vorbereitet. Erst beim Senden im Zielgespräch beginnt die Ausführung.',
    model: 'Beibehaltenes Modell'
  },
  es: {
    toCode: 'Continuar en Code',
    toWork: 'Continuar en Work',
    returnResult: 'Devolver el resultado a Work',
    review: 'Revisar transferencia',
    summary: 'Resumen',
    files: 'Rutas de archivos seleccionadas',
    pathsOnly: 'Una ruta por línea. Solo se comparten referencias, no el contenido de los archivos.',
    create: 'Crear conversación vinculada',
    prepareReturn: 'Añadir el resultado revisado al borrador de Work',
    source: 'Conversación de origen',
    child: 'Conversación vinculada',
    unsupported: 'Esta puerta de enlace no admite transferencias Work/Code. Actualízala e inténtalo de nuevo.',
    changed: 'Cambió la conversación, el propietario o el modelo. Abre la transferencia y revísala de nuevo.',
    unproven: 'La puerta de enlace no confirmó la transferencia. No se abrió ningún borrador.',
    draftExists: 'Work ya tiene un borrador sin enviar. Guárdalo o envíalo antes de devolver el resultado.',
    invalid: 'Introduce un resumen de hasta 32.000 caracteres y hasta 32 rutas de 4.096 caracteres cada una.',
    hint: 'Se prepara un borrador editable. Nada se ejecuta hasta que pulses Enviar en la conversación de destino.',
    model: 'Modelo conservado'
  },
  ru: {
    toCode: 'Продолжить в Code',
    toWork: 'Продолжить в Work',
    returnResult: 'Вернуть результат в Work',
    review: 'Проверить передачу',
    summary: 'Краткое описание',
    files: 'Выбранные пути файлов',
    pathsOnly: 'Один путь в строке. Передаются только ссылки, без содержимого файлов.',
    create: 'Создать связанную беседу',
    prepareReturn: 'Добавить проверенный результат в черновик Work',
    source: 'Исходная беседа',
    child: 'Связанная беседа',
    unsupported: 'Шлюз не поддерживает передачу между Work и Code. Обновите его.',
    changed: 'Беседа, владелец или модель изменились. Откройте передачу и проверьте её снова.',
    unproven: 'Шлюз не подтвердил передачу. Черновик не открыт.',
    draftExists: 'В Work уже есть черновик. Сначала сохраните или отправьте его.',
    invalid: 'Введите описание до 32 000 символов и до 32 путей по 4096 символов каждый.',
    hint: 'Будет подготовлен редактируемый черновик. Запуск произойдёт только после отправки в целевой беседе.',
    model: 'Сохранённая модель'
  },
  ar: {
    toCode: 'المتابعة في Code',
    toWork: 'المتابعة في Work',
    returnResult: 'إعادة النتيجة إلى Work',
    review: 'مراجعة التسليم',
    summary: 'الملخص',
    files: 'مسارات الملفات المحددة',
    pathsOnly: 'مسار واحد في كل سطر. تتم مشاركة المراجع فقط دون محتويات الملفات.',
    create: 'إنشاء محادثة مرتبطة',
    prepareReturn: 'إضافة النتيجة المراجعة إلى مسودة Work',
    source: 'المحادثة الأصلية',
    child: 'المحادثة المرتبطة',
    unsupported: 'هذه البوابة لا تدعم تسليم Work/Code. حدّثها ثم حاول مجددًا.',
    changed: 'تغيّرت المحادثة أو المالك أو النموذج. افتح التسليم وراجعه مجددًا.',
    unproven: 'لم تؤكد البوابة التسليم. لم يتم فتح أي مسودة.',
    draftExists: 'توجد مسودة غير مرسلة في Work. احفظها أو أرسلها قبل إعادة النتيجة.',
    invalid: 'أدخل ملخصًا حتى 32000 حرف، وما يصل إلى 32 مسارًا بطول 4096 حرف لكل مسار.',
    hint: 'سيتم إعداد مسودة قابلة للتحرير. لن يبدأ التنفيذ حتى تضغط إرسال في المحادثة المستهدفة.',
    model: 'النموذج المحتفظ به'
  }
}

export function handoffCopy(locale: string): HandoffCopy {
  return copy[locale as BundledLocale] ?? copy.en
}
