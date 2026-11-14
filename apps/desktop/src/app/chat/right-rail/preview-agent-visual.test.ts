import { beforeEach, describe, expect, it, vi } from 'vitest'

import { actInPage } from '@/lib/preview-act/act-in-page'

import { inspectPreviewAction, type PreviewTargetInfo, sensitivePreviewAction } from './preview-agent-visual'

const draftForm: PreviewTargetInfo = {
  context: '姓名 启用预览 应用预览 提交测试',
  form: '/api/submit-preview',
  href: '',
  label: '姓名',
  role: 'textbox',
  tag: 'input',
  type: 'text'
}

describe('browser action confirmation boundaries', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 30,
      height: 20,
      left: 10,
      right: 60,
      top: 10,
      width: 50,
      x: 10,
      y: 10
    } as DOMRect)
    Element.prototype.scrollIntoView = vi.fn()
  })

  it.each([
    '<button type="submit"><span id="target">Continue</span></button>',
    '<button><svg><path id="target" /></svg><span>Continue</span></button>',
    '<button type="button" aria-label="Delete record"><svg id="target" /></button>',
    '<input type="password" id="secret"><label for="secret"><span id="target">Credential</span></label>'
  ])('inspects the activated control when clicking its text, icon or associated label: %s', async html => {
    document.body.innerHTML = `<form>${html}</form>`
    const action = { kind: 'click', selector: '#target' }
    const target = await inspectPreviewAction(async script => new Function(`return ${script}`)(), action)

    expect(sensitivePreviewAction(action, target)).toBe(true)
  })

  it('keeps an ordinary associated input and preview-button icon unconfirmed beside a submit control', async () => {
    document.body.innerHTML = `<form><input id="name"><label for="name"><span id="label">Name</span></label>
      <button type="button"><svg id="preview" /></button><button type="submit">Submit</button></form>`

    for (const selector of ['#name', '#label', '#preview']) {
      const action = { kind: 'click', selector }
      const target = await inspectPreviewAction(async script => new Function(`return ${script}`)(), action)

      expect(sensitivePreviewAction(action, target)).toBe(false)
    }
  })

  it.each([
    '<input type="button" id="target" value="Delete record">',
    '<span id="name">Delete record</span><button id="target" type="button" aria-labelledby="name"><svg /></button>',
    '<button id="target" type="button" title="Delete record"><svg /></button>'
  ])('confirms consequential controls by the same accessible name as the inventory: %s', async html => {
    document.body.innerHTML = html
    const action = { kind: 'click', selector: '#target' }
    const target = await inspectPreviewAction(async script => new Function(`return ${script}`)(), action)

    expect(target.label).toBe('Delete record')
    expect(sensitivePreviewAction(action, target)).toBe(true)
  })

  it('does not expose a password value as the confirmation target name', async () => {
    document.body.innerHTML = '<input type="password" id="target" value="private-test-secret">'
    const action = { kind: 'type', selector: '#target', text: 'replacement' }
    const target = await inspectPreviewAction(async script => new Function(`return ${script}`)(), action)

    expect(target.label).not.toContain('private-test-secret')
    expect(sensitivePreviewAction(action, target)).toBe(true)
  })

  it('joins aria-labelledby IDs in order within the target document or shadow root', async () => {
    for (const shadow of [false, true]) {
      document.body.innerHTML = '<span id="action">Preview</span><div id="host"></div>'
      const host = document.getElementById('host')!
      const root = shadow ? host.attachShadow({ mode: 'open' }) : document.body
      root.innerHTML =
        '<span id="object">record</span><span id="action">Delete</span>' +
        '<button id="target" type="button" aria-labelledby="action object"><svg /></button>'
      const action = { kind: 'click', selector: '#target' }
      const target = await inspectPreviewAction(async script => new Function(`return ${script}`)(), action)

      expect(target.label).toBe('Delete record')
      expect(sensitivePreviewAction(action, target)).toBe(true)
    }
  })

  it.each([
    { missing: true, message: 'Unknown element btn-missing' },
    { missing: false, message: 'has been removed from the page since the last snapshot' }
  ])('preserves the actionable reference error across the guest boundary: $message', async ({ missing, message }) => {
    document.body.innerHTML = '<button id="target">Continue</button>'
    const holder = {}
    Object.assign(window, { __hermesActHolder: holder })
    const [button] = actInPage(document, holder, { kind: 'elements' }).elements!

    if (!missing) {
      document.getElementById('target')!.remove()
    }

    const run = async (script: string) => {
      try {
        return new Function(`return ${script}`)()
      } catch {
        // Electron intentionally does not forward exceptions thrown by guest scripts.
        throw new Error('Script failed to execute')
      }
    }

    await expect(
      inspectPreviewAction(run, { kind: 'click', ref: missing ? 'btn-missing' : button.ref })
    ).rejects.toThrow(message)
  })

  it.each([
    { action: { kind: 'type', text: 'Alex' }, target: draftForm },
    { action: { kind: 'click' }, target: { ...draftForm, label: '启用预览', role: 'checkbox', type: 'checkbox' } },
    {
      action: { kind: 'click' },
      target: { ...draftForm, label: '应用预览', role: 'button', tag: 'button', type: 'button' }
    }
  ])(
    'does not confirm ordinary $action.kind on $target.label because its form contains a submit button',
    ({ action, target }) => {
      expect(sensitivePreviewAction(action, target)).toBe(false)
    }
  )

  it.each([
    '提交测试',
    'Delete',
    '删除记录',
    'Send',
    '发送消息',
    'Pay',
    '付款',
    '授权',
    '修改密码',
    'Revoke permission'
  ])('confirms the actual %s target', label => {
    expect(sensitivePreviewAction({ kind: 'click' }, { ...draftForm, label, tag: 'button', type: 'button' })).toBe(true)
  })

  it.each([
    { tag: 'button', type: 'submit' },
    { tag: 'input', type: 'submit' },
    { tag: 'button', type: '' }
  ])('confirms an actual form submit control $tag/$type regardless of its name', overrides => {
    expect(sensitivePreviewAction({ kind: 'click' }, { ...draftForm, label: 'Continue', ...overrides })).toBe(true)
  })

  it.each([
    { context: '支付信息 持卡人姓名 信用卡', form: '/checkout' },
    { context: 'Payment details Cardholder name', form: '/order' },
    { context: '账户安全 更改密码', form: '/settings' },
    { context: 'Account security settings', form: '/settings' },
    { context: 'Access permissions', form: '/settings' },
    { context: '姓名', form: '/account/security' },
    { context: 'Name', form: '/billing/payment-method' }
  ])('preserves confirmation for a draft field in sensitive context $context ($form)', context => {
    expect(sensitivePreviewAction({ kind: 'type', text: 'Alex' }, { ...draftForm, ...context })).toBe(true)
  })

  it('confirms password fields even without contextual copy', () => {
    expect(
      sensitivePreviewAction(
        { kind: 'type', text: 'secret' },
        { ...draftForm, context: '', label: '', type: 'password' }
      )
    ).toBe(true)
  })

  it.each([
    { coordinate: [20, 30] as [number, number], kind: 'click' },
    { coordinate: [20, 30] as [number, number], kind: 'drag', toCoordinate: [40, 50] as [number, number] },
    { kind: 'type', submit: true, text: 'Alex' },
    { kind: 'press', key: 'Enter' },
    { kind: 'click', sensitive: true }
  ])('continues confirming explicit or visual mutation $kind', action => {
    expect(sensitivePreviewAction(action, draftForm)).toBe(true)
  })

  it('does not confirm observation-only hovering over a sensitive control', () => {
    expect(sensitivePreviewAction({ coordinate: [20, 30], kind: 'hover' }, { ...draftForm, label: 'Pay' })).toBe(false)
  })
})
