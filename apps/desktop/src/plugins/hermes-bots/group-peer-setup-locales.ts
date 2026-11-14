export interface GroupPeerSetupMessages {
  peerTargetSetup: string
  peerSetupUpdate: string
  peerSetupApiServer: string
  peerSetupRunStorage: string
  peerSetupRoomKey: string
  peerSetupApprovals: string
  peerSetupAddress: string
  peerSetupBackground: string
  peerSetupGeneric: string
  readTimedOut: string
  createdNotJoined: string
  peerNotJoinedBadge: string
  peerOfflineBadge: string
  peerRejoinBadge: string
  peerNotJoined: string
  peerRejoin: string
  peerAway: string
  peerRetryFailed: string
}

export const GROUP_PEER_SETUP_LOCALES = {
  en: {
    peerTargetSetup: '{connection} can’t host a bot for a group chat on another computer yet. {reason}',
    peerSetupUpdate: 'Hermes there is too old for it. Update Hermes on that computer, then check again.',
    peerSetupApiServer:
      'Its API server is off. Turn on the API server there (gateway.platforms.api_server), restart Hermes on that computer, then check again.',
    peerSetupRunStorage:
      'Its API server can’t save its run records, so a message could run twice. Make sure Hermes can write to its data folder on that computer, restart Hermes there, then check again.',
    peerSetupRoomKey:
      'Hermes there can’t create the key that protects access to group chats. Make sure Hermes can write to its data folder on that computer, restart Hermes there, then check again.',
    peerSetupApprovals:
      'Command approvals are off there, or its settings can’t be read. Set approvals to manual or smart on that computer (approvals.mode), then check again.',
    peerSetupAddress:
      'It has no address that the computer running this group chat can reach. Set gateway.room_link_url on that computer, restart Hermes there, then check again.',
    peerSetupBackground:
      'Hermes there stops when its Desktop closes. Run its gateway on its own there (hermes gateway run, or install it as a service), then check again.',
    peerSetupGeneric:
      'Update Hermes there, turn on its API server with an address the computer running this group chat can reach (gateway.room_link_url), and keep approvals on.',
    readTimedOut:
      'The gateway didn’t answer in time. It may be waiting for a bot’s computer. Choose Refresh to try again.',
    createdNotJoined:
      'The group chat was created, but {names} hasn’t joined yet. The group chat says why; use Retry there.',
    peerNotJoinedBadge: 'not joined',
    peerOfflineBadge: 'offline',
    peerRejoinBadge: 'access expired',
    peerNotJoined: '{name} hasn’t joined this group chat yet.',
    peerRejoin:
      '{name}’s access to this group chat ended. To invite it again, use Retry from a Desktop connected to its computer.',
    peerAway: '{name}’s computer could not be reached. The next message to it will try again.',
    peerRetryFailed: 'We couldn’t reconnect {name}. Check that Hermes is running on its computer, then try again.'
  },
  ja: {
    peerTargetSetup:
      '{connection} は、まだほかのコンピューターのグループチャットにボットを参加させられません。{reason}',
    peerSetupUpdate:
      'そこの Hermes が古いためです。そのコンピューターの Hermes を更新してから、もう一度確認してください。',
    peerSetupApiServer:
      'API サーバーがオフになっています。そこで API サーバー（gateway.platforms.api_server）を有効にし、そのコンピューターの Hermes を再起動してから、もう一度確認してください。',
    peerSetupRunStorage:
      'API サーバーが実行記録を保存できないため、メッセージが二重に実行されるおそれがあります。そのコンピューターで Hermes がデータフォルダーに書き込めることを確認し、Hermes を再起動してから、もう一度確認してください。',
    peerSetupRoomKey:
      'そこの Hermes が、グループチャットへのアクセスを保護するキーを作成できません。そのコンピューターで Hermes がデータフォルダーに書き込めることを確認し、Hermes を再起動してから、もう一度確認してください。',
    peerSetupApprovals:
      'そこではコマンドの承認がオフになっているか、設定を読み取れません。そのコンピューターで承認を manual または smart（approvals.mode）に設定してから、もう一度確認してください。',
    peerSetupAddress:
      'このグループチャットを実行するコンピューターから届くアドレスがありません。そのコンピューターで gateway.room_link_url を設定し、Hermes を再起動してから、もう一度確認してください。',
    peerSetupBackground:
      'そこの Hermes は Desktop を閉じると停止します。そこでゲートウェイを単独で実行してから（hermes gateway run、またはサービスとしてインストール）、もう一度確認してください。',
    peerSetupGeneric:
      'そこで Hermes を更新し、このグループチャットを実行するコンピューターから届くアドレス（gateway.room_link_url）で API サーバーを有効にし、承認をオンのままにしてください。',
    readTimedOut:
      'ゲートウェイが時間内に応答しませんでした。ボットのコンピューターの応答を待っている可能性があります。「更新」を選んで再試行してください。',
    createdNotJoined:
      'グループチャットを作成しましたが、{names} はまだ参加していません。理由はグループチャットに表示されます。そこで「再試行」を使ってください。',
    peerNotJoinedBadge: '未参加',
    peerOfflineBadge: 'オフライン',
    peerRejoinBadge: 'アクセス期限切れ',
    peerNotJoined: '{name} はまだこのグループチャットに参加していません。',
    peerRejoin:
      '{name} のこのグループチャットへのアクセス期限が切れました。再招待するには、そのコンピューターに接続された Desktop から「再試行」を選んでください。',
    peerAway:
      '{name} のコンピューターに接続できませんでした。次にそのメンバーにメッセージを送ると、もう一度接続を試みます。',
    peerRetryFailed:
      '{name} に再接続できませんでした。そのコンピューターで Hermes が起動していることを確認してから、もう一度お試しください。'
  },
  zh: {
    peerTargetSetup: '{connection} 目前还无法让机器人加入其他电脑上的群聊。{reason}',
    peerSetupUpdate: '那里的 Hermes 版本太旧。请在那台电脑上更新 Hermes，然后再检查一次。',
    peerSetupApiServer:
      '它的 API 服务器未开启。请在那里开启 API 服务器（gateway.platforms.api_server），重启那台电脑上的 Hermes，然后再检查一次。',
    peerSetupRunStorage:
      '它的 API 服务器无法保存运行记录，消息可能会被执行两次。请确认 Hermes 能写入那台电脑上的数据文件夹，重启那里的 Hermes，然后再检查一次。',
    peerSetupRoomKey:
      '那里的 Hermes 无法创建保护群聊访问的密钥。请确认 Hermes 能写入那台电脑上的数据文件夹，重启那里的 Hermes，然后再检查一次。',
    peerSetupApprovals:
      '那里的命令批准已关闭，或无法读取其设置。请在那台电脑上将批准设为 manual 或 smart（approvals.mode），然后再检查一次。',
    peerSetupAddress:
      '它没有运行此群聊的电脑可以访问的地址。请在那台电脑上设置 gateway.room_link_url，重启那里的 Hermes，然后再检查一次。',
    peerSetupBackground:
      '那里的 Hermes 会在其 Desktop 关闭时停止。请在那里单独运行其网关（hermes gateway run，或将其安装为服务），然后再检查一次。',
    peerSetupGeneric:
      '请在那里更新 Hermes，用运行此群聊的电脑可以访问的地址（gateway.room_link_url）开启其 API 服务器，并保持批准开启。',
    readTimedOut: '网关未及时响应。它可能正在等待某个机器人的电脑响应。请选择“刷新”重试。',
    createdNotJoined: '群聊已创建，但 {names} 尚未加入。原因显示在群聊中，请在那里使用“重试”。',
    peerNotJoinedBadge: '未加入',
    peerOfflineBadge: '离线',
    peerRejoinBadge: '访问权限已过期',
    peerNotJoined: '{name} 尚未加入此群聊。',
    peerRejoin: '{name} 对此群聊的访问权限已过期。要再次邀请它，请在连接到其电脑的 Desktop 中选择重试。',
    peerAway: '未能连接到 {name} 所在的电脑。下次向它发送消息时会重试。',
    peerRetryFailed: '未能重新连接 {name}。请确认 Hermes 正在其电脑上运行，然后重试。'
  },
  'zh-hant': {
    peerTargetSetup: '{connection} 目前還無法讓機器人加入其他電腦上的群組聊天。{reason}',
    peerSetupUpdate: '那裡的 Hermes 版本太舊。請在那台電腦上更新 Hermes，然後再檢查一次。',
    peerSetupApiServer:
      '它的 API 伺服器未開啟。請在那裡開啟 API 伺服器（gateway.platforms.api_server），重新啟動那台電腦上的 Hermes，然後再檢查一次。',
    peerSetupRunStorage:
      '它的 API 伺服器無法儲存執行記錄，訊息可能會被執行兩次。請確認 Hermes 能寫入那台電腦上的資料夾，重新啟動那裡的 Hermes，然後再檢查一次。',
    peerSetupRoomKey:
      '那裡的 Hermes 無法建立保護群組聊天存取權的金鑰。請確認 Hermes 能寫入那台電腦上的資料夾，重新啟動那裡的 Hermes，然後再檢查一次。',
    peerSetupApprovals:
      '那裡的指令核准已關閉，或無法讀取其設定。請在那台電腦上將核准設為 manual 或 smart（approvals.mode），然後再檢查一次。',
    peerSetupAddress:
      '它沒有執行此群組聊天的電腦可以連到的位址。請在那台電腦上設定 gateway.room_link_url，重新啟動那裡的 Hermes，然後再檢查一次。',
    peerSetupBackground:
      '那裡的 Hermes 會在其 Desktop 關閉時停止。請在那裡單獨執行其閘道（hermes gateway run，或將其安裝為服務），然後再檢查一次。',
    peerSetupGeneric:
      '請在那裡更新 Hermes，以執行此群組聊天的電腦可以連到的位址（gateway.room_link_url）開啟其 API 伺服器，並保持核准開啟。',
    readTimedOut: '閘道未及時回應。它可能正在等待某個機器人的電腦回應。請選擇「重新整理」重試。',
    createdNotJoined: '群組聊天已建立，但 {names} 尚未加入。原因會顯示在群組聊天中，請在那裡使用「重試」。',
    peerNotJoinedBadge: '未加入',
    peerOfflineBadge: '離線',
    peerRejoinBadge: '存取權已過期',
    peerNotJoined: '{name} 尚未加入此群組聊天。',
    peerRejoin: '{name} 對此群組聊天的存取權已過期。若要再次邀請它，請在連線至其電腦的 Desktop 中選擇重試。',
    peerAway: '未能連線至 {name} 所在的電腦。下次向它傳送訊息時會再試一次。',
    peerRetryFailed: '未能重新連線至 {name}。請確認 Hermes 正在其電腦上執行，然後再試一次。'
  },
  ar: {
    peerTargetSetup: 'لا يستطيع {connection} بعد استضافة روبوت لمحادثة مجموعة على جهاز آخر. {reason}',
    peerSetupUpdate: 'إصدار Hermes هناك قديم جدًا. حدّث Hermes على ذلك الجهاز، ثم تحقّق مجددًا.',
    peerSetupApiServer:
      'خادم API الخاص به متوقف. فعّل خادم API هناك (gateway.platforms.api_server)، وأعد تشغيل Hermes على ذلك الجهاز، ثم تحقّق مجددًا.',
    peerSetupRunStorage:
      'لا يستطيع خادم API الخاص به حفظ سجلات التشغيل، لذا قد تُنفَّذ رسالة مرتين. تأكد من أن Hermes يستطيع الكتابة في مجلد بياناته على ذلك الجهاز، وأعد تشغيل Hermes هناك، ثم تحقّق مجددًا.',
    peerSetupRoomKey:
      'لا يستطيع Hermes هناك إنشاء المفتاح الذي يحمي الوصول إلى المحادثات الجماعية. تأكد من أن Hermes يستطيع الكتابة في مجلد بياناته على ذلك الجهاز، وأعد تشغيل Hermes هناك، ثم تحقّق مجددًا.',
    peerSetupApprovals:
      'موافقات الأوامر معطّلة هناك، أو تتعذّر قراءة إعداداته. اضبط الموافقات على manual أو smart على ذلك الجهاز (approvals.mode)، ثم تحقّق مجددًا.',
    peerSetupAddress:
      'ليس له عنوان يستطيع الجهاز الذي يشغّل محادثة المجموعة هذه الوصول إليه. اضبط gateway.room_link_url على ذلك الجهاز، وأعد تشغيل Hermes هناك، ثم تحقّق مجددًا.',
    peerSetupBackground:
      'يتوقف Hermes هناك عند إغلاق Desktop الخاص به. شغّل بوابته وحدها هناك (hermes gateway run، أو ثبّتها كخدمة)، ثم تحقّق مجددًا.',
    peerSetupGeneric:
      'حدّث Hermes هناك، وفعّل خادم API الخاص به بعنوان يستطيع الجهاز الذي يشغّل محادثة المجموعة هذه الوصول إليه (gateway.room_link_url)، وأبقِ الموافقات مفعّلة.',
    readTimedOut:
      'لم تستجب البوابة في الوقت المحدد. ربما تنتظر استجابة جهاز أحد البوتات. اختر «تحديث» لإعادة المحاولة.',
    createdNotJoined:
      'تم إنشاء محادثة المجموعة، لكن {names} لم ينضم بعد. تعرض محادثة المجموعة السبب؛ استخدم إعادة المحاولة هناك.',
    peerNotJoinedBadge: 'لم ينضم',
    peerOfflineBadge: 'غير متصل',
    peerRejoinBadge: 'انتهت صلاحية الوصول',
    peerNotJoined: 'لم ينضم {name} إلى محادثة المجموعة هذه بعد.',
    peerRejoin:
      'انتهت صلاحية وصول {name} إلى محادثة المجموعة هذه. لدعوته مجددًا، اختر إعادة المحاولة من Desktop متصل بجهازه.',
    peerAway: 'تعذّر الوصول إلى جهاز {name}. ستحاول الرسالة التالية الموجّهة إليه الاتصال مجددًا.',
    peerRetryFailed: 'تعذّر إعادة الاتصال بـ {name}. تأكد من تشغيل Hermes على جهازه، ثم حاول مجددًا.'
  },
  ru: {
    peerTargetSetup: '{connection} пока не может предоставить бота групповому чату на другом компьютере. {reason}',
    peerSetupUpdate: 'Hermes там слишком старый. Обновите Hermes на том компьютере и проверьте снова.',
    peerSetupApiServer:
      'Его API-сервер выключен. Включите там API-сервер (gateway.platforms.api_server), перезапустите Hermes на том компьютере и проверьте снова.',
    peerSetupRunStorage:
      'Его API-сервер не может сохранять записи о запусках, поэтому сообщение может выполниться дважды. Убедитесь, что Hermes может записывать в свою папку данных на том компьютере, перезапустите там Hermes и проверьте снова.',
    peerSetupRoomKey:
      'Hermes там не может создать ключ, защищающий доступ к групповым чатам. Убедитесь, что Hermes может записывать в свою папку данных на том компьютере, перезапустите там Hermes и проверьте снова.',
    peerSetupApprovals:
      'Подтверждения команд там выключены, или его настройки не читаются. Установите подтверждения в manual или smart на том компьютере (approvals.mode) и проверьте снова.',
    peerSetupAddress:
      'У него нет адреса, доступного компьютеру, на котором работает этот групповой чат. Задайте gateway.room_link_url на том компьютере, перезапустите там Hermes и проверьте снова.',
    peerSetupBackground:
      'Hermes там останавливается, когда закрывается его Desktop. Запустите там его шлюз отдельно (hermes gateway run или установите его как службу) и проверьте снова.',
    peerSetupGeneric:
      'Обновите там Hermes, включите его API-сервер с адресом, доступным компьютеру, на котором работает этот групповой чат (gateway.room_link_url), и оставьте подтверждения включёнными.',
    readTimedOut:
      'Шлюз не ответил вовремя. Возможно, он ждёт, пока ответит компьютер бота. Нажмите «Обновить», чтобы повторить попытку.',
    createdNotJoined:
      'Групповой чат создан, но {names} ещё не присоединился. Причина показана в групповом чате; нажмите там «Повторить».',
    peerNotJoinedBadge: 'не присоединился',
    peerOfflineBadge: 'не в сети',
    peerRejoinBadge: 'доступ истёк',
    peerNotJoined: '{name} ещё не присоединился к этому групповому чату.',
    peerRejoin:
      'Доступ {name} к этому групповому чату истёк. Чтобы пригласить его снова, нажмите «Повторить» в Desktop, подключённом к его компьютеру.',
    peerAway: 'Не удалось связаться с компьютером {name}. Следующее сообщение ему повторит попытку подключения.',
    peerRetryFailed:
      'Не удалось восстановить подключение к {name}. Убедитесь, что на его компьютере работает Hermes, и попробуйте снова.'
  },
  fr: {
    peerTargetSetup:
      '{connection} ne peut pas encore accueillir de bot pour une discussion de groupe sur un autre ordinateur. {reason}',
    peerSetupUpdate:
      'La version de Hermes sur cet ordinateur est trop ancienne. Mettez Hermes à jour sur cet ordinateur, puis vérifiez de nouveau.',
    peerSetupApiServer:
      'Son serveur API est désactivé. Activez-y le serveur API (gateway.platforms.api_server), redémarrez Hermes sur cet ordinateur, puis vérifiez de nouveau.',
    peerSetupRunStorage:
      'Son serveur API ne peut pas enregistrer ses exécutions : un message pourrait s’exécuter deux fois. Vérifiez que Hermes peut écrire dans son dossier de données sur cet ordinateur, redémarrez-y Hermes, puis vérifiez de nouveau.',
    peerSetupRoomKey:
      'Hermes ne peut pas y créer la clé qui protège l’accès aux discussions de groupe. Vérifiez que Hermes peut écrire dans son dossier de données sur cet ordinateur, redémarrez-y Hermes, puis vérifiez de nouveau.',
    peerSetupApprovals:
      'Les approbations de commandes y sont désactivées, ou ses réglages sont illisibles. Réglez les approbations sur manual ou smart sur cet ordinateur (approvals.mode), puis vérifiez de nouveau.',
    peerSetupAddress:
      'Il n’a aucune adresse que l’ordinateur qui gère cette discussion de groupe peut joindre. Définissez gateway.room_link_url sur cet ordinateur, redémarrez-y Hermes, puis vérifiez de nouveau.',
    peerSetupBackground:
      'Hermes s’y arrête quand son Desktop se ferme. Lancez-y sa passerelle seule (hermes gateway run, ou installez-la comme service), puis vérifiez de nouveau.',
    peerSetupGeneric:
      'Mettez Hermes à jour là-bas, activez son serveur API avec une adresse que l’ordinateur qui gère cette discussion de groupe peut joindre (gateway.room_link_url), et laissez les approbations activées.',
    readTimedOut:
      'La passerelle n’a pas répondu à temps. Elle attend peut-être l’ordinateur d’un bot. Choisissez Actualiser pour réessayer.',
    createdNotJoined:
      'La discussion de groupe a été créée, mais {names} ne l’a pas encore rejointe. La discussion de groupe indique pourquoi ; utilisez Réessayer depuis celle-ci.',
    peerNotJoinedBadge: 'pas encore là',
    peerOfflineBadge: 'hors ligne',
    peerRejoinBadge: 'accès expiré',
    peerNotJoined: '{name} n’a pas encore rejoint cette discussion de groupe.',
    peerRejoin:
      'L’accès de {name} à cette discussion de groupe a expiré. Pour l’inviter à nouveau, choisissez Réessayer depuis un Desktop connecté à son ordinateur.',
    peerAway: 'Impossible de joindre l’ordinateur de {name}. Le prochain message qui lui sera adressé réessaiera.',
    peerRetryFailed:
      'Impossible de reconnecter {name}. Vérifiez que Hermes fonctionne sur son ordinateur, puis réessayez.'
  },
  de: {
    peerTargetSetup:
      '{connection} kann noch keinen Bot für einen Gruppenchat auf einem anderen Computer bereitstellen. {reason}',
    peerSetupUpdate:
      'Hermes ist dort zu alt dafür. Aktualisieren Sie Hermes auf diesem Computer und prüfen Sie es dann erneut.',
    peerSetupApiServer:
      'Sein API-Server ist ausgeschaltet. Schalten Sie dort den API-Server ein (gateway.platforms.api_server), starten Sie Hermes auf diesem Computer neu und prüfen Sie es dann erneut.',
    peerSetupRunStorage:
      'Sein API-Server kann keine Ausführungsprotokolle speichern, daher könnte eine Nachricht doppelt ausgeführt werden. Stellen Sie sicher, dass Hermes auf diesem Computer in seinen Datenordner schreiben kann, starten Sie Hermes dort neu und prüfen Sie es dann erneut.',
    peerSetupRoomKey:
      'Hermes kann dort den Schlüssel nicht erstellen, der den Zugriff auf Gruppenchats schützt. Stellen Sie sicher, dass Hermes auf diesem Computer in seinen Datenordner schreiben kann, starten Sie Hermes dort neu und prüfen Sie es dann erneut.',
    peerSetupApprovals:
      'Befehlsfreigaben sind dort ausgeschaltet, oder seine Einstellungen lassen sich nicht lesen. Setzen Sie die Freigaben auf diesem Computer auf manual oder smart (approvals.mode) und prüfen Sie es dann erneut.',
    peerSetupAddress:
      'Dort ist keine Adresse eingerichtet, die der Computer erreichen kann, auf dem dieser Gruppenchat läuft. Legen Sie auf diesem Computer gateway.room_link_url fest, starten Sie Hermes dort neu und prüfen Sie es dann erneut.',
    peerSetupBackground:
      'Hermes stoppt dort, wenn sein Desktop geschlossen wird. Starten Sie dort sein Gateway eigenständig (hermes gateway run oder als Dienst installiert) und prüfen Sie es dann erneut.',
    peerSetupGeneric:
      'Aktualisieren Sie Hermes dort, aktivieren Sie seinen API-Server mit einer Adresse, die der Computer erreichen kann, auf dem dieser Gruppenchat läuft (gateway.room_link_url), und lassen Sie Freigaben eingeschaltet.',
    readTimedOut:
      'Das Gateway hat nicht rechtzeitig geantwortet. Möglicherweise wartet es auf den Computer eines Bots. Wählen Sie „Aktualisieren“, um es erneut zu versuchen.',
    createdNotJoined:
      'Der Gruppenchat wurde erstellt, aber {names} ist noch nicht beigetreten. Der Gruppenchat zeigt den Grund; verwenden Sie dort „Erneut versuchen“.',
    peerNotJoinedBadge: 'nicht beigetreten',
    peerOfflineBadge: 'nicht erreichbar',
    peerRejoinBadge: 'Zugriff abgelaufen',
    peerNotJoined: '{name} ist diesem Gruppenchat noch nicht beigetreten.',
    peerRejoin:
      'Der Zugriff von {name} auf diesen Gruppenchat ist abgelaufen. Um das Mitglied erneut einzuladen, wählen Sie „Erneut versuchen“ in einem Desktop, der mit seinem Computer verbunden ist.',
    peerAway:
      'Der Computer von {name} konnte nicht erreicht werden. Bei der nächsten Nachricht an dieses Mitglied wird es erneut versucht.',
    peerRetryFailed:
      'Die Verbindung zu {name} konnte nicht wiederhergestellt werden. Prüfen Sie, ob Hermes auf seinem Computer läuft, und versuchen Sie es erneut.'
  },
  es: {
    peerTargetSetup: '{connection} todavía no puede aportar un bot a un chat de grupo de otro equipo. {reason}',
    peerSetupUpdate: 'Hermes es demasiado antiguo allí. Actualiza Hermes en ese equipo y vuelve a comprobarlo.',
    peerSetupApiServer:
      'Su servidor API está desactivado. Activa allí el servidor API (gateway.platforms.api_server), reinicia Hermes en ese equipo y vuelve a comprobarlo.',
    peerSetupRunStorage:
      'Su servidor API no puede guardar los registros de ejecución, así que un mensaje podría ejecutarse dos veces. Comprueba que Hermes pueda escribir en su carpeta de datos en ese equipo, reinicia Hermes allí y vuelve a comprobarlo.',
    peerSetupRoomKey:
      'Hermes no puede crear allí la clave que protege el acceso a los chats de grupo. Comprueba que Hermes pueda escribir en su carpeta de datos en ese equipo, reinicia Hermes allí y vuelve a comprobarlo.',
    peerSetupApprovals:
      'Las aprobaciones de comandos están desactivadas allí, o no se puede leer su configuración. Configura las aprobaciones como manual o smart en ese equipo (approvals.mode) y vuelve a comprobarlo.',
    peerSetupAddress:
      'No tiene una dirección que el equipo que gestiona este chat de grupo pueda alcanzar. Configura gateway.room_link_url en ese equipo, reinicia Hermes allí y vuelve a comprobarlo.',
    peerSetupBackground:
      'Hermes se detiene allí cuando se cierra su Desktop. Ejecuta allí su pasarela por sí sola (hermes gateway run, o instálala como servicio) y vuelve a comprobarlo.',
    peerSetupGeneric:
      'Actualiza Hermes allí, activa su servidor API con una dirección que el equipo que gestiona este chat de grupo pueda alcanzar (gateway.room_link_url) y mantén activadas las aprobaciones.',
    readTimedOut:
      'La pasarela no respondió a tiempo. Puede que esté esperando al equipo de un bot. Elige Actualizar para reintentarlo.',
    createdNotJoined:
      'El chat de grupo se ha creado, pero {names} aún no se ha unido. El chat de grupo indica el motivo; usa Reintentar allí.',
    peerNotJoinedBadge: 'sin unirse',
    peerOfflineBadge: 'sin conexión',
    peerRejoinBadge: 'acceso caducado',
    peerNotJoined: '{name} aún no se ha unido a este chat de grupo.',
    peerRejoin:
      'El acceso de {name} a este chat de grupo ha caducado. Para volver a invitarlo, elige Reintentar desde un Desktop conectado a su equipo.',
    peerAway:
      'No se pudo conectar con el equipo de {name}. El próximo mensaje dirigido a ese miembro lo volverá a intentar.',
    peerRetryFailed:
      'No se pudo reconectar a {name}. Comprueba que Hermes se esté ejecutando en su equipo y vuelve a intentarlo.'
  }
} satisfies Record<string, GroupPeerSetupMessages>
