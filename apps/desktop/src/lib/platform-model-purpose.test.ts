import { expect, it } from 'vitest'

import { platformModel } from '@/test/platform-model'

import { availablePlatformDefault } from './model-default'
import { platformModelSupportsPurpose } from './platform-model-purpose'

it('retains legacy chat models and excludes image routes from chat defaults', () => {
  const chat = { ...platformModel('chat'), is_default: false }

  const image = {
    ...platformModel('image'),
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...chat.capabilities, image_generation: true }
  }

  expect(platformModelSupportsPurpose(chat, 'chat')).toBe(true)
  expect(platformModelSupportsPurpose(image, 'chat')).toBe(false)
  expect(availablePlatformDefault([image, chat], 'image')).toBeUndefined()
})

it('requires declared image purpose, image generation capability and image API mode together', () => {
  const image = {
    ...platformModel('image'),
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...platformModel().capabilities, image_generation: true }
  }

  expect(platformModelSupportsPurpose(image, 'image')).toBe(true)
  expect(platformModelSupportsPurpose({ ...image, purpose: undefined }, 'image')).toBe(false)
  expect(
    platformModelSupportsPurpose(
      { ...image, capabilities: { ...image.capabilities, image_generation: false } },
      'image'
    )
  ).toBe(false)
  expect(platformModelSupportsPurpose({ ...image, api_mode: 'chat_completions' }, 'image')).toBe(false)
})
