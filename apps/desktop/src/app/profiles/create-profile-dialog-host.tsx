import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { useContributions } from '@/contrib/react/use-contributions'
import { $profileCreateRequest, $profiles, refreshActiveProfile } from '@/store/profile'

import { navigateToWorkspacePage, PROFILES_ROUTE } from '../routes'

import { CreateProfileDialog } from './create-profile-dialog'

/**
 * Global creation shortcuts use the Bot manager's creator when available.
 * A runtime without that contribution keeps the basic profile creator, without
 * changing the owner of an ordinary conversation.
 */
export function ProfileCreateDialogHost() {
  const navigate = useNavigate()
  const managers = useContributions('profiles.manager')
  const profiles = useStore($profiles)
  const createRequest = useStore($profileCreateRequest)
  const [open, setOpen] = useState(false)
  const lastCreateRef = useRef(createRequest)

  // eslint-disable-next-line no-restricted-syntax -- one-shot request-seen sentinel, not an atom mirror
  useEffect(() => {
    if (createRequest === lastCreateRef.current) {
      return
    }

    lastCreateRef.current = createRequest

    const create = managers
      .map(manager => (manager.data as { create?: () => void } | undefined)?.create)
      .find(create => typeof create === 'function')

    if (create) {
      create()
      navigateToWorkspacePage(navigate, PROFILES_ROUTE)

      return
    }

    setOpen(true)
  }, [createRequest, managers, navigate])

  return (
    <CreateProfileDialog
      onClose={() => setOpen(false)}
      onCreated={async () => {
        await refreshActiveProfile()
        navigateToWorkspacePage(navigate, PROFILES_ROUTE)
      }}
      open={open}
      profiles={profiles}
    />
  )
}
