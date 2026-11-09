import {
  answerPlatformConversationModelRequest,
  type ConversationModelRequest,
  type ConversationModelRow
} from '@/api/platform-conversation-models'
import { bindPlatformModel } from '@/api/platform-models'
import { capturePlatformDraftAuthority } from '@/api/platform-session-binding'
import type { resolveModelDefault } from '@/lib/model-default'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'

import type { PluginSessionCreateRoute } from './plugin-session-create'

type Request = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
type ResolveDefault = (profile: string) => ReturnType<typeof resolveModelDefault>

interface HostedMember {
  member_id: string
  profile: string
  target?: { kind?: string }
}

interface PreparedModel {
  profile: string
  session_id: string
  model_id: string
  managed_model_binding: number
  session_ticket: string
}

export interface GroupConversationModelRequest extends ConversationModelRequest {
  request_id: string
  session_id: string
  member_id: string
  profile: string
}

const answering = new Map<string, Promise<void>>()

/** The room's existing poll is its viewer channel; never attach its private
 * member sessions just to answer a credential-free model catalog request. */
export async function respondPluginGroupModelRequests(
  route: PluginSessionCreateRoute,
  request: Request,
  roomId: string,
  members: readonly HostedMember[],
  pending: readonly GroupConversationModelRequest[]
): Promise<void> {
  const account = platformModelCatalog().account.get()

  const assertAccount = () => {
    if (
      account !== platformModelCatalog().account.get() &&
      !samePlatformAccount(account, platformModelCatalog().account.get())
    ) {
      throw new PlatformSelectionError('platform_account_changed')
    }
  }

  for (const entry of pending) {
    if (
      !members.some(
        member =>
          member.member_id === entry.member_id &&
          member.profile === entry.profile &&
          (!member.target || member.target.kind === 'local')
      )
    ) {
      continue
    }

    const key = JSON.stringify([route.connectionId, route.targetProfile, roomId, entry.request_id])
    let work = answering.get(key)

    if (!work) {
      work = (async () => {
        assertAccount()

        const result = await answerPlatformConversationModelRequest(
          { connectionId: route.connectionId, profile: entry.profile },
          {
            action: entry.action,
            ...(entry.query !== undefined ? { query: entry.query } : {}),
            ...(entry.provider !== undefined ? { provider: entry.provider } : {})
          }
        )

        assertAccount()
        await request(
          'groups.model_respond',
          { profile: route.targetProfile, room_id: roomId, request_id: entry.request_id, result },
          10_000
        )
        assertAccount()
      })().finally(() => answering.delete(key))
      answering.set(key, work)
    }

    await work
  }
}

async function inspectGroupConversationSelection(
  route: PluginSessionCreateRoute,
  request: Request,
  roomId: string,
  member: HostedMember,
  assertAccount: () => void
): Promise<ConversationModelRow | null> {
  const inspected = await request<{ profile: string; session_id: string; selection: ConversationModelRow | null }>(
    'groups.prepare_model',
    {
      profile: route.targetProfile,
      room_id: roomId,
      member_id: member.member_id,
      inspect_selection: true
    },
    10_000
  )

  assertAccount()

  if (inspected.profile !== member.profile || !inspected.session_id) {
    throw new PlatformSelectionError('unsupported_gateway')
  }

  return inspected.selection
}

async function applyGroupProviderSelection(
  route: PluginSessionCreateRoute,
  request: Request,
  roomId: string,
  member: HostedMember,
  selected: ConversationModelRow,
  assertAccount: () => void
) {
  const checked = await answerPlatformConversationModelRequest(
    { connectionId: route.connectionId, profile: member.profile },
    {
      action: 'select',
      query: selected.model_id,
      provider: selected.provider
    }
  )

  assertAccount()

  if (
    checked.selection?.model_source !== 'provider' ||
    checked.selection.model_id !== selected.model_id ||
    checked.selection.provider !== selected.provider
  ) {
    throw new PlatformSelectionError('model_unavailable')
  }

  const applied = await request<{ profile: string; selection?: ConversationModelRow }>(
    'groups.prepare_model',
    {
      profile: route.targetProfile,
      room_id: roomId,
      member_id: member.member_id,
      apply_selection: true
    },
    10_000
  )

  assertAccount()

  if (
    applied.profile !== member.profile ||
    applied.selection?.model_id !== selected.model_id ||
    applied.selection?.provider !== selected.provider
  ) {
    throw new PlatformSelectionError('unsupported_gateway')
  }
}

async function selectedGroupDefault(
  selected: ConversationModelRow | null,
  profile: string,
  resolveDefault: ResolveDefault
) {
  if (!selected) {
    return resolveDefault(profile)
  }

  if (!selected.owner?.user_id || !selected.owner.platform_origin) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  return {
    platform: {
      modelId: selected.model_id,
      ownerUserId: selected.owner.user_id,
      platformOrigin: selected.owner.platform_origin
    }
  }
}

function requirePreparedMemberModel(prepared: PreparedModel, member: HostedMember, modelId: string) {
  if (
    prepared.profile !== member.profile ||
    prepared.model_id !== modelId ||
    !prepared.session_id ||
    !prepared.session_ticket ||
    prepared.managed_model_binding !== 1
  ) {
    throw new PlatformSelectionError('unsupported_gateway')
  }
}

/** Hosted member sessions have their own identities and bindings; a Bot Chat's
 * authorization cannot be borrowed by the room. Never change the send journal. */
export async function preparePluginGroupModels(
  route: PluginSessionCreateRoute,
  request: Request,
  roomId: string,
  resolveDefault: ResolveDefault,
  assertAccount: () => void,
  memberId?: string
): Promise<void> {
  const snapshot = await request<{ room: { members: HostedMember[] } }>('groups.state', {
    profile: route.targetProfile,
    room_id: roomId
  })

  assertAccount()
  let supported: boolean | undefined
  let selectionsSupported = false

  for (const member of snapshot.room.members) {
    if (memberId !== undefined && member.member_id !== memberId) {
      continue
    }

    // Independent/remote members keep their own runtime and credential authority.
    if (member.target && member.target.kind !== 'local') {
      continue
    }

    if (supported === undefined) {
      const capabilities = await request<{ methods?: string[] }>('groups.capabilities', {
        profile: route.targetProfile
      })
      assertAccount()
      supported = capabilities.methods?.includes('groups.prepare_model') === true
      selectionsSupported = capabilities.methods?.includes('groups.model_respond') === true
    }

    const selected = selectionsSupported
      ? await inspectGroupConversationSelection(route, request, roomId, member, assertAccount)
      : null

    if (selected?.model_source === 'provider') {
      await applyGroupProviderSelection(route, request, roomId, member, selected, assertAccount)

      continue
    }

    const resolved = await selectedGroupDefault(selected, member.profile, resolveDefault)

    assertAccount()

    if (!resolved.platform) {
      if (supported) {
        const followed = await request<{ profile: string; follow_profile_config: boolean }>(
          'groups.prepare_model',
          {
            profile: route.targetProfile,
            room_id: roomId,
            member_id: member.member_id,
            follow_profile_config: true
          },
          10_000
        )

        assertAccount()

        if (followed.profile !== member.profile || followed.follow_profile_config !== true) {
          throw new PlatformSelectionError('unsupported_gateway')
        }
      }

      continue
    }

    if (!supported) {
      throw new PlatformSelectionError('unsupported_gateway')
    }

    const authority = await capturePlatformDraftAuthority(
      resolved.platform.ownerUserId,
      resolved.platform.platformOrigin
    )
    assertAccount()

    const prepared = await request<PreparedModel>(
      'groups.prepare_model',
      {
        profile: route.targetProfile,
        room_id: roomId,
        member_id: member.member_id,
        model_id: resolved.platform.modelId,
        owner: authority.owner
      },
      10_000
    )

    assertAccount()

    requirePreparedMemberModel(prepared, member, resolved.platform.modelId)

    const result = await bindPlatformModel(
      {
        connection_id: route.connectionId || '',
        profile: prepared.profile,
        session_id: prepared.session_id,
        model_id: prepared.model_id,
        expected_account_revision: authority.account.revision
      },
      authority.account,
      async <T>(method: string) => {
        if (method !== 'session.managed_model_ticket') {
          throw new PlatformSelectionError('unsupported_gateway')
        }
        assertAccount()

        return prepared as T
      }
    )

    assertAccount()

    if (!result.ok) {
      throw new PlatformSelectionError(result.error.code)
    }
  }
}
