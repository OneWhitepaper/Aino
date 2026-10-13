import type { TranslationOverrides } from './define-locale'

export const zhHantCommon = {
  common: {
    apply: '套用',
    back: '返回',
    save: '儲存',
    saving: '儲存中…',
    cancel: '取消',
    change: '變更',
    choose: '選擇',
    clear: '清除',
    close: '關閉',
    collapse: '收合',
    confirm: '確認',
    connect: '連線',
    connecting: '連線中',
    continue: '繼續',
    bots: '機器人',
    copied: '已複製',
    copy: '複製',
    copyFailed: '複製失敗',
    delete: '刪除',
    docs: '文件',
    done: '完成',
    error: '錯誤',
    expand: '展開',
    failed: '失敗',
    formatJson: '格式化 JSON',
    free: '免費',
    loading: '載入中…',
    notSet: '未設定',
    refresh: '重新整理',
    remove: '移除',
    replace: '取代',
    retry: '重試',
    run: '執行',
    send: '傳送',
    set: '設定',
    skip: '略過',
    update: '更新',
    tryHint: term => `試試「${term}」`,
    on: '開啟',
    off: '關閉',
    actions: '動作'
  },

  billingBlock: {
    titleNous: 'Nous 額度已用盡',
    titleProvider: provider => `額度已用盡 — ${provider}`,
    fallbackMessage: '您的帳戶額度已用盡。請儲值以繼續使用。',
    openBilling: '開啟帳單',
    addCredits: '新增額度',
    dismiss: '忽略'
  },

  ui: {
    search: {
      clear: '清除搜尋'
    },
    logs: {
      bottom: '記錄底端',
      search: '搜尋記錄…',
      top: '記錄頂端'
    },
    pagination: {
      label: '分頁',
      previous: '上一頁',
      previousAria: '前往上一頁',
      next: '下一頁',
      nextAria: '前往下一頁'
    },
    sidebar: {
      title: '側邊欄',
      description: '顯示行動裝置側邊欄。',
      toggle: open => `${open ? '顯示' : '隱藏'}側邊欄`
    },
    actions: {
      addContext: '新增上下文',
      filters: '篩選',
      grouping: '分組',
      ordering: '排序',
      show: '顯示',
      inboxStyle: '收件匣樣式',
      status: '狀態',
      pullRequest: '提取要求',
      profile: '設定檔',
      project: '專案',
      archived: '已封存',
      resetDefaults: '還原預設值',
      expandAll: '全部展開',
      collapseAll: '全部收合',
      markAllRead: '全部標示為已讀',
      labels: {
        updated: '更新時間',
        project: '專案',
        status: '狀態',
        profile: '設定檔',
        created: '建立時間',
        tokens: 'Token 數',
        cost: '費用',
        manual: '手動',
        preview: '預覽',
        pr: 'PR',
        open: '開啟',
        draft: '草稿',
        merged: '已合併',
        closed: '已關閉',
        noPr: '無 PR',
        needsInput: '需要輸入',
        working: '工作中',
        unread: '未讀',
        idle: '閒置',
        cardRows: '收件匣樣式',
        archived: '已封存'
      }
    },

    accessibility: {
      showOptions: '顯示選項',
      removeReference: '移除參考圖片',
      referenceImage: '參考圖片',
      generatedImage: '產生的圖片',
      youtubeEmbed: 'YouTube 嵌入',
      spotifyEmbed: 'Spotify 嵌入',
      conversationTimeline: '對話時間軸',
      holdToZoom: '按住 ⌘ 進行縮放',
      moreActions: '更多操作',
      openFullView: '開啟完整檢視',
      openDiagram: '開啟圖表',
      zoomOut: '縮小',
      resetZoom: '重設縮放',
      zoomIn: '放大',
      copy: '複製',
      copied: '已複製',
      close: '關閉'
    },

    messages: {
      embedLoadFailed: label => `無法載入 ${label} 嵌入內容`,
      noPageAt: path => `${path} 沒有對應頁面`
    },

    routes: {
      artifacts: '成品',
      messaging: '訊息平台',
      capabilities: '功能'
    }
  }
} satisfies Pick<TranslationOverrides, 'common' | 'billingBlock' | 'ui'>
