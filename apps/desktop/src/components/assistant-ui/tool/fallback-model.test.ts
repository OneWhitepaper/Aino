import { afterEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import {
  buildToolView,
  clampForDisplay,
  countDiffLineStats,
  inlineDiffFromResult,
  MAX_TOOL_RENDER_CHARS,
  prettyJson,
  type ToolPart
} from './fallback-model'
import { summarizeToolRun } from './run-summary'

const part = (overrides: Partial<ToolPart>): ToolPart => ({
  args: {},
  isError: false,
  result: {},
  toolCallId: 'call_1',
  toolName: 'vision_analyze',
  type: 'tool-call',
  ...overrides
})

afterEach(() => {
  setRuntimeI18nLocale('en')
})

describe('buildToolView image handling', () => {
  it('keeps local image paths for the activity renderer to resolve', () => {
    expect(buildToolView(part({ args: { path: '/Users/me/shot.png' } }), '').imageUrl).toBe('/Users/me/shot.png')
    expect(buildToolView(part({ result: { image_path: '/tmp/out.jpg' } }), '').imageUrl).toBe('/tmp/out.jpg')
  })

  it('keeps fetchable data URLs', () => {
    const dataUrl = 'data:image/png;base64,AAAA'

    expect(buildToolView(part({ result: { image_url: dataUrl } }), '').imageUrl).toBe(dataUrl)
  })

  it('keeps remote http(s) image URLs', () => {
    const url = 'https://example.com/pic.webp'

    expect(buildToolView(part({ result: { url } }), '').imageUrl).toBe(url)
  })
})

describe('buildToolView terminal exit-code status', () => {
  const terminal = (result: Record<string, unknown>) => buildToolView(part({ result, toolName: 'terminal' }), '')

  // A non-zero exit code with real output is not a failure (grep no-match,
  // diff differences, piped commands surfacing the last stage's code, etc.) —
  // it should render as success so the card isn't painted red.
  it('treats non-zero exit with output as success', () => {
    expect(terminal({ exit_code: 7, output: 'node ... 5174 (LISTEN)' }).status).toBe('success')
    expect(terminal({ exit_code: 1, stdout: 'partial results' }).status).toBe('success')
  })

  it('distinguishes a command failure from an empty no-match exit', () => {
    expect(terminal({ exit_code: 127, output: '' }).status).toBe('error')
    expect(terminal({ exit_code: 1, output: '' }).status).toBe('notice')
  })

  it('treats zero exit as success', () => {
    expect(terminal({ exit_code: 0, output: 'done' }).status).toBe('success')
  })

  // Explicit error signals still win regardless of output presence.
  it('keeps explicit error signals red even with output', () => {
    expect(terminal({ error: 'boom', exit_code: 0, output: 'partial' }).status).toBe('error')
    expect(buildToolView(part({ isError: true, result: { output: 'x' }, toolName: 'terminal' }), '').status).toBe(
      'error'
    )
  })

  it('keeps the command and exit code for the terminal transcript', () => {
    const view = buildToolView(
      part({
        args: { command: 'npm run check --workspace=apps/desktop' },
        result: { exit_code: 0, output: 'done' },
        toolName: 'terminal'
      }),
      ''
    )

    expect(view.terminalCommand).toBe('npm run check --workspace=apps/desktop')
    expect(view.terminalExitCode).toBe(0)
  })
})

describe('buildToolView error confidence', () => {
  it('does not claim a failed or missing file was read successfully', () => {
    const args = { path: '/repo/private.ts' }
    const success = buildToolView(part({ toolName: 'read_file', args, result: { content: 'Read successfully' } }), '')

    for (const error of ['Permission denied reading /repo/private.ts', 'File not found: /repo/private.ts']) {
      const failed = buildToolView(part({ toolName: 'read_file', args, result: { error } }), '')
      expect(failed.title).not.toBe(success.title)
      expect(failed.title).toContain('Failed to read')
      expect(failed.titleTarget).toEqual(success.titleTarget)
      expect(failed.detail).toContain(error)
    }
  })

  it('keeps routine misses and returned diagnostic data out of destructive status', () => {
    const cases: Array<[Partial<ToolPart>, ReturnType<typeof buildToolView>['status']]> = [
      [
        {
          toolName: 'read_file',
          result: { error: 'File not found: /repo/session-view.ts', similar_files: ['/repo/session-view.tsx'] }
        },
        'notice'
      ],
      [{ toolName: 'read_file', isError: true, result: { error: 'File not found: /repo/session-view.ts' } }, 'notice'],
      [{ toolName: 'terminal', result: { exit_code: 0, output: '{"error":"a logged failure"}' } }, 'success'],
      [{ result: { error: 'none', message: 'No changes needed' } }, 'success'],
      [{ result: { status: 'no error', message: 'Ready' } }, 'success'],
      [{ result: { meta: { error: 'a previous attempt' }, data: { count: 1 } } }, 'success'],
      [{ toolName: 'read_file', result: { error: 'Permission denied reading /repo/private.ts' } }, 'error'],
      [{ toolName: 'patch', result: { error: 'File not found: /repo/session-view.ts' } }, 'error'],
      [{ result: { success: false, result: { output: { error: { message: 'Connection refused' } } } } }, 'error']
    ]

    for (const [overrides, status] of cases) {
      expect(buildToolView(part(overrides), '').status, JSON.stringify(overrides)).toBe(status)
    }
  })
})

describe('buildToolView envelope errors', () => {
  it('shows the event error when the result carries no explanation', () => {
    const view = buildToolView(
      part({
        isError: true,
        result: 'partial output',
        toolName: 'terminal',
        toolResultMetadata: { error: 'killed by signal 9' }
      }),
      ''
    )

    expect(view.status).toBe('error')
    expect(view.subtitle).toBe('killed by signal 9')
  })

  it('keeps an envelope-only read miss on the notice tier', () => {
    const view = buildToolView(
      part({
        isError: true,
        result: undefined,
        completedAt: 5,
        toolName: 'read_file',
        toolResultMetadata: { error: 'File not found: /repo/missing.ts' }
      }),
      ''
    )

    expect(view.status).toBe('notice')
  })
})

describe('buildToolView generic fallback errors', () => {
  it('uses Simplified Chinese copy for app-generated tool errors', () => {
    setRuntimeI18nLocale('zh')

    const returnedError = buildToolView(part({ isError: true, result: {}, toolName: 'terminal' }), '')
    const returnedFalse = buildToolView(part({ result: { success: false }, toolName: 'vision_analyze' }), '')
    const returnedStatus = buildToolView(part({ result: { status: 'failed' }, toolName: 'vision_analyze' }), '')
    const failedCommand = buildToolView(part({ result: { exit_code: 127 }, toolName: 'terminal' }), '')

    expect(returnedError.detail).toBe('工具返回了错误。')
    expect(returnedFalse.detail).toContain('工具返回 success=false。')
    expect(returnedStatus.detail).toContain('工具返回状态“failed”。')
    expect(failedCommand.detail).toContain('命令失败，退出码为 127。')
  })
})

describe('buildToolView cron summaries', () => {
  it('uses Simplified Chinese copy for generated cron labels and empty states', () => {
    setRuntimeI18nLocale('zh')

    const empty = buildToolView(part({ result: { jobs: [] }, toolName: 'cronjob' }), '')

    const detail = buildToolView(
      part({
        result: {
          deliver: 'chat',
          next_run_at: '2026-09-01T09:00:00.000Z',
          repeat: 'daily',
          schedule: '0 9 * * *'
        },
        toolName: 'cronjob'
      }),
      ''
    )

    expect(empty.subtitle).toBe('没有 Cron 任务')
    expect(empty.detail).toBe('没有已安排的 Cron 任务')
    expect(detail.detail).toContain('计划: 0 9 * * *')
    expect(detail.detail).toContain('重复: daily')
    expect(detail.detail).toContain('发送到: chat')
    expect(detail.detail).toContain('下次运行:')
  })
})

describe('buildToolView browser and command summaries', () => {
  it('uses Simplified Chinese copy for fixed subtitles while preserving dynamic text', () => {
    setRuntimeI18nLocale('zh')

    const navigated = buildToolView(part({ result: {}, toolName: 'browser_navigate' }), '')
    const snapshot = buildToolView(part({ result: {}, toolName: 'browser_snapshot' }), '')
    const clicked = buildToolView(part({ result: {}, toolName: 'browser_click' }), '')

    const clickedInternal = buildToolView(part({ result: { clicked: '@email' }, toolName: 'browser_click' }), '')

    const filled = buildToolView(
      part({ args: { label: '邮箱', value: 'alice@example.com' }, result: {}, toolName: 'browser_fill' }),
      ''
    )

    const searched = buildToolView(part({ result: {}, toolName: 'web_search' }), '')
    const executed = buildToolView(part({ result: {}, toolName: 'terminal' }), '')
    const changed = buildToolView(part({ result: { inline_diff: '--- a/a.ts\n+++ b/a.ts' }, toolName: 'patch' }), '')
    const fetched = buildToolView(part({ result: {}, toolName: 'web_extract' }), '')

    expect(navigated.subtitle).toBe('已在浏览器中导航')
    expect(snapshot.subtitle).toBe('已捕获浏览器无障碍快照')
    expect(clicked.subtitle).toBe('已点击页面')
    expect(clickedInternal.subtitle).toBe('已点击页面元素（内部引用 @email）')
    expect(filled.subtitle).toBe('字段：邮箱 · 值：alice@example.com')
    expect(searched.subtitle).toBe('已查询网页来源')
    expect(executed.subtitle).toBe('已执行命令')
    expect(changed.subtitle).toBe('已更改文件')
    expect(fetched.subtitle).toBe('已获取网页')
  })
})

describe('buildToolView result counts', () => {
  it('keeps transport statistics out of result counts while preserving meaningful totals', () => {
    const result = { stdout: 'ok', stdout_bytes_total: 37009, stderr_bytes_total: 18, input_tokens_total: 200 }

    const code = buildToolView(part({ result, toolName: 'execute_code' }), '')
    const files = buildToolView(part({ result: { ...result, files_total: 3 }, toolName: 'list_files' }), '')

    const failure = buildToolView(
      part({ result: { ...result, error: 'execution failed' }, toolName: 'execute_code' }),
      ''
    )

    expect(code.countLabel).toBeUndefined()
    expect(code.stdout).toBe(result.stdout)
    expect(files.countLabel).toBe('3 files')
    expect(failure.countLabel).toBeUndefined()
    expect(failure.status).toBe('error')
    expect(failure.detail).toContain('execution failed')
  })

  it('localizes known count nouns in Simplified Chinese', () => {
    setRuntimeI18nLocale('zh')

    const results = buildToolView(
      part({ result: { results: [{ title: 'A' }, { title: 'B' }] }, toolName: 'web_search' }),
      ''
    )

    const files = buildToolView(part({ result: { files: ['a.txt', 'b.txt', 'c.txt'] }, toolName: 'list_files' }), '')

    expect(results.countLabel).toBe('2 个结果')
    expect(files.countLabel).toBe('3 个文件')
  })
})

describe('buildToolView calls sealed without a result', () => {
  it('warns that a lost result is unavailable', () => {
    const view = buildToolView(part({ completedAt: 5, result: undefined, toolName: 'terminal' }), '')

    expect(view.status).toBe('warning')
    expect(view.title).toBe('Result unavailable')
  })

  it('shows a call the user interrupted as a neutral notice', () => {
    const view = buildToolView(part({ completedAt: 5, interrupted: true, result: undefined, toolName: 'terminal' }), '')

    expect(view.status).toBe('notice')
    expect(view.title).toBe('Interrupted')
  })

  it('shows the real result when one arrived after the interruption', () => {
    const view = buildToolView(part({ completedAt: 5, interrupted: true, result: 'ok', toolName: 'terminal' }), '')

    expect(view.status).toBe('success')
    expect(view.title).not.toBe('Interrupted')
  })
})

describe('buildToolView browser_exec step label', () => {
  const bexec = (code: string) =>
    buildToolView(part({ args: { code }, result: undefined, toolName: 'browser_exec' }), '')

  it('uses the leading # comment as the title', () => {
    expect(bexec('# Searching Amazon for paper towels\nnew_tab("https://amazon.com")').title).toBe(
      'Searching Amazon for paper towels'
    )
  })

  it('falls back to the generic title when code has no leading comment', () => {
    const view = bexec('new_tab("https://amazon.com")')

    expect(view.title).not.toBe('')
    expect(view.title).not.toContain('new_tab')
  })

  it('truncates long labels and keeps the ellipsis', () => {
    const long = `# ${'x'.repeat(120)}`

    expect(bexec(long).title.length).toBeLessThanOrEqual(80)
    expect(bexec(long).title.endsWith('…')).toBe(true)
  })

  it('keeps the label after the result arrives', () => {
    const view = buildToolView(
      part({
        args: { code: '# Checking workspace persistence\nprint(1)' },
        result: { output: 'ok', success: true },
        toolName: 'browser_exec'
      }),
      ''
    )

    expect(view.title).toBe('Checking workspace persistence')
  })
})

describe('buildToolView web-search query', () => {
  it('keeps the query separate from structured search results', () => {
    const view = buildToolView(
      part({
        args: { query: 'Hermes Agent Desktop tool calls' },
        result: { web: [{ snippet: 'Desktop docs', title: 'Hermes docs', url: 'https://example.com/docs' }] },
        toolName: 'web_search'
      }),
      ''
    )

    expect(view.searchQuery).toBe('Hermes Agent Desktop tool calls')
    expect(view.searchHits).toEqual([
      { snippet: 'Desktop docs', title: 'Hermes docs', url: 'https://example.com/docs' }
    ])
  })
})

describe('buildToolView file-search query', () => {
  it('distinguishes patterns and search locations in every locale and lifecycle state', () => {
    for (const locale of ['en', 'zh', 'zh-hant', 'ja'] as const) {
      setRuntimeI18nLocale(locale)

      for (const result of [undefined, { matches: [] }]) {
        const searches = [
          { pattern: 'conversation', path: 'DESIGN.md' },
          { pattern: 'collapse', path: 'DESIGN.md' },
          { pattern: 'conversation', path: 'README.md' }
        ].map(args => ({ args, view: buildToolView(part({ args, result, toolName: 'search_files' }), '') }))

        expect(new Set(searches.map(({ view }) => view.title)).size).toBe(searches.length)

        for (const { args, view } of searches) {
          expect(view.title).toContain(args.pattern)
          expect(view.title).toContain(args.path)
        }

        const pathless = buildToolView(part({ args: { pattern: 'collapse' }, result, toolName: 'search_files' }), '')
        expect(pathless.title).toContain('collapse')
      }
    }
  })
})

describe('buildToolView browser_navigate title', () => {
  it('shows failed title when navigate returns success=false', () => {
    const view = buildToolView(
      part({
        toolName: 'browser_navigate',
        args: { url: 'https://hermes-agent.nousresearch.com/docs' },
        result: { success: false, error: 'Command timed out after 60 seconds' }
      }),
      ''
    )

    expect(view.status).toBe('error')
    expect(view.title).toBe('Failed to open hermes-agent.nousresearch.com/docs')
  })

  it('shows opened title on success', () => {
    const view = buildToolView(
      part({
        toolName: 'browser_navigate',
        args: { url: 'https://hermes-agent.nousresearch.com/docs' },
        result: { success: true, url: 'https://hermes-agent.nousresearch.com/docs', title: 'Docs' }
      }),
      ''
    )

    expect(view.status).toBe('success')
    expect(view.title).toBe('Opened hermes-agent.nousresearch.com/docs')
  })
})

describe('buildToolView file edit diffs', () => {
  const patchDiff = '--- a/src/demo.ts\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-old\n+new'

  it('reads inline_diff and diff fields from patch results', () => {
    expect(inlineDiffFromResult({ inline_diff: patchDiff })).toBe(patchDiff)
    expect(inlineDiffFromResult({ diff: patchDiff })).toBe(patchDiff)
  })

  it('suppresses raw patch args when a diff is available', () => {
    const view = buildToolView(
      part({
        args: { context: 'src/demo.ts', mode: 'replace', new_string: 'new', path: 'src/demo.ts' },
        result: { diff: patchDiff, success: true },
        toolName: 'patch'
      }),
      patchDiff
    )

    expect(view.title).toBe('demo.ts')
    expect(view.subtitle).toBe('src/demo.ts')
    expect(view.detail).toBe('')
    expect(view.inlineDiff).toBe(patchDiff)
  })

  it('shows path subtitle instead of patch args JSON while pending', () => {
    const view = buildToolView(
      part({
        args: { context: 'src/demo.ts', mode: 'replace', new_string: 'new', path: 'src/demo.ts' },
        result: undefined,
        toolName: 'patch'
      }),
      ''
    )

    expect(view.title).toBe('demo.ts')
    expect(view.subtitle).toBe('src/demo.ts')
    expect(view.detail).toBe('')
  })
})

describe('buildToolView title actions', () => {
  it('localizes shell counts without treating Python source as a shell command list', () => {
    setRuntimeI18nLocale('zh')
    const source = 'import json\nfor value in range(3):\n    print(json.dumps(value))'
    const input = part({ args: { code: source }, result: undefined, toolName: 'execute_code' })
    const code = buildToolView(input, '')

    const terminal = buildToolView(
      part({ args: { command: 'git status; git diff; git log -1' }, toolName: 'terminal' }),
      ''
    )

    expect(terminal.title).toBe('已运行 git status + 2 个命令')
    expect(code.title).not.toContain('import')
    expect(code.title).not.toContain('commands')
    expect(code.title).not.toContain('命令')
    expect(code.status).toBe('running')
    expect(code.titleAction?.text).toBe(code.title)
    expect(input.args).toEqual({ code: source })
    expect(code.detail).toContain(source)
    expect(summarizeToolRun([input], true)).toBe(code.title)
    expect(summarizeToolRun([{ ...input, result: { stdout: 'ok' } }], false)).toBe('已运行代码')
  })

  it('marks the pending action separately from the rest of the title', () => {
    const read = buildToolView(part({ args: { path: '/tmp/demo.txt' }, result: undefined, toolName: 'read_file' }), '')

    const web = buildToolView(
      part({ args: { url: 'https://example.com/docs' }, result: undefined, toolName: 'web_extract' }),
      ''
    )

    const terminal = buildToolView(
      part({ args: { command: 'npm test -- --runInBand' }, result: undefined, toolName: 'terminal' }),
      ''
    )

    const code = buildToolView(
      part({ args: { code: 'print("hello")' }, result: undefined, toolName: 'execute_code' }),
      ''
    )

    expect(read.title).toBe('Reading demo.txt')
    expect(read.titleAction).toEqual({ prefix: '', text: 'Reading', suffix: ' demo.txt' })
    expect(web.title).toBe('Reading example.com/docs')
    expect(web.titleAction).toEqual({ prefix: '', text: 'Reading', suffix: ' example.com/docs' })
    expect(terminal.title).toBe('Running npm test -- --runInBand')
    expect(terminal.titleAction).toEqual({ prefix: '', text: 'Running', suffix: ' npm test -- --runInBand' })
    expect(terminal.titleTarget).toEqual({ kind: 'command', text: terminal.terminalCommand })
    expect(code.title).not.toContain('print')
    expect(code.titleAction).toEqual({ prefix: '', text: code.title, suffix: '' })
  })

  it('does not mark completed tool titles as pending actions', () => {
    const view = buildToolView(part({ args: { url: 'https://example.com/docs' }, toolName: 'web_extract' }), '')

    expect(view.title).toBe('Read example.com/docs')
    expect(view.titleAction).toBeUndefined()
  })

  it('uses the filename for completed read_file rows', () => {
    const view = buildToolView(
      part({ args: { path: './package.json' }, result: { content: '1|{"name":"demo"}' }, toolName: 'read_file' }),
      ''
    )

    expect(view.title).toBe('Read package.json')
    expect(view.subtitle).toBe('')
    expect(view.titleAction).toBeUndefined()
  })

  it('adds a compact line range to line-scoped read_file rows', () => {
    const view = buildToolView(
      part({
        args: { limit: 10, offset: 25, path: './src/main.ts' },
        result: { content: '25|function toggleDock() {\n26|  dock.classList.toggle("hidden");\n34|}' },
        toolName: 'read_file'
      }),
      ''
    )

    expect(view.title).toBe('Read main.ts L25-34')
    expect(view.subtitle).toBe('')
  })

  it('uses the requested positive offset/limit for read_file row line ranges', () => {
    const view = buildToolView(
      part({
        args: { limit: 5, offset: 1, path: './package.json' },
        result: {
          content:
            '1|{\n2|  "name": "bb-rainbows",\n3|  "private": true,\n4|  "version": "0.0.1",\n5|  "type": "module",\n6|  "description": "extra"'
        },
        toolName: 'read_file'
      }),
      ''
    )

    expect(view.title).toBe('Read package.json L1-5')
  })

  it('uses inherited backend context for live read_file rows', () => {
    const view = buildToolView(
      part({
        args: { context: 'package.json L1-5', path: './package.json' },
        result: undefined,
        toolName: 'read_file'
      }),
      ''
    )

    expect(view.title).toBe('Reading package.json L1-5')
    expect(view.titleAction).toEqual({ prefix: '', text: 'Reading', suffix: ' package.json L1-5' })
  })

  it('uses returned line numbers for negative-offset read_file rows', () => {
    const view = buildToolView(
      part({
        args: { limit: 2, offset: -2, path: './src/main.ts' },
        result: { content: '99|lastLine();\n100|done();' },
        toolName: 'read_file'
      }),
      ''
    )

    expect(view.title).toBe('Read main.ts L99-100')
  })

  it('renders compact terminal titles for session 20260624_231846_bdbd1e commands', () => {
    const rows = [
      [
        'cd /Users/brooklyn/www/bb-rainbows && pnpm run lint 2>&1 | tail -20; echo "lint_exit=${PIPESTATUS[0]}"',
        'Ran pnpm run lint'
      ],
      [
        'cd /Users/brooklyn/www/bb-rainbows && pnpm run build 2>&1 | tail -20; echo "build_exit=${PIPESTATUS[0]}"',
        'Ran pnpm run build'
      ],
      [
        'which node pnpm corepack; node -v; echo "---"; corepack --version 2>&1; echo "---pnpm via corepack---"; pnpm --version 2>&1 | tail -5',
        'Ran which node pnpm corepack + 3 commands'
      ],
      [
        'echo "--- proto pnpm direct ---"; ~/.proto/tools/node/24.11.0/bin/pnpm --version 2>&1 | tail -3; echo "--- proto node ---"; ls ~/.proto/tools/node/ 2>&1; echo "--- corepack cache ---"; ls ~/.cache/node/corepack/v1/pnpm/ 2>&1',
        'Ran ~/.proto/tools/node/24.11.0/bin/pnpm --version + 2 commands'
      ],
      [
        'cd /Users/brooklyn/www/bb-rainbows && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.20.0 --version 2>&1 | tail -3',
        'Ran COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm@10.20.0 --version'
      ],
      [
        'cd /Users/brooklyn/www/bb-rainbows && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack use pnpm@10.20.0 2>&1 | tail -10; echo "exit=$?"',
        'Ran COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack use pnpm@10.20.0'
      ]
    ] as const

    for (const [command, expectedTitle] of rows) {
      const view = buildToolView(
        part({ args: { command }, result: { output: 'ok', exit_code: 0 }, toolName: 'terminal' }),
        ''
      )

      expect(view.title).toBe(expectedTitle)
    }
  })

  it('uses inherited backend context for live terminal rows', () => {
    const view = buildToolView(
      part({
        args: {
          command: 'cd /Users/brooklyn/www/bb-rainbows && pnpm run lint 2>&1 | tail -20',
          context: 'pnpm run lint'
        },
        result: undefined,
        toolName: 'terminal'
      }),
      ''
    )

    expect(view.title).toBe('Running pnpm run lint')
    expect(view.subtitle).toBe('')
    expect(view.titleAction).toEqual({ prefix: '', text: 'Running', suffix: ' pnpm run lint' })
  })

  it('never stutters the verb or echoes the command when the backend context is a phrased label', () => {
    // Older backends stamped tool.start with a *phrased* label
    // ("Running sleep 70 + 2 commands") rather than a raw arg preview, and the
    // desktop merges that into args.context. The row must still prepend its own
    // verb exactly once, show the real command in the `$` transcript, and not
    // repeat either string as detail.
    const command = 'sleep 70; echo "a"; echo "b"'

    const view = buildToolView(
      part({
        args: { command, context: 'Running sleep 70 + 2 commands' },
        result: { exit_code: 0 },
        toolName: 'terminal'
      }),
      ''
    )

    expect(view.title).toBe('Ran sleep 70 + 2 commands')
    expect(view.terminalCommand).toBe(command)
    expect(view.detail).toBe('')
  })

  it('uses the runtime locale for title text and action placement', () => {
    setRuntimeI18nLocale('ja')

    const read = buildToolView(part({ args: { path: '/tmp/demo.txt' }, result: undefined, toolName: 'read_file' }), '')

    const web = buildToolView(
      part({ args: { url: 'https://example.com/docs' }, result: undefined, toolName: 'web_extract' }),
      ''
    )

    expect(read.title).toBe('demo.txt を読み取り中')
    expect(read.titleAction).toEqual({ prefix: 'demo.txt を', text: '読み取り中', suffix: '' })
    expect(read.titleTarget?.kind).toBe('file')
    expect(read.titleAction?.prefix).toContain(read.titleTarget?.text)
    expect(web.title).toBe('example.com/docs を読み取り中')
    expect(web.titleAction).toEqual({ prefix: 'example.com/docs を', text: '読み取り中', suffix: '' })
  })
})

describe('clampForDisplay', () => {
  it('passes short payloads through untouched', () => {
    expect(clampForDisplay('hello')).toBe('hello')
    expect(clampForDisplay('x'.repeat(MAX_TOOL_RENDER_CHARS))).toHaveLength(MAX_TOOL_RENDER_CHARS)
  })

  it('truncates oversized payloads and reports the omitted count', () => {
    const oversized = 'x'.repeat(MAX_TOOL_RENDER_CHARS + 5_000)
    const clamped = clampForDisplay(oversized)

    expect(clamped.length).toBeLessThan(oversized.length)
    expect(clamped.startsWith('x'.repeat(MAX_TOOL_RENDER_CHARS))).toBe(true)
    expect(clamped).toContain('5,000 more characters truncated')
    expect(clamped).toContain('Copy')
  })

  it('uses the active Simplified Chinese copy for truncated output', () => {
    setRuntimeI18nLocale('zh')

    expect(clampForDisplay('1234567890', 5)).toBe('12345\n\n… 已省略 5 个字符 — 使用“复制”获取完整输出。')
  })
})

// A large tool result (e.g. a 100KB read_file during a `/learn` run) must not
// be serialized at full size — that JSON.stringify payload is what floods the
// renderer. buildToolView no longer prettyJson's every result eagerly; the
// web_search drilldown serializes lazily via prettyJson, which clamps.
describe('prettyJson caps serialized result size', () => {
  it('clamps an oversized result', () => {
    const huge = 'y'.repeat(MAX_TOOL_RENDER_CHARS * 3)
    const out = prettyJson({ content: huge })

    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RENDER_CHARS + 200)
    expect(out).toContain('truncated')
  })
})

describe('countDiffLineStats', () => {
  it('counts added and removed lines', () => {
    expect(countDiffLineStats(`--- a/x\n+++ b/x\n@@\n-old\n+new\n context\n+another`)).toEqual({ added: 2, removed: 1 })
  })
})

describe('buildToolView memory status', () => {
  const memory = (overrides: Partial<Parameters<typeof part>[0]> = {}) =>
    buildToolView(part({ toolName: 'memory', ...overrides }), '')

  it('treats an explicit success payload as success even with isError', () => {
    const view = memory({
      isError: true,
      result: {
        success: true,
        entry_count: 13,
        message: 'Applied 1 operation(s).',
        duration_s: 0.003
      }
    })

    expect(view.status).toBe('success')
    expect(view.title).toBe('Saved to memory')
    expect(view.countLabel).toBe('13 entries')
    expect(view.subtitle).toBe('Applied 1 operation(s).')
  })

  it('uses soft warning copy for over-budget refusals, not "Saved"', () => {
    const view = memory({
      result: {
        success: false,
        error: 'Memory is full (2,200/2,200). Consolidate before adding more.'
      }
    })

    expect(view.status).toBe('warning')
    expect(view.title).toBe('Memory write noted')
    expect(view.subtitle).toContain('Memory is full')
  })
})
