import type { ComponentProps } from 'react'

import { useI18n } from '@/i18n'
import { List } from '@/lib/icons'

import { ComposerApprovalMode } from './approval-mode-menu'
import { BotComposerMenuActions } from './bot-actions'
import { botComposerCopy } from './bot-composer-copy'
import { ContextMenu, ContextMenuItem } from './context-menu'
import { ComposerContextUsagePresentation } from './context-usage'
import { ComposerProjectContext } from './project-context'
import { ReasoningPill } from './reasoning-pill'

interface ComposerMenuProps extends Omit<ComponentProps<typeof ContextMenu>, 'bot' | 'settings'> {
  canonicalBotChat: boolean
  disabled: boolean
  guidedChat: boolean
  insertCompletionStarter: (text: string) => void
  projectContext: Omit<ComponentProps<typeof ComposerProjectContext>, 'placement'>
  statusDrawerCollapsed: boolean
  statusStackVisible: boolean
  toggleStatusDrawer: () => void
}

export function ComposerMenu({
  canonicalBotChat,
  disabled,
  guidedChat,
  insertCompletionStarter,
  projectContext,
  state,
  statusDrawerCollapsed,
  statusStackVisible,
  toggleStatusDrawer,
  ...actions
}: ComposerMenuProps) {
  const { t } = useI18n()

  return (
    <ContextMenu
      {...actions}
      bot={
        canonicalBotChat
          ? {
              actions: <BotComposerMenuActions />,
              onReferenceFiles: () => insertCompletionStarter('@file:')
            }
          : undefined
      }
      settings={
        canonicalBotChat ? (
          <>
            <ComposerProjectContext {...projectContext} placement="menu" />
            <ComposerApprovalMode disabled={disabled} presentation="submenu" />
            {!guidedChat && <ReasoningPill disabled={disabled} model={state.model} presentation="submenu" />}
            <ComposerContextUsagePresentation.Provider value="submenu">
              {state.contextUsage}
            </ComposerContextUsagePresentation.Provider>
            {statusStackVisible && (
              <ContextMenuItem icon={List} onSelect={toggleStatusDrawer}>
                {statusDrawerCollapsed ? t.statusStack.showStack : t.statusStack.hideStack}
              </ContextMenuItem>
            )}
          </>
        ) : undefined
      }
      state={state}
    />
  )
}

interface ComposerFooterProps {
  canonicalBotChat: boolean
  inputDisabled: boolean
  insertCompletionStarter: (text: string) => void
  projectContext: Omit<ComponentProps<typeof ComposerProjectContext>, 'placement'>
}

export function ComposerFooter({
  canonicalBotChat,
  inputDisabled,
  insertCompletionStarter,
  projectContext
}: ComposerFooterProps) {
  const { locale } = useI18n()

  return canonicalBotChat ? (
    <div data-slot="bot-composer-note">
      <button disabled={inputDisabled} onClick={() => insertCompletionStarter('/')} type="button">
        <span aria-hidden>/</span> {botComposerCopy(locale).useSkills}
      </button>
      <span>{botComposerCopy(locale).modelHint}</span>
      <span aria-hidden />
    </div>
  ) : (
    <ComposerProjectContext {...projectContext} placement="footer" />
  )
}
