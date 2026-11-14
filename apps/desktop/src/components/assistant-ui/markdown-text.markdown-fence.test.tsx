import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeClipboardText } from '@/lib/clipboard'

import { MarkdownTextContent } from './markdown-text'

vi.mock('@/lib/clipboard', () => ({ writeClipboardText: vi.fn(async () => {}) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const body = '# 排查任务\n\n## 环境信息\n- **产品**：Aino\n- **模型**：`GLM-5.3-Flash`\n\n1. 切换账号\n2. 检查工作区\n'

const fence = (language: string, content: string, closed = true) =>
  `\`\`\`${language}\n${content}${closed ? `${content.endsWith('\n') ? '' : '\n'}\`\`\`` : ''}`

describe('Markdown source in a reply', () => {
  it.each(['md', 'markdown'])('renders and copies %s as source inside a separate card', async language => {
    const source = `直接复制下面的提示词：\n\n${fence(language, body)}\n\n发送后查看结果。`
    const { container } = render(<MarkdownTextContent isRunning={false} text={source} />)
    const card = container.querySelector<HTMLElement>('[data-slot="code-card"]')

    expect(card).not.toBeNull()
    expect(card?.querySelector('pre')?.textContent).toBe(body)
    expect(container.querySelector('h1, h2, ul, ol')).toBeNull()
    expect(screen.getByText('直接复制下面的提示词：')).toBeTruthy()
    expect(screen.getByText('发送后查看结果。')).toBeTruthy()

    fireEvent.click(within(card!).getByRole('button', { name: /^Copy/ }))
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(body))
  })

  it('keeps the source card while a Markdown fence grows and closes', async () => {
    const { container, rerender } = render(<MarkdownTextContent isRunning text={fence('markdown', '# 排查', false)} />)

    for (const content of ['# 排查任务\n\n- **产品**：Aino', body]) {
      await act(async () => rerender(<MarkdownTextContent isRunning text={fence('markdown', content, false)} />))
      expect(container.querySelector('[data-slot="code-card"]')).not.toBeNull()
      expect(container.querySelector('h1, h2, ul')).toBeNull()
      // CommonMark terminates the last code line, including an open streaming fence.
      expect(container.querySelector('pre')?.textContent).toBe(content.endsWith('\n') ? content : `${content}\n`)
    }

    await act(async () => rerender(<MarkdownTextContent isRunning={false} text={fence('markdown', body)} />))
    expect(container.querySelector('[data-slot="code-card"] pre')?.textContent).toBe(body)
  })

  it('leaves ordinary Markdown replies and the plain word markdown as prose', () => {
    const { container } = render(<MarkdownTextContent isRunning={false} text={`markdown\n\n${body}`} />)

    expect(container.querySelector('[data-slot="code-card"]')).toBeNull()
    expect(screen.getByRole('heading', { name: '排查任务' })).toBeTruthy()
    expect(container.querySelector('ul')).not.toBeNull()
  })

  it('keeps nested code examples and inline backticks intact in the copied document', async () => {
    const document = '# 使用说明\n\nUse ``a ` b``.\n\n```ts\nconst model = "ready";\n```\n\n- **保留**：原始源码\n'

    const { container } = render(
      <MarkdownTextContent isRunning={false} text={`\`\`\`\`markdown\n${document}\`\`\`\``} />
    )

    const card = container.querySelector<HTMLElement>('[data-slot="code-card"]')

    expect(container.querySelectorAll('[data-slot="code-card"]')).toHaveLength(1)
    expect(card?.querySelector('pre')?.textContent).toBe(document)
    fireEvent.click(within(card!).getByRole('button', { name: /^Copy/ }))
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(document))
  })
})
