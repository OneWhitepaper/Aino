// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { CustomEndpointsResponse, CustomEndpointValidationResponse } from '@/types/hermes'

const getCustomEndpoints = vi.fn()
const saveCustomEndpoint = vi.fn()
const validateCustomEndpoint = vi.fn()
const deleteCustomEndpoint = vi.fn()
const confirm = vi.fn()
const notify = vi.fn()
const notifyError = vi.fn()

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCustomEndpoints: (...args: unknown[]) => getCustomEndpoints(...args),
  deleteCustomEndpoint: (...args: unknown[]) => deleteCustomEndpoint(...args),
  saveCustomEndpoint: (...args: unknown[]) => saveCustomEndpoint(...args),
  validateCustomEndpoint: (...args: unknown[]) => validateCustomEndpoint(...args)
}))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/confirm', () => ({ confirm: (...args: unknown[]) => confirm(...args) }))
vi.mock('@/store/notifications', () => ({
  notify: (...args: unknown[]) => notify(...args),
  notifyError: (...args: unknown[]) => notifyError(...args)
}))

const { CustomModelConfigDialog } = await import('./custom-endpoints-settings')
const emptyResponse: CustomEndpointsResponse = { current: { base_url: '', model: '', provider: '' }, endpoints: [] }
const scope = { connectionId: 'local', profile: 'writer' }
const nativeScrollIntoView = HTMLElement.prototype.scrollIntoView

const savedEndpoint = {
  id: 'saved',
  name: '团队服务',
  base_url: 'https://saved.example/v1',
  model: 'saved-model',
  models: ['saved-model'],
  discover_models: true,
  has_api_key: true,
  is_current: false
}

function renderDialog(props: Partial<React.ComponentProps<typeof CustomModelConfigDialog>> = {}) {
  return render(
    <I18nProvider configClient={null} initialLocale="zh">
      <CustomModelConfigDialog onOpenChange={vi.fn()} open scope={scope} {...props} />
    </I18nProvider>
  )
}

async function enterConnection() {
  await screen.findByRole('textbox', { name: '名称' })
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '团队模型' } })
  fireEvent.change(screen.getByRole('textbox', { name: '端点 URL' }), {
    target: { value: 'https://team.example/v1' }
  })
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'fixture-secret' } })
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  getCustomEndpoints.mockResolvedValue(emptyResponse)
  saveCustomEndpoint.mockResolvedValue({ ...emptyResponse, ok: true, id: 'team' })
  deleteCustomEndpoint.mockResolvedValue({ ...emptyResponse, ok: true })
  confirm.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  HTMLElement.prototype.scrollIntoView = nativeScrollIntoView
  vi.resetAllMocks()
})

describe('CustomModelConfigDialog', () => {
  it('keeps a saved configuration and its draft when deletion is cancelled', async () => {
    getCustomEndpoints.mockResolvedValue({ ...emptyResponse, endpoints: [savedEndpoint] })
    confirm.mockResolvedValue(false)
    const onConfigSaved = vi.fn()
    renderDialog({ onConfigSaved })
    fireEvent.click(await screen.findByText(/^已保存配置/))
    fireEvent.click(screen.getByRole('button', { name: /团队服务/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '未保存的名称' } })
    fireEvent.click(screen.getByRole('button', { name: '删除端点' }))

    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ destructive: true, title: '删除 团队服务？' }))
    expect(deleteCustomEndpoint).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('未保存的名称')
    expect(screen.getByRole('button', { name: /团队服务/ })).toBeTruthy()
    expect(onConfigSaved).not.toHaveBeenCalled()
  })

  it('deletes the selected saved configuration for its owner and resets its private draft', async () => {
    getCustomEndpoints.mockResolvedValue({ ...emptyResponse, endpoints: [savedEndpoint] })
    let finish!: (response: CustomEndpointsResponse) => void
    deleteCustomEndpoint.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const onConfigSaved = vi.fn()
    const onOpenChange = vi.fn()
    renderDialog({ onConfigSaved, onOpenChange })
    fireEvent.click(await screen.findByText(/^已保存配置/))
    fireEvent.click(screen.getByRole('button', { name: /团队服务/ }))
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'unsaved-fixture-key' } })
    fireEvent.click(screen.getByRole('button', { name: '删除端点' }))

    await waitFor(() => expect(deleteCustomEndpoint).toHaveBeenCalledWith('saved', scope))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除端点' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /团队服务/ }).disabled).toBe(true)
    await act(async () => finish({ ...emptyResponse, ok: true }))

    expect(screen.queryByText(/^已保存配置/)).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '端点 URL' }).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('API 密钥').value).toBe('')
    expect(onConfigSaved).toHaveBeenCalledOnce()
    expect(saveCustomEndpoint).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('leaves a failed deletion available for retry without losing the saved configuration', async () => {
    getCustomEndpoints.mockResolvedValue({ ...emptyResponse, endpoints: [savedEndpoint] })
    const failure = new Error('fixture-delete-failure')
    deleteCustomEndpoint.mockRejectedValue(failure)
    const onConfigSaved = vi.fn()
    renderDialog({ onConfigSaved })
    fireEvent.click(await screen.findByText(/^已保存配置/))
    fireEvent.click(screen.getByRole('button', { name: '删除端点' }))

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(failure, '删除失败'))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除端点' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /团队服务/ })).toBeTruthy()
    expect(onConfigSaved).not.toHaveBeenCalled()
  })

  it('starts with direct custom API fields and no official-provider selector', async () => {
    renderDialog()

    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: '名称' })
    const url = screen.getByRole<HTMLInputElement>('textbox', { name: '端点 URL' })
    expect(name.value).toBe('')
    expect(url.value).toBe('')
    expect(screen.getByLabelText('API 密钥')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '模型名称' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '服务商' })).toBeNull()
    expect(screen.queryByText('服务商', { exact: true })).toBeNull()
    expect(screen.queryByText(/^已保存配置/)).toBeNull()
    expect(screen.queryByRole('button', { name: '新建配置' })).toBeNull()
  })

  it('tests and saves the explicit owner without changing the default model', async () => {
    validateCustomEndpoint.mockResolvedValue({ ok: true, reachable: true, models: ['team-model'], message: '' })
    const onOpenChange = vi.fn()
    const onConfigSaved = vi.fn()
    renderDialog({ onConfigSaved, onOpenChange })
    await enterConnection()
    expect(getCustomEndpoints).toHaveBeenCalledWith(scope)
    const key = screen.getByLabelText<HTMLInputElement>('API 密钥')
    expect(key.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }))
    expect(key.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('team-model')
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onConfigSaved).toHaveBeenCalledOnce())
    expect(validateCustomEndpoint).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'fixture-secret' }), scope)
    expect(saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ make_default: false, model: 'team-model', models: ['team-model'] }),
      scope
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('discards a validation result after the endpoint credentials change', async () => {
    let finish!: (response: CustomEndpointValidationResponse) => void
    validateCustomEndpoint.mockReturnValue(new Promise(resolve => (finish = resolve)))
    renderDialog()
    await enterConnection()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    fireEvent.change(screen.getByRole('textbox', { name: '端点 URL' }), {
      target: { value: 'https://new.example/v1' }
    })
    await act(async () =>
      finish({
        ok: true,
        reachable: true,
        models: ['old-model'],
        message: '',
        resolved_base_url: 'https://old.example/v1'
      })
    )
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '端点 URL' }).value).toBe('https://new.example/v1')
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('')
    expect(notify).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: '模型名称' }), { target: { value: 'new-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'new-model', model_details: undefined, models: undefined }),
      scope
    )
  })

  it('drops a pending save after the dialog closes', async () => {
    let finish!: (response: CustomEndpointsResponse) => void
    saveCustomEndpoint.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const onConfigSaved = vi.fn()
    const view = renderDialog({ onConfigSaved })
    await enterConnection()
    fireEvent.change(screen.getByRole('combobox', { name: '模型名称' }), { target: { value: 'team-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    view.unmount()
    await act(async () => finish({ ...emptyResponse, ok: true }))
    expect(onConfigSaved).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps saved configurations collapsed and their credentials private when editing', async () => {
    getCustomEndpoints.mockResolvedValue({
      ...emptyResponse,
      endpoints: [
        {
          id: 'saved',
          name: '团队服务',
          base_url: 'https://saved.example/v1',
          model: 'saved-model',
          models: ['saved-model'],
          discover_models: true,
          has_api_key: true,
          is_current: true
        }
      ]
    })
    renderDialog()
    const summary = await screen.findByText(/^已保存配置/)
    expect(summary.closest('details')?.open).toBe(false)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('')
    expect(summary.closest('details')?.contains(screen.getByRole('button', { name: /团队服务/ }))).toBe(true)
    expect(screen.queryByRole('combobox', { name: '服务商' })).toBeNull()
    fireEvent.click(summary)
    fireEvent.click(screen.getByRole('button', { name: /团队服务/ }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('团队服务')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '端点 URL' }).value).toBe('https://saved.example/v1')
    expect(screen.getByLabelText<HTMLInputElement>('API 密钥').value).toBe('')
    expect(screen.getByPlaceholderText('留空以保留当前密钥')).toBeTruthy()
    expect(screen.getByText('高级设置').closest('details')?.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'saved', api_key: undefined, make_default: false }),
      scope
    )
  })

  it('returns from editing a saved configuration to a clean new configuration', async () => {
    getCustomEndpoints.mockResolvedValue({
      ...emptyResponse,
      endpoints: [
        {
          id: 'saved',
          name: '团队服务',
          base_url: 'https://saved.example/v1',
          model: 'saved-model',
          models: ['saved-model'],
          discover_models: true,
          has_api_key: true,
          is_current: true
        }
      ]
    })
    renderDialog()
    fireEvent.click(await screen.findByText(/^已保存配置/))
    fireEvent.click(screen.getByRole('button', { name: /团队服务/ }))
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'unsaved-fixture-key' } })
    fireEvent.click(screen.getByRole('button', { name: '显示密钥' }))
    fireEvent.click(screen.getByRole('button', { name: '新建配置' }))

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '端点 URL' }).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('')
    const key = screen.getByLabelText<HTMLInputElement>('API 密钥')
    expect(key.value).toBe('')
    expect(key.type).toBe('password')
    expect(screen.queryByRole('button', { name: '新建配置' })).toBeNull()
    expect(saveCustomEndpoint).not.toHaveBeenCalled()
  })

  it('invalidates discovered aliases when the connection key changes', async () => {
    validateCustomEndpoint.mockResolvedValue({
      ok: true,
      reachable: true,
      models: ['old-alias'],
      model_details: [{ id: 'old-alias', canonical_model: 'old-model', reasoning_effort: 'high' }],
      message: ''
    })
    renderDialog()
    await enterConnection()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('old-alias')
    )
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'new-fixture-key' } })
    fireEvent.change(screen.getByRole('combobox', { name: '模型名称' }), { target: { value: 'new-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saveCustomEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: 'new-fixture-key', model_details: undefined, models: undefined }),
      scope
    )
  })

  it('keeps a failed connection editable without saving it', async () => {
    validateCustomEndpoint.mockResolvedValue({
      ok: false,
      reachable: false,
      models: [],
      message: '连接失败，请检查地址'
    })
    const onConfigSaved = vi.fn()
    renderDialog({ onConfigSaved })
    await enterConnection()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect((await screen.findByRole('status')).textContent).toBe('连接失败，请检查地址')
    expect(screen.getByLabelText<HTMLInputElement>('API 密钥').disabled).toBe(false)
    expect(saveCustomEndpoint).not.toHaveBeenCalled()
    expect(onConfigSaved).not.toHaveBeenCalled()
  })

  it('does not apply an old owner validation after the dialog scope changes', async () => {
    let finish!: (response: CustomEndpointValidationResponse) => void
    validateCustomEndpoint.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const view = renderDialog()
    await enterConnection()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    const nextScope = { connectionId: 'other-gateway', profile: 'director' }
    view.rerender(
      <I18nProvider configClient={null} initialLocale="zh">
        <CustomModelConfigDialog onOpenChange={vi.fn()} open scope={nextScope} />
      </I18nProvider>
    )
    await waitFor(() => expect(getCustomEndpoints).toHaveBeenCalledWith(nextScope))
    await act(async () => finish({ ok: true, reachable: true, models: ['old-owner-model'], message: '' }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '名称' }).value).toBe('')
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: '模型名称' }).value).toBe('')
    expect(notify).not.toHaveBeenCalled()
  })
})
