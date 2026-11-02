import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ProfileScope } from '@/api/client'
import { queryClient } from '@/lib/query-client'
import {
  $customModelConfigTarget,
  closeCustomModelConfig,
  openCustomModelConfig,
  setModelVisibilityOpen
} from '@/store/model-visibility'
import { $activeSessionId, $gatewayState } from '@/store/session'

import { ModelVisibilityOverlay } from './model-visibility-overlay'

interface ConfigDialogProps {
  onConfigSaved?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  scope?: ProfileScope
}

vi.mock('@/app/settings/custom-endpoints-settings', () => ({
  CustomModelConfigDialog: ({ open, scope, onOpenChange, onConfigSaved }: ConfigDialogProps) =>
    open ? (
      <div aria-label="配置自定义模型" role="dialog">
        <output aria-label="配置所属工作区">{JSON.stringify(scope)}</output>
        <button onClick={() => onOpenChange(false)}>关闭配置</button>
        <button
          onClick={() => {
            onConfigSaved?.()
            onOpenChange(false)
          }}
        >
          保存配置
        </button>
      </div>
    ) : null
}))

vi.mock('@/app/settings/third-party-model-settings', () => ({
  ThirdPartyModelConfigDialog: ({
    open,
    scope,
    providerId,
    onOpenChange,
    onConfigSaved
  }: ConfigDialogProps & { providerId?: string }) =>
    open ? (
      <div aria-label="配置第三方服务" role="dialog">
        <output aria-label="服务所属工作区">{JSON.stringify(scope)}</output>
        <output aria-label="服务商">{providerId}</output>
        <button onClick={() => onOpenChange(false)}>关闭服务配置</button>
        <button onClick={onConfigSaved}>保存服务配置</button>
      </div>
    ) : null
}))

vi.mock('@/components/model-visibility-dialog', () => ({
  ModelVisibilityDialog: ({ open }: { open: boolean }) =>
    open ? <div aria-label="管理模型可见性" role="dialog" /> : null
}))

beforeEach(() => {
  queryClient.clear()
  closeCustomModelConfig()
  setModelVisibilityOpen(false)
  $activeSessionId.set(null)
  $gatewayState.set('open')
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  closeCustomModelConfig()
  setModelVisibilityOpen(false)
  $activeSessionId.set(null)
  $gatewayState.set('closed')
})

it('keeps the requested connection and profile when the ambient gateway changes or disconnects', () => {
  openCustomModelConfig({ connectionId: 'bot-owner', profile: 'research-bot' })

  const { rerender } = render(
    <ModelVisibilityOverlay onOpenProviders={vi.fn()} ownerConnectionId="primary" profile="default" />
  )

  expect(screen.getByRole('dialog', { name: '配置自定义模型' })).toBeTruthy()
  expect(screen.getByLabelText('配置所属工作区').textContent).toBe(
    JSON.stringify({ connectionId: 'bot-owner', profile: 'research-bot' })
  )

  act(() => {
    $activeSessionId.set('unrelated-session')
    $gatewayState.set('closed')
  })
  rerender(<ModelVisibilityOverlay onOpenProviders={vi.fn()} ownerConnectionId="other-host" profile="other-profile" />)

  expect(screen.getByRole('dialog', { name: '配置自定义模型' })).toBeTruthy()
  expect(screen.getByLabelText('配置所属工作区').textContent).toBe(
    JSON.stringify({ connectionId: 'bot-owner', profile: 'research-bot' })
  )
})

it('opens while the ambient gateway is disconnected and clears the target on close', () => {
  $gatewayState.set('closed')
  openCustomModelConfig({ connectionId: 'local', profile: 'writer' })
  render(<ModelVisibilityOverlay onOpenProviders={vi.fn()} profile="default" />)

  expect(screen.getByRole('dialog', { name: '配置自定义模型' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭配置' }))

  expect($customModelConfigTarget.get()).toBeNull()
  expect(screen.queryByRole('dialog', { name: '配置自定义模型' })).toBeNull()
})

it('invalidates model catalogs after saving without invalidating unrelated settings', () => {
  const ownerCatalog = ['model-options', 'bot-owner::writer']
  const primaryCatalog = ['model-options', 'local::default']
  const settingsKey = ['settings', 'bot-owner::writer']
  queryClient.setQueryData(ownerCatalog, { providers: [] })
  queryClient.setQueryData(primaryCatalog, { providers: [] })
  queryClient.setQueryData(settingsKey, { theme: 'light' })
  openCustomModelConfig({ connectionId: 'bot-owner', profile: 'writer' })
  render(<ModelVisibilityOverlay onOpenProviders={vi.fn()} profile="default" />)

  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

  expect(queryClient.getQueryState(ownerCatalog)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(primaryCatalog)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(settingsKey)?.isInvalidated).toBe(false)
  expect($customModelConfigTarget.get()).toBeNull()
})

it('keeps the requested official provider and owner when ambient navigation moves elsewhere', () => {
  const target = {
    connectionId: 'remote-bot',
    profile: 'research-bot',
    kind: 'provider' as const,
    providerId: 'deepseek'
  }

  openCustomModelConfig(target)

  const view = render(
    <ModelVisibilityOverlay onOpenProviders={vi.fn()} ownerConnectionId="primary" profile="default" />
  )

  expect(screen.getByRole('dialog', { name: '配置第三方服务' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '配置自定义模型' })).toBeNull()
  expect(screen.getByLabelText('服务商').textContent).toBe('deepseek')
  expect(screen.getByLabelText('服务所属工作区').textContent).toBe(JSON.stringify(target))

  act(() => {
    $activeSessionId.set('another-session')
    $gatewayState.set('closed')
  })
  view.rerender(
    <ModelVisibilityOverlay onOpenProviders={vi.fn()} ownerConnectionId="other-host" profile="other-profile" />
  )

  expect(screen.getByLabelText('服务商').textContent).toBe('deepseek')
  expect(screen.getByLabelText('服务所属工作区').textContent).toBe(JSON.stringify(target))
  fireEvent.click(screen.getByRole('button', { name: '关闭服务配置' }))
  expect($customModelConfigTarget.get()).toBeNull()
  expect(screen.queryByRole('dialog', { name: '配置第三方服务' })).toBeNull()
})

it('opens official provider setup while the ambient gateway is disconnected', () => {
  $gatewayState.set('closed')
  openCustomModelConfig({ connectionId: 'local', profile: 'writer', kind: 'provider' })
  render(<ModelVisibilityOverlay onOpenProviders={vi.fn()} profile="default" />)

  expect(screen.getByRole('dialog', { name: '配置第三方服务' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '配置自定义模型' })).toBeNull()
})

it('refreshes model catalogs after an official provider save and keeps the provider dialog usable', () => {
  const ownerCatalog = ['model-options', 'remote-bot::writer']
  const settingsKey = ['settings', 'remote-bot::writer']
  queryClient.setQueryData(ownerCatalog, { providers: [] })
  queryClient.setQueryData(settingsKey, { theme: 'light' })
  openCustomModelConfig({ connectionId: 'remote-bot', profile: 'writer', kind: 'provider', providerId: 'deepseek' })
  render(<ModelVisibilityOverlay onOpenProviders={vi.fn()} profile="default" />)

  fireEvent.click(screen.getByRole('button', { name: '保存服务配置' }))

  expect(queryClient.getQueryState(ownerCatalog)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(settingsKey)?.isInvalidated).toBe(false)
  expect(screen.getByRole('dialog', { name: '配置第三方服务' })).toBeTruthy()
  expect(screen.getByLabelText('服务商').textContent).toBe('deepseek')
})
