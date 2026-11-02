import type { BundledLocale } from './types'

export interface WorkspacePageCopy {
  description: string
  tabsLabel: string
  tabs: { projects: string; shell: string; files: string }
  groups: {
    directory: string
    discovery: string
    shell: string
    environment: string
    execution: string
    reading: string
  }
  cwd: { label: string; description: string; placeholder: string; hint: string }
  discovery: {
    label: string
    description: string
    rootsLabel: string
    rootsDescription: string
    rootsPlaceholder: string
    rootsHint: string
    excludeLabel: string
    excludeDescription: string
    excludePlaceholder: string
    excludeHint: string
    disabled: string
    empty: string
    summary: string
    note: string
  }
  shell: { label: string; description: string; hint: string }
  environment: { label: string; description: string; placeholder: string; hint: string; restart: string }
  execution: {
    label: string
    description: string
    projectLabel: string
    projectMeta: string
    projectDescription: string
    strictLabel: string
    strictMeta: string
    strictDescription: string
    hint: string
  }
  reading: { label: string; description: string; unit: string; invalid: string; fallbackHint: string }
  configNames: string
}

export const workspacePage: Record<BundledLocale, WorkspacePageCopy> = {
  en: {
    description: 'Manage project discovery, command environments and file reading.',
    tabsLabel: 'Workspace settings categories',
    tabs: { projects: 'Projects & discovery', shell: 'Terminal environment', files: 'Files & execution' },
    groups: {
      directory: 'Working directory',
      discovery: 'Project discovery',
      shell: 'Command environment',
      environment: 'Environment variables',
      execution: 'Code execution',
      reading: 'File reading'
    },
    cwd: {
      label: 'Default working directory',
      description: 'The default directory for tools and commands. Project chats keep their existing directory rules.',
      placeholder: 'For example, /Users/you/Projects',
      hint: '“.” is the runtime service’s current directory. It does not create a folder.'
    },
    discovery: {
      label: 'Discover repositories automatically',
      description: 'Find Git repositories in specified folders and add them to Projects.',
      rootsLabel: 'Scan these folders',
      rootsDescription: 'One path per line. You can add multiple directories.',
      rootsPlaceholder: 'For example, /Users/you/Projects',
      rootsHint: 'Leave empty to skip filesystem scanning.',
      excludeLabel: 'Skip these folders',
      excludeDescription: 'Exclude these paths and their subfolders from scanning.',
      excludePlaceholder: 'For example, /Users/you/Projects/archive',
      excludeHint: 'One path per line. Optional.',
      disabled: 'Automatic discovery is off. Projects linked to existing chats remain available.',
      empty: 'No scan directories specified. The filesystem will not be scanned.',
      summary: 'Find Git repositories in {roots} specified directories; skip {excluded} excluded directories.',
      note: 'Turning off discovery does not delete project files or hide projects linked to existing chats.'
    },
    shell: {
      label: 'Keep the SSH command environment',
      description: 'When tools run over SSH, keep exported environment variables for later commands.',
      hint: 'Applies to SSH execution environments. It does not control local terminal windows.'
    },
    environment: {
      label: 'Environment variables passed to tools',
      description: 'Pass selected environment variables to tools. Enter names only, one per line.',
      placeholder: 'For example, NODE_ENV',
      hint: 'Do not enter variable values. Existing runtime filtering rules still apply.',
      restart: 'After changes, restart the runtime service and recreate existing code execution environments.'
    },
    execution: {
      label: 'Code execution environment',
      description: 'Choose the directory and Python environment used to execute code.',
      projectLabel: 'Project environment',
      projectMeta: 'Default · Project',
      projectDescription:
        'Run in the session directory, preferring the project’s active Python environment so dependencies and relative paths work.',
      strictLabel: 'Separate environment',
      strictMeta: 'Strict',
      strictDescription:
        'Use a temporary directory and the Aino runtime’s Python. Project dependencies and relative paths may be unavailable.',
      hint: 'Both modes retain existing tool allowlists and sensitive-variable filtering. They do not replace command approvals or system permissions.'
    },
    reading: {
      label: 'File read limit per request',
      description: 'Limit the number of file characters a tool returns at once. Larger values can use more context.',
      unit: 'characters',
      invalid: 'Enter a positive whole number.',
      fallbackHint: 'The runtime uses 100,000 characters when this value is missing or not positive.'
    },
    configNames: 'Show corresponding configuration keys'
  },
  zh: {
    description: '管理项目发现、命令环境与文件读取方式。',
    tabsLabel: '工作区设置分类',
    tabs: { projects: '项目与发现', shell: '终端环境', files: '文件与执行' },
    groups: {
      directory: '工作目录',
      discovery: '项目发现',
      shell: '命令执行环境',
      environment: '环境变量',
      execution: '代码执行',
      reading: '文件读取'
    },
    cwd: {
      label: '默认工作目录',
      description: '工具与命令执行的默认目录；项目会话仍沿用已有的目录规则。',
      placeholder: '例如 /Users/you/Projects',
      hint: '“.” 表示运行服务的当前目录，不会创建新文件夹。'
    },
    discovery: {
      label: '自动发现代码仓库',
      description: '在指定文件夹中查找 Git 仓库，添加到“项目”列表。',
      rootsLabel: '扫描这些文件夹',
      rootsDescription: '每行一个路径，支持添加多个目录。',
      rootsPlaceholder: '例如 /Users/you/Projects',
      rootsHint: '留空时不主动扫描磁盘。',
      excludeLabel: '跳过这些文件夹',
      excludeDescription: '扫描时排除这些路径及其子文件夹。',
      excludePlaceholder: '例如 /Users/you/Projects/archive',
      excludeHint: '每行一个路径，可不填写。',
      disabled: '自动发现已关闭，已有会话项目仍然保留。',
      empty: '尚未指定扫描目录，当前不会主动扫描。',
      summary: '将在 {roots} 个指定目录中发现 Git 仓库；跳过 {excluded} 个排除目录。',
      note: '关闭自动发现不会删除项目文件，也不影响从已有会话显示项目。'
    },
    shell: {
      label: '保留 SSH 命令环境',
      description: '使用 SSH 执行工具命令时，在后续命令中保留导出的环境变量。',
      hint: '适用于 SSH 执行环境，不控制本地终端窗口。'
    },
    environment: {
      label: '传给工具的环境变量',
      description: '将指定环境变量传入工具执行环境。这里只填写变量名，每行一个。',
      placeholder: '例如 NODE_ENV',
      hint: '不需要填写变量值；仍遵循运行时现有的变量过滤规则。',
      restart: '修改后需重启运行服务，并重新创建已有代码执行环境。'
    },
    execution: {
      label: '代码运行方式',
      description: '选择执行代码时使用的目录与 Python 环境。',
      projectLabel: '项目环境',
      projectMeta: '默认 · Project',
      projectDescription: '在会话目录中运行，优先使用项目已激活的 Python 环境，便于复用依赖和相对路径。',
      strictLabel: '独立环境',
      strictMeta: 'Strict',
      strictDescription: '使用独立临时目录和 Aino 运行时的 Python，项目依赖和相对路径可能不可用。',
      hint: '这两种方式都保留现有工具白名单与敏感变量过滤，不替代命令审批或系统权限。'
    },
    reading: {
      label: '单次文件读取上限',
      description: '限制工具单次返回的文件字符数；较大的值可能占用更多上下文。',
      unit: '字符',
      invalid: '请输入大于 0 的整数。',
      fallbackHint: '未设置或值不大于 0 时，运行时使用默认的 100,000 字符。'
    },
    configNames: '查看对应配置名称'
  },
  'zh-hant': {
    description: '管理專案探索、指令環境與檔案讀取方式。',
    tabsLabel: '工作區設定分類',
    tabs: { projects: '專案與探索', shell: '終端機環境', files: '檔案與執行' },
    groups: {
      directory: '工作目錄',
      discovery: '專案探索',
      shell: '指令執行環境',
      environment: '環境變數',
      execution: '程式碼執行',
      reading: '檔案讀取'
    },
    cwd: {
      label: '預設工作目錄',
      description: '工具與指令執行的預設目錄；專案對話仍沿用既有的目錄規則。',
      placeholder: '例如 /Users/you/Projects',
      hint: '「.」表示執行服務的目前目錄，不會建立新資料夾。'
    },
    discovery: {
      label: '自動探索程式碼儲存庫',
      description: '在指定資料夾中尋找 Git 儲存庫，加入「專案」清單。',
      rootsLabel: '掃描這些資料夾',
      rootsDescription: '每行一個路徑，可加入多個目錄。',
      rootsPlaceholder: '例如 /Users/you/Projects',
      rootsHint: '留空時不主動掃描磁碟。',
      excludeLabel: '略過這些資料夾',
      excludeDescription: '掃描時排除這些路徑及其子資料夾。',
      excludePlaceholder: '例如 /Users/you/Projects/archive',
      excludeHint: '每行一個路徑，可留空。',
      disabled: '自動探索已關閉，既有對話專案仍然保留。',
      empty: '尚未指定掃描目錄，目前不會主動掃描。',
      summary: '將在 {roots} 個指定目錄中探索 Git 儲存庫；略過 {excluded} 個排除目錄。',
      note: '關閉自動探索不會刪除專案檔案，也不影響從既有對話顯示專案。'
    },
    shell: {
      label: '保留 SSH 指令環境',
      description: '使用 SSH 執行工具指令時，在後續指令中保留匯出的環境變數。',
      hint: '適用於 SSH 執行環境，不控制本機終端機視窗。'
    },
    environment: {
      label: '傳給工具的環境變數',
      description: '將指定環境變數傳入工具執行環境。僅填寫變數名稱，每行一個。',
      placeholder: '例如 NODE_ENV',
      hint: '不需要填寫變數值；仍遵循執行環境既有的變數過濾規則。',
      restart: '修改後需重新啟動執行服務，並重新建立既有程式碼執行環境。'
    },
    execution: {
      label: '程式碼執行方式',
      description: '選擇執行程式碼時使用的目錄與 Python 環境。',
      projectLabel: '專案環境',
      projectMeta: '預設 · Project',
      projectDescription: '在對話目錄中執行，優先使用專案已啟用的 Python 環境，便於重用相依套件和相對路徑。',
      strictLabel: '獨立環境',
      strictMeta: 'Strict',
      strictDescription: '使用獨立暫存目錄和 Aino 執行環境的 Python，專案相依套件和相對路徑可能無法使用。',
      hint: '兩種方式都保留既有工具允許清單與敏感變數過濾，不取代指令核准或系統權限。'
    },
    reading: {
      label: '單次檔案讀取上限',
      description: '限制工具單次傳回的檔案字元數；較大的值可能占用更多上下文。',
      unit: '字元',
      invalid: '請輸入大於 0 的整數。',
      fallbackHint: '未設定或值不大於 0 時，執行環境使用預設的 100,000 字元。'
    },
    configNames: '查看對應設定名稱'
  },
  ja: {
    description: 'プロジェクトの検出、コマンド環境、ファイルの読み取り方法を管理します。',
    tabsLabel: 'ワークスペース設定の分類',
    tabs: { projects: 'プロジェクトと検出', shell: 'ターミナル環境', files: 'ファイルと実行' },
    groups: {
      directory: '作業ディレクトリ',
      discovery: 'プロジェクトの検出',
      shell: 'コマンド実行環境',
      environment: '環境変数',
      execution: 'コード実行',
      reading: 'ファイル読み取り'
    },
    cwd: {
      label: '既定の作業ディレクトリ',
      description:
        'ツールとコマンドの既定ディレクトリです。プロジェクトの会話には既存のディレクトリ規則が適用されます。',
      placeholder: '例：/Users/you/Projects',
      hint: '「.」は実行サービスの現在のディレクトリです。フォルダは作成しません。'
    },
    discovery: {
      label: 'リポジトリを自動検出',
      description: '指定フォルダ内の Git リポジトリを検索し、プロジェクト一覧に追加します。',
      rootsLabel: '検索するフォルダ',
      rootsDescription: '1 行に 1 パスずつ、複数のディレクトリを追加できます。',
      rootsPlaceholder: '例：/Users/you/Projects',
      rootsHint: '空欄の場合はディスクを検索しません。',
      excludeLabel: '除外するフォルダ',
      excludeDescription: 'これらのパスとサブフォルダを検索対象から除外します。',
      excludePlaceholder: '例：/Users/you/Projects/archive',
      excludeHint: '1 行に 1 パス。省略できます。',
      disabled: '自動検出はオフです。既存の会話に関連するプロジェクトは残ります。',
      empty: '検索ディレクトリが未指定のため、ディスクは検索しません。',
      summary:
        '指定した {roots} 個のディレクトリで Git リポジトリを検出し、{excluded} 個の除外ディレクトリをスキップします。',
      note: '自動検出をオフにしてもプロジェクトのファイルは削除されず、既存の会話に関連するプロジェクトは表示されます。'
    },
    shell: {
      label: 'SSH コマンド環境を保持',
      description: 'SSH でツールのコマンドを実行する際、エクスポートした環境変数を後続のコマンドに引き継ぎます。',
      hint: 'SSH 実行環境に適用されます。ローカルのターミナルウィンドウは制御しません。'
    },
    environment: {
      label: 'ツールに渡す環境変数',
      description: '指定した環境変数をツールの実行環境に渡します。名前のみを 1 行に 1 つ入力してください。',
      placeholder: '例：NODE_ENV',
      hint: '変数の値は不要です。既存の実行環境のフィルタリング規則が適用されます。',
      restart: '変更後は実行サービスを再起動し、既存のコード実行環境を作り直してください。'
    },
    execution: {
      label: 'コードの実行方法',
      description: 'コード実行に使用するディレクトリと Python 環境を選びます。',
      projectLabel: 'プロジェクト環境',
      projectMeta: '既定 · Project',
      projectDescription:
        '会話のディレクトリで実行し、プロジェクトの有効な Python 環境を優先して、依存関係と相対パスを利用します。',
      strictLabel: '独立した環境',
      strictMeta: 'Strict',
      strictDescription:
        '一時ディレクトリと Aino 実行環境の Python を使用します。プロジェクトの依存関係や相対パスを利用できない場合があります。',
      hint: 'どちらも既存のツール許可リストと機密変数のフィルタリングを保持します。コマンド承認やシステム権限の代わりにはなりません。'
    },
    reading: {
      label: '1 回のファイル読み取り上限',
      description:
        'ツールが一度に返すファイルの文字数を制限します。大きい値ほど多くのコンテキストを使用する可能性があります。',
      unit: '文字',
      invalid: '0 より大きい整数を入力してください。',
      fallbackHint: '未設定または 0 以下の場合、実行環境は既定の 100,000 文字を使用します。'
    },
    configNames: '対応する設定キーを表示'
  },
  de: {
    description: 'Projekterkennung, Befehlsumgebung und Dateizugriff verwalten.',
    tabsLabel: 'Kategorien der Arbeitsbereichseinstellungen',
    tabs: { projects: 'Projekte und Erkennung', shell: 'Terminalumgebung', files: 'Dateien und Ausführung' },
    groups: {
      directory: 'Arbeitsverzeichnis',
      discovery: 'Projekterkennung',
      shell: 'Befehlsumgebung',
      environment: 'Umgebungsvariablen',
      execution: 'Code-Ausführung',
      reading: 'Dateien lesen'
    },
    cwd: {
      label: 'Standard-Arbeitsverzeichnis',
      description:
        'Standardverzeichnis für Tools und Befehle. Projektchats behalten ihre bisherigen Verzeichnisregeln.',
      placeholder: 'Zum Beispiel /Users/you/Projects',
      hint: '„.“ steht für das aktuelle Verzeichnis des Laufzeitdienstes. Es wird kein Ordner erstellt.'
    },
    discovery: {
      label: 'Repositories automatisch erkennen',
      description: 'Git-Repositories in den angegebenen Ordnern finden und zu Projekte hinzufügen.',
      rootsLabel: 'Diese Ordner durchsuchen',
      rootsDescription: 'Ein Pfad pro Zeile. Mehrere Verzeichnisse sind möglich.',
      rootsPlaceholder: 'Zum Beispiel /Users/you/Projects',
      rootsHint: 'Leer lassen, um den Dateisystemscan auszulassen.',
      excludeLabel: 'Diese Ordner überspringen',
      excludeDescription: 'Diese Pfade und ihre Unterordner von der Suche ausschließen.',
      excludePlaceholder: 'Zum Beispiel /Users/you/Projects/archive',
      excludeHint: 'Ein Pfad pro Zeile. Optional.',
      disabled: 'Die automatische Erkennung ist aus. Projekte bestehender Chats bleiben verfügbar.',
      empty: 'Keine Suchverzeichnisse angegeben. Das Dateisystem wird nicht durchsucht.',
      summary:
        'Git-Repositories in {roots} angegebenen Verzeichnissen finden; {excluded} ausgeschlossene Verzeichnisse überspringen.',
      note: 'Das Ausschalten löscht keine Projektdateien und blendet keine Projekte bestehender Chats aus.'
    },
    shell: {
      label: 'SSH-Befehlsumgebung beibehalten',
      description: 'Bei Tool-Befehlen über SSH exportierte Umgebungsvariablen für spätere Befehle beibehalten.',
      hint: 'Gilt für SSH-Ausführungsumgebungen, nicht für lokale Terminalfenster.'
    },
    environment: {
      label: 'An Tools übergebene Umgebungsvariablen',
      description: 'Ausgewählte Umgebungsvariablen an Tools übergeben. Nur Namen eingeben, einen pro Zeile.',
      placeholder: 'Zum Beispiel NODE_ENV',
      hint: 'Keine Variablenwerte eingeben. Die bisherigen Filterregeln der Laufzeit gelten weiterhin.',
      restart: 'Nach Änderungen den Laufzeitdienst neu starten und bestehende Code-Ausführungsumgebungen neu erstellen.'
    },
    execution: {
      label: 'Code-Ausführungsumgebung',
      description: 'Verzeichnis und Python-Umgebung für die Code-Ausführung wählen.',
      projectLabel: 'Projektumgebung',
      projectMeta: 'Standard · Project',
      projectDescription:
        'Im Sitzungsverzeichnis ausführen und die aktive Python-Umgebung des Projekts bevorzugen, damit Abhängigkeiten und relative Pfade funktionieren.',
      strictLabel: 'Separate Umgebung',
      strictMeta: 'Strict',
      strictDescription:
        'Ein temporäres Verzeichnis und Python der Aino-Laufzeit nutzen. Projektabhängigkeiten und relative Pfade sind eventuell nicht verfügbar.',
      hint: 'Beide Modi behalten Tool-Freigabelisten und das Filtern sensibler Variablen bei. Sie ersetzen keine Befehlsfreigaben oder Systemberechtigungen.'
    },
    reading: {
      label: 'Leselimit pro Dateianfrage',
      description:
        'Die Zahl der auf einmal vom Tool gelieferten Dateizeichen begrenzen. Größere Werte können mehr Kontext benötigen.',
      unit: 'Zeichen',
      invalid: 'Eine positive ganze Zahl eingeben.',
      fallbackHint: 'Fehlt der Wert oder ist er nicht positiv, nutzt die Laufzeit 100.000 Zeichen.'
    },
    configNames: 'Zugehörige Konfigurationsschlüssel anzeigen'
  },
  es: {
    description: 'Gestiona la detección de proyectos, los entornos de comandos y la lectura de archivos.',
    tabsLabel: 'Categorías de ajustes del espacio de trabajo',
    tabs: { projects: 'Proyectos y detección', shell: 'Entorno de terminal', files: 'Archivos y ejecución' },
    groups: {
      directory: 'Directorio de trabajo',
      discovery: 'Detección de proyectos',
      shell: 'Entorno de comandos',
      environment: 'Variables de entorno',
      execution: 'Ejecución de código',
      reading: 'Lectura de archivos'
    },
    cwd: {
      label: 'Directorio de trabajo predeterminado',
      description:
        'Directorio predeterminado de herramientas y comandos. Los chats de proyecto conservan sus reglas de directorio.',
      placeholder: 'Por ejemplo, /Users/you/Projects',
      hint: '«.» es el directorio actual del servicio de ejecución. No crea una carpeta.'
    },
    discovery: {
      label: 'Detectar repositorios automáticamente',
      description: 'Busca repositorios Git en las carpetas indicadas y añádelos a Proyectos.',
      rootsLabel: 'Buscar en estas carpetas',
      rootsDescription: 'Una ruta por línea. Puedes añadir varios directorios.',
      rootsPlaceholder: 'Por ejemplo, /Users/you/Projects',
      rootsHint: 'Déjalo vacío para omitir el escaneo del disco.',
      excludeLabel: 'Omitir estas carpetas',
      excludeDescription: 'Excluye estas rutas y sus subcarpetas del escaneo.',
      excludePlaceholder: 'Por ejemplo, /Users/you/Projects/archive',
      excludeHint: 'Una ruta por línea. Opcional.',
      disabled: 'La detección automática está desactivada. Se conservan los proyectos de chats existentes.',
      empty: 'No se indicaron directorios. El disco no se escaneará.',
      summary: 'Buscar repositorios Git en {roots} directorios indicados; omitir {excluded} directorios excluidos.',
      note: 'Desactivar la detección no elimina archivos ni oculta los proyectos vinculados a chats existentes.'
    },
    shell: {
      label: 'Conservar el entorno de comandos SSH',
      description: 'Al ejecutar herramientas por SSH, conserva las variables exportadas para los comandos posteriores.',
      hint: 'Se aplica a los entornos SSH. No controla las ventanas de terminal locales.'
    },
    environment: {
      label: 'Variables de entorno pasadas a herramientas',
      description: 'Pasa las variables seleccionadas a las herramientas. Introduce solo nombres, uno por línea.',
      placeholder: 'Por ejemplo, NODE_ENV',
      hint: 'No introduzcas valores. Se mantienen las reglas de filtrado del entorno de ejecución.',
      restart: 'Tras los cambios, reinicia el servicio y recrea los entornos de ejecución de código existentes.'
    },
    execution: {
      label: 'Entorno de ejecución de código',
      description: 'Elige el directorio y el entorno Python para ejecutar código.',
      projectLabel: 'Entorno del proyecto',
      projectMeta: 'Predeterminado · Project',
      projectDescription:
        'Ejecuta en el directorio de la sesión, priorizando el Python activo del proyecto para reutilizar dependencias y rutas relativas.',
      strictLabel: 'Entorno separado',
      strictMeta: 'Strict',
      strictDescription:
        'Usa un directorio temporal y el Python del entorno de Aino. Es posible que las dependencias del proyecto y las rutas relativas no estén disponibles.',
      hint: 'Ambos modos mantienen las listas de herramientas permitidas y el filtrado de variables sensibles. No sustituyen las aprobaciones de comandos ni los permisos del sistema.'
    },
    reading: {
      label: 'Límite de lectura por solicitud',
      description:
        'Limita los caracteres que devuelve una herramienta en cada lectura. Valores mayores pueden ocupar más contexto.',
      unit: 'caracteres',
      invalid: 'Introduce un número entero positivo.',
      fallbackHint: 'Si falta el valor o no es positivo, se usa el valor predeterminado de 100.000 caracteres.'
    },
    configNames: 'Ver claves de configuración correspondientes'
  },
  fr: {
    description: 'Gérez la découverte de projets, les environnements de commandes et la lecture des fichiers.',
    tabsLabel: 'Catégories des réglages de l’espace de travail',
    tabs: { projects: 'Projets et découverte', shell: 'Environnement du terminal', files: 'Fichiers et exécution' },
    groups: {
      directory: 'Dossier de travail',
      discovery: 'Découverte de projets',
      shell: 'Environnement des commandes',
      environment: 'Variables d’environnement',
      execution: 'Exécution du code',
      reading: 'Lecture des fichiers'
    },
    cwd: {
      label: 'Dossier de travail par défaut',
      description:
        'Dossier par défaut pour les outils et commandes. Les conversations de projet conservent leurs règles de dossier.',
      placeholder: 'Par exemple, /Users/you/Projects',
      hint: '« . » désigne le dossier courant du service d’exécution. Aucun dossier n’est créé.'
    },
    discovery: {
      label: 'Découvrir les dépôts automatiquement',
      description: 'Rechercher des dépôts Git dans les dossiers indiqués et les ajouter à Projets.',
      rootsLabel: 'Analyser ces dossiers',
      rootsDescription: 'Un chemin par ligne. Plusieurs dossiers sont possibles.',
      rootsPlaceholder: 'Par exemple, /Users/you/Projects',
      rootsHint: 'Laissez vide pour ne pas analyser le disque.',
      excludeLabel: 'Ignorer ces dossiers',
      excludeDescription: 'Exclure ces chemins et leurs sous-dossiers de l’analyse.',
      excludePlaceholder: 'Par exemple, /Users/you/Projects/archive',
      excludeHint: 'Un chemin par ligne. Facultatif.',
      disabled:
        'La découverte automatique est désactivée. Les projets des conversations existantes restent disponibles.',
      empty: 'Aucun dossier d’analyse indiqué. Le disque ne sera pas analysé.',
      summary: 'Rechercher des dépôts Git dans {roots} dossiers indiqués ; ignorer {excluded} dossiers exclus.',
      note: 'Désactiver la découverte ne supprime aucun fichier et ne masque pas les projets liés aux conversations existantes.'
    },
    shell: {
      label: 'Conserver l’environnement des commandes SSH',
      description:
        'Pour les commandes des outils via SSH, conserver les variables exportées pour les commandes suivantes.',
      hint: 'S’applique aux environnements SSH. Ne contrôle pas les fenêtres de terminal locales.'
    },
    environment: {
      label: 'Variables d’environnement transmises aux outils',
      description: 'Transmettre les variables choisies aux outils. Saisissez uniquement leurs noms, un par ligne.',
      placeholder: 'Par exemple, NODE_ENV',
      hint: 'Ne saisissez pas les valeurs. Les règles de filtrage du moteur restent appliquées.',
      restart: 'Après modification, redémarrez le service et recréez les environnements d’exécution de code existants.'
    },
    execution: {
      label: 'Environnement d’exécution du code',
      description: 'Choisissez le dossier et l’environnement Python utilisés pour exécuter le code.',
      projectLabel: 'Environnement du projet',
      projectMeta: 'Par défaut · Project',
      projectDescription:
        'Exécuter dans le dossier de session en privilégiant le Python actif du projet pour réutiliser les dépendances et chemins relatifs.',
      strictLabel: 'Environnement séparé',
      strictMeta: 'Strict',
      strictDescription:
        'Utiliser un dossier temporaire et le Python du moteur Aino. Les dépendances du projet et les chemins relatifs peuvent être indisponibles.',
      hint: 'Les deux modes conservent les listes d’outils autorisés et le filtrage des variables sensibles. Ils ne remplacent pas les approbations de commandes ni les permissions du système.'
    },
    reading: {
      label: 'Limite de lecture par requête',
      description:
        'Limiter le nombre de caractères renvoyés en une lecture. Une valeur élevée peut utiliser davantage de contexte.',
      unit: 'caractères',
      invalid: 'Saisissez un entier strictement positif.',
      fallbackHint: 'Si la valeur manque ou n’est pas positive, le moteur utilise 100 000 caractères.'
    },
    configNames: 'Afficher les clés de configuration correspondantes'
  },
  ru: {
    description: 'Управляйте поиском проектов, средой команд и чтением файлов.',
    tabsLabel: 'Категории настроек рабочего пространства',
    tabs: { projects: 'Проекты и поиск', shell: 'Среда терминала', files: 'Файлы и выполнение' },
    groups: {
      directory: 'Рабочая папка',
      discovery: 'Поиск проектов',
      shell: 'Среда выполнения команд',
      environment: 'Переменные окружения',
      execution: 'Выполнение кода',
      reading: 'Чтение файлов'
    },
    cwd: {
      label: 'Рабочая папка по умолчанию',
      description:
        'Папка по умолчанию для инструментов и команд. В чатах проектов действуют прежние правила выбора папки.',
      placeholder: 'Например, /Users/you/Projects',
      hint: '«.» означает текущую папку службы выполнения. Новая папка не создаётся.'
    },
    discovery: {
      label: 'Автоматически находить репозитории',
      description: 'Находить Git-репозитории в указанных папках и добавлять в список проектов.',
      rootsLabel: 'Сканировать эти папки',
      rootsDescription: 'Один путь в строке. Можно добавить несколько папок.',
      rootsPlaceholder: 'Например, /Users/you/Projects',
      rootsHint: 'Пустой список отключает сканирование диска.',
      excludeLabel: 'Пропускать эти папки',
      excludeDescription: 'Исключить указанные пути и их вложенные папки из поиска.',
      excludePlaceholder: 'Например, /Users/you/Projects/archive',
      excludeHint: 'Один путь в строке. Необязательно.',
      disabled: 'Автопоиск выключен. Проекты существующих чатов остаются доступными.',
      empty: 'Папки для поиска не указаны. Диск не будет сканироваться.',
      summary: 'Поиск Git-репозиториев в указанных папках: {roots}; исключённых папок: {excluded}.',
      note: 'Отключение поиска не удаляет файлы и не скрывает проекты, связанные с существующими чатами.'
    },
    shell: {
      label: 'Сохранять среду команд SSH',
      description:
        'При выполнении команд инструментов по SSH сохранять экспортированные переменные для последующих команд.',
      hint: 'Применяется к средам SSH. Не управляет локальными окнами терминала.'
    },
    environment: {
      label: 'Переменные окружения для инструментов',
      description: 'Передавать указанные переменные инструментам. Введите только имена, по одному в строке.',
      placeholder: 'Например, NODE_ENV',
      hint: 'Не вводите значения. Продолжают действовать прежние правила фильтрации среды.',
      restart: 'После изменения перезапустите службу и заново создайте существующие среды выполнения кода.'
    },
    execution: {
      label: 'Среда выполнения кода',
      description: 'Выберите папку и среду Python для выполнения кода.',
      projectLabel: 'Среда проекта',
      projectMeta: 'По умолчанию · Project',
      projectDescription:
        'Выполнять в папке сессии, предпочитая активный Python проекта для использования зависимостей и относительных путей.',
      strictLabel: 'Отдельная среда',
      strictMeta: 'Strict',
      strictDescription:
        'Использовать временную папку и Python среды Aino. Зависимости проекта и относительные пути могут быть недоступны.',
      hint: 'Оба режима сохраняют списки разрешённых инструментов и фильтрацию конфиденциальных переменных. Они не заменяют одобрение команд и системные разрешения.'
    },
    reading: {
      label: 'Лимит чтения файла за запрос',
      description:
        'Ограничить число символов файла, возвращаемых инструментом за один раз. Большее значение может занимать больше контекста.',
      unit: 'символов',
      invalid: 'Введите положительное целое число.',
      fallbackHint: 'Если значение не задано или не положительно, используется лимит в 100 000 символов.'
    },
    configNames: 'Показать соответствующие ключи конфигурации'
  },
  ar: {
    description: 'أدر اكتشاف المشاريع وبيئات الأوامر وطريقة قراءة الملفات.',
    tabsLabel: 'فئات إعدادات مساحة العمل',
    tabs: { projects: 'المشاريع والاكتشاف', shell: 'بيئة الطرفية', files: 'الملفات والتنفيذ' },
    groups: {
      directory: 'مجلد العمل',
      discovery: 'اكتشاف المشاريع',
      shell: 'بيئة تنفيذ الأوامر',
      environment: 'متغيرات البيئة',
      execution: 'تنفيذ الكود',
      reading: 'قراءة الملفات'
    },
    cwd: {
      label: 'مجلد العمل الافتراضي',
      description: 'المجلد الافتراضي للأدوات والأوامر. تحتفظ محادثات المشاريع بقواعد المجلدات الحالية.',
      placeholder: 'مثال: /Users/you/Projects',
      hint: 'تشير «.» إلى المجلد الحالي لخدمة التشغيل. لا تنشئ مجلداً جديداً.'
    },
    discovery: {
      label: 'اكتشاف المستودعات تلقائياً',
      description: 'ابحث عن مستودعات Git في المجلدات المحددة وأضفها إلى قائمة المشاريع.',
      rootsLabel: 'فحص هذه المجلدات',
      rootsDescription: 'مسار واحد في كل سطر. يمكنك إضافة عدة مجلدات.',
      rootsPlaceholder: 'مثال: /Users/you/Projects',
      rootsHint: 'اتركها فارغة لتجاوز فحص القرص.',
      excludeLabel: 'تجاوز هذه المجلدات',
      excludeDescription: 'استبعد هذه المسارات ومجلداتها الفرعية من الفحص.',
      excludePlaceholder: 'مثال: /Users/you/Projects/archive',
      excludeHint: 'مسار واحد في كل سطر. اختياري.',
      disabled: 'الاكتشاف التلقائي متوقف. تظل مشاريع المحادثات الحالية متاحة.',
      empty: 'لم تحدد مجلدات للفحص. لن يتم فحص القرص.',
      summary: 'اكتشاف مستودعات Git في المجلدات المحددة: {roots}؛ تجاوز المجلدات المستبعدة: {excluded}.',
      note: 'إيقاف الاكتشاف لا يحذف ملفات المشاريع ولا يخفي المشاريع المرتبطة بالمحادثات الحالية.'
    },
    shell: {
      label: 'الاحتفاظ ببيئة أوامر SSH',
      description: 'عند تنفيذ أوامر الأدوات عبر SSH، احتفظ بمتغيرات البيئة المصدرة للأوامر اللاحقة.',
      hint: 'ينطبق على بيئات SSH. لا يتحكم في نوافذ الطرفية المحلية.'
    },
    environment: {
      label: 'متغيرات البيئة الممررة إلى الأدوات',
      description: 'مرر متغيرات البيئة المحددة إلى الأدوات. أدخل الأسماء فقط، اسماً في كل سطر.',
      placeholder: 'مثال: NODE_ENV',
      hint: 'لا تدخل قيم المتغيرات. تظل قواعد التصفية الحالية لبيئة التشغيل مطبقة.',
      restart: 'بعد التعديل، أعد تشغيل الخدمة وأعد إنشاء بيئات تنفيذ الكود الحالية.'
    },
    execution: {
      label: 'بيئة تنفيذ الكود',
      description: 'اختر المجلد وبيئة Python المستخدمين لتنفيذ الكود.',
      projectLabel: 'بيئة المشروع',
      projectMeta: 'الافتراضي · Project',
      projectDescription:
        'نفذ في مجلد الجلسة مع تفضيل بيئة Python النشطة للمشروع للاستفادة من الاعتماديات والمسارات النسبية.',
      strictLabel: 'بيئة منفصلة',
      strictMeta: 'Strict',
      strictDescription:
        'استخدم مجلداً مؤقتاً وPython الخاص ببيئة Aino. قد لا تتوفر اعتماديات المشروع والمسارات النسبية.',
      hint: 'يحتفظ النمطان بقوائم الأدوات المسموح بها وتصفية المتغيرات الحساسة. لا يحلان محل موافقات الأوامر أو أذونات النظام.'
    },
    reading: {
      label: 'حد قراءة الملف لكل طلب',
      description: 'حدد عدد أحرف الملف التي تعيدها الأداة في المرة الواحدة. قد تستخدم القيم الأكبر سياقاً أكثر.',
      unit: 'حرف',
      invalid: 'أدخل عدداً صحيحاً موجباً.',
      fallbackHint: 'عندما لا تحدد القيمة أو تكون غير موجبة، تستخدم بيئة التشغيل الحد الافتراضي البالغ 100,000 حرف.'
    },
    configNames: 'عرض مفاتيح الإعدادات المقابلة'
  }
}
