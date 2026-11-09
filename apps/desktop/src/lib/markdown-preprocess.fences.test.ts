import { describe, expect, it } from 'vitest'

import { normalizeFilePreviewMath, preprocessMarkdown } from '@/lib/markdown-preprocess'

// Listings whose own text carries fence characters: a ``` mid-line, and the
// inner fences of a markdown example fenced with a longer or other marker.
// Each must reach the renderer byte-for-byte, with the prose after it outside.
const LISTINGS = [
  ['```python', 'def is_fence(line):', '    return line.startswith("```")', 'first = parts[0]', 'cost = "$5"', '```'],
  ['````markdown', '```js', 'const a = arr[0];', '```', '````'],
  ['~~~md', '```sh', 'export A=$5; echo \\(x\\)', '```', '~~~'],
  ['```js', 'const tilde = "~~~ and $5 [1]"', '```']
].map(lines => lines.join('\n'))

describe('fenced code segmentation', () => {
  it.each(['md', 'markdown'])('preserves explicit %s source throughout streaming', language => {
    const body = '# 排查任务\n\n- **账号**：核对目录\n- **模型**：`GLM-5.3-Flash`\n\n保留 $5、items[0] 和 https://example.com。'

    for (const suffix of ['', '\n```']) {
      const source = `复制以下内容：\n\n\`\`\`${language}\n${body}${suffix}`

      expect(preprocessMarkdown(source)).toBe(source)
    }
  })

  it.each(['md', 'markdown'])('does not consume URL-only %s source as a preview handoff', language => {
    for (const body of ['http://localhost:3000/', 'https://example.com/a\nhttps://example.com/b']) {
      const source = `\`\`\`${language}\n${body}\n\`\`\``

      expect(preprocessMarkdown(source)).toBe(source)
    }
  })

  it('keeps a listing that contains fence characters intact in chat markdown', () => {
    for (const listing of LISTINGS) {
      const output = preprocessMarkdown(`Example:\n\n${listing}\n\nAfter the example.`)

      expect(output).toContain(listing)
      expect(output.endsWith(`${listing}\n\nAfter the example.`)).toBe(true)
    }
  })

  it('keeps the same listings intact in a file preview, CRLF included', () => {
    for (const listing of [...LISTINGS, '```sh\r\nexport A=$5\r\n```']) {
      const input = `Intro \\(y\\)\n\n${listing}\n\nOutro`

      expect(normalizeFilePreviewMath(input)).toBe(`Intro $y$\n\n${listing}\n\nOutro`)
    }
  })
})
