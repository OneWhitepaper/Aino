import type { PlatformModel, PlatformModelPurpose } from '../../shared/platform-contract'

export function platformModelSupportsPurpose(model: PlatformModel, purpose: PlatformModelPurpose): boolean {
  if (purpose === 'image') {
    return (
      model.purpose === 'image' &&
      model.api_mode === 'images_generations' &&
      model.capabilities.image_generation === true
    )
  }

  return (model.purpose ?? 'chat') === 'chat' && model.api_mode !== 'images_generations'
}
