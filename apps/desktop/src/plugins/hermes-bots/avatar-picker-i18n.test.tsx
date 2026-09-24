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
  ColorSwatches: () => null,
  GlyphSpinner: () => null,
  host: hostMock,
  PROFILE_SWATCHES: [],
  RowButton: (props: React.ComponentProps<'button'>) => <button {...props} />,
  SegmentedControl: ({
    onChange,
    options,
    value
  }: {
    onChange: (id: string) => void
    options: Array<{ id: string; label: string }>
    value: string
  }) => (
    <div data-value={value}>
      {options.map(option => (
        <button key={option.id} onClick={() => onChange(option.id)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
  Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
  useValue: () => imageState.value
}))

vi.mock('./avatar', () => ({
  AVATAR_PICKER_SHAPES: ['circle'],
  BLOB_KINDS: [],
  BotFace: () => null,
  avatarColor: () => '#000000',
  blobShapeString: () => 'blobatar',
  blobatarSvg: false,
  defaultShapeFor: () => 'circle',
  isBlobShape: () => false,
  parseBlobShape: () => ({ kind: '', seed: '', seedPart: '' })
}))

vi.mock('./avatar-image', () => ({
  $imagenAvailable: { get: () => imageState.value, set: (value: boolean) => (imageState.value = value) },
  generateAvatarImage: vi.fn(),
  normalizeAvatarImage: vi.fn(async (value: string) => value),
  pickImageFromDevice: vi.fn(),
  probeImagen: vi.fn()
}))

vi.mock('./i18n', () => ({
  useBots: () => ({
    avatar: {
      auto: '自动',
      autoTitle: '自动',
      chooseImage: '选择图片',
      describeHint: '描述',
      describePlaceholder: '描述你的头像…',
      faceFollowsName: '头像跟随名称',
      faceLocked: '头像已锁定',
      generate: '生成',
      generationFailed: '头像生成失败',
      generating: '生成中…',
      imageTooLarge: '图片过大',
      matchTheName: '匹配名称',
      noImageModel: '没有图像模型',
      petLoadFailed: '宠物加载失败',
      petGalleryEmpty: '没有宠物',
      petNoMatch: '没有匹配',
      petScrollMore: () => '更多',
      pickPet: '选择宠物',
      removeImage: '移除图片',
      tabBot: '机器人',
      tabGenerate: '生成',
      tabPet: '宠物',
      tabUpload: '上传',
      upload: '上传',
      checkingImageBackend: '检查中…'
    },
    bot: { descriptionHint: '描述提示' }
  })
}))

vi.mock('./pet', () => ({ PetTab: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  imageState.value = true
  hostMock.request.mockResolvedValue({ success: false })
})

afterEach(() => {
  cleanup()
})

describe('avatar generation fallback copy', () => {
  it('uses the localized error when image.generate omits an error message', async () => {
    const { AvatarPicker } = await import('./avatar-picker')

    render(
      <AvatarPicker color={null} image={null} onColor={vi.fn()} onImage={vi.fn()} onShape={vi.fn()} shape="circle" />
    )

    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    fireEvent.change(screen.getByPlaceholderText('描述你的头像…'), { target: { value: '一只狐狸' } })

    const generateButtons = screen.getAllByRole('button', { name: '生成' })
    fireEvent.click(generateButtons.at(-1)!)

    await waitFor(() => expect(hostMock.notifyError).toHaveBeenCalledTimes(1))

    const [error, summary] = hostMock.notifyError.mock.calls[0] as [Error, string]

    expect(error.message).toBe('头像生成失败')
    expect(summary).toBe('头像生成失败')
  })
})
