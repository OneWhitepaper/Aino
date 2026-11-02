import type { BundledLocale } from './types'

export const fieldDescriptions: Partial<Record<BundledLocale, Record<string, string>>> = {
  'zh-hant': {
    'approvals.mcp_reload_confirm': '重新載入 MCP 工具設定前先取得確認；重新載入可能影響對話快取。',
    command_allowlist: '每行輸入一條可信任的指令規則，依既有審批比對方式免除重複確認。',
    'security.allow_private_urls': '允許相關網路工具存取本機與私人網址；雲端中繼資料網址仍受封鎖。',
    'memory.provider': '連接已安裝的外部記憶服務，可與內建記憶同時使用。',
    'voice.voice_chat_mode': '選擇下次語音對話使用的引擎；進行中的對話維持原引擎。',
    'voice.gpt_live.voice': '選擇或輸入即時語音服務支援的音色名稱。',
    'voice.gpt_live.instructions': '為即時語音層補充語氣、語速與語言偏好；Aino 保留自己的任務提示詞。',
    'tts.provider': '選擇產生語音的服務，保留提供方與模型原名。',
    'stt.provider': '選擇將錄音轉為文字的服務。',
    'stt.streaming': '提供方與目前語音模式支援時，邊說邊顯示辨識結果。',
    'voice.max_recording_seconds': '達到此時長後，依既有錄音流程結束單次錄音。',
    'voice.client_direct': '在支援範圍內由桌面直接連接語音服務；設定快取最多約 60 秒更新。',
    toolsets: '選擇目前工作區可使用的工具集；清空全部工具仍需確認。',
    'terminal.backend': '選擇工具指令實際執行的環境。',
    'terminal.timeout': '單次終端工具指令可等待的最長時間。',
    'terminal.docker_image': 'Docker 執行後端使用的鏡像。',
    'terminal.singularity_image': 'Singularity 執行後端使用的鏡像。',
    'terminal.modal_image': 'Modal 執行後端使用的鏡像。',
    'terminal.daytona_image': 'Daytona 執行後端使用的鏡像。',
    'tool_output.max_bytes': '限制工具輸出保留的最大位元組數。',
    'tool_output.max_line_length': '限制工具輸出單行的最大字元數。',
    'checkpoints.max_snapshots': '啟用檔案快照後，最多保留的快照數量。',
    'agent.api_max_retries': '符合重試條件的介面請求失敗後，最多重試的次數。',
    'agent.service_tier': '使用目前服務與模型支援的快速請求規則，保留提供方原有選項。',
    'agent.tool_use_enforcement': '設定既有模型工具呼叫約束策略，不是系統級沙箱。'
  },
  ja: {
    'approvals.mcp_reload_confirm':
      'MCP ツールの設定を再読み込みする前に確認します。再読み込みは会話のキャッシュに影響することがあります。',
    command_allowlist: '信頼するコマンド規則を1行ずつ入力します。既存の承認判定に従って再確認を省きます。',
    'security.allow_private_urls':
      '対応するウェブツールにローカル・プライベートURLへのアクセスを許可します。クラウドのメタデータURLは禁止のままです。',
    'memory.provider': 'インストール済みの外部記憶サービスを内蔵記憶と併用します。',
    'voice.voice_chat_mode': '次の音声対話のエンジンを選びます。進行中の対話は変更しません。',
    'voice.gpt_live.voice': 'リアルタイム音声サービスが対応する音声名を選ぶか入力します。',
    'voice.gpt_live.instructions': '音声層の口調、速度、言語を補足します。Aino のタスク用指示は維持されます。',
    'tts.provider': '音声を生成するサービスを選びます。サービス名とモデル名はそのまま使用します。',
    'stt.provider': '録音を文字に変換するサービスを選びます。',
    'stt.streaming': 'サービスと音声モードが対応する場合、話している間に認識結果を表示します。',
    'voice.max_recording_seconds': 'この時間に達したら既存の録音処理で録音を終了します。',
    'voice.client_direct':
      '対応する音声サービスにデスクトップから直接接続します。設定キャッシュは最大約60秒で更新されます。',
    toolsets: '現在のプロファイルが使えるツールセットを選びます。全て空にする場合は確認が必要です。',
    'terminal.backend': 'ツールのコマンドを実際に実行する環境を選びます。',
    'terminal.timeout': '1回のターミナルコマンドを待つ最大時間です。',
    'terminal.docker_image': 'Docker 実行環境で使用するイメージです。',
    'terminal.singularity_image': 'Singularity 実行環境で使用するイメージです。',
    'terminal.modal_image': 'Modal 実行環境で使用するイメージです。',
    'terminal.daytona_image': 'Daytona 実行環境で使用するイメージです。',
    'tool_output.max_bytes': 'ツール出力に保持する最大バイト数です。',
    'tool_output.max_line_length': 'ツール出力の1行に保持する最大文字数です。',
    'checkpoints.max_snapshots': 'ファイルの復元点が有効な場合に保持する最大件数です。',
    'agent.api_max_retries': '再試行可能なAPI要求が失敗した場合の再試行上限です。',
    'agent.service_tier': 'サービスとモデルが対応する高速要求方針を使用します。提供元の値は変更しません。',
    'agent.tool_use_enforcement':
      '既存のモデル用ツール呼び出し規則を設定します。システムのサンドボックスではありません。'
  },
  ar: {
    'approvals.mcp_reload_confirm':
      'اطلب التأكيد قبل إعادة تحميل أدوات MCP؛ قد تؤثر الإعادة في ذاكرة سياق المحادثة المؤقتة.',
    command_allowlist: 'أدخل قاعدة أمر موثوق في كل سطر لتجاوز التأكيد المتكرر وفق قواعد الموافقة الحالية.',
    'security.allow_private_urls':
      'اسمح لأدوات الويب المدعومة بالوصول إلى العناوين المحلية والخاصة؛ تظل بيانات السحابة الوصفية محظورة.',
    'memory.provider': 'صل خدمة ذاكرة خارجية مثبّتة إلى جانب الذاكرة المدمجة.',
    'voice.voice_chat_mode': 'اختر محرك المحادثة الصوتية التالية؛ لا تتغير المحادثة الجارية.',
    'voice.gpt_live.voice': 'اختر اسم صوت تدعمه خدمة الصوت الفوري أو أدخله.',
    'voice.gpt_live.instructions': 'أضف تفضيلات النبرة والسرعة واللغة للصوت؛ يحتفظ Aino بتعليمات المهمة الخاصة به.',
    'tts.provider': 'اختر خدمة توليد الصوت مع الحفاظ على أسماء الخدمات والنماذج.',
    'stt.provider': 'اختر الخدمة التي تحول التسجيلات إلى نص.',
    'stt.streaming': 'اعرض نتائج التعرف أثناء الكلام عندما تدعم الخدمة ووضع الصوت ذلك.',
    'voice.max_recording_seconds': 'أنهِ التسجيل الواحد عند بلوغ هذه المدة وفق مسار التسجيل الحالي.',
    'voice.client_direct': 'صل خدمات الصوت المدعومة مباشرة من سطح المكتب؛ تتحدث الإعدادات المخزنة خلال نحو 60 ثانية.',
    toolsets: 'اختر مجموعات الأدوات المتاحة لهذا الملف؛ يتطلب إفراغها جميعًا تأكيدًا.',
    'terminal.backend': 'اختر البيئة التي تنفّذ أوامر الأدوات فعليًا.',
    'terminal.timeout': 'أقصى مدة انتظار لأمر طرفية واحد.',
    'terminal.docker_image': 'الصورة المستخدمة في بيئة تنفيذ Docker.',
    'terminal.singularity_image': 'الصورة المستخدمة في بيئة تنفيذ Singularity.',
    'terminal.modal_image': 'الصورة المستخدمة في بيئة تنفيذ Modal.',
    'terminal.daytona_image': 'الصورة المستخدمة في بيئة تنفيذ Daytona.',
    'tool_output.max_bytes': 'الحد الأقصى للبايتات المحتفظ بها من مخرجات الأدوات.',
    'tool_output.max_line_length': 'الحد الأقصى للأحرف في سطر واحد من مخرجات الأدوات.',
    'checkpoints.max_snapshots': 'أقصى عدد لقطات محفوظة عند تفعيل لقطات الملفات.',
    'agent.api_max_retries': 'أقصى عدد لمحاولات الطلبات الفاشلة القابلة لإعادة المحاولة.',
    'agent.service_tier': 'استخدم سياسة الطلبات السريعة التي يدعمها المزود والنموذج مع إبقاء قيم المزود الحالية.',
    'agent.tool_use_enforcement': 'اضبط سياسة استدعاء الأدوات الحالية للنموذج؛ ليست عزلًا على مستوى النظام.'
  },
  ru: {
    'approvals.mcp_reload_confirm':
      'Запрашивать подтверждение перед перезагрузкой MCP: она может повлиять на кэш контекста.',
    command_allowlist:
      'По одной доверенной команде в строке. Существующие правила определяют освобождение от повторного подтверждения.',
    'security.allow_private_urls':
      'Разрешает поддерживаемым веб-инструментам локальные и частные адреса; метаданные облака остаются заблокированными.',
    'memory.provider': 'Подключите установленный внешний сервис памяти вместе со встроенной памятью.',
    'voice.voice_chat_mode': 'Выберите движок следующего голосового разговора; текущий разговор не меняется.',
    'voice.gpt_live.voice': 'Выберите или введите голос, поддерживаемый сервисом реального времени.',
    'voice.gpt_live.instructions':
      'Добавьте пожелания к тону, темпу и языку голосового слоя; Aino сохраняет свои инструкции задачи.',
    'tts.provider': 'Выберите сервис синтеза, сохраняя названия сервисов и моделей.',
    'stt.provider': 'Выберите сервис преобразования записей в текст.',
    'stt.streaming': 'Показывать текст во время речи, если сервис и голосовой режим это поддерживают.',
    'voice.max_recording_seconds': 'Завершать одну запись при достижении указанной длительности.',
    'voice.client_direct':
      'Подключать поддерживаемые голосовые сервисы из приложения; кэш настроек обновляется примерно за 60 секунд.',
    toolsets: 'Выберите доступные профилю наборы инструментов. Очистка всех наборов требует подтверждения.',
    'terminal.backend': 'Выберите среду фактического выполнения команд инструментов.',
    'terminal.timeout': 'Максимальное ожидание одной команды терминала.',
    'terminal.docker_image': 'Образ для среды выполнения Docker.',
    'terminal.singularity_image': 'Образ для среды выполнения Singularity.',
    'terminal.modal_image': 'Образ для среды выполнения Modal.',
    'terminal.daytona_image': 'Образ для среды выполнения Daytona.',
    'tool_output.max_bytes': 'Максимальный размер сохраняемого вывода инструментов в байтах.',
    'tool_output.max_line_length': 'Максимальное число символов в одной строке вывода.',
    'checkpoints.max_snapshots': 'Максимальное число сохраняемых снимков, когда они включены.',
    'agent.api_max_retries': 'Максимальное число повторов допустимых неудачных запросов API.',
    'agent.service_tier':
      'Политика быстрых запросов, поддерживаемая провайдером и моделью; исходные значения сохраняются.',
    'agent.tool_use_enforcement':
      'Настройте существующую политику вызова инструментов моделью; это не системная изоляция.'
  },
  fr: {
    'approvals.mcp_reload_confirm':
      'Demander avant de recharger les outils MCP ; ce rechargement peut affecter le cache du contexte.',
    command_allowlist:
      'Une règle de commande fiable par ligne. Les règles existantes évitent les confirmations répétées.',
    'security.allow_private_urls':
      'Autoriser les outils web compatibles à visiter des URL locales et privées ; les métadonnées cloud restent bloquées.',
    'memory.provider': 'Ajouter un service de mémoire installé à la mémoire intégrée.',
    'voice.voice_chat_mode':
      'Choisir le moteur de la prochaine conversation vocale ; la conversation en cours ne change pas.',
    'voice.gpt_live.voice': 'Choisir ou saisir une voix acceptée par le service en temps réel.',
    'voice.gpt_live.instructions':
      'Préciser le ton, le rythme ou la langue de la voix ; Aino conserve ses propres instructions de tâche.',
    'tts.provider': 'Choisir le service de synthèse en conservant les noms des fournisseurs et modèles.',
    'stt.provider': 'Choisir le service qui transforme les enregistrements en texte.',
    'stt.streaming': 'Afficher la reconnaissance pendant la parole si le fournisseur et le mode le permettent.',
    'voice.max_recording_seconds': 'Terminer un enregistrement à cette durée selon le fonctionnement existant.',
    'voice.client_direct':
      'Connecter le bureau directement aux services compatibles ; le cache se renouvelle en environ 60 secondes maximum.',
    toolsets: 'Choisir les ensembles d’outils du profil ; tout désactiver demande confirmation.',
    'terminal.backend': 'Choisir l’environnement où les commandes s’exécutent réellement.',
    'terminal.timeout': 'Attente maximale pour une commande de terminal.',
    'terminal.docker_image': 'Image utilisée pour l’exécution Docker.',
    'terminal.singularity_image': 'Image utilisée pour l’exécution Singularity.',
    'terminal.modal_image': 'Image utilisée pour l’exécution Modal.',
    'terminal.daytona_image': 'Image utilisée pour l’exécution Daytona.',
    'tool_output.max_bytes': 'Nombre maximal d’octets conservés dans les sorties des outils.',
    'tool_output.max_line_length': 'Nombre maximal de caractères conservés par ligne de sortie.',
    'checkpoints.max_snapshots': 'Nombre maximal d’instantanés conservés lorsqu’ils sont activés.',
    'agent.api_max_retries': 'Nombre maximal de tentatives supplémentaires pour les requêtes API éligibles.',
    'agent.service_tier':
      'Utiliser la politique rapide acceptée par le fournisseur et le modèle, sans modifier leurs valeurs.',
    'agent.tool_use_enforcement':
      'Configurer la stratégie existante d’appel des outils ; ce n’est pas un bac à sable système.'
  },
  de: {
    'approvals.mcp_reload_confirm':
      'Vor dem Neuladen von MCP-Tools bestätigen; dies kann den Kontextcache beeinflussen.',
    command_allowlist:
      'Eine vertrauenswürdige Befehlsregel pro Zeile. Die bestehenden Regeln steuern wiederholte Freigaben.',
    'security.allow_private_urls':
      'Erlaubt unterstützten Webtools lokale und private URLs; Cloud-Metadaten bleiben gesperrt.',
    'memory.provider': 'Einen installierten externen Speicherdienst zusätzlich zur integrierten Erinnerung verbinden.',
    'voice.voice_chat_mode': 'Modul für das nächste Sprachgespräch wählen; das laufende Gespräch bleibt unverändert.',
    'voice.gpt_live.voice': 'Eine vom Echtzeitdienst unterstützte Stimme auswählen oder eingeben.',
    'voice.gpt_live.instructions':
      'Tonfall, Tempo oder Sprache ergänzen; Aino behält seine eigenen Aufgabenanweisungen.',
    'tts.provider': 'Sprachdienst auswählen; Anbieter- und Modellnamen bleiben unverändert.',
    'stt.provider': 'Dienst zum Umwandeln von Aufnahmen in Text auswählen.',
    'stt.streaming': 'Erkennung während des Sprechens anzeigen, wenn Dienst und Modus es unterstützen.',
    'voice.max_recording_seconds': 'Eine Aufnahme nach dieser Dauer nach dem bestehenden Ablauf beenden.',
    'voice.client_direct':
      'Unterstützte Sprachdienste direkt verbinden; der Einstellungscache wird innerhalb von etwa 60 Sekunden erneuert.',
    toolsets: 'Toolsets für dieses Profil wählen; das Leeren aller Toolsets erfordert Bestätigung.',
    'terminal.backend': 'Umgebung wählen, in der Toolbefehle tatsächlich ausgeführt werden.',
    'terminal.timeout': 'Maximale Wartezeit für einen Terminalbefehl.',
    'terminal.docker_image': 'Image für die Docker-Ausführung.',
    'terminal.singularity_image': 'Image für die Singularity-Ausführung.',
    'terminal.modal_image': 'Image für die Modal-Ausführung.',
    'terminal.daytona_image': 'Image für die Daytona-Ausführung.',
    'tool_output.max_bytes': 'Maximale Bytezahl, die von Toolausgaben erhalten bleibt.',
    'tool_output.max_line_length': 'Maximale Zeichenzahl einer Ausgabezeile.',
    'checkpoints.max_snapshots': 'Maximale Anzahl gespeicherter Dateisicherungen, wenn aktiviert.',
    'agent.api_max_retries': 'Maximale Wiederholungen für dafür geeignete fehlgeschlagene API-Anfragen.',
    'agent.service_tier': 'Unterstützte Schnellanforderungsrichtlinie verwenden; Anbieterwerte bleiben erhalten.',
    'agent.tool_use_enforcement': 'Bestehende Modellrichtlinie für Toolaufrufe konfigurieren; keine System-Sandbox.'
  },
  es: {
    'approvals.mcp_reload_confirm': 'Pedir confirmación antes de recargar MCP; puede afectar a la caché del contexto.',
    command_allowlist: 'Una regla de comando fiable por línea; las reglas existentes evitan confirmaciones repetidas.',
    'security.allow_private_urls':
      'Permitir a herramientas web compatibles acceder a URL locales y privadas; los metadatos de la nube siguen bloqueados.',
    'memory.provider': 'Conectar un servicio de memoria instalado junto a la memoria integrada.',
    'voice.voice_chat_mode': 'Elegir el motor de la próxima conversación de voz; la actual no cambia.',
    'voice.gpt_live.voice': 'Elegir o introducir una voz admitida por el servicio en tiempo real.',
    'voice.gpt_live.instructions':
      'Añadir preferencias de tono, ritmo o idioma; Aino conserva sus propias instrucciones de tarea.',
    'tts.provider': 'Elegir el servicio de síntesis sin modificar nombres de proveedores ni modelos.',
    'stt.provider': 'Elegir el servicio que transforma grabaciones en texto.',
    'stt.streaming': 'Mostrar reconocimiento mientras hablas si lo admiten el proveedor y el modo.',
    'voice.max_recording_seconds': 'Finalizar cada grabación al alcanzar esta duración según el flujo existente.',
    'voice.client_direct':
      'Conectar servicios compatibles directamente desde el escritorio; la caché se actualiza en unos 60 segundos como máximo.',
    toolsets: 'Elegir conjuntos de herramientas del perfil; vaciarlos todos requiere confirmación.',
    'terminal.backend': 'Elegir el entorno donde se ejecutan realmente los comandos.',
    'terminal.timeout': 'Espera máxima de un comando de terminal.',
    'terminal.docker_image': 'Imagen usada con el entorno Docker.',
    'terminal.singularity_image': 'Imagen usada con el entorno Singularity.',
    'terminal.modal_image': 'Imagen usada con el entorno Modal.',
    'terminal.daytona_image': 'Imagen usada con el entorno Daytona.',
    'tool_output.max_bytes': 'Máximo de bytes conservados de las salidas de herramientas.',
    'tool_output.max_line_length': 'Máximo de caracteres conservados en una línea de salida.',
    'checkpoints.max_snapshots': 'Máximo de instantáneas conservadas cuando están activadas.',
    'agent.api_max_retries': 'Máximo de reintentos para solicitudes API fallidas que lo permitan.',
    'agent.service_tier': 'Usar la política rápida admitida por el proveedor y el modelo conservando sus valores.',
    'agent.tool_use_enforcement':
      'Configurar la política existente de uso de herramientas; no es un aislamiento del sistema.'
  }
}
