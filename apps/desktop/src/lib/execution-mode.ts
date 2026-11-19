export type ExecutionMode = 'work' | 'code'

/** Historical sessions predate mode selection and keep their Hermes runtime. */
export function executionMode(value: unknown): ExecutionMode {
  return value === 'code' ? 'code' : 'work'
}
