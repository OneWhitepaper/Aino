import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { NotificationStack } from '@/components/notifications'
import { notify } from '@/store/notifications'

const placement = new URLSearchParams(location.search).has('toolbar') ? 'toolbar' : 'workspace'

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
    <header style={{ height: 48, flex: 'none', display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
      {placement === 'toolbar' && <NotificationStack placement="toolbar" />}
    </header>
    <NotificationStack active={placement === 'workspace'}>
      <main style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 24 }}>
        <h1>Workspace content</h1>
        <button
          onClick={() =>
            notify({
              id: 'layout',
              title: 'Saved',
              message: 'Your changes are saved',
              detail: 'long-path-without-spaces/'.repeat(150),
              durationMs: 60_000
            })
          }
          type="button"
        >
          Save changes
        </button>
        <div aria-label="History" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {Array.from({ length: 40 }, (_, index) => (
            <p key={index}>History message {index}</p>
          ))}
        </div>
        <textarea aria-label="Draft" defaultValue="Preserved draft" />
      </main>
    </NotificationStack>
  </div>
)
