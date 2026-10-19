export const GUEST_ONBOARDING_ENV = 'HERMES_GUEST_ONBOARDING'
export const GUEST_ONBOARDING_FLAG = '--guest-onboarding'

export function guestOnboardingEnabled(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[GUEST_ONBOARDING_ENV] === '1' || argv.includes(GUEST_ONBOARDING_FLAG)
}

// Aino's first-run film can be skipped while rehearsing onboarding.
export const SKIP_INTRO_ENV = 'HERMES_SKIP_INTRO'
export const SKIP_INTRO_FLAG = '--skip-intro'

export function skipIntroEnabled(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[SKIP_INTRO_ENV] === '1' || argv.includes(SKIP_INTRO_FLAG)
}
