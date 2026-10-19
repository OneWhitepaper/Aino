import type { PluginTranslate } from '@hermes/plugin-sdk'

// Bind the message SHAPE to a plugin translator: string leaves resolve now,
// function leaves forward their args through t(path, …).
export type Bound<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : T[K] extends object
      ? Bound<T[K]>
      : string
}

export function bind<T extends object>(t: PluginTranslate, template: T, prefix = ''): Bound<T> {
  const out = {} as Record<string, unknown>

  for (const [key, value] of Object.entries(template)) {
    const path = prefix ? `${prefix}.${key}` : key
    out[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            const translated = t(path, ...args)

            // Test harnesses and older hosts can expose a translator before
            // the plugin bundle has been registered. In that case the core
            // resolver returns the raw dotted key; keep the English bundle as
            // the final local fallback so a key never leaks into the UI.
            return translated === path ? (value as (...a: unknown[]) => string)(...args) : translated
          }
        : value && typeof value === 'object'
          ? bind(t, value as object, path)
          : (() => {
              const translated = t(path)

              return translated === path ? value : translated
            })()
  }

  return out as Bound<T>
}
