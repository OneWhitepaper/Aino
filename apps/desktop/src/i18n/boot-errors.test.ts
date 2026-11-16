import { describe, expect, it } from 'vitest'

import { localizedBootFailureError } from './boot-errors'
import { TRANSLATIONS } from './catalog'

describe('localizedBootFailureError', () => {
  it('translates the desktop boot prefix while retaining the diagnostic detail', () => {
    expect(
      localizedBootFailureError(
        TRANSLATIONS.zh,
        'Desktop boot failed: Could not verify the existing SSH backend. Log: /tmp/aino.log'
      )
    ).toBe('桌面启动失败：Could not verify the existing SSH backend. Log: /tmp/aino.log')
  })

  it('translates backend start and before-ready exit prefixes', () => {
    expect(localizedBootFailureError(TRANSLATIONS.zh, 'Aino backend failed to start: spawn aino ENOENT')).toBe(
      'Aino 后端启动失败：spawn aino ENOENT'
    )
    expect(
      localizedBootFailureError(
        TRANSLATIONS.zh,
        'Aino backend exited before it became ready (1).\nRecent backend output:\nModuleNotFoundError: hermes_cli'
      )
    ).toBe('Aino 后端在准备就绪前退出（1）。\nRecent backend output:\nModuleNotFoundError: hermes_cli')
  })

  it('translates profile-scoped backend failures without changing the profile or detail', () => {
    expect(
      localizedBootFailureError(
        TRANSLATIONS.zh,
        'Aino backend for profile "Hermes work" exited before it became ready (SIGTERM).\nHermes traceback (most recent call last)'
      )
    ).toBe('Aino 机器人“Hermes work”的后端在准备就绪前退出（SIGTERM）。\nHermes traceback (most recent call last)')
  })

  it('leaves unknown and already-localized diagnostics unchanged', () => {
    expect(localizedBootFailureError(TRANSLATIONS.zh, 'Could not connect to gateway: ECONNREFUSED')).toBe(
      'Could not connect to gateway: ECONNREFUSED'
    )
    expect(localizedBootFailureError(TRANSLATIONS.zh, null)).toBe('')
  })

  it('does not brand-rewrite dynamic backend diagnostics', () => {
    expect(
      localizedBootFailureError(TRANSLATIONS.zh, 'Aino backend failed to start: Hermes plugin reported a failure')
    ).toBe('Aino 后端启动失败：Hermes plugin reported a failure')
  })

  it('does not brand-rewrite diagnostics after the desktop boot prefix', () => {
    expect(localizedBootFailureError(TRANSLATIONS.zh, 'Desktop boot failed: Hermes reported a startup failure')).toBe(
      '桌面启动失败：Hermes reported a startup failure'
    )
  })

  it('keeps the English error contract intact', () => {
    expect(localizedBootFailureError(TRANSLATIONS.en, 'Aino backend failed to start: spawn aino ENOENT')).toBe(
      'Aino backend failed to start: spawn aino ENOENT'
    )
    expect(
      localizedBootFailureError(TRANSLATIONS.en, 'Aino backend exited before it became ready (1). Log: /tmp/aino.log')
    ).toBe('Aino backend exited before it became ready (1). Log: /tmp/aino.log')
  })
})
