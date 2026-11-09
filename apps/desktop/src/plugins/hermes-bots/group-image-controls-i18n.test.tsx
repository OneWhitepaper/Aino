import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hostMock, imageState } = vi.hoisted(() => ({
  hostMock: { notifyError: vi.fn(), request: vi.fn() },
  imageState: { value: true }
}))

vi.mock('@hermes/plugin-sdk', () => ({
  Button: (props: React.ComponentProps<'button'>) => <button {...props} />,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Codicon: () => null,
  host: hostMock,
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  RowButton: (props: React.ComponentProps<'button'>) => <button {...props} />,
  Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
  useI18n: () => ({ t: (key: string) => (key === 'common.remove' ? '移除' : key) }),
  useValue: () => imageState.value
}))

// Mention avatars are a separate consumer of this shared file. The image
// control test exercises generation/error copy without mounting any avatars.
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))

vi.mock('./avatar-image', () => ({
  $imagenAvailable: { get: () => imageState.value, set: (value: boolean) => (imageState.value = value) },
  normalizeAvatarImage: vi.fn(async (value: string) => value),
  pickImageFromDevice: vi.fn(),
  probeImagen: vi.fn()
}))

vi.mock('./data', () => ({ $botMeta: { get: () => ({}) }, botHandle: vi.fn(), botMentionTag: vi.fn() }))
vi.mock('./group-chat', () => ({ appendGroupChatEntry: vi.fn() }))
vi.mock('./group-membership', () => ({ groupMemberKey: vi.fn() }))
vi.mock('./group-turns', () => ({ answerGroupClarify: vi.fn() }))
vi.mock('./labels', () => ({ displayName: (member: { name?: string }) => member.name || '' }))
vi.mock('./routing', () => ({ botRosterMeta: vi.fn() }))
vi.mock('./i18n', () => ({
  useBots: () => ({
    avatar: { generate: '生成', generating: '生成中…', upload: '上传' },
    group: { pictureGenerationFailed: '群组图片生成失败' }
  })
}))

beforeEach(() => {
  vi.clearAllMocks()
  imageState.value = true
  hostMock.request.mockResolvedValue({ success: false })
})

afterEach(() => {
  cleanup()
})

describe('group picture generation fallback copy', () => {
  it('uses the localized error when image.generate omits an error message', async () => {
    const { GroupImageControls } = await import('./group-chat-parts')

    render(<GroupImageControls image={null} onImage={vi.fn()} seedName="研究组" />)
    fireEvent.click(screen.getByRole('button', { name: '生成' }))

    await waitFor(() => expect(hostMock.notifyError).toHaveBeenCalledTimes(1))

    const [error, summary] = hostMock.notifyError.mock.calls[0] as [Error, string]

    expect(error.message).toBe('群组图片生成失败')
    expect(summary).toBe('群组图片生成失败')
  })
})
