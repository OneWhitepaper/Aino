import { computed } from 'nanostores'

import { $foregroundConversationOwner } from './conversation-runtime'
import { $toolWorkspaceCwd } from './tool-session'

// Managed conversations own their opened-folder list, including its empty state.
// They do not populate the legacy session's cwd just to reveal the pane.
export const $filesPaneAvailable = computed([$toolWorkspaceCwd, $foregroundConversationOwner], (cwd, conversation) =>
  Boolean(conversation || cwd)
)
