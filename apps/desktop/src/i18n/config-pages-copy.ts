import type { BundledLocale } from './types'
import type { ConfigPagesCopy } from './types_config_pages'

export const pageCopy: Record<BundledLocale, Omit<ConfigPagesCopy, 'fields'>> = {
  en: {
    intros: {
      chat: 'Adjust reply style, reasoning display and image handling.',
      safety: 'Manage operation approvals, privacy, file snapshots and saved credentials.',
      browser: 'Choose browser identity and how local websites are reached.',
      memory: 'Manage lasting memory and how long conversations fit within context.',
      voice: 'Set up voice conversations, speech recognition and speech synthesis.',
      advanced: 'Adjust desktop behavior, execution, tool credentials and output limits.'
    },
    tabs: {
      chatReply: 'Replies & display',
      chatAttachments: 'Images & attachments',
      safetyApprovals: 'Execution approvals',
      safetyPrivacy: 'Privacy & access',
      safetyCheckpoints: 'File snapshots',
      safetyVault: 'Passwords & sign-ins',
      browserProfile: 'Browser identity',
      browserNetwork: 'Local & private URLs',
      memoryPersistent: 'Long-term memory',
      memoryContext: 'Context organization',
      voiceConversation: 'Voice conversation',
      voiceTranscription: 'Speech to text',
      voiceSpeech: 'Text to speech',
      advancedDesktop: 'Desktop & startup',
      advancedRuntime: 'Runtime & execution',
      advancedOutput: 'Output & snapshots',
      advancedKeys: 'Tools & credentials'
    },
    sections: {
      reply: 'Reply preferences',
      preferences: 'Answer preferences',
      images: 'Image understanding',
      attachments: 'Attachment size',
      approvals: 'Confirm before acting',
      privacy: 'Privacy protection',
      metrics: 'Usage statistics',
      checkpoints: 'File recovery points',
      vault: 'Passwords & sign-ins',
      browserIdentity: 'Use existing sign-ins',
      browserNetwork: 'Local network access',
      persistent: 'Built-in memory',
      externalMemory: 'External memory services',
      context: 'Context engine',
      compression: 'Automatic compression',
      voiceConversation: 'Conversation mode',
      voiceEntry: 'Desktop voice entry points',
      transcription: 'Recognition settings',
      speech: 'Speech settings',
      desktop: 'Desktop behavior',
      startup: 'Shortcuts & startup',
      runtime: 'Agent runtime',
      connections: 'Runtime connections',
      tools: 'Tools & commands',
      terminal: 'Command environment',
      output: 'Tool output',
      credentials: 'Service credentials'
    },
    units: {
      seconds: 'seconds',
      minutes: 'minutes',
      megabytes: 'MB',
      bytes: 'bytes',
      characters: 'characters',
      messages: 'messages',
      snapshots: 'snapshots',
      turns: 'turns',
      retries: 'retries',
      percent: '%',
      lines: 'lines',
      connections: 'connections',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'Ask each time',
          description: 'Ask for your approval before operations that require it.'
        },
        smart: {
          label: 'Assess automatically',
          description: 'Use the existing risk assessment to decide when confirmation is needed.'
        },
        off: {
          label: 'Do not request approval',
          description: 'Skip command approval prompts. Existing tool permissions and system restrictions still apply.'
        }
      },
      images: {
        auto: {
          label: 'Choose automatically',
          description: 'Choose a suitable image path based on model capabilities.'
        },
        native: {
          label: 'Send the image directly',
          description: 'Send the original image to a model that supports visual input.'
        },
        text: {
          label: 'Convert to a description',
          description:
            'Use the existing image-processing service to describe the image before sending text to the model.'
        }
      },
      voice: {
        chained: {
          label: 'Step-by-step voice',
          description: 'Recognize speech, get an answer and synthesize speech in separate steps.'
        },
        'gpt-live': {
          label: 'Real-time voice',
          description:
            'Use the existing GPT Live voice connection; Aino still handles requests with the selected model and tools.'
        }
      }
    },
    invalidNumber: 'Enter a valid number.',
    listPlaceholder: 'One item per line; commas also separate items.',
    percentPrecise: 'Exact percentage'
  },
  zh: {
    intros: {
      chat: '调整回答的表达方式、思考显示与图片处理。',
      safety: '管理执行审批、隐私保护、文件快照与已保存的凭据。',
      browser: '选择浏览器身份，并管理本地网站的访问方式。',
      memory: '管理跨会话记忆，并控制长对话如何整理上下文。',
      voice: '设置语音对话、语音转文字与文字转语音。',
      advanced: '调整桌面行为、运行方式、工具凭据与输出限制。'
    },
    tabs: {
      chatReply: '回复与显示',
      chatAttachments: '图片与附件',
      safetyApprovals: '执行审批',
      safetyPrivacy: '隐私与访问',
      safetyCheckpoints: '文件快照',
      safetyVault: '密码与登录',
      browserProfile: '浏览器身份',
      browserNetwork: '本地与私有网址',
      memoryPersistent: '长期记忆',
      memoryContext: '上下文整理',
      voiceConversation: '语音对话',
      voiceTranscription: '语音转文字',
      voiceSpeech: '文字转语音',
      advancedDesktop: '桌面与启动',
      advancedRuntime: '运行与执行',
      advancedOutput: '输出与快照',
      advancedKeys: '工具与密钥'
    },
    sections: {
      reply: '回答偏好',
      preferences: '回答偏好',
      images: '图片理解',
      attachments: '附件大小',
      approvals: '操作前如何确认',
      privacy: '隐私保护',
      metrics: '使用统计',
      checkpoints: '操作前保留恢复点',
      vault: '密码与登录',
      browserIdentity: '使用已有登录状态',
      browserNetwork: '本地网络访问',
      persistent: '内置长期记忆',
      externalMemory: '外部记忆服务',
      context: '上下文引擎',
      compression: '自动压缩',
      voiceConversation: '对话方式',
      voiceEntry: '桌面语音入口',
      transcription: '识别设置',
      speech: '合成设置',
      desktop: '桌面行为',
      startup: '快捷入口与启动',
      runtime: '模型运行',
      connections: '运行服务资源',
      tools: '工具与命令',
      terminal: '命令运行环境',
      output: '工具返回内容',
      credentials: '服务凭据'
    },
    units: {
      seconds: '秒',
      minutes: '分钟',
      megabytes: 'MB',
      bytes: '字节',
      characters: '字符',
      messages: '条消息',
      snapshots: '份快照',
      turns: '轮',
      retries: '次',
      percent: '%',
      lines: '行',
      connections: '个连接',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '倍'
    },
    modes: {
      approvals: {
        manual: {
          label: '每次询问',
          description: '需要审批的操作先征求你的同意，再继续执行。'
        },
        smart: {
          label: '智能判断',
          description: '沿用现有风险判断规则，对需要确认的操作请求批准。'
        },
        off: {
          label: '不请求批准',
          description: '跳过命令审批。工具权限、系统权限及原有安全限制仍然有效。'
        }
      },
      images: {
        auto: {
          label: '自动选择',
          description: '根据模型能力选择合适的图片处理方式。'
        },
        native: {
          label: '直接发送图片',
          description: '把原图交给支持视觉输入的模型。'
        },
        text: {
          label: '先转换为文字',
          description: '使用现有图片处理服务生成文字说明，再交给模型。'
        }
      },
      voice: {
        chained: {
          label: '分步语音对话',
          description: '语音转文字、模型回答和语音播放分别处理。'
        },
        'gpt-live': {
          label: '实时语音对话',
          description: '通过现有 GPT Live 连接实时交流，实际请求仍由 Aino 使用已选模型和工具处理。'
        }
      }
    },
    invalidNumber: '请输入有效的数字。',
    listPlaceholder: '每行一项，也可使用逗号分隔。',
    percentPrecise: '精确百分比'
  },
  'zh-hant': {
    intros: {
      chat: '調整回答的表達方式、思考顯示與圖片處理。',
      safety: '管理執行審批、隱私保護、檔案快照與已儲存的憑證。',
      browser: '選擇瀏覽器身分，並管理本機網站的存取方式。',
      memory: '管理跨對話記憶，並控制長對話如何整理上下文。',
      voice: '設定語音對話、語音轉文字與文字轉語音。',
      advanced: '調整桌面行為、執行方式、工具憑證與輸出限制。'
    },
    tabs: {
      chatReply: '回覆與顯示',
      chatAttachments: '圖片與附件',
      safetyApprovals: '執行審批',
      safetyPrivacy: '隱私與存取',
      safetyCheckpoints: '檔案快照',
      safetyVault: '密碼與登入',
      browserProfile: '瀏覽器身分',
      browserNetwork: '本機與私人網址',
      memoryPersistent: '長期記憶',
      memoryContext: '上下文整理',
      voiceConversation: '語音對話',
      voiceTranscription: '語音轉文字',
      voiceSpeech: '文字轉語音',
      advancedDesktop: '桌面與啟動',
      advancedRuntime: '執行與環境',
      advancedOutput: '輸出與快照',
      advancedKeys: '工具與金鑰'
    },
    sections: {
      reply: '回答偏好',
      preferences: '回答偏好',
      images: '圖片理解',
      attachments: '附件大小',
      approvals: '操作前如何確認',
      privacy: '隱私保護',
      metrics: '使用統計',
      checkpoints: '操作前保留還原點',
      vault: '密碼與登入',
      browserIdentity: '使用既有登入狀態',
      browserNetwork: '本機網路存取',
      persistent: '內建長期記憶',
      externalMemory: '外部記憶服務',
      context: '上下文引擎',
      compression: '自動壓縮',
      voiceConversation: '對話方式',
      voiceEntry: '桌面語音入口',
      transcription: '辨識設定',
      speech: '合成設定',
      desktop: '桌面行為',
      startup: '快捷入口與啟動',
      runtime: '模型執行',
      connections: '執行服務資源',
      tools: '工具與指令',
      terminal: '指令執行環境',
      output: '工具回傳內容',
      credentials: '服務憑證'
    },
    units: {
      seconds: '秒',
      minutes: '分鐘',
      megabytes: 'MB',
      bytes: '位元組',
      characters: '字元',
      messages: '則訊息',
      snapshots: '份快照',
      turns: '輪',
      retries: '次',
      percent: '%',
      lines: '行',
      connections: '個連線',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '倍'
    },
    modes: {
      approvals: {
        manual: {
          label: '每次詢問',
          description: '需要審批的操作先徵求你的同意，再繼續執行。'
        },
        smart: {
          label: '智慧判斷',
          description: '沿用既有風險判斷規則，對需要確認的操作請求批准。'
        },
        off: {
          label: '不請求批准',
          description: '略過指令審批。工具權限、系統權限與既有安全限制仍然有效。'
        }
      },
      images: {
        auto: {
          label: '自動選擇',
          description: '根據模型能力選擇合適的圖片處理方式。'
        },
        native: {
          label: '直接傳送圖片',
          description: '將原圖交給支援視覺輸入的模型。'
        },
        text: {
          label: '先轉換為文字',
          description: '使用既有圖片處理服務產生文字說明，再交給模型。'
        }
      },
      voice: {
        chained: {
          label: '分步語音對話',
          description: '語音轉文字、模型回答與語音播放分別處理。'
        },
        'gpt-live': {
          label: '即時語音對話',
          description: '透過既有 GPT Live 連線即時交流，實際請求仍由 Aino 使用所選模型與工具處理。'
        }
      }
    },
    invalidNumber: '請輸入有效的數字。',
    listPlaceholder: '每行一項，也可使用逗號分隔。',
    percentPrecise: '精確百分比'
  },
  ja: {
    intros: {
      chat: '回答の文体、推論の表示、画像の処理を調整します。',
      safety: '実行の承認、プライバシー、ファイルの復元点、保存した認証情報を管理します。',
      browser: 'ブラウザーの利用者情報とローカルサイトへのアクセス方法を選びます。',
      memory: '会話をまたぐ記憶と長い会話のコンテキスト整理を管理します。',
      voice: '音声対話、文字起こし、音声合成を設定します。',
      advanced: 'デスクトップ動作、実行環境、ツールの認証情報、出力制限を調整します。'
    },
    tabs: {
      chatReply: '回答と表示',
      chatAttachments: '画像と添付',
      safetyApprovals: '実行の承認',
      safetyPrivacy: 'プライバシーとアクセス',
      safetyCheckpoints: 'ファイルの復元点',
      safetyVault: 'パスワードとログイン',
      browserProfile: 'ブラウザーの利用者情報',
      browserNetwork: 'ローカルとプライベートURL',
      memoryPersistent: '長期記憶',
      memoryContext: 'コンテキスト整理',
      voiceConversation: '音声対話',
      voiceTranscription: '音声から文字へ',
      voiceSpeech: '文字から音声へ',
      advancedDesktop: 'デスクトップと起動',
      advancedRuntime: '実行と環境',
      advancedOutput: '出力と復元点',
      advancedKeys: 'ツールと認証情報'
    },
    sections: {
      reply: '回答の設定',
      preferences: '回答の好み',
      images: '画像の理解',
      attachments: '添付サイズ',
      approvals: '操作前の確認',
      privacy: 'プライバシー保護',
      metrics: '利用統計',
      checkpoints: 'ファイルの復元点',
      vault: 'パスワードとログイン',
      browserIdentity: '既存のログイン状態を使用',
      browserNetwork: 'ローカルネットワーク',
      persistent: '内蔵の長期記憶',
      externalMemory: '外部記憶サービス',
      context: 'コンテキストエンジン',
      compression: '自動圧縮',
      voiceConversation: '対話方式',
      voiceEntry: 'デスクトップの音声操作',
      transcription: '認識設定',
      speech: '音声合成の設定',
      desktop: 'デスクトップ動作',
      startup: 'ショートカットと起動',
      runtime: 'エージェントの実行',
      connections: '接続リソース',
      tools: 'ツールとコマンド',
      terminal: 'コマンド実行環境',
      output: 'ツール出力',
      credentials: 'サービスの認証情報'
    },
    units: {
      seconds: '秒',
      minutes: '分',
      megabytes: 'MB',
      bytes: 'バイト',
      characters: '文字',
      messages: 'メッセージ',
      snapshots: '復元点',
      turns: 'ターン',
      retries: '回',
      percent: '%',
      lines: '行',
      connections: '接続',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '倍'
    },
    modes: {
      approvals: {
        manual: {
          label: '毎回確認',
          description: '承認が必要な操作を実行する前に確認します。'
        },
        smart: {
          label: '自動で判断',
          description: '既存のリスク判定に従い、必要な操作の確認を求めます。'
        },
        off: {
          label: '承認を求めない',
          description: 'コマンドの承認を省略します。ツールの権限とシステムの制限は引き続き適用されます。'
        }
      },
      images: {
        auto: {
          label: '自動で選択',
          description: 'モデルの能力に応じた画像処理方法を選びます。'
        },
        native: {
          label: '画像を直接送信',
          description: '視覚入力に対応したモデルへ元画像を送ります。'
        },
        text: {
          label: '説明文に変換',
          description: '既存の画像処理サービスで説明文を作成してモデルへ送ります。'
        }
      },
      voice: {
        chained: {
          label: '段階式の音声対話',
          description: '文字起こし、モデルの回答、音声合成を別々に処理します。'
        },
        'gpt-live': {
          label: 'リアルタイム音声',
          description: '既存の GPT Live 接続で対話し、実際の依頼は Aino が選択中のモデルとツールで処理します。'
        }
      }
    },
    invalidNumber: '有効な数値を入力してください。',
    listPlaceholder: '1行に1項目。カンマでも区切れます。',
    percentPrecise: '正確なパーセント'
  },
  ar: {
    intros: {
      chat: 'اضبط أسلوب الرد وعرض التفكير ومعالجة الصور.',
      safety: 'أدر الموافقات والخصوصية ولقطات الملفات وبيانات الدخول المحفوظة.',
      browser: 'اختر هوية المتصفح وطريقة الوصول إلى المواقع المحلية.',
      memory: 'أدر الذاكرة بين المحادثات وتنظيم سياق المحادثات الطويلة.',
      voice: 'اضبط المحادثة الصوتية والتعرف على الكلام وتوليد الصوت.',
      advanced: 'اضبط سلوك سطح المكتب وبيئة التنفيذ وبيانات الأدوات وحدود المخرجات.'
    },
    tabs: {
      chatReply: 'الرد والعرض',
      chatAttachments: 'الصور والمرفقات',
      safetyApprovals: 'موافقات التنفيذ',
      safetyPrivacy: 'الخصوصية والوصول',
      safetyCheckpoints: 'لقطات الملفات',
      safetyVault: 'كلمات المرور والدخول',
      browserProfile: 'هوية المتصفح',
      browserNetwork: 'العناوين المحلية والخاصة',
      memoryPersistent: 'الذاكرة طويلة المدى',
      memoryContext: 'تنظيم السياق',
      voiceConversation: 'المحادثة الصوتية',
      voiceTranscription: 'تحويل الكلام إلى نص',
      voiceSpeech: 'تحويل النص إلى كلام',
      advancedDesktop: 'سطح المكتب وبدء التشغيل',
      advancedRuntime: 'التشغيل والتنفيذ',
      advancedOutput: 'المخرجات واللقطات',
      advancedKeys: 'الأدوات وبيانات الدخول'
    },
    sections: {
      reply: 'تفضيلات الرد',
      preferences: 'تفضيلات الإجابة',
      images: 'فهم الصور',
      attachments: 'حجم المرفقات',
      approvals: 'التأكيد قبل التنفيذ',
      privacy: 'حماية الخصوصية',
      metrics: 'إحصاءات الاستخدام',
      checkpoints: 'نقاط استعادة الملفات',
      vault: 'كلمات المرور والدخول',
      browserIdentity: 'استخدام جلسات الدخول الحالية',
      browserNetwork: 'الوصول إلى الشبكة المحلية',
      persistent: 'الذاكرة المدمجة',
      externalMemory: 'خدمات الذاكرة الخارجية',
      context: 'محرك السياق',
      compression: 'الضغط التلقائي',
      voiceConversation: 'أسلوب المحادثة',
      voiceEntry: 'مداخل الصوت في سطح المكتب',
      transcription: 'إعدادات التعرف',
      speech: 'إعدادات توليد الصوت',
      desktop: 'سلوك سطح المكتب',
      startup: 'الاختصارات وبدء التشغيل',
      runtime: 'تشغيل الوكيل',
      connections: 'موارد الاتصالات',
      tools: 'الأدوات والأوامر',
      terminal: 'بيئة الأوامر',
      output: 'مخرجات الأدوات',
      credentials: 'بيانات دخول الخدمات'
    },
    units: {
      seconds: 'ثانية',
      minutes: 'دقيقة',
      megabytes: 'MB',
      bytes: 'بايت',
      characters: 'حرف',
      messages: 'رسالة',
      snapshots: 'لقطة',
      turns: 'دورة',
      retries: 'محاولة',
      percent: '%',
      lines: 'سطر',
      connections: 'اتصال',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'السؤال كل مرة',
          description: 'اطلب موافقتك قبل العمليات التي تتطلبها.'
        },
        smart: {
          label: 'التقييم التلقائي',
          description: 'استخدم تقييم المخاطر الحالي لتحديد العمليات التي تحتاج إلى تأكيد.'
        },
        off: {
          label: 'عدم طلب الموافقة',
          description: 'تجاوز موافقات الأوامر. تظل صلاحيات الأدوات وقيود النظام الحالية سارية.'
        }
      },
      images: {
        auto: {
          label: 'الاختيار التلقائي',
          description: 'اختر مسار معالجة الصورة وفق قدرات النموذج.'
        },
        native: {
          label: 'إرسال الصورة مباشرة',
          description: 'أرسل الصورة الأصلية إلى نموذج يدعم الرؤية.'
        },
        text: {
          label: 'التحويل إلى وصف',
          description: 'استخدم خدمة الصور الحالية لإنشاء وصف نصي ثم أرسله إلى النموذج.'
        }
      },
      voice: {
        chained: {
          label: 'محادثة صوتية على مراحل',
          description: 'عالج التعرف على الكلام والإجابة وتوليد الصوت كلًا على حدة.'
        },
        'gpt-live': {
          label: 'صوت في الوقت الحقيقي',
          description: 'استخدم اتصال GPT Live الحالي؛ يواصل Aino معالجة الطلبات بالنموذج والأدوات المحددة.'
        }
      }
    },
    invalidNumber: 'أدخل رقمًا صالحًا.',
    listPlaceholder: 'عنصر واحد في كل سطر؛ يمكن الفصل بفاصلة أيضًا.',
    percentPrecise: 'النسبة المئوية الدقيقة'
  },
  fr: {
    intros: {
      chat: 'Réglez le style des réponses, le raisonnement affiché et le traitement des images.',
      safety: 'Gérez les approbations, la confidentialité, les instantanés et les identifiants enregistrés.',
      browser: 'Choisissez l’identité du navigateur et l’accès aux sites locaux.',
      memory: 'Gérez la mémoire durable et l’organisation du contexte des longues conversations.',
      voice: 'Configurez les conversations vocales, la transcription et la synthèse vocale.',
      advanced: 'Réglez le bureau, l’exécution, les identifiants des outils et les limites de sortie.'
    },
    tabs: {
      chatReply: 'Réponses et affichage',
      chatAttachments: 'Images et pièces jointes',
      safetyApprovals: 'Approbations',
      safetyPrivacy: 'Confidentialité et accès',
      safetyCheckpoints: 'Instantanés de fichiers',
      safetyVault: 'Mots de passe et connexions',
      browserProfile: 'Identité du navigateur',
      browserNetwork: 'URL locales et privées',
      memoryPersistent: 'Mémoire à long terme',
      memoryContext: 'Organisation du contexte',
      voiceConversation: 'Conversation vocale',
      voiceTranscription: 'Parole en texte',
      voiceSpeech: 'Texte en parole',
      advancedDesktop: 'Bureau et démarrage',
      advancedRuntime: 'Exécution et environnement',
      advancedOutput: 'Sorties et instantanés',
      advancedKeys: 'Outils et identifiants'
    },
    sections: {
      reply: 'Préférences de réponse',
      preferences: 'Préférences des réponses',
      images: 'Compréhension des images',
      attachments: 'Taille des pièces jointes',
      approvals: 'Confirmer avant d’agir',
      privacy: 'Protection de la confidentialité',
      metrics: 'Statistiques d’utilisation',
      checkpoints: 'Points de restauration',
      vault: 'Mots de passe et connexions',
      browserIdentity: 'Utiliser les connexions existantes',
      browserNetwork: 'Accès au réseau local',
      persistent: 'Mémoire intégrée',
      externalMemory: 'Services de mémoire externes',
      context: 'Moteur de contexte',
      compression: 'Compression automatique',
      voiceConversation: 'Mode de conversation',
      voiceEntry: 'Commandes vocales du bureau',
      transcription: 'Paramètres de reconnaissance',
      speech: 'Paramètres de synthèse',
      desktop: 'Comportement du bureau',
      startup: 'Raccourcis et démarrage',
      runtime: 'Exécution de l’agent',
      connections: 'Ressources des connexions',
      tools: 'Outils et commandes',
      terminal: 'Environnement des commandes',
      output: 'Sorties des outils',
      credentials: 'Identifiants des services'
    },
    units: {
      seconds: 'secondes',
      minutes: 'minutes',
      megabytes: 'MB',
      bytes: 'octets',
      characters: 'caractères',
      messages: 'messages',
      snapshots: 'instantanés',
      turns: 'tours',
      retries: 'tentatives',
      percent: '%',
      lines: 'lignes',
      connections: 'connexions',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'Demander à chaque fois',
          description: 'Demander votre accord avant toute opération qui le requiert.'
        },
        smart: {
          label: 'Évaluer automatiquement',
          description: 'Utiliser l’évaluation des risques existante pour décider quand demander confirmation.'
        },
        off: {
          label: 'Ne pas demander',
          description:
            'Ignorer l’approbation des commandes. Les permissions des outils et les restrictions du système restent actives.'
        }
      },
      images: {
        auto: {
          label: 'Choisir automatiquement',
          description: 'Choisir le traitement adapté aux capacités du modèle.'
        },
        native: {
          label: 'Envoyer l’image directement',
          description: 'Envoyer l’image originale à un modèle acceptant les images.'
        },
        text: {
          label: 'Convertir en description',
          description: 'Créer une description avec le service d’image existant, puis l’envoyer au modèle.'
        }
      },
      voice: {
        chained: {
          label: 'Voix par étapes',
          description: 'Traiter séparément la reconnaissance, la réponse et la synthèse vocale.'
        },
        'gpt-live': {
          label: 'Voix en temps réel',
          description:
            'Utiliser la connexion GPT Live existante ; Aino traite les demandes avec le modèle et les outils choisis.'
        }
      }
    },
    invalidNumber: 'Saisissez un nombre valide.',
    listPlaceholder: 'Un élément par ligne ; les virgules séparent aussi les éléments.',
    percentPrecise: 'Pourcentage exact'
  },
  de: {
    intros: {
      chat: 'Antwortstil, Denkprozessanzeige und Bildverarbeitung anpassen.',
      safety: 'Freigaben, Datenschutz, Dateisicherungen und gespeicherte Zugangsdaten verwalten.',
      browser: 'Browseridentität und Zugriff auf lokale Websites auswählen.',
      memory: 'Dauerhafte Erinnerungen und den Kontext langer Gespräche verwalten.',
      voice: 'Sprachgespräche, Spracherkennung und Sprachausgabe einrichten.',
      advanced: 'Desktopverhalten, Ausführung, Toolzugangsdaten und Ausgabelimits anpassen.'
    },
    tabs: {
      chatReply: 'Antworten und Anzeige',
      chatAttachments: 'Bilder und Anhänge',
      safetyApprovals: 'Ausführungsfreigaben',
      safetyPrivacy: 'Datenschutz und Zugriff',
      safetyCheckpoints: 'Dateisicherungen',
      safetyVault: 'Passwörter und Anmeldungen',
      browserProfile: 'Browseridentität',
      browserNetwork: 'Lokale und private URLs',
      memoryPersistent: 'Langzeitgedächtnis',
      memoryContext: 'Kontextverwaltung',
      voiceConversation: 'Sprachgespräch',
      voiceTranscription: 'Sprache zu Text',
      voiceSpeech: 'Text zu Sprache',
      advancedDesktop: 'Desktop und Start',
      advancedRuntime: 'Laufzeit und Ausführung',
      advancedOutput: 'Ausgabe und Sicherungen',
      advancedKeys: 'Tools und Zugangsdaten'
    },
    sections: {
      reply: 'Antwortpräferenzen',
      preferences: 'Antwortverhalten',
      images: 'Bildverständnis',
      attachments: 'Anhangsgröße',
      approvals: 'Vor Aktionen bestätigen',
      privacy: 'Datenschutz',
      metrics: 'Nutzungsstatistik',
      checkpoints: 'Wiederherstellungspunkte',
      vault: 'Passwörter und Anmeldungen',
      browserIdentity: 'Bestehende Anmeldungen verwenden',
      browserNetwork: 'Lokaler Netzwerkzugriff',
      persistent: 'Integrierte Erinnerung',
      externalMemory: 'Externe Speicherdienste',
      context: 'Kontextmodul',
      compression: 'Automatische Komprimierung',
      voiceConversation: 'Gesprächsmodus',
      voiceEntry: 'Sprachzugänge am Desktop',
      transcription: 'Erkennungseinstellungen',
      speech: 'Sprachausgabe',
      desktop: 'Desktopverhalten',
      startup: 'Kurzbefehle und Start',
      runtime: 'Agentenausführung',
      connections: 'Verbindungsressourcen',
      tools: 'Tools und Befehle',
      terminal: 'Befehlsumgebung',
      output: 'Toolausgabe',
      credentials: 'Dienstzugangsdaten'
    },
    units: {
      seconds: 'Sekunden',
      minutes: 'Minuten',
      megabytes: 'MB',
      bytes: 'Bytes',
      characters: 'Zeichen',
      messages: 'Nachrichten',
      snapshots: 'Sicherungen',
      turns: 'Runden',
      retries: 'Versuche',
      percent: '%',
      lines: 'Zeilen',
      connections: 'Verbindungen',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'Jedes Mal fragen',
          description: 'Vor freigabepflichtigen Vorgängen um Zustimmung bitten.'
        },
        smart: {
          label: 'Automatisch bewerten',
          description: 'Mit der vorhandenen Risikobewertung ermitteln, wann eine Bestätigung nötig ist.'
        },
        off: {
          label: 'Keine Freigabe anfordern',
          description: 'Befehlsfreigaben überspringen. Toolberechtigungen und Systembeschränkungen gelten weiter.'
        }
      },
      images: {
        auto: {
          label: 'Automatisch auswählen',
          description: 'Passende Bildverarbeitung nach den Fähigkeiten des Modells wählen.'
        },
        native: {
          label: 'Bild direkt senden',
          description: 'Das Originalbild an ein Modell mit Bildeingabe senden.'
        },
        text: {
          label: 'In Beschreibung umwandeln',
          description: 'Mit dem vorhandenen Bilddienst eine Beschreibung erstellen und an das Modell senden.'
        }
      },
      voice: {
        chained: {
          label: 'Schrittweise Sprachverarbeitung',
          description: 'Erkennung, Modellantwort und Sprachausgabe getrennt verarbeiten.'
        },
        'gpt-live': {
          label: 'Echtzeit-Sprache',
          description:
            'Die bestehende GPT-Live-Verbindung verwenden; Aino bearbeitet Anfragen mit dem gewählten Modell und den Tools.'
        }
      }
    },
    invalidNumber: 'Geben Sie eine gültige Zahl ein.',
    listPlaceholder: 'Ein Eintrag pro Zeile; auch Kommas trennen Einträge.',
    percentPrecise: 'Genauer Prozentsatz'
  },
  es: {
    intros: {
      chat: 'Ajusta el estilo de respuesta, el razonamiento visible y las imágenes.',
      safety: 'Gestiona aprobaciones, privacidad, instantáneas y credenciales guardadas.',
      browser: 'Elige la identidad del navegador y el acceso a sitios locales.',
      memory: 'Gestiona la memoria duradera y el contexto de conversaciones largas.',
      voice: 'Configura conversaciones de voz, transcripción y síntesis de voz.',
      advanced: 'Ajusta el escritorio, la ejecución, las credenciales y los límites de salida.'
    },
    tabs: {
      chatReply: 'Respuestas y visualización',
      chatAttachments: 'Imágenes y adjuntos',
      safetyApprovals: 'Aprobaciones',
      safetyPrivacy: 'Privacidad y acceso',
      safetyCheckpoints: 'Instantáneas de archivos',
      safetyVault: 'Contraseñas e inicios de sesión',
      browserProfile: 'Identidad del navegador',
      browserNetwork: 'URL locales y privadas',
      memoryPersistent: 'Memoria a largo plazo',
      memoryContext: 'Organización del contexto',
      voiceConversation: 'Conversación de voz',
      voiceTranscription: 'Voz a texto',
      voiceSpeech: 'Texto a voz',
      advancedDesktop: 'Escritorio e inicio',
      advancedRuntime: 'Ejecución y entorno',
      advancedOutput: 'Salidas e instantáneas',
      advancedKeys: 'Herramientas y credenciales'
    },
    sections: {
      reply: 'Preferencias de respuesta',
      preferences: 'Preferencias de las respuestas',
      images: 'Comprensión de imágenes',
      attachments: 'Tamaño de adjuntos',
      approvals: 'Confirmar antes de actuar',
      privacy: 'Protección de privacidad',
      metrics: 'Estadísticas de uso',
      checkpoints: 'Puntos de restauración',
      vault: 'Contraseñas e inicios de sesión',
      browserIdentity: 'Usar sesiones existentes',
      browserNetwork: 'Acceso a la red local',
      persistent: 'Memoria integrada',
      externalMemory: 'Servicios de memoria externos',
      context: 'Motor de contexto',
      compression: 'Compresión automática',
      voiceConversation: 'Modo de conversación',
      voiceEntry: 'Accesos de voz del escritorio',
      transcription: 'Ajustes de reconocimiento',
      speech: 'Ajustes de síntesis',
      desktop: 'Comportamiento del escritorio',
      startup: 'Atajos e inicio',
      runtime: 'Ejecución del agente',
      connections: 'Recursos de conexión',
      tools: 'Herramientas y comandos',
      terminal: 'Entorno de comandos',
      output: 'Salida de herramientas',
      credentials: 'Credenciales de servicios'
    },
    units: {
      seconds: 'segundos',
      minutes: 'minutos',
      megabytes: 'MB',
      bytes: 'bytes',
      characters: 'caracteres',
      messages: 'mensajes',
      snapshots: 'instantáneas',
      turns: 'turnos',
      retries: 'reintentos',
      percent: '%',
      lines: 'líneas',
      connections: 'conexiones',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'Preguntar siempre',
          description: 'Solicitar tu aprobación antes de las operaciones que la requieren.'
        },
        smart: {
          label: 'Evaluar automáticamente',
          description: 'Usar la evaluación de riesgo existente para decidir cuándo pedir confirmación.'
        },
        off: {
          label: 'No solicitar aprobación',
          description:
            'Omitir aprobaciones de comandos. Los permisos de herramientas y las restricciones del sistema siguen activos.'
        }
      },
      images: {
        auto: {
          label: 'Elegir automáticamente',
          description: 'Elegir el procesamiento de imagen adecuado para el modelo.'
        },
        native: {
          label: 'Enviar imagen directamente',
          description: 'Enviar la imagen original a un modelo con entrada visual.'
        },
        text: {
          label: 'Convertir en descripción',
          description: 'Crear una descripción con el servicio de imágenes existente y enviarla al modelo.'
        }
      },
      voice: {
        chained: {
          label: 'Voz por etapas',
          description: 'Procesar por separado reconocimiento, respuesta y síntesis de voz.'
        },
        'gpt-live': {
          label: 'Voz en tiempo real',
          description:
            'Usar la conexión GPT Live existente; Aino procesa las solicitudes con el modelo y las herramientas elegidos.'
        }
      }
    },
    invalidNumber: 'Introduce un número válido.',
    listPlaceholder: 'Un elemento por línea; también se pueden separar con comas.',
    percentPrecise: 'Porcentaje exacto'
  },
  ru: {
    intros: {
      chat: 'Настройте стиль ответов, показ рассуждений и обработку изображений.',
      safety: 'Управляйте подтверждениями, конфиденциальностью, снимками файлов и учётными данными.',
      browser: 'Выберите профиль браузера и способ доступа к локальным сайтам.',
      memory: 'Управляйте долговременной памятью и контекстом длинных разговоров.',
      voice: 'Настройте голосовой диалог, распознавание и синтез речи.',
      advanced: 'Настройте приложение, выполнение, данные доступа инструментов и ограничения вывода.'
    },
    tabs: {
      chatReply: 'Ответы и отображение',
      chatAttachments: 'Изображения и вложения',
      safetyApprovals: 'Подтверждение действий',
      safetyPrivacy: 'Конфиденциальность и доступ',
      safetyCheckpoints: 'Снимки файлов',
      safetyVault: 'Пароли и вход',
      browserProfile: 'Профиль браузера',
      browserNetwork: 'Локальные и частные URL',
      memoryPersistent: 'Долговременная память',
      memoryContext: 'Организация контекста',
      voiceConversation: 'Голосовой диалог',
      voiceTranscription: 'Речь в текст',
      voiceSpeech: 'Текст в речь',
      advancedDesktop: 'Приложение и запуск',
      advancedRuntime: 'Среда и выполнение',
      advancedOutput: 'Вывод и снимки',
      advancedKeys: 'Инструменты и ключи'
    },
    sections: {
      reply: 'Параметры ответов',
      preferences: 'Стиль ответов',
      images: 'Понимание изображений',
      attachments: 'Размер вложений',
      approvals: 'Подтверждение перед действием',
      privacy: 'Защита конфиденциальности',
      metrics: 'Статистика использования',
      checkpoints: 'Точки восстановления',
      vault: 'Пароли и вход',
      browserIdentity: 'Использовать текущие входы',
      browserNetwork: 'Доступ к локальной сети',
      persistent: 'Встроенная память',
      externalMemory: 'Внешние сервисы памяти',
      context: 'Механизм контекста',
      compression: 'Автоматическое сжатие',
      voiceConversation: 'Режим разговора',
      voiceEntry: 'Голосовые команды приложения',
      transcription: 'Настройки распознавания',
      speech: 'Настройки синтеза',
      desktop: 'Поведение приложения',
      startup: 'Быстрый доступ и запуск',
      runtime: 'Выполнение агента',
      connections: 'Ресурсы подключений',
      tools: 'Инструменты и команды',
      terminal: 'Среда команд',
      output: 'Вывод инструментов',
      credentials: 'Данные доступа к сервисам'
    },
    units: {
      seconds: 'секунд',
      minutes: 'минут',
      megabytes: 'MB',
      bytes: 'байт',
      characters: 'символов',
      messages: 'сообщений',
      snapshots: 'снимков',
      turns: 'ходов',
      retries: 'повторов',
      percent: '%',
      lines: 'строк',
      connections: 'подключений',
      hertz: 'Hz',
      bitsPerSecond: 'bps',
      multiplier: '×'
    },
    modes: {
      approvals: {
        manual: {
          label: 'Всегда спрашивать',
          description: 'Запрашивать согласие перед операциями, которым нужно подтверждение.'
        },
        smart: {
          label: 'Оценивать автоматически',
          description: 'Использовать существующую оценку рисков для выбора действий, требующих подтверждения.'
        },
        off: {
          label: 'Не запрашивать подтверждение',
          description: 'Пропускать подтверждения команд. Права инструментов и ограничения системы сохраняются.'
        }
      },
      images: {
        auto: {
          label: 'Выбирать автоматически',
          description: 'Выбирать обработку изображений с учётом возможностей модели.'
        },
        native: {
          label: 'Отправлять изображение',
          description: 'Отправлять исходное изображение модели с визуальным вводом.'
        },
        text: {
          label: 'Преобразовать в описание',
          description: 'Создать описание существующим сервисом изображений и передать его модели.'
        }
      },
      voice: {
        chained: {
          label: 'Поэтапный голосовой диалог',
          description: 'Раздельно выполнять распознавание, получение ответа и синтез речи.'
        },
        'gpt-live': {
          label: 'Голос в реальном времени',
          description:
            'Использовать существующее подключение GPT Live; Aino обрабатывает запросы выбранной моделью и инструментами.'
        }
      }
    },
    invalidNumber: 'Введите допустимое число.',
    listPlaceholder: 'По одному элементу в строке; можно разделять запятыми.',
    percentPrecise: 'Точный процент'
  }
}
