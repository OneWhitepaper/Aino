export interface FixtureAccount {
  userId: string
  displayName: string
  origin: string
  model: string
  baseUrl: string
  profile: string
  sessionIds: string[]
  /** Absolute home selected by the production account-workspace resolver. */
  home: string
  /** Portable relative path recorded in the disposable fixture marker. */
  relativeHome: string
}

export function fixtureAccountForHome(options: { root: string; home: string }): FixtureAccount | null
