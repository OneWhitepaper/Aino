import { describe, expect, it } from 'vitest'

import { conversationOwnerKey, participantSessionOwner } from './conversation-owner'

describe('conversation owners', () => {
  it('keeps public identity separate from participant session routing and validates the exact host', () => {
    const owner = { conversationId: 'c', connectionId: 'remote-one', installId: 'host-one' }
    expect(participantSessionOwner(owner, { install_id: 'host-one', profile: 'writer' })).toEqual({
      connectionId: 'remote-one',
      profile: 'default',
      targetProfile: 'writer'
    })
    expect(() => participantSessionOwner(owner, { install_id: 'host-two', profile: 'writer' })).toThrow()
    expect(conversationOwnerKey(owner)).not.toBe(conversationOwnerKey({ ...owner, installId: 'host-two' }))
    expect(conversationOwnerKey(owner)).not.toBe(conversationOwnerKey({ ...owner, connectionId: 'remote-two' }))
    expect(() => conversationOwnerKey({ ...owner, connectionId: '' })).toThrow()
  })
})
