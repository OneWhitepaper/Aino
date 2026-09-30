import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider, TRANSLATIONS, useI18n } from '@/i18n'
import type { I18nContextValue } from '@/i18n'
import { PRODUCT_NAME } from '@/lib/brand'

import { UninstallSection } from './uninstall-section'

let i18n: I18nContextValue

function Surface() {
  i18n = useI18n()

  return <UninstallSection />
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it.each(['gui', 'lite', 'full'] as const)(
  'localizes confirmation for %s without changing mode or running before confirmation',
  async mode => {
    const run = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('hermesDesktop', {
      uninstall: { summary: async () => ({ agent_installed: true, running_app_path: '/fixture/Hermes.app' }), run }
    })
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Surface />
      </I18nProvider>
    )
    const zh = TRANSLATIONS.zh.settings.uninstall
    const zhTitle = { gui: zh.guiTitle, lite: zh.liteTitle, full: zh.fullTitle }[mode]

    const zhConsequence = {
      gui: zh.guiConsequence,
      lite: zh.liteConsequence(PRODUCT_NAME),
      full: zh.fullConsequence(PRODUCT_NAME)
    }[mode]

    await screen.findByText(zh.heading(PRODUCT_NAME))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zhTitle) }))
    expect(screen.getByText(zh.confirmBody(zhConsequence))).toBeTruthy()
    expect(run).not.toHaveBeenCalled()
    await act(() => i18n.setLocale('ja'))
    const ja = TRANSLATIONS.ja.settings.uninstall

    const jaConsequence = {
      gui: ja.guiConsequence,
      lite: ja.liteConsequence(PRODUCT_NAME),
      full: ja.fullConsequence(PRODUCT_NAME)
    }[mode]

    expect(screen.getByText(ja.confirmBody(jaConsequence))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: ja.yesUninstall }))
    expect(run).toHaveBeenCalledWith(mode)
  }
)
