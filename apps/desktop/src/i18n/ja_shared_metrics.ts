export const jaSharedMetrics = {
  consentTitle: '利用統計を共有しますか？',
  dialogTitle: '利用統計',
  consentBody:
    'Aino は使われ方を集計できます：セッションの長さ、実行されたモデルとツール、何かが失敗したタイミング。メッセージ、ファイル、パス、エラーテキストは一切記録しません。',
  whatIsCollected: '集計される内容',
  collectedActivity: 'セッション：長さ、結果、エラーの種類、1 日あたりのアクティブ時間',
  collectedModels: 'モデル：使用したモデル、トークン合計',
  collectedNames: '機能：使用またはオフにした組み込みツール、コマンド、アプリの領域、設定',
  collectedMilestones: 'セットアップ：完了したステップ、プロバイダーの接続、スキル・プラグイン・ジョブの数',
  collectedReliability: 'アプリの状態：クラッシュ、起動と応答の速さ、アップデート、メッセージングの接続',
  collectedUsage: 'エージェントの品質：失敗した編集、壊れたツール呼び出し、抜け出せないループ、タスクごとのコスト',
  collectedMachine: 'マシン：OS、RAM の範囲、GPU の種類、Aino のバージョン、ローカルモデルの使用',
  sending:
    '同意すると、Aino は集計値を毎日 api.agentera.com.cn に送信します。プロフィールのランダム ID が付き、アカウントトークンは含みません。Aino 管理者が閲覧できます。14 日で閲覧不可となり、1 時間以内にオンラインデータを削除します。バックアップは運用の保管方針に従います。インストール記録を除き、新しい同意前のデータは送信しません。設定でいつでも停止できます。',
  readDocs: '詳細を読む',
  share: 'Aino と共有する',
  off: '共有しない',
  saveFailed: '選択を保存できませんでした',
  sendLabel: '利用統計を Aino と共有する',
  sendDesc:
    '件数のみを、このプロファイル用のランダムな ID を付けて 1 日 1 回送信します。メッセージ、ファイル、パス、エラーテキストは一切含みません。',
  unavailable: 'この設定を変更するには Aino バックエンドを更新してください。',
  stripBody: '件数のみ。メッセージやファイルは一切含みません。',
  stripReaskBody:
    '統計の送信先が Aino に変わりました。以前の選択は Aino への同意にはなりません。再度選択してください。',
  stripChoices: { share: 'Aino と共有', off: '今はしない' },
  stripDetails: '詳細'
}
