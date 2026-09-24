import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  DEFAULT_NATIVE_LOCALE,
  NATIVE_LOCALES,
  type NativeLocale,
  nativeLocaleCopy,
  normalizeNativeLocale
} from './native-locale'

describe('Electron-owned locale copy', () => {
  test('keeps the native surface in sync for every supported locale', () => {
    const expected: NativeLocale[] = ['en', 'zh', 'zh-hant', 'ja', 'ar']

    assert.deepEqual(NATIVE_LOCALES, expected)

    for (const locale of expected) {
      const copy = nativeLocaleCopy(locale)

      assert.equal(typeof copy.file, 'string')
      assert.equal(typeof copy.newWindow, 'string')
      assert.equal(typeof copy.saveFile, 'string')
      assert.equal(typeof copy.saveImage, 'string')
      assert.equal(copy.about('Aino').includes('Aino'), true)
      assert.equal(copy.signInGateway('Aino').includes('Aino'), true)
      assert.equal(copy.updateTitle('Aino').includes('Aino'), true)
    }
  })

  test('normalizes persisted and operating-system locale aliases', () => {
    assert.equal(normalizeNativeLocale('zh-CN'), 'zh')
    assert.equal(normalizeNativeLocale('zh_Hant_TW'), 'zh-hant')
    assert.equal(normalizeNativeLocale('ja-JP'), 'ja')
    assert.equal(normalizeNativeLocale('ar_EG'), 'ar')
    assert.equal(normalizeNativeLocale('de-DE'), DEFAULT_NATIVE_LOCALE)
    assert.equal(normalizeNativeLocale(null), DEFAULT_NATIVE_LOCALE)
  })

  test('never returns raw keys for the native copy fallback', () => {
    const copy = nativeLocaleCopy('unsupported')

    assert.equal(copy.file, 'File')
    assert.equal(copy.saveFile, 'Save File')
  })

  test('localizes main-process boot progress copy', () => {
    const copy = nativeLocaleCopy('zh').bootProgress

    assert.equal(copy.waitingToStartBackend('Aino'), '正在等待 Aino 后端启动')
    assert.equal(copy.waitingForSetup, '正在等待首次设置选择')
    assert.equal(copy.waitingForSetupAfterSeconds(3), '首次设置选择仍未完成，已等待 3 秒')
    assert.equal(copy.restartingConnection, '正在重新启动桌面连接')
  })

  test('localizes backend startup progress while preserving dynamic runtime details', () => {
    const copy = nativeLocaleCopy('zh').bootProgress

    assert.equal(copy.updateFinishing('Aino'), '更新正在完成，Aino 将在完成后自动启动…')
    assert.equal(copy.usingBackend('/opt/aino/venv/bin/python'), '正在使用 /opt/aino/venv/bin/python')
    assert.equal(copy.runtimeReady('Aino'), 'Aino 运行时已就绪')
    assert.equal(copy.resolvingBackend('Aino'), '正在解析 Aino 后端')
    assert.equal(
      copy.connectingRemoteBackend('Aino', 'https://example.test:8443'),
      '正在连接远程 Aino 后端：https://example.test:8443'
    )
    assert.equal(copy.remoteBackendReady('Aino'), '远程 Aino 后端已就绪')
    assert.equal(copy.resolvingRuntime('Aino'), '正在解析 Aino 运行时')
    assert.equal(copy.startingBackendVia('Aino', 'uv-managed runtime'), '正在通过 uv-managed runtime 启动 Aino 后端')
    assert.equal(copy.waitingBackendLaunch('Aino'), '正在等待 Aino 后端启动')
    assert.equal(copy.waitingBackendReady('Aino'), '正在等待 Aino 后端就绪')
    assert.equal(copy.backendReadyFinalizing('Aino'), 'Aino 后端已就绪，正在完成桌面启动')
  })
})
