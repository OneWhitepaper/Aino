import { beforeEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, openPreview, type PreviewTarget } from '@/store/preview'

import { registerPreviewScriptRunner } from './preview-script-runner'
import { runPreviewTour } from './preview-tour'

function urlTarget(url: string): PreviewTarget {
  return { kind: 'url', label: 'Browser', source: url, url }
}

describe('runPreviewTour', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    cleanup?.()
    cleanup = undefined
    closeRightRail()
    setRuntimeI18nLocale('en')
  })

  it('localizes the missing-page error for Simplified Chinese users', async () => {
    setRuntimeI18nLocale('zh')

    expect(await runPreviewTour({ kind: 'targets' })).toEqual({
      error: '预览面板中没有打开可交互的页面——请先打开一个页面。',
      success: false
    })
  })

  it('localizes a page that does not answer the tour action', async () => {
    setRuntimeI18nLocale('zh')
    openPreview(urlTarget('https://example.com'))
    cleanup = registerPreviewScriptRunner($rightRailActiveTabId.get()!, async () => '')

    expect(await runPreviewTour({ kind: 'targets' })).toEqual({
      error: '页面没有回应导览操作。',
      success: false
    })
  })
})
