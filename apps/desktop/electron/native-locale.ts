/**
 * Copy used by Electron-owned menus and native dialogs.
 *
 * The renderer catalog cannot be imported from the Electron main process: it
 * carries renderer aliases and UI-only dependencies. Keep this small, stable
 * boundary in the Electron workspace instead. The locale ids intentionally
 * mirror `src/i18n/types.ts`; `normalizeNativeLocale` accepts the same common
 * persisted/OS aliases so a renderer or an older config cannot poison the
 * native surface with a raw key.
 */

export type NativeLocale = 'ar' | 'en' | 'ja' | 'zh' | 'zh-hant'

export const DEFAULT_NATIVE_LOCALE: NativeLocale = 'en'

export interface NativeLocaleCopy {
  addContext: string
  allFiles: string
  actualSize: string
  about: (appName: string) => string
  checkForUpdates: string
  chooseDefaultProjectDirectory: string
  connectingCloudAgent: string
  close: string
  copy: string
  cut: string
  delete: string
  edit: string
  file: string
  forceReload: string
  front: string
  help: string
  hide: (appName: string) => string
  hideOthers: string
  images: string
  minimize: string
  newWindow: string
  openFolder: string
  paste: string
  pasteAndMatchStyle: string
  quit: (appName: string) => string
  quitAnyway: string
  quitKeepRunning: string
  quitMore: (count: number) => string
  quitWarning: string
  quitWorking: (appName: string, count: number) => string
  redo: string
  reload: string
  save: string
  saveFile: string
  saveImage: string
  selectAll: string
  services: string
  signInCloud: string
  signInGateway: (appName: string) => string
  toggleDeveloperTools: string
  toggleFullscreen: string
  unhide: string
  undo: string
  updateFailedTitle: (appName: string) => string
  updateNeedsStep: string
  updateTitle: (appName: string) => string
  view: string
  window: string
  renewingCloudSession: string
  zoom: string
  zoomIn: string
  zoomOut: string
  rendererLoadError: {
    title: (appName: string) => string
    defaultDescription: string
    repeatedFailureDescription: string
    incompleteDescription: (count: number) => string
    missingAssets: (total: number, shown: number) => string
    repairWith: string
    persistentPrefix: string
    persistentMiddle: string
    persistentSuffix: string
    reload: string
  }
  bootProgress: {
    waitingToStartBackend: (appName: string) => string
    updateFinishing: (appName: string) => string
    usingBackend: (label: string) => string
    runtimeReady: (appName: string) => string
    resolvingBackend: (appName: string) => string
    connectingRemoteBackend: (appName: string, url: string) => string
    remoteBackendReady: (appName: string) => string
    resolvingRuntime: (appName: string) => string
    startingBackendVia: (appName: string, label: string) => string
    waitingBackendLaunch: (appName: string) => string
    waitingBackendReady: (appName: string) => string
    backendReadyFinalizing: (appName: string) => string
    waitingForSetup: string
    waitingForSetupAfterSeconds: (seconds: number) => string
    restartingConnection: string
  }
}

const COPY: Record<NativeLocale, NativeLocaleCopy> = {
  en: {
    about: appName => `About ${appName}`,
    addContext: 'Add context',
    allFiles: 'All Files',
    actualSize: 'Actual Size',
    checkForUpdates: 'Check for Updates…',
    chooseDefaultProjectDirectory: 'Choose default project directory',
    connectingCloudAgent: 'Connecting to Nous Cloud agent…',
    close: 'Close',
    copy: 'Copy',
    cut: 'Cut',
    delete: 'Delete',
    edit: 'Edit',
    file: 'File',
    forceReload: 'Force Reload',
    front: 'Bring All to Front',
    help: 'Help',
    hide: appName => `Hide ${appName}`,
    hideOthers: 'Hide Others',
    images: 'Images',
    minimize: 'Minimize',
    newWindow: 'New Window',
    openFolder: 'Open Folder…',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    quit: appName => `Quit ${appName}`,
    quitAnyway: 'Quit Anyway',
    quitKeepRunning: 'Keep Running',
    quitMore: count => `• ${count} more`,
    quitWarning: 'Quitting stops the agent mid-turn. Any work it has not finished writing is lost.',
    quitWorking: (appName, count) => `${appName} is still working on ${count} chat${count === 1 ? '' : 's'}.`,
    redo: 'Redo',
    reload: 'Reload',
    save: 'Save',
    saveFile: 'Save File',
    saveImage: 'Save Image',
    selectAll: 'Select All',
    services: 'Services',
    signInCloud: 'Sign in to Nous Cloud',
    signInGateway: appName => `Sign in to ${appName} gateway`,
    toggleDeveloperTools: 'Toggle Developer Tools',
    toggleFullscreen: 'Toggle Full Screen',
    unhide: 'Show All',
    undo: 'Undo',
    updateFailedTitle: appName => `${appName} update did not finish`,
    updateNeedsStep: 'The update finished, but needs one more step',
    updateTitle: appName => `${appName} update`,
    view: 'View',
    window: 'Window',
    renewingCloudSession: 'Renewing Nous Cloud session…',
    zoom: 'Zoom',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    rendererLoadError: {
      title: appName => `${appName} couldn’t start the desktop UI`,
      defaultDescription: 'The desktop renderer failed to load.',
      repeatedFailureDescription: 'The desktop renderer failed to load repeatedly after the update.',
      incompleteDescription: count =>
        `The desktop renderer bundle is incomplete after the last update (${count} missing file(s)).`,
      missingAssets: (total, shown) =>
        `The renderer bundle is missing ${total} module file(s) (first ${shown} shown) — the last update replaced the app while its files were locked.`,
      repairWith: 'Repair with:',
      persistentPrefix: 'If this keeps happening, check',
      persistentMiddle: 'and try',
      persistentSuffix: ', then restart the app.',
      reload: 'Reload'
    },
    bootProgress: {
      waitingToStartBackend: appName => `Waiting to start ${appName} backend`,
      updateFinishing: appName => `An update is finishing — ${appName} will start automatically when it completes…`,
      usingBackend: label => `Using ${label}`,
      runtimeReady: appName => `${appName} runtime is ready`,
      resolvingBackend: appName => `Resolving ${appName} backend`,
      connectingRemoteBackend: (appName, url) => `Connecting to remote ${appName} backend at ${url}`,
      remoteBackendReady: appName => `Remote ${appName} backend is ready`,
      resolvingRuntime: appName => `Resolving ${appName} runtime`,
      startingBackendVia: (appName, label) => `Starting ${appName} backend via ${label}`,
      waitingBackendLaunch: appName => `Waiting for ${appName} backend to launch`,
      waitingBackendReady: appName => `Waiting for ${appName} backend to become ready`,
      backendReadyFinalizing: appName => `${appName} backend is ready. Finalizing desktop startup`,
      waitingForSetup: 'Waiting for first-run setup choice',
      waitingForSetupAfterSeconds: seconds => `Still waiting for first-run setup choice after ${seconds} seconds`,
      restartingConnection: 'Restarting desktop connection'
    }
  },
  zh: {
    about: appName => `关于 ${appName}`,
    addContext: '添加上下文',
    allFiles: '所有文件',
    actualSize: '实际大小',
    checkForUpdates: '检查更新…',
    chooseDefaultProjectDirectory: '选择默认项目目录',
    connectingCloudAgent: '正在连接 Nous Cloud 智能体…',
    close: '关闭',
    copy: '复制',
    cut: '剪切',
    delete: '删除',
    edit: '编辑',
    file: '文件',
    forceReload: '强制重新加载',
    front: '将所有窗口置于最前',
    help: '帮助',
    hide: appName => `隐藏 ${appName}`,
    hideOthers: '隐藏其他窗口',
    images: '图片',
    minimize: '最小化',
    newWindow: '新建窗口',
    openFolder: '打开文件夹…',
    paste: '粘贴',
    pasteAndMatchStyle: '粘贴并匹配样式',
    quit: appName => `退出 ${appName}`,
    quitAnyway: '仍然退出',
    quitKeepRunning: '继续运行',
    quitMore: count => `• 还有 ${count} 项`,
    quitWarning: '退出会中断智能体当前回合，尚未完成写入的工作将会丢失。',
    quitWorking: (appName, count) => `${appName} 仍在处理 ${count} 个聊天。`,
    redo: '重做',
    reload: '重新加载',
    save: '保存',
    saveFile: '保存文件',
    saveImage: '保存图片',
    selectAll: '全选',
    services: '服务',
    signInCloud: '登录 Nous Cloud',
    signInGateway: appName => `登录 ${appName} 网关`,
    toggleDeveloperTools: '切换开发者工具',
    toggleFullscreen: '切换全屏',
    unhide: '显示全部',
    undo: '撤销',
    updateFailedTitle: appName => `${appName} 更新未完成`,
    updateNeedsStep: '更新已完成，但还需要执行一步',
    updateTitle: appName => `${appName} 更新`,
    view: '视图',
    window: '窗口',
    renewingCloudSession: '正在续期 Nous Cloud 会话…',
    zoom: '缩放',
    zoomIn: '放大',
    zoomOut: '缩小',
    rendererLoadError: {
      title: appName => `${appName} 无法启动桌面界面`,
      defaultDescription: '桌面渲染器加载失败。',
      repeatedFailureDescription: '桌面渲染器在更新后多次加载失败。',
      incompleteDescription: count => `上次更新后桌面渲染器包不完整（缺少 ${count} 个文件）。`,
      missingAssets: (total, shown) =>
        `渲染器包缺少 ${total} 个模块文件（显示前 ${shown} 个）——上次更新时文件被锁定，应用替换未完成。`,
      repairWith: '修复方式：',
      persistentPrefix: '如果问题持续，请检查',
      persistentMiddle: '并尝试执行',
      persistentSuffix: '，然后重新启动应用。',
      reload: '重新加载'
    },
    bootProgress: {
      waitingToStartBackend: appName => `正在等待 ${appName} 后端启动`,
      updateFinishing: appName => `更新正在完成，${appName} 将在完成后自动启动…`,
      usingBackend: label => `正在使用 ${label}`,
      runtimeReady: appName => `${appName} 运行时已就绪`,
      resolvingBackend: appName => `正在解析 ${appName} 后端`,
      connectingRemoteBackend: (appName, url) => `正在连接远程 ${appName} 后端：${url}`,
      remoteBackendReady: appName => `远程 ${appName} 后端已就绪`,
      resolvingRuntime: appName => `正在解析 ${appName} 运行时`,
      startingBackendVia: (appName, label) => `正在通过 ${label} 启动 ${appName} 后端`,
      waitingBackendLaunch: appName => `正在等待 ${appName} 后端启动`,
      waitingBackendReady: appName => `正在等待 ${appName} 后端就绪`,
      backendReadyFinalizing: appName => `${appName} 后端已就绪，正在完成桌面启动`,
      waitingForSetup: '正在等待首次设置选择',
      waitingForSetupAfterSeconds: seconds => `首次设置选择仍未完成，已等待 ${seconds} 秒`,
      restartingConnection: '正在重新启动桌面连接'
    }
  },
  'zh-hant': {
    about: appName => `關於 ${appName}`,
    addContext: '新增內容',
    allFiles: '所有檔案',
    actualSize: '實際大小',
    checkForUpdates: '檢查更新…',
    chooseDefaultProjectDirectory: '選擇預設專案目錄',
    connectingCloudAgent: '正在連線 Nous Cloud 代理…',
    close: '關閉',
    copy: '複製',
    cut: '剪下',
    delete: '刪除',
    edit: '編輯',
    file: '檔案',
    forceReload: '強制重新載入',
    front: '將所有視窗移到最前',
    help: '說明',
    hide: appName => `隱藏 ${appName}`,
    hideOthers: '隱藏其他視窗',
    images: '圖片',
    minimize: '最小化',
    newWindow: '新增視窗',
    openFolder: '開啟資料夾…',
    paste: '貼上',
    pasteAndMatchStyle: '貼上並符合樣式',
    quit: appName => `結束 ${appName}`,
    quitAnyway: '仍要結束',
    quitKeepRunning: '繼續執行',
    quitMore: count => `• 還有 ${count} 項`,
    quitWarning: '結束會中斷智慧體目前的回合，尚未完成寫入的工作將會遺失。',
    quitWorking: (appName, count) => `${appName} 仍在處理 ${count} 個聊天。`,
    redo: '重做',
    reload: '重新載入',
    save: '儲存',
    saveFile: '儲存檔案',
    saveImage: '儲存圖片',
    selectAll: '全選',
    services: '服務',
    signInCloud: '登入 Nous Cloud',
    signInGateway: appName => `登入 ${appName} 閘道`,
    toggleDeveloperTools: '切換開發者工具',
    toggleFullscreen: '切換全螢幕',
    unhide: '顯示全部',
    undo: '復原',
    updateFailedTitle: appName => `${appName} 更新未完成`,
    updateNeedsStep: '更新已完成，但還需要再執行一步',
    updateTitle: appName => `${appName} 更新`,
    view: '檢視',
    window: '視窗',
    renewingCloudSession: '正在更新 Nous Cloud 工作階段…',
    zoom: '縮放',
    zoomIn: '放大',
    zoomOut: '縮小',
    rendererLoadError: {
      title: appName => `${appName} 無法啟動桌面介面`,
      defaultDescription: '桌面轉譯器載入失敗。',
      repeatedFailureDescription: '桌面轉譯器在更新後多次載入失敗。',
      incompleteDescription: count => `上次更新後桌面轉譯器套件不完整（缺少 ${count} 個檔案）。`,
      missingAssets: (total, shown) =>
        `轉譯器套件缺少 ${total} 個模組檔案（顯示前 ${shown} 個）——上次更新時檔案被鎖定，應用程式替換未完成。`,
      repairWith: '修復方式：',
      persistentPrefix: '如果問題持續，請檢查',
      persistentMiddle: '並嘗試執行',
      persistentSuffix: '，然後重新啟動應用程式。',
      reload: '重新載入'
    },
    bootProgress: {
      waitingToStartBackend: appName => `正在等待 ${appName} 後端啟動`,
      updateFinishing: appName => `更新正在完成，${appName} 將在完成後自動啟動…`,
      usingBackend: label => `正在使用 ${label}`,
      runtimeReady: appName => `${appName} 執行階段已就緒`,
      resolvingBackend: appName => `正在解析 ${appName} 後端`,
      connectingRemoteBackend: (appName, url) => `正在連線遠端 ${appName} 後端：${url}`,
      remoteBackendReady: appName => `遠端 ${appName} 後端已就緒`,
      resolvingRuntime: appName => `正在解析 ${appName} 執行階段`,
      startingBackendVia: (appName, label) => `正在透過 ${label} 啟動 ${appName} 後端`,
      waitingBackendLaunch: appName => `正在等待 ${appName} 後端啟動`,
      waitingBackendReady: appName => `正在等待 ${appName} 後端就緒`,
      backendReadyFinalizing: appName => `${appName} 後端已就緒，正在完成桌面啟動`,
      waitingForSetup: '正在等待首次設定選擇',
      waitingForSetupAfterSeconds: seconds => `首次設定選擇仍未完成，已等待 ${seconds} 秒`,
      restartingConnection: '正在重新啟動桌面連線'
    }
  },
  ja: {
    about: appName => `${appName} について`,
    addContext: 'コンテキストを追加',
    allFiles: 'すべてのファイル',
    actualSize: '実際のサイズ',
    checkForUpdates: 'アップデートを確認…',
    chooseDefaultProjectDirectory: 'デフォルトのプロジェクトディレクトリを選択',
    connectingCloudAgent: 'Nous Cloud エージェントに接続中…',
    close: '閉じる',
    copy: 'コピー',
    cut: '切り取り',
    delete: '削除',
    edit: '編集',
    file: 'ファイル',
    forceReload: '強制再読み込み',
    front: 'すべてを手前に移動',
    help: 'ヘルプ',
    hide: appName => `${appName} を隠す`,
    hideOthers: 'ほかを隠す',
    images: '画像',
    minimize: '最小化',
    newWindow: '新しいウィンドウ',
    openFolder: 'フォルダを開く…',
    paste: '貼り付け',
    pasteAndMatchStyle: 'スタイルを合わせて貼り付け',
    quit: appName => `${appName} を終了`,
    quitAnyway: '終了する',
    quitKeepRunning: '実行を続ける',
    quitMore: count => `• ${count} 件以上`,
    quitWarning: '終了するとエージェントの処理が中断され、書き込みが完了していない作業は失われます。',
    quitWorking: (appName, count) => `${appName} は ${count} 件のチャットを処理中です。`,
    redo: 'やり直す',
    reload: '再読み込み',
    save: '保存',
    saveFile: 'ファイルを保存',
    saveImage: '画像を保存',
    selectAll: 'すべてを選択',
    services: 'サービス',
    signInCloud: 'Nous Cloud にサインイン',
    signInGateway: appName => `${appName} ゲートウェイにサインイン`,
    toggleDeveloperTools: '開発者ツールを切り替え',
    toggleFullscreen: 'フルスクリーンを切り替え',
    unhide: 'すべてを表示',
    undo: '取り消す',
    updateFailedTitle: appName => `${appName} の更新を完了できませんでした`,
    updateNeedsStep: '更新は完了しましたが、もう一つ手順が必要です',
    updateTitle: appName => `${appName} の更新`,
    view: '表示',
    window: 'ウィンドウ',
    renewingCloudSession: 'Nous Cloud セッションを更新中…',
    zoom: 'ズーム',
    zoomIn: '拡大',
    zoomOut: '縮小',
    rendererLoadError: {
      title: appName => `${appName} デスクトップ UI を起動できませんでした`,
      defaultDescription: 'デスクトップ renderer の読み込みに失敗しました。',
      repeatedFailureDescription: '更新後、デスクトップ renderer の読み込みに繰り返し失敗しました。',
      incompleteDescription: count =>
        `前回の更新後、デスクトップ renderer バンドルが不完全です（不足ファイル ${count} 個）。`,
      missingAssets: (total, shown) =>
        `renderer バンドルにモジュールファイルが ${total} 個ありません（先頭 ${shown} 個を表示）— 前回の更新時にファイルがロックされていました。`,
      repairWith: '修復方法：',
      persistentPrefix: '問題が続く場合は',
      persistentMiddle: 'を実行して',
      persistentSuffix: 'からアプリを再起動してください。',
      reload: '再読み込み'
    },
    bootProgress: {
      waitingToStartBackend: appName => `${appName} バックエンドの起動を待機中`,
      updateFinishing: appName => `更新を完了中 — ${appName} は完了後に自動的に起動します…`,
      usingBackend: label => `${label} を使用中`,
      runtimeReady: appName => `${appName} ランタイムの準備ができました`,
      resolvingBackend: appName => `${appName} バックエンドを解決中`,
      connectingRemoteBackend: (appName, url) => `リモート ${appName} バックエンド（${url}）に接続中`,
      remoteBackendReady: appName => `リモート ${appName} バックエンドの準備ができました`,
      resolvingRuntime: appName => `${appName} ランタイムを解決中`,
      startingBackendVia: (appName, label) => `${label} 経由で ${appName} バックエンドを起動中`,
      waitingBackendLaunch: appName => `${appName} バックエンドの起動を待機中`,
      waitingBackendReady: appName => `${appName} バックエンドの準備を待機中`,
      backendReadyFinalizing: appName => `${appName} バックエンドの準備ができました。デスクトップ起動を完了中`,
      waitingForSetup: '初回セットアップの選択を待機中',
      waitingForSetupAfterSeconds: seconds => `初回セットアップの選択を ${seconds} 秒待機中`,
      restartingConnection: 'デスクトップ接続を再起動中'
    }
  },
  ar: {
    about: appName => `حول ${appName}`,
    addContext: 'إضافة سياق',
    allFiles: 'كل الملفات',
    actualSize: 'الحجم الفعلي',
    checkForUpdates: 'التحقق من وجود تحديثات…',
    chooseDefaultProjectDirectory: 'اختيار مجلد المشروع الافتراضي',
    connectingCloudAgent: 'جارٍ الاتصال بعامل Nous Cloud…',
    close: 'إغلاق',
    copy: 'نسخ',
    cut: 'قص',
    delete: 'حذف',
    edit: 'تحرير',
    file: 'ملف',
    forceReload: 'إعادة تحميل قسرية',
    front: 'إحضار الكل إلى المقدمة',
    help: 'مساعدة',
    hide: appName => `إخفاء ${appName}`,
    hideOthers: 'إخفاء الآخرين',
    images: 'الصور',
    minimize: 'تصغير',
    newWindow: 'نافذة جديدة',
    openFolder: 'فتح مجلد…',
    paste: 'لصق',
    pasteAndMatchStyle: 'لصق ومطابقة النمط',
    quit: appName => `إنهاء ${appName}`,
    quitAnyway: 'إنهاء على أي حال',
    quitKeepRunning: 'متابعة التشغيل',
    quitMore: count => `• ${count} إضافية`,
    quitWarning: 'سيؤدي الإنهاء إلى إيقاف دور الوكيل الحالي، وستُفقد أي أعمال لم تكتمل كتابتها.',
    quitWorking: (appName, count) => `لا يزال ${appName} يعالج ${count} من المحادثات.`,
    redo: 'إعادة',
    reload: 'إعادة تحميل',
    save: 'حفظ',
    saveFile: 'حفظ الملف',
    saveImage: 'حفظ الصورة',
    selectAll: 'تحديد الكل',
    services: 'الخدمات',
    signInCloud: 'تسجيل الدخول إلى Nous Cloud',
    signInGateway: appName => `تسجيل الدخول إلى بوابة ${appName}`,
    toggleDeveloperTools: 'تبديل أدوات المطور',
    toggleFullscreen: 'تبديل ملء الشاشة',
    unhide: 'إظهار الكل',
    undo: 'تراجع',
    updateFailedTitle: appName => `تعذر إكمال تحديث ${appName}`,
    updateNeedsStep: 'اكتمل التحديث، لكن يلزم تنفيذ خطوة أخرى',
    updateTitle: appName => `تحديث ${appName}`,
    view: 'عرض',
    window: 'نافذة',
    renewingCloudSession: 'جارٍ تجديد جلسة Nous Cloud…',
    zoom: 'تكبير',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    rendererLoadError: {
      title: appName => `تعذر تشغيل واجهة سطح المكتب في ${appName}`,
      defaultDescription: 'تعذر تحميل واجهة سطح المكتب.',
      repeatedFailureDescription: 'تعذر تحميل واجهة سطح المكتب بشكل متكرر بعد التحديث.',
      incompleteDescription: count =>
        `حزمة واجهة سطح المكتب غير مكتملة بعد التحديث الأخير (الملفات المفقودة: ${count}).`,
      missingAssets: (total, shown) =>
        `تفتقد حزمة الواجهة ${total} من ملفات الوحدات (يُعرض أول ${shown}) — استبدل التحديث الأخير التطبيق بينما كانت ملفاته مقفلة.`,
      repairWith: 'طريقة الإصلاح:',
      persistentPrefix: 'إذا استمرت المشكلة، فتحقق من',
      persistentMiddle: 'وجرب',
      persistentSuffix: 'ثم أعد تشغيل التطبيق.',
      reload: 'إعادة تحميل'
    },
    bootProgress: {
      waitingToStartBackend: appName => `في انتظار بدء بوابة ${appName} الخلفية`,
      updateFinishing: appName => `جارٍ إنهاء التحديث — سيبدأ ${appName} تلقائيًا عند اكتماله…`,
      usingBackend: label => `جارٍ استخدام ${label}`,
      runtimeReady: appName => `أصبح وقت تشغيل ${appName} جاهزًا`,
      resolvingBackend: appName => `جارٍ تحديد بوابة ${appName} الخلفية`,
      connectingRemoteBackend: (appName, url) => `جارٍ الاتصال ببوابة ${appName} الخلفية البعيدة على ${url}`,
      remoteBackendReady: appName => `البوابة الخلفية البعيدة لـ ${appName} جاهزة`,
      resolvingRuntime: appName => `جارٍ تحديد وقت تشغيل ${appName}`,
      startingBackendVia: (appName, label) => `جارٍ بدء بوابة ${appName} الخلفية عبر ${label}`,
      waitingBackendLaunch: appName => `في انتظار بدء بوابة ${appName} الخلفية`,
      waitingBackendReady: appName => `في انتظار جاهزية بوابة ${appName} الخلفية`,
      backendReadyFinalizing: appName => `بوابة ${appName} الخلفية جاهزة. جارٍ إكمال بدء تشغيل سطح المكتب`,
      waitingForSetup: 'في انتظار اختيار الإعداد الأولي',
      waitingForSetupAfterSeconds: seconds => `لا يزال في انتظار اختيار الإعداد الأولي بعد ${seconds} ثوانٍ`,
      restartingConnection: 'جارٍ إعادة تشغيل اتصال سطح المكتب'
    }
  }
}

const LOCALE_ALIASES: Record<string, NativeLocale> = {
  ar: 'ar',
  'ar-ae': 'ar',
  'ar-eg': 'ar',
  'ar-sa': 'ar',
  arabic: 'ar',
  العربية: 'ar',
  en: 'en',
  'en-us': 'en',
  ja: 'ja',
  'ja-jp': 'ja',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-hans-cn': 'zh',
  'zh-hant': 'zh-hant',
  'zh-hant-hk': 'zh-hant',
  'zh-hant-tw': 'zh-hant',
  'zh-hk': 'zh-hant',
  'zh-mo': 'zh-hant',
  'zh-tw': 'zh-hant'
}

/** Normalize persisted display-language values and OS locale tags. */
export function normalizeNativeLocale(value: unknown): NativeLocale {
  if (typeof value !== 'string') {
    return DEFAULT_NATIVE_LOCALE
  }

  const normalized = value.trim().toLowerCase().replaceAll('_', '-')

  return LOCALE_ALIASES[normalized] ?? DEFAULT_NATIVE_LOCALE
}

export function nativeLocaleCopy(value: unknown): NativeLocaleCopy {
  return COPY[normalizeNativeLocale(value)]
}

/** Exposed for contract tests and future locale additions. */
export const NATIVE_LOCALES = Object.freeze(Object.keys(COPY) as NativeLocale[])
