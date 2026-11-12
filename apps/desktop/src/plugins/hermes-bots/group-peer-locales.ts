export interface GroupPeerMessages {
  peerJoinFailed: string
  peerJoinUnconfirmed: string
  peerJoinUnreachable: string
  peerJoinChanged: string
  disbandUnconfirmed: string
  disbandKept: string
  disbandPeerUnreachable: string
  disbandStopPending: string
  disbandMemberHomeUnknown: string
  disbandInProgress: string
  disbandRevokeUnsupported: string
  disbandServiceRequired: string
  peerStartWithoutRetry: string
  peerStartWithoutKept: string
  peerJoinConnect: string
  peerStartWithout: string
  peerStartWithoutConfirm: string
}

export const GROUP_PEER_LOCALES = {
  en: {
    peerJoinFailed: '{name} hasn’t joined: {reason}',
    peerJoinUnconfirmed:
      'Could not confirm whether {name} joined. Check the group chat when its computer is reachable.',
    peerJoinUnreachable:
      '{name} hasn’t joined: the computer running this group chat couldn’t reach its computer. Check that its computer can be reached from there without Desktop, then try again.',
    peerJoinChanged:
      '{name} can’t join this group chat: its computer’s bot settings changed since the group chat was created. Start a new group chat to include it.',
    disbandUnconfirmed:
      'We couldn’t confirm that the group chat ended. A bot’s computer may be asleep or offline. Try again once it’s back.',
    disbandKept: 'The group chat has been kept. {reason}',
    disbandPeerUnreachable:
      'Its work was stopped. A member’s computer isn’t answering. Reconnect that computer, then try Disband again.',
    disbandStopPending:
      'The bots in this group chat haven’t all confirmed they’ve stopped. Try Disband again once they have. For a waiting turn, use Retry or Discard if offered in the group chat.',
    disbandMemberHomeUnknown:
      'The group chat may still be working, but one of its bot profiles is no longer configured on the computer running the group chat. Add that profile back to hosted_rooms.profiles so its Stop can be confirmed, then try Disband again.',
    disbandInProgress:
      'Disband could not finish. Wait a moment, check the group chat, then try Disband again if needed.',
    disbandRevokeUnsupported:
      'Its work was stopped. A member cannot remove its access to this group chat. Update Hermes on that member’s computer, then try Disband again.',
    disbandServiceRequired:
      'Hermes must be running on the computer that runs this group chat to stop its bots and remove their access. Start or reconnect Hermes there, then try Disband again.',
    peerStartWithoutRetry: 'Use Retry for these bots in the new group chat.',
    peerStartWithoutKept:
      'The new group chat was created and the original group chat has been kept. {reason} Disband the original when you’re ready.',
    peerJoinConnect: '{name} hasn’t joined: connect to the computer it runs on, then choose Retry.',
    peerStartWithout: 'Start new group chat without {name}',
    peerStartWithoutConfirm:
      'A new group chat starts with the other bots. The original ends only after they all join and every original member confirms Stop and access revocation. If either step fails, both group chats stay. Earlier messages aren’t copied. Using this action again after creation makes another group chat.'
  },
  ja: {
    peerJoinFailed: '{name} はまだ参加していません: {reason}',
    peerJoinUnconfirmed:
      '{name} が参加したか確認できませんでした。コンピューターに接続できるようになったら、グループチャットを確認してください。',
    peerJoinUnreachable:
      '{name} はまだ参加していません。このグループチャットを実行するコンピューターから、そのコンピューターに接続できませんでした。Desktop を介さずにそこから届くことを確認してから、もう一度お試しください。',
    peerJoinChanged:
      '{name} はこのグループチャットに参加できません。グループチャットの作成後に、そのコンピューターのボットの設定が変わりました。含めるには新しいグループチャットを始めてください。',
    disbandUnconfirmed:
      'グループチャットの終了を確認できませんでした。ボットのコンピューターがスリープ中かオフラインの可能性があります。復帰してからもう一度お試しください。',
    disbandKept: 'グループチャットは保持されています。{reason}',
    disbandPeerUnreachable:
      '作業は停止しました。メンバーのコンピューターが応答していません。そのコンピューターに再接続してから、もう一度解散してください。',
    disbandStopPending:
      'このグループチャットのすべてのボットから停止の確認が取れたわけではありません。全員の確認が取れたら、もう一度解散してください。保留中のターンには、グループチャットに再試行や破棄が表示されていれば、その操作を使えます。',
    disbandMemberHomeUnknown:
      'このグループチャットの処理はまだ続いている可能性がありますが、ボットのプロファイルの一つがグループチャットを実行しているコンピューターの設定から外れています。そのプロファイルを hosted_rooms.profiles に戻して停止を確認できるようにしてから、もう一度解散してください。',
    disbandInProgress:
      '解散を完了できませんでした。少し待ってグループチャットを確認し、必要であればもう一度解散してください。',
    disbandRevokeUnsupported:
      '作業は停止しました。メンバーがこのグループチャットへのアクセス権を取り消せません。そのメンバーのコンピューターで Hermes を更新してから、もう一度解散してください。',
    disbandServiceRequired:
      'ボットを停止してアクセスを解除するには、このグループチャットを実行するコンピューターで Hermes が動作している必要があります。そこで Hermes を起動するか再接続してから、もう一度解散してください。',
    peerStartWithoutRetry: '新しいグループチャットで、これらのボットの「再試行」を使ってください。',
    peerStartWithoutKept:
      '新しいグループチャットを作成しました。元のグループチャットも保持されています。{reason} 準備ができたら元のグループチャットを解散してください。',
    peerJoinConnect:
      '{name} はまだ参加していません。それが動いているコンピューターに接続してから、「再試行」を選んでください。',
    peerStartWithout: '{name} を除いて新しいグループチャットを始める',
    peerStartWithoutConfirm:
      'ほかのボットで新しいグループチャットを作成します。全員が参加し、元の全メンバーの停止とアクセス取り消しが確認されてから、元のチャットを終了します。どちらかが失敗した場合は両方を保持します。以前のメッセージはコピーされません。 作成後にこの操作をもう一度行うと、別のグループチャットが作成されます。'
  },
  zh: {
    peerJoinFailed: '{name} 尚未加入：{reason}',
    peerJoinUnconfirmed: '无法确认 {name} 是否已加入。请在能够连接到其电脑后检查群聊。',
    peerJoinUnreachable:
      '{name} 尚未加入：运行此群聊的电脑无法访问它所在的电脑。请确认无需 Desktop 也能从那里访问该电脑，然后重试。',
    peerJoinChanged:
      '{name} 无法加入此群聊：自群聊创建以来，它所在电脑上的机器人设置已更改。要加入它，请开始一个新群聊。',
    disbandUnconfirmed: '无法确认群聊是否已经结束。某个机器人的电脑可能处于休眠或离线状态。请在它恢复连接后重试。',
    disbandKept: '群聊已保留。{reason}',
    disbandPeerUnreachable: '群聊中的工作已停止。某位成员所在的电脑没有响应。请重新连接该电脑，然后再次尝试解散。',
    disbandStopPending:
      '此群聊中的机器人尚未全部确认已停止。请在全部确认后再次尝试解散。如果群聊中为等待处理的回合提供了重试或丢弃操作，可以使用这些操作。',
    disbandMemberHomeUnknown:
      '群聊可能仍在运行，但其中一个机器人的配置档案已不在运行群聊的电脑的配置中。请将该配置档案重新加入 hosted_rooms.profiles，以便确认其已停止，然后再次尝试解散。',
    disbandInProgress: '未能完成解散。请稍等片刻，检查群聊状态，然后根据需要重试解散。',
    disbandRevokeUnsupported:
      '群聊中的工作已停止。某位成员无法撤销其对此群聊的访问权限。请在该成员所在的电脑上更新 Hermes，然后再次尝试解散。',
    disbandServiceRequired:
      '必须在运行此群聊的电脑上启动 Hermes，才能停止机器人并撤销其访问权限。请在那台电脑上启动或重新连接 Hermes，然后重试解散。',
    peerStartWithoutRetry: '请在新群聊中对这些机器人使用“重试”。',
    peerStartWithoutKept: '已创建新群聊，原群聊已保留。{reason} 准备好后可解散原群聊。',
    peerJoinConnect: '{name} 尚未加入：请连接到它所在的电脑，然后选择“重试”。',
    peerStartWithout: '不含 {name} 开始新群聊',
    peerStartWithoutConfirm:
      '将用其他机器人创建新群聊。只有它们全部加入，且原群聊所有成员确认停止并撤销访问权限后，原群聊才会结束。任一步骤失败都会保留两个群聊。之前的消息不会复制。 创建后再次使用此操作会创建另一个群聊。'
  },
  'zh-hant': {
    peerJoinFailed: '{name} 尚未加入：{reason}',
    peerJoinUnconfirmed: '無法確認 {name} 是否已加入。請在能夠連線到其電腦後檢查群組聊天。',
    peerJoinUnreachable:
      '{name} 尚未加入：執行此群組聊天的電腦無法連到它所在的電腦。請確認不經 Desktop 也能從那裡連到該電腦，然後再試一次。',
    peerJoinChanged:
      '{name} 無法加入此群組聊天：自群組聊天建立以來，它所在電腦上的機器人設定已變更。若要加入它，請開始新的群組聊天。',
    disbandUnconfirmed: '無法確認群組聊天是否已經結束。某個機器人的電腦可能處於休眠或離線狀態。請在它恢復連線後重試。',
    disbandKept: '群組聊天已保留。{reason}',
    disbandPeerUnreachable:
      '群組聊天中的工作已停止。某位成員所在的電腦沒有回應。請重新連線至該電腦，然後再次嘗試解散。',
    disbandStopPending:
      '此群組聊天中的機器人尚未全部確認已停止。請在全部確認後再次嘗試解散。如果群組聊天中為等待處理的回合提供了重試或捨棄操作，可以使用這些操作。',
    disbandMemberHomeUnknown:
      '群組聊天可能仍在執行，但其中一個機器人的設定檔已不在執行群組聊天的電腦的設定中。請將該設定檔重新加入 hosted_rooms.profiles，以便確認其已停止，然後再次嘗試解散。',
    disbandInProgress: '未能完成解散。請稍候片刻，檢查群組聊天狀態，再視需要重試解散。',
    disbandRevokeUnsupported:
      '群組聊天中的工作已停止。某位成員無法撤銷其對此群組聊天的存取權。請在該成員所在的電腦上更新 Hermes，然後再次嘗試解散。',
    disbandServiceRequired:
      '必須在執行此群組聊天的電腦上啟動 Hermes，才能停止機器人並撤銷其存取權。請在那台電腦上啟動或重新連線至 Hermes，再重試解散。',
    peerStartWithoutRetry: '請在新的群組聊天中對這些機器人使用「重試」。',
    peerStartWithoutKept: '已建立新的群組聊天，原有的群組聊天也已保留。{reason} 準備好後可解散原有的群組聊天。',
    peerJoinConnect: '{name} 尚未加入：請連線到它所在的電腦，然後選擇「重試」。',
    peerStartWithout: '不含 {name} 開始新群組聊天',
    peerStartWithoutConfirm:
      '將用其他機器人建立新的群組聊天。只有它們全部加入，且原有群組聊天的所有成員確認停止並撤銷存取權後，原有聊天才會結束。任一步驟失敗都會保留兩個群組聊天。先前的訊息不會複製。 建立後再次使用此操作會建立另一個群組聊天。'
  },
  ar: {
    peerJoinFailed: 'لم ينضم {name} بعد: {reason}',
    peerJoinUnconfirmed: 'تعذر تأكيد انضمام {name}. تحقق من محادثة المجموعة عندما يمكن الاتصال بجهازها.',
    peerJoinUnreachable:
      'لم ينضم {name} بعد: تعذّر على الجهاز الذي يشغّل محادثة المجموعة هذه الوصول إلى جهازه. تأكد من إمكانية الوصول إلى جهازه من هناك دون Desktop، ثم حاول مرة أخرى.',
    peerJoinChanged:
      'لا يمكن لـ {name} الانضمام إلى محادثة المجموعة هذه: تغيّرت إعدادات الروبوت على جهازه منذ إنشاء محادثة المجموعة. ابدأ محادثة مجموعة جديدة لتضمينه.',
    disbandUnconfirmed:
      'لم نتمكن من تأكيد انتهاء محادثة المجموعة. قد يكون جهاز أحد البوتات في وضع السكون أو غير متصل. أعد المحاولة بعد عودته للاتصال.',
    disbandKept: 'تم الاحتفاظ بمحادثة المجموعة. {reason}',
    disbandPeerUnreachable:
      'توقف العمل فيها. جهاز أحد الأعضاء لا يستجيب. أعد الاتصال بذلك الجهاز، ثم حاول حل محادثة المجموعة مجددًا.',
    disbandStopPending:
      'لم تؤكد جميع البوتات في محادثة المجموعة هذه أنها توقفت. حاول حل محادثة المجموعة مجددًا بعد تأكيدها جميعًا. للدور المنتظر، استخدم إعادة المحاولة أو التجاهل إذا كان الخيار متاحًا في محادثة المجموعة.',
    disbandMemberHomeUnknown:
      'قد يستمر العمل في محادثة المجموعة، لكن أحد ملفات تعريف البوتات لم يعد مضافًا إلى إعدادات الجهاز الذي يشغّل محادثة المجموعة. أعد إضافته إلى hosted_rooms.profiles حتى يمكن تأكيد توقفه، ثم حاول حل محادثة المجموعة مجددًا.',
    disbandInProgress: 'تعذّر إكمال حل محادثة المجموعة. انتظر قليلًا وتحقّق منها، ثم حاول حلها مجددًا إذا لزم الأمر.',
    disbandRevokeUnsupported:
      'توقف العمل فيها. لا يستطيع أحد الأعضاء إلغاء وصوله إلى محادثة المجموعة هذه. حدّث Hermes على جهاز ذلك العضو، ثم حاول حل محادثة المجموعة مجددًا.',
    disbandServiceRequired:
      'يجب تشغيل Hermes على الجهاز الذي يشغّل محادثة المجموعة هذه لإيقاف روبوتاتها وإلغاء وصولها. شغّل Hermes هناك أو أعد الاتصال به، ثم حاول حل المحادثة مجددًا.',
    peerStartWithoutRetry: 'استخدم إعادة المحاولة لهذه البوتات في محادثة المجموعة الجديدة.',
    peerStartWithoutKept:
      'تم إنشاء محادثة المجموعة الجديدة والاحتفاظ بمحادثة المجموعة الأصلية. {reason} يمكنك حل الدردشة الأصلية عندما تكون مستعدًا.',
    peerJoinConnect: 'لم ينضم {name} بعد: اتصل بالجهاز الذي يعمل عليه، ثم اختر إعادة المحاولة.',
    peerStartWithout: 'بدء محادثة مجموعة جديدة بدون {name}',
    peerStartWithoutConfirm:
      'تبدأ دردشة جماعية جديدة بالبوتات الأخرى. لا تنتهي الأصلية إلا بعد انضمامها جميعًا وتأكيد إيقاف كل عضو أصلي وإلغاء وصوله. إذا فشلت أي خطوة، تبقى الدردشتان. لن تُنسخ الرسائل السابقة. استخدام هذا الإجراء مجددًا بعد الإنشاء ينشئ دردشة جماعية أخرى.'
  },
  ru: {
    peerJoinFailed: '{name} ещё не присоединился: {reason}',
    peerJoinUnconfirmed:
      'Не удалось подтвердить, присоединился ли {name}. Проверьте групповой чат, когда его компьютер станет доступен.',
    peerJoinUnreachable:
      '{name} ещё не присоединился: компьютер, на котором работает этот групповой чат, не смог связаться с его компьютером. Убедитесь, что этот компьютер доступен оттуда без Desktop, и попробуйте снова.',
    peerJoinChanged:
      '{name} не может присоединиться к этому групповому чату: настройки бота на его компьютере изменились после создания группового чата. Чтобы добавить его, начните новый групповой чат.',
    disbandUnconfirmed:
      'Не удалось подтвердить завершение группового чата. Компьютер одного из ботов может быть в спящем режиме или не в сети. Повторите попытку, когда он снова будет доступен.',
    disbandKept: 'Групповой чат сохранён. {reason}',
    disbandPeerUnreachable:
      'Работа в нём остановлена. Компьютер одного из участников не отвечает. Восстановите подключение к этому компьютеру и попробуйте распустить групповой чат снова.',
    disbandStopPending:
      'Не все боты в этом групповом чате подтвердили остановку. Повторите роспуск группового чата, когда все подтвердят её. Для ожидающего хода используйте повтор или отмену, если эти действия доступны в групповом чате.',
    disbandMemberHomeUnknown:
      'Работа в групповом чате может продолжаться, но один из профилей ботов больше не настроен на компьютере, на котором работает групповой чат. Верните этот профиль в hosted_rooms.profiles, чтобы подтвердить его остановку, затем повторите роспуск группового чата.',
    disbandInProgress:
      'Не удалось завершить роспуск. Немного подождите, проверьте групповой чат и при необходимости повторите роспуск.',
    disbandRevokeUnsupported:
      'Работа в нём остановлена. Один из участников не может отозвать свой доступ к этому групповому чату. Обновите Hermes на компьютере этого участника и попробуйте распустить групповой чат снова.',
    disbandServiceRequired:
      'Чтобы остановить ботов и отозвать их доступ, Hermes должен работать на компьютере, который ведёт этот групповой чат. Запустите Hermes там или восстановите подключение к нему, затем повторите роспуск.',
    peerStartWithoutRetry: 'Нажмите «Повторить» для этих ботов в новом групповом чате.',
    peerStartWithoutKept:
      'Новый групповой чат создан, а исходный групповой чат сохранён. {reason} Когда будете готовы, распустите исходный групповой чат.',
    peerJoinConnect:
      '{name} ещё не присоединился: подключитесь к компьютеру, на котором он работает, и выберите «Повторить».',
    peerStartWithout: 'Начать новый групповой чат без {name}',
    peerStartWithoutConfirm:
      'Создаётся новый групповой чат с остальными ботами. Исходный завершится только после их присоединения и подтверждения остановки и отзыва доступа каждого исходного участника. При сбое любого шага оба чата сохраняются. Прежние сообщения не копируются. Повторное действие после создания создаст ещё один групповой чат.'
  },
  fr: {
    peerJoinFailed: '{name} n’a pas encore rejoint la discussion de groupe : {reason}',
    peerJoinUnconfirmed:
      'Impossible de confirmer si {name} a rejoint la discussion de groupe. Vérifiez la discussion lorsque son ordinateur sera joignable.',
    peerJoinUnreachable:
      '{name} n’a pas encore rejoint la discussion de groupe : l’ordinateur qui gère cette discussion de groupe n’a pas pu joindre son ordinateur. Vérifiez qu’on peut le joindre depuis là-bas sans Desktop, puis réessayez.',
    peerJoinChanged:
      '{name} ne peut pas rejoindre cette discussion de groupe : les réglages du bot sur son ordinateur ont changé depuis la création de la discussion de groupe. Démarrez une nouvelle discussion de groupe pour l’inclure.',
    disbandUnconfirmed:
      'La fin de la discussion de groupe n’a pas pu être confirmée. L’ordinateur d’un bot est peut-être en veille ou hors ligne. Réessayez lorsqu’il sera de nouveau disponible.',
    disbandKept: 'La discussion de groupe a été conservée. {reason}',
    disbandPeerUnreachable:
      'Le travail a été arrêté. L’ordinateur d’un membre ne répond pas. Reconnectez cet ordinateur, puis réessayez de dissoudre la discussion de groupe.',
    disbandStopPending:
      'Les bots de cette discussion de groupe n’ont pas tous confirmé leur arrêt. Réessayez de dissoudre la discussion une fois que tous l’auront confirmé. Pour un tour en attente, utilisez Réessayer ou Ignorer si ces actions sont proposées dans la discussion de groupe.',
    disbandMemberHomeUnknown:
      'La discussion de groupe peut encore être en cours, mais un profil de bot n’est plus configuré sur l’ordinateur qui exécute la discussion de groupe. Ajoutez à nouveau ce profil à hosted_rooms.profiles pour pouvoir confirmer son arrêt, puis réessayez de dissoudre la discussion de groupe.',
    disbandInProgress:
      'La dissolution n’a pas pu se terminer. Patientez un instant, vérifiez la discussion de groupe, puis réessayez si nécessaire.',
    disbandRevokeUnsupported:
      'Le travail a été arrêté. Un membre ne peut pas révoquer son accès à cette discussion de groupe. Mettez Hermes à jour sur son ordinateur, puis réessayez de dissoudre la discussion de groupe.',
    disbandServiceRequired:
      'Hermes doit fonctionner sur l’ordinateur qui exécute cette discussion de groupe pour arrêter ses bots et révoquer leurs accès. Démarrez ou reconnectez Hermes sur cet ordinateur, puis réessayez de dissoudre la discussion de groupe.',
    peerStartWithoutRetry: 'Utilisez Réessayer pour ces bots dans la nouvelle discussion de groupe.',
    peerStartWithoutKept:
      'La nouvelle discussion de groupe a été créée et celle d’origine a été conservée. {reason} Vous pourrez dissoudre la discussion d’origine quand vous serez prêt.',
    peerJoinConnect:
      '{name} n’a pas encore rejoint la discussion de groupe : connectez-vous à l’ordinateur où il fonctionne, puis choisissez Réessayer.',
    peerStartWithout: 'Démarrer une nouvelle discussion de groupe sans {name}',
    peerStartWithoutConfirm:
      'Une nouvelle discussion de groupe est créée avec les autres bots. L’originale ne se termine qu’après leur arrivée et la confirmation de l’arrêt et de la révocation des accès de chaque membre d’origine. Si une étape échoue, les deux discussions sont conservées. Les messages précédents ne sont pas copiés. Réutiliser cette action après la création crée une autre discussion de groupe.'
  },
  de: {
    peerJoinFailed: '{name} ist noch nicht beigetreten: {reason}',
    peerJoinUnconfirmed:
      'Es konnte nicht bestätigt werden, ob {name} beigetreten ist. Prüfen Sie den Gruppenchat, sobald sein Computer erreichbar ist.',
    peerJoinUnreachable:
      '{name} ist noch nicht beigetreten: Der Computer, auf dem dieser Gruppenchat läuft, konnte seinen Computer nicht erreichen. Prüfen Sie, ob dieser Computer von dort ohne Desktop erreichbar ist, und versuchen Sie es erneut.',
    peerJoinChanged:
      '{name} kann diesem Gruppenchat nicht beitreten: Die Bot-Einstellungen auf seinem Computer haben sich seit dem Erstellen des Gruppenchats geändert. Starten Sie einen neuen Gruppenchat, um ihn aufzunehmen.',
    disbandUnconfirmed:
      'Das Ende des Gruppenchats konnte nicht bestätigt werden. Der Computer eines Bots ist möglicherweise im Ruhezustand oder offline. Versuchen Sie es erneut, sobald er wieder erreichbar ist.',
    disbandKept: 'Der Gruppenchat bleibt erhalten. {reason}',
    disbandPeerUnreachable:
      'Die Arbeit darin wurde gestoppt. Der Computer eines Mitglieds antwortet nicht. Stellen Sie die Verbindung zu diesem Computer wieder her und versuchen Sie erneut, den Gruppenchat aufzulösen.',
    disbandStopPending:
      'Die Bots in diesem Gruppenchat haben noch nicht alle bestätigt, dass sie gestoppt wurden. Versuchen Sie erneut, den Gruppenchat aufzulösen, sobald alle dies bestätigt haben. Nutzen Sie bei einem wartenden Turn „Erneut versuchen“ oder „Verwerfen“, wenn diese Aktionen im Gruppenchat angeboten werden.',
    disbandMemberHomeUnknown:
      'Der Gruppenchat arbeitet möglicherweise noch, aber eines seiner Bot-Profile ist auf dem Computer, auf dem der Gruppenchat läuft, nicht mehr konfiguriert. Fügen Sie das Profil wieder zu hosted_rooms.profiles hinzu, damit sein Stopp bestätigt werden kann. Versuchen Sie dann erneut, den Gruppenchat aufzulösen.',
    disbandInProgress:
      'Die Auflösung konnte nicht abgeschlossen werden. Warten Sie kurz, prüfen Sie den Gruppenchat und versuchen Sie es bei Bedarf erneut.',
    disbandRevokeUnsupported:
      'Die Arbeit darin wurde gestoppt. Ein Mitglied kann seinen Zugriff auf diesen Gruppenchat nicht aufheben. Aktualisieren Sie Hermes auf dem Computer dieses Mitglieds und versuchen Sie dann erneut, den Gruppenchat aufzulösen.',
    disbandServiceRequired:
      'Hermes muss auf dem Computer laufen, der diesen Gruppenchat ausführt, um die Bots zu stoppen und ihren Zugriff aufzuheben. Starten Sie Hermes dort oder verbinden Sie es erneut und versuchen Sie dann erneut, den Gruppenchat aufzulösen.',
    peerStartWithoutRetry: 'Verwenden Sie für diese Bots im neuen Gruppenchat „Erneut versuchen“.',
    peerStartWithoutKept:
      'Der neue Gruppenchat wurde erstellt und der ursprüngliche Gruppenchat bleibt erhalten. {reason} Lösen Sie den ursprünglichen Gruppenchat auf, wenn Sie bereit sind.',
    peerJoinConnect:
      '{name} ist noch nicht beigetreten: Verbinden Sie sich mit dem Computer, auf dem er läuft, und wählen Sie dann Erneut versuchen.',
    peerStartWithout: 'Neuen Gruppenchat ohne {name} starten',
    peerStartWithoutConfirm:
      'Ein neuer Gruppenchat wird mit den anderen Bots erstellt. Der ursprüngliche endet erst, wenn alle beigetreten sind und Stopp und Zugriffsentzug aller ursprünglichen Mitglieder bestätigt wurden. Schlägt ein Schritt fehl, bleiben beide Gruppenchats erhalten. Frühere Nachrichten werden nicht kopiert. Nach der Erstellung legt diese Aktion beim nächsten Mal einen weiteren Gruppenchat an.'
  },
  es: {
    peerJoinFailed: '{name} aún no se ha unido: {reason}',
    peerJoinUnconfirmed:
      'No se pudo confirmar si {name} se ha unido. Revisa el chat de grupo cuando su equipo esté disponible.',
    peerJoinUnreachable:
      '{name} aún no se ha unido: el equipo que gestiona este chat de grupo no pudo alcanzar su equipo. Comprueba que se pueda alcanzar desde allí sin Desktop y vuelve a intentarlo.',
    peerJoinChanged:
      '{name} no puede unirse a este chat de grupo: la configuración del bot en su equipo cambió desde que se creó el chat de grupo. Inicia un chat de grupo nuevo para incluirlo.',
    disbandUnconfirmed:
      'No pudimos confirmar que el chat de grupo haya terminado. El equipo de un bot puede estar suspendido o sin conexión. Reinténtalo cuando vuelva a estar disponible.',
    disbandKept: 'El chat de grupo se ha conservado. {reason}',
    disbandPeerUnreachable:
      'El trabajo se ha detenido. El equipo de un miembro no responde. Reconecta ese equipo y vuelve a intentar disolver el chat de grupo.',
    disbandStopPending:
      'Los bots de este chat de grupo aún no han confirmado todos que se hayan detenido. Vuelve a intentar disolver el chat cuando todos lo confirmen. Para un turno pendiente, usa Reintentar o Descartar si esas acciones se ofrecen en el chat de grupo.',
    disbandMemberHomeUnknown:
      'El chat de grupo puede seguir trabajando, pero uno de sus perfiles de bot ya no está configurado en el equipo que ejecuta el chat de grupo. Vuelve a añadir ese perfil a hosted_rooms.profiles para poder confirmar su parada y vuelve a intentar disolver el chat de grupo.',
    disbandInProgress:
      'No se pudo completar la disolución. Espera un momento, comprueba el chat de grupo y vuelve a intentarlo si es necesario.',
    disbandRevokeUnsupported:
      'El trabajo se ha detenido. Un miembro no puede revocar su acceso a este chat de grupo. Actualiza Hermes en el equipo de ese miembro y vuelve a intentar disolver el chat de grupo.',
    disbandServiceRequired:
      'Hermes debe estar en ejecución en el equipo que gestiona este chat de grupo para detener sus bots y revocar sus accesos. Inicia o reconecta Hermes allí y vuelve a intentar disolver el chat de grupo.',
    peerStartWithoutRetry: 'Usa Reintentar para estos bots en el nuevo chat de grupo.',
    peerStartWithoutKept:
      'El nuevo chat de grupo se ha creado y el original se ha conservado. {reason} Disuelve el chat original cuando estés listo.',
    peerJoinConnect: '{name} aún no se ha unido: conéctate al equipo donde funciona y elige Reintentar.',
    peerStartWithout: 'Iniciar nuevo chat de grupo sin {name}',
    peerStartWithoutConfirm:
      'Se crea un nuevo chat de grupo con los demás bots. El original solo termina cuando todos se unen y cada miembro original confirma la detención y la revocación de acceso. Si falla algún paso, se conservan ambos chats. Los mensajes anteriores no se copian. Usar esta acción de nuevo tras la creación genera otro chat de grupo.'
  }
} satisfies Record<string, GroupPeerMessages>
