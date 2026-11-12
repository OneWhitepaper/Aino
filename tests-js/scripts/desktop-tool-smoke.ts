import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { ChatIdentity } from './desktop-chat-smoke.ts'

/** A tool checkpoint must stay in the home whose account and listener were verified. */
export function desktopToolMarker(identity: Pick<ChatIdentity, 'hermesHome'>, launchHome: string, predictedHome?: string): string {
  const home = fs.realpathSync(predictedHome ?? launchHome)

  if (identity.hermesHome && fs.realpathSync(identity.hermesHome) !== home) {
    throw new Error('Native tool checkpoint resolved another verified workspace home')
  }

  return path.join(home, `native-tool-${randomUUID()}.txt`)
}
