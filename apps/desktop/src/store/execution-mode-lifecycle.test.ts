import type { WritableAtom } from 'nanostores'
import { beforeEach, expect, it } from 'vitest'

import type { PlatformAccountSnapshot } from '../../shared/platform-contract'

import { $freshDraftKey } from './composer'
import {
  getDraftExecutionMode,
  getExecutionWorkspace,
  rememberExecutionWorkspace,
  setDraftExecutionMode
} from './execution-mode'
import { platformModelCatalog } from './platform-models'
import { $activeGatewayProfile, $newChatConnectionId, $newChatProfile, $newChatRoute } from './profile'
import { $selectedStoredSessionId, $workspaceCwdOwner, setConnection } from './session'
import { dropTilesForProfile, migrateTilesForProfile } from './session-states'

const account = platformModelCatalog().account as WritableAtom<PlatformAccountSnapshot | null>

function owner(connectionId: string, profile: string, user = 'alice') {
  account.set({ mode: 'production', account: { id: user } } as PlatformAccountSnapshot)
  $newChatRoute.set(null)
  $newChatProfile.set(null)
  $newChatConnectionId.set(null)
  $activeGatewayProfile.set(profile)
  setConnection({ mode: 'local', connectionId, profile, registryScoped: true } as never)
}

beforeEach(() => {
  $selectedStoredSessionId.set(null)
  $workspaceCwdOwner.set(null)
})

it('keeps account model/draft intent separate even on the same connection and profile', () => {
  owner('account-test', 'writer')
  $freshDraftKey.set('__new__:alice')
  setDraftExecutionMode('code')
  rememberExecutionWorkspace()
  owner('account-test', 'writer', 'bob')
  expect(getExecutionWorkspace('code')).toBeNull()
  expect(getDraftExecutionMode()).toBe('work')
  owner('account-test', 'writer')
  expect(getExecutionWorkspace('code')?.draft?.key).toBe('__new__:alice')
})

it('moves local profile mode pointers on rename and drops only the deleted source', async () => {
  owner('local', 'rename-source')
  $freshDraftKey.set('__new__:local')
  setDraftExecutionMode('code')
  rememberExecutionWorkspace()
  owner('remote', 'rename-source')
  $freshDraftKey.set('__new__:remote')
  setDraftExecutionMode('code')
  rememberExecutionWorkspace()
  await migrateTilesForProfile('rename-source', 'renamed')
  owner('local', 'renamed')
  expect(getExecutionWorkspace('code')?.draft?.key).toBe('__new__:local')
  owner('remote', 'rename-source')
  expect(getExecutionWorkspace('code')?.draft?.key).toBe('__new__:remote')
  dropTilesForProfile('renamed', { connectionId: 'local', profile: 'renamed' })
  owner('local', 'renamed')
  expect(getExecutionWorkspace('code')).toBeNull()
  expect(getDraftExecutionMode()).toBe('work')
  owner('remote', 'rename-source')
  expect(getExecutionWorkspace('code')?.draft?.key).toBe('__new__:remote')
})
