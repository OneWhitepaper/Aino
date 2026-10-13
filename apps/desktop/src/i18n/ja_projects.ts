// サイドバーのプロジェクトセクションのコピー。ja.ts が参照します。
import type { TranslationOverrides } from './define-locale'
export const jaProjects: NonNullable<TranslationOverrides['sidebar']>['projects'] = {
  showAllSessions: 'すべてのセッションを表示',
  sectionLabel: 'プロジェクト',
  home: 'ホーム',
  autoDiscovered: '自動検出',
  showAllCount: count => `${count} 件のセッションをすべて表示`,
  newButton: '新規プロジェクト',
  createTitle: 'プロジェクトを作成',
  createDesc: '名前を入力し、作成時にフォルダーの保存先を選択します。既存のフォルダーも追加できます。',
  renameTitle: 'プロジェクト名を変更',
  addFolderTitle: 'フォルダを追加',
  namePlaceholder: 'プロジェクト名',
  foldersLabel: 'ソースフォルダー',

  noFolders: 'まだフォルダがありません。',
  addFolder: 'フォルダを追加',
  primaryBadge: 'メイン',
  removeFolder: '削除',
  create: 'プロジェクトを作成',
  menu: 'アクション',
  menuRename: '名前を変更…',
  menuAppearance: '外観',
  noColor: '色なし',
  menuAddFolder: 'フォルダを追加',
  menuSetActive: 'アクティブに設定',
  menuDelete: 'プロジェクトの登録を解除',
  reveal: 'フォルダで表示',
  copyPath: 'パスをコピー',
  removeFromSidebar: 'サイドバーから削除',
  createdInPreviousContext:
    'プロジェクトは以前の接続またはプロファイルで作成されました。そこに戻ってください。IDEA.md は書き込まれていません。',
  hiddenFromSidebar: 'サイドバーから非表示にしました',
  undoHide: '元に戻す',
  createFailed: 'プロジェクトを作成できませんでした',
  staleBackend:
    'プロジェクトを作成するには Hermes バックエンドを更新してください。バックエンドがこのデスクトップアプリより古いです（設定 → 更新 → バックエンド）。',
  deleteConfirm:
    'Hermes から保存済みプロジェクトを削除します。ファイル・git リポジトリ・ワークツリーはそのまま残ります。',
  startWork: '新しいワークツリー',
  newWorktreeTitle: '新しいワークツリー',
  newWorktreeDesc: 'このワークツリーのブランチ名を入力してください。',
  branchPlaceholder: '例: my-feature',
  branchOff: () => ({ after: ' から分岐', before: '' }),
  baseBranchPlaceholder: 'ブランチを検索…',
  baseBranchNone: 'ブランチが見つかりません',
  startWorkFailed: 'ワークツリーを作成できませんでした',
  worktreeStaleBackend:
    'このリモート接続でワークツリーを作成するには Hermes バックエンドを更新してください — git ワークツリー API 以前のバージョンです。',
  worktreeProjectLabel: 'プロジェクト',
  worktreeProjectPlaceholder: 'プロジェクトを検索…',
  worktreeProjectNone: 'フォルダのあるプロジェクトがありません',
  convertBranch: 'ブランチを変換…',
  convertBranchTitle: 'ブランチを変換',
  convertBranchDesc: 'チェックアウト済みのブランチを開くか、空いているブランチのワークツリーを作成します。',
  convertBranchPlaceholder: 'ブランチを検索…',
  convertBranchInstead: '既存のブランチを変換',
  branchOpenExisting: '開く',
  branchSwitchHome: 'ホームを切替',
  branchCreateWorktree: '新しいワークツリー',
  branchTrackRemote: 'リモートを追跡',
  branchesLoading: 'ブランチを読み込み中…',
  noBranches: 'ブランチが見つかりません',
  removeWorktree: 'ワークツリーを削除',
  removeWorktreeFailed: 'ワークツリーを削除できませんでした（コミットされていない変更？）',
  removeWorktreeConfirm:
    'git から削除（ワークツリーのディレクトリを削除しますが、ブランチは残ります）するか、サイドバーからレーンを隠してワークツリーをディスク上に残します。',
  removeWorktreeDirty:
    'このワークツリーにはコミットされていない変更があります。強制削除（変更を破棄）するか、レーンを隠してディスク上に残します。',
  forceRemove: '強制削除',
  enter: label => `${label} を開く`,
  empty: '開いているプロジェクトはありません',

  createFolderLocation: name => `「${name}」フォルダーの保存先を選択`,

  folderSourceLocal: 'このコンピューターのフォルダーを追加',

  folderSourceRemote: '接続先のフォルダーを追加',

  add: '追加',

  manageFolders: 'フォルダを管理',

  setPrimaryFolder: 'メインフォルダに設定',

  foldersDescription: '新しい会話にはメインフォルダを使用します。関連付けを解除してもファイルと会話は保持されます。',

  keepOneFolder: '少なくとも1つのフォルダを残してください',

  contextChanged: '会話またはワークスペースが変更されました。このダイアログを開き直してください。',

  menuClose: 'プロジェクトを閉じる',

  unavailableAllProfiles:
    '全プロファイル表示では読み取り専用です。編集するには設定で所属ワークスペースを選択してください。',

  activeProfileChanged: '接続中にアクティブな Hermes プロファイルが変更されました'
}
