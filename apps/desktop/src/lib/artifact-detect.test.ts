import { describe, expect, it } from 'vitest'

import {
  artifactContentHash,
  artifactDownloadName,
  artifactSlug,
  detectArtifact,
  detectStandaloneHtmlArtifact
} from './artifact-detect'

const HTML_DOC = `<!doctype html>
<html>
<head><title>Pomodoro Timer</title></head>
<body>
<h1>Pomodoro</h1>
<script>let t = 25 * 60; setInterval(() => { t -= 1 }, 1000)</script>
</body>
</html>`

function longCode(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `export function helper${i}(value: number) { return value * ${i} }`
  ).join('\n')
}

describe('detectArtifact', () => {
  it('promotes a full html document', () => {
    const detection = detectArtifact('html', HTML_DOC)

    expect(detection).not.toBeNull()
    expect(detection?.kind).toBe('html')
    expect(detection?.title).toBe('Pomodoro Timer')
  })

  it('falls back to h1 when the document has no title tag', () => {
    const doc = `<!doctype html><html><body><h1>Budget <em>Dashboard</em></h1>${'<div>x</div>'.repeat(30)}</body></html>`

    expect(detectArtifact('html', doc)?.title).toBe('Budget Dashboard')
  })

  it('ignores a small html snippet', () => {
    expect(detectArtifact('html', '<div class="chip">hello</div>')).toBeNull()
  })

  it.each([
    ['document', '<html>', '</html>', 160],
    ['fragment', '<div>', '</div>', 1200]
  ] as const)('promotes an HTML %s only at its trimmed size threshold', (_kind, start, end, minChars) => {
    const content = `${start}${'x'.repeat(minChars - start.length - end.length)}${end}`

    for (const language of ['html', 'htm', 'xhtml']) {
      expect(detectArtifact(language, ` \n${content.replace('x', '')}\n `)).toBeNull()
      expect(detectArtifact(language, ` \n${content}\n `)).toEqual({
        kind: 'html',
        language,
        title: 'HTML'
      })
    }
  })

  it('requires HTML markup even when a declared HTML fence is long enough', () => {
    const text = 'x'.repeat(3000)

    for (const language of ['html', 'htm', 'xhtml']) {
      expect(detectArtifact(language, text)).toBeNull()
    }
  })

  it('ignores small svg fences (inline embed owns them)', () => {
    expect(detectArtifact('svg', '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')).toBeNull()
  })

  it('promotes a large svg', () => {
    const svg = `<svg viewBox="0 0 100 100"><title>Org Chart</title>${'<rect x="1" y="2" width="3" height="4"/>'.repeat(80)}</svg>`
    const detection = detectArtifact('svg', svg)

    expect(detection?.kind).toBe('svg')
    expect(detection?.title).toBe('Org Chart')
  })

  it('keeps short code inline', () => {
    expect(detectArtifact('python', 'print("hi")')).toBeNull()
  })

  it('promotes long code and derives a declaration title', () => {
    const code = `export function buildDashboard(config: Config) {\n${longCode(60)}\n}`
    const detection = detectArtifact('typescript', code)

    expect(detection?.kind).toBe('code')
    expect(detection?.title).toBe('buildDashboard')
  })

  it('prefers a filename comment for the title', () => {
    const code = `# server.py\n${longCode(60)
      .replace(/export function/g, 'def')
      .replace(/\{|\}/g, '')}`

    const detection = detectArtifact('python', code)

    expect(detection?.kind).toBe('code')
    expect(detection?.title).toBe('server.py')
  })

  it('never promotes prose-ish or terminal fences', () => {
    expect(detectArtifact('text', longCode(80))).toBeNull()
    expect(detectArtifact('text', HTML_DOC)).toBeNull()
    expect(detectArtifact('diff', longCode(80))).toBeNull()
    expect(detectArtifact('markdown', longCode(80))).toBeNull()
    expect(detectArtifact('mermaid', longCode(80))).toBeNull()
  })

  it('leaves rich-renderer fences alone however long they get', () => {
    // Detection runs before the rich-fence registry, so a long `listing` set
    // (or any renderer-owned language) would otherwise be stolen by the code
    // card and never render as its own component.
    expect(detectArtifact('listing', longCode(200))).toBeNull()
  })
})

describe('detectStandaloneHtmlArtifact', () => {
  it.each([
    ['prose discussing a document', `The <html> root contains the page, for example:\n${HTML_DOC}`],
    ['a long inline fragment', `<div>${'<p>This remains ordinary inline HTML.</p>'.repeat(50)}</div>`],
    ['an explicitly text-only fence', `\`\`\`text\n${HTML_DOC}\n\`\`\``]
  ])('does not promote %s into an executable artifact', (_label, text) => {
    expect(detectStandaloneHtmlArtifact(text)).toBeNull()
  })
})

describe('artifactSlug', () => {
  it('distinguishes different titles', () => {
    expect(artifactSlug({ kind: 'html', language: 'html', title: 'Timer' })).not.toBe(
      artifactSlug({ kind: 'html', language: 'html', title: 'Dashboard' })
    )
  })

  it('handles empty/symbol-only titles', () => {
    expect(artifactSlug({ kind: 'code', language: 'ts', title: '!!!' })).toBe('code:ts:untitled')
  })
})

describe('artifactContentHash', () => {
  it('is deterministic and content-sensitive', () => {
    expect(artifactContentHash('abc')).toBe(artifactContentHash('abc'))
    expect(artifactContentHash('abc')).not.toBe(artifactContentHash('abd'))
  })
})

describe('artifactDownloadName', () => {
  it('keeps an existing extension', () => {
    expect(artifactDownloadName('code', 'python', 'server.py')).toBe('server.py')
  })

  it('appends by kind and language', () => {
    expect(artifactDownloadName('html', 'html', 'Pomodoro Timer')).toBe('Pomodoro-Timer.html')
    expect(artifactDownloadName('svg', 'svg', 'Org Chart')).toBe('Org-Chart.svg')
    expect(artifactDownloadName('code', 'typescript', 'buildDashboard')).toBe('buildDashboard.ts')
    expect(artifactDownloadName('code', 'unknownlang', '')).toBe('artifact.txt')
  })
})
