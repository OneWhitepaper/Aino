import { describe, expect, it } from 'vitest'

import { preprocessMarkdown } from './markdown-preprocess'

describe('Markdown source fences while the outer block is still streaming', () => {
  it.each([
    ['````', 'markdown'],
    ['~~~', 'md']
  ])('does not repeat a closed inner listing inside an open %s%s block', (marker, language) => {
    const body = '# README\n\n```sh\necho ok\n```\n\nMore text'
    const open = `${marker}${language}\n${body}`

    expect(preprocessMarkdown(open)).toBe(open)
    expect(preprocessMarkdown(`${open}\n${marker}`)).toBe(`${open}\n${marker}`)
  })

  it.each(['md', 'markdown'])('preserves a %s fence with metadata before its closing marker arrives', language => {
    const body = '# README\n\n- **账号**：保留标题\n- **模型**：保留列表'
    const open = `\`\`\`${language} title="README.md"\n${body}`
    const normalized = `\`\`\`${language}\n${body}`

    expect(preprocessMarkdown(open)).toBe(normalized)
    expect(preprocessMarkdown(`${open}\n\`\`\``)).toBe(`${normalized}\n\`\`\``)
  })

  it('retains ordinary code with metadata and still repairs prose masquerading as fence info', () => {
    expect(preprocessMarkdown('```ts title="example.ts"\nconst value = 1;')).toBe('```ts\nconst value = 1;')

    const prose = '```Heads up - a bunny got added\n- Pure white (`#ffffff`)\n- Ambient dropped to 0.18'

    expect(preprocessMarkdown(prose)).toBe(prose.replace('```', ''))
  })

  it.each(['```', '~~~'])('preserves literal double-backtick syntax within a %smarkdown source block', marker => {
    const body = '# Example\n\nUse ``a ` b``.\n\nKeep the literal sequence: `` ``.'
    const open = `${marker}markdown\n${body}`

    expect(preprocessMarkdown(open)).toBe(open)
    expect(preprocessMarkdown(`${open}\n${marker}`)).toBe(`${open}\n${marker}`)
  })
})
