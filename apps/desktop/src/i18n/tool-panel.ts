import type { BundledLocale } from './types'

export interface ToolPanelCopy {
  saveClose: string
  saveCloseFailed: string
  description: string
  filesDescription: string
  browserDescription: string
  terminalDescription: string
  reviewDescription: string
  recent: string
  auxiliaryChat: string
  collaboration: string
  project: string
  hide: string
  maximize: string
  restore: string
  listTabs: string
  keep: string
  temporary: string
  discard: string
  closeBody: string
  search: string
  noMatches: string
}

export const toolPanel: Record<BundledLocale, ToolPanelCopy> = {
  en: {
    saveClose: 'Save and close',
    saveCloseFailed: 'Could not save. Cancel to review the file conflict or save error.',
    description: 'Open what you need in the current project.',
    filesDescription: 'Browse folders and open files',
    browserDescription: 'View websites and preview apps',
    terminalDescription: 'Run commands and inspect output',
    reviewDescription: 'Inspect code changes and diffs',
    recent: 'Recently opened',
    auxiliaryChat: 'Auxiliary chat',
    collaboration: 'Collaboration',
    project: 'Current project',
    hide: 'Hide panel',
    maximize: 'Maximize panel',
    restore: 'Restore panel',
    listTabs: 'List tabs',
    keep: 'Keep tab',
    temporary: 'Temporary preview',
    discard: 'Discard changes',
    closeBody: 'Close this file and discard its unsaved changes?',
    search: 'Search project files',
    noMatches: 'No matching files'
  },
  zh: {
    saveClose: '保存并关闭',
    saveCloseFailed: '无法保存。请取消并查看文件冲突或保存错误。',
    description: '在当前项目中打开你需要的内容。',
    filesDescription: '浏览目录与打开文件',
    browserDescription: '查看网页与预览应用',
    terminalDescription: '运行命令与查看输出',
    reviewDescription: '查看代码变更与差异',
    recent: '最近打开',
    auxiliaryChat: '辅助会话',
    collaboration: '协作',
    project: '当前项目',
    hide: '隐藏面板',
    maximize: '最大化面板',
    restore: '还原面板',
    listTabs: '所有标签页',
    keep: '保留标签页',
    temporary: '临时预览',
    discard: '放弃更改',
    closeBody: '关闭此文件并放弃未保存的更改？',
    search: '搜索项目文件',
    noMatches: '没有匹配的文件'
  },
  'zh-hant': {
    saveClose: '儲存並關閉',
    saveCloseFailed: '無法儲存。請取消並查看檔案衝突或儲存錯誤。',
    description: '在目前專案中開啟你需要的內容。',
    filesDescription: '瀏覽目錄與開啟檔案',
    browserDescription: '查看網頁與預覽應用程式',
    terminalDescription: '執行指令與查看輸出',
    reviewDescription: '查看程式碼變更與差異',
    recent: '最近開啟',
    auxiliaryChat: '輔助對話',
    collaboration: '協作',
    project: '目前專案',
    hide: '隱藏面板',
    maximize: '最大化面板',
    restore: '還原面板',
    listTabs: '所有分頁',
    keep: '保留分頁',
    temporary: '暫時預覽',
    discard: '捨棄變更',
    closeBody: '關閉此檔案並捨棄未儲存的變更？',
    search: '搜尋專案檔案',
    noMatches: '沒有符合的檔案'
  },
  ja: {
    saveClose: '保存して閉じる',
    saveCloseFailed: '保存できませんでした。キャンセルしてファイルの競合または保存エラーを確認してください。',
    description: '現在のプロジェクトで必要なものを開きます。',
    filesDescription: 'フォルダーとファイルを開く',
    browserDescription: 'ウェブサイトとアプリをプレビュー',
    terminalDescription: 'コマンドを実行して出力を確認',
    reviewDescription: 'コードの変更と差分を確認',
    recent: '最近開いた項目',
    auxiliaryChat: '補助チャット',
    collaboration: 'コラボレーション',
    project: '現在のプロジェクト',
    hide: 'パネルを隠す',
    maximize: 'パネルを最大化',
    restore: 'パネルを元に戻す',
    listTabs: 'タブ一覧',
    keep: 'タブを保持',
    temporary: '一時プレビュー',
    discard: '変更を破棄',
    closeBody: 'このファイルを閉じて未保存の変更を破棄しますか？',
    search: 'プロジェクトのファイルを検索',
    noMatches: '一致するファイルがありません'
  },
  fr: {
    saveClose: 'Enregistrer et fermer',
    saveCloseFailed: 'Enregistrement impossible. Annulez pour consulter le conflit ou l’erreur.',
    description: 'Ouvrez le contenu utile dans le projet actuel.',
    filesDescription: 'Parcourir les dossiers et ouvrir des fichiers',
    browserDescription: 'Consulter des sites et prévisualiser les applications',
    terminalDescription: 'Exécuter des commandes et consulter la sortie',
    reviewDescription: 'Examiner les modifications et les différences',
    recent: 'Ouverts récemment',
    auxiliaryChat: 'Discussion auxiliaire',
    collaboration: 'Collaboration',
    project: 'Projet actuel',
    hide: 'Masquer le panneau',
    maximize: 'Agrandir le panneau',
    restore: 'Restaurer le panneau',
    listTabs: 'Liste des onglets',
    keep: 'Conserver l’onglet',
    temporary: 'Aperçu temporaire',
    discard: 'Ignorer les modifications',
    closeBody: 'Fermer ce fichier et ignorer ses modifications non enregistrées ?',
    search: 'Rechercher des fichiers du projet',
    noMatches: 'Aucun fichier correspondant'
  },
  de: {
    saveClose: 'Speichern und schließen',
    saveCloseFailed: 'Speichern fehlgeschlagen. Abbrechen, um Dateikonflikt oder Speicherfehler zu prüfen.',
    description: 'Öffne benötigte Inhalte im aktuellen Projekt.',
    filesDescription: 'Ordner durchsuchen und Dateien öffnen',
    browserDescription: 'Websites und Apps in der Vorschau ansehen',
    terminalDescription: 'Befehle ausführen und Ausgabe prüfen',
    reviewDescription: 'Codeänderungen und Unterschiede prüfen',
    recent: 'Zuletzt geöffnet',
    auxiliaryChat: 'Zusätzlicher Chat',
    collaboration: 'Zusammenarbeit',
    project: 'Aktuelles Projekt',
    hide: 'Panel ausblenden',
    maximize: 'Panel maximieren',
    restore: 'Panel wiederherstellen',
    listTabs: 'Tabliste',
    keep: 'Tab behalten',
    temporary: 'Temporäre Vorschau',
    discard: 'Änderungen verwerfen',
    closeBody: 'Diese Datei schließen und ungespeicherte Änderungen verwerfen?',
    search: 'Projektdateien suchen',
    noMatches: 'Keine passenden Dateien'
  },
  es: {
    saveClose: 'Guardar y cerrar',
    saveCloseFailed: 'No se pudo guardar. Cancela para revisar el conflicto o el error.',
    description: 'Abre lo que necesites en el proyecto actual.',
    filesDescription: 'Explorar carpetas y abrir archivos',
    browserDescription: 'Ver sitios web y vistas previas de aplicaciones',
    terminalDescription: 'Ejecutar comandos y revisar la salida',
    reviewDescription: 'Revisar cambios de código y diferencias',
    recent: 'Abiertos recientemente',
    auxiliaryChat: 'Chat auxiliar',
    collaboration: 'Colaboración',
    project: 'Proyecto actual',
    hide: 'Ocultar panel',
    maximize: 'Maximizar panel',
    restore: 'Restaurar panel',
    listTabs: 'Lista de pestañas',
    keep: 'Conservar pestaña',
    temporary: 'Vista previa temporal',
    discard: 'Descartar cambios',
    closeBody: '¿Cerrar este archivo y descartar los cambios sin guardar?',
    search: 'Buscar archivos del proyecto',
    noMatches: 'No hay archivos coincidentes'
  },
  ru: {
    saveClose: 'Сохранить и закрыть',
    saveCloseFailed: 'Не удалось сохранить. Отмените, чтобы просмотреть конфликт файла или ошибку.',
    description: 'Откройте нужное содержимое в текущем проекте.',
    filesDescription: 'Просмотр папок и открытие файлов',
    browserDescription: 'Просмотр сайтов и приложений',
    terminalDescription: 'Запуск команд и просмотр вывода',
    reviewDescription: 'Просмотр изменений кода и различий',
    recent: 'Недавно открытые',
    auxiliaryChat: 'Дополнительный чат',
    collaboration: 'Совместная работа',
    project: 'Текущий проект',
    hide: 'Скрыть панель',
    maximize: 'Развернуть панель',
    restore: 'Восстановить панель',
    listTabs: 'Список вкладок',
    keep: 'Сохранить вкладку',
    temporary: 'Временный просмотр',
    discard: 'Отменить изменения',
    closeBody: 'Закрыть файл и отменить несохранённые изменения?',
    search: 'Поиск файлов проекта',
    noMatches: 'Совпадающие файлы не найдены'
  },
  ar: {
    saveClose: 'حفظ وإغلاق',
    saveCloseFailed: 'تعذر الحفظ. ألغِ العملية لمراجعة تعارض الملف أو خطأ الحفظ.',
    description: 'افتح ما تحتاجه في المشروع الحالي.',
    filesDescription: 'تصفح المجلدات وفتح الملفات',
    browserDescription: 'عرض المواقع ومعاينة التطبيقات',
    terminalDescription: 'تشغيل الأوامر وفحص المخرجات',
    reviewDescription: 'مراجعة تغييرات الشفرة والفروق',
    recent: 'فُتحت مؤخرًا',
    auxiliaryChat: 'محادثة مساعدة',
    collaboration: 'التعاون',
    project: 'المشروع الحالي',
    hide: 'إخفاء اللوحة',
    maximize: 'تكبير اللوحة',
    restore: 'استعادة اللوحة',
    listTabs: 'قائمة علامات التبويب',
    keep: 'الاحتفاظ بعلامة التبويب',
    temporary: 'معاينة مؤقتة',
    discard: 'تجاهل التغييرات',
    closeBody: 'هل تريد إغلاق الملف وتجاهل التغييرات غير المحفوظة؟',
    search: 'البحث في ملفات المشروع',
    noMatches: 'لا توجد ملفات مطابقة'
  }
}
