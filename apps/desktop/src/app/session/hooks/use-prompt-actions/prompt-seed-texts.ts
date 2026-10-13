export function renderedSeedTexts(seeds: Record<string, unknown>[]): string[] {
  return seeds.flatMap(state => {
    const messages = Array.isArray(state.messages)
      ? (state.messages as Array<{ parts?: Array<{ text?: string }> }>)
      : []

    return messages.flatMap(message => (message.parts ?? []).map(part => part.text ?? ''))
  })
}
