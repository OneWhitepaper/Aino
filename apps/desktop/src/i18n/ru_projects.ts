// Тексты секции проектов в боковой панели; подключается из ru.ts.
import type { TranslationOverrides } from './define-locale'
export const ruProjects: NonNullable<TranslationOverrides['sidebar']>['projects'] = {
  showAllSessions: 'Показать все сессии',
  sectionLabel: 'Проекты',
  home: 'Главная',
  newButton: 'Новый проект',
  createTitle: 'Создать проект',
  createDesc: 'Введите имя и выберите, где создать папку. Можно также добавить существующую папку.',
  renameTitle: 'Переименовать проект',
  addFolderTitle: 'Добавить папку',
  namePlaceholder: 'Имя проекта',
  foldersLabel: 'Исходные папки',

  noFolders: 'Папки ещё не добавлены.',
  addFolder: 'Добавить папку',
  primaryBadge: 'основная',
  removeFolder: 'Удалить',
  create: 'Создать проект',
  menu: 'Действия',
  menuRename: 'Переименовать',
  menuAppearance: 'Внешний вид',
  noColor: 'Без цвета',
  menuAddFolder: 'Добавить папку',
  menuSetActive: 'Сделать активным',
  menuDelete: 'Убрать проект',
  moveToProject: 'Переместить в проект',
  movedTo: name => `Перемещено в ${name}`,
  moveFailed: 'Не удалось переместить сеанс',
  moveNoFolder: 'У этого проекта нет папки для перемещения',
  moveNoProjects: 'Нет других проектов',
  reveal: 'Показать в папке',
  copyPath: 'Копировать путь',
  removeFromSidebar: 'Скрыть из боковой панели',
  createdInPreviousContext:
    'Проект создан в прежнем подключении или профиле. Вернитесь к нему; файл IDEA.md не был записан.',
  hiddenFromSidebar: 'Скрыто из боковой панели',
  undoHide: 'Отменить',
  createFailed: 'Не удалось создать проект',
  staleBackend:
    'Обновите бэкенд Hermes, чтобы создавать проекты — ваш бэкенд старше этого desktop-приложения (Настройки → Обновления → Бэкенд).',
  deleteConfirm: 'Это удалит сохранённый проект из Hermes. Файлы, git-репозитории и worktrees не пострадают.',
  startWork: 'Новый worktree',
  newWorktreeTitle: 'Новый worktree',
  newWorktreeDesc: 'Назовите ветку для этого worktree.',
  branchPlaceholder: 'например, my-feature',
  branchOff: () => ({ after: '', before: 'от ветки ' }),
  baseBranchPlaceholder: 'Поиск веток…',
  baseBranchNone: 'Ветки не найдены',
  startWorkFailed: 'Не удалось создать worktree',
  worktreeStaleBackend:
    'Обновите бэкенд Hermes, чтобы создавать worktrees по этому удалённому соединению — он старше git worktree API.',
  worktreeProjectLabel: 'Проект',
  worktreeProjectPlaceholder: 'Поиск проектов…',
  worktreeProjectNone: 'Нет проектов с папкой',
  convertBranch: 'Преобразовать ветку…',
  convertBranchTitle: 'Преобразовать ветку',
  convertBranchDesc: 'Откройте закоммиченные ветки или создайте worktree для свободной ветки.',
  convertBranchPlaceholder: 'Поиск веток…',
  convertBranchInstead: 'Преобразовать существующую ветку',
  branchOpenExisting: 'открыть',
  branchSwitchHome: 'сменить home',
  branchCreateWorktree: 'новый worktree',
  branchTrackRemote: 'отслеживать удалённую',
  branchesLoading: 'Загрузка веток…',
  noBranches: 'Ветки не найдены',
  removeWorktree: 'Удалить worktree',
  removeWorktreeFailed: 'Не удалось удалить worktree (есть незакоммиченные изменения?)',
  removeWorktreeConfirm:
    'Удалить из git (сотрёт каталог worktree; ветка останется) или просто скрыть лану из боковой панели, оставив worktree на диске.',
  removeWorktreeDirty:
    'В этом worktree есть незакоммиченные изменения. Удалить принудительно (сбросит эти изменения) или просто скрыть лану и оставить на диске.',
  forceRemove: 'Удалить принудительно',
  enter: label => `Открыть ${label}`,
  reorder: label => `Изменить порядок ${label}`,
  toggle: (label, open) => `${open ? 'Показать' : 'Скрыть'} сеансы ${label}`,
  showAllCount: count => `Показать все сессии (${count})`,
  back: 'Все проекты',
  empty: 'Нет открытых проектов',

  createFolderLocation: name => `Выберите место для папки «${name}»`,

  folderSourceLocal: 'Добавить папки на этом компьютере',

  folderSourceRemote: 'Добавить папки на подключённом сервере',

  add: 'Добавить',

  manageFolders: 'Управление папками',

  setPrimaryFolder: 'Сделать основной папкой',

  foldersDescription: 'Новые чаты используют основную папку. Удаление связи сохраняет файлы и чаты.',

  keepOneFolder: 'Оставьте хотя бы одну папку',

  contextChanged: 'Разговор или рабочая область изменились. Откройте это окно заново.',

  menuClose: 'Закрыть проект'
}
