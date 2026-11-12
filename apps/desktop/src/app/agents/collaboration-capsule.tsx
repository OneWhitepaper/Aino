import './collaboration-capsule.css'

import { useStore } from '@nanostores/react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'

import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { collaborationCopy } from '@/i18n/collaboration-capsule'
import { ChevronDown, ChevronRight, MessageCircle, Network, Robot } from '@/lib/icons'
import { $collaborationGroups, type CollaborationGroup } from '@/store/collaboration-capsule'
import { $collaborationCapsuleOpen } from '@/store/collaboration-capsule-view'
import { $focusedRuntimeId } from '@/store/session-states'

import { useCapsulePosition, useCollaborationLifetime } from './collaboration-capsule-hooks'
import { openCollaborationGroup } from './collaboration-navigation'
import { collaborationSummary } from './collaboration-presentation'
import { CollaborationAvatar, CollaborationTaskRow } from './collaboration-task'

function focusedWidgetOwnsEscape(target: Element | null): boolean {
  const controller = target?.closest('[aria-expanded="true"][aria-controls]')
  const ids = controller?.getAttribute('aria-controls')?.split(/\s+/) ?? []

  return ids.some(id => {
    const popup = document.getElementById(id)

    return Boolean(
      popup &&
      ['listbox', 'menu', 'dialog'].includes(popup.getAttribute('role') || '') &&
      !popup.closest('[hidden], [aria-hidden="true"], [data-pane-hidden]') &&
      getComputedStyle(popup).display !== 'none' &&
      getComputedStyle(popup).visibility !== 'hidden'
    )
  })
}

/** The approved capsule envelope, shared by ordinary and Bot conversations. */
export function CollaborationCapsule({ autoVisible = true }: { autoVisible?: boolean }) {
  const groups = useStore($collaborationGroups)
  const open = useStore($collaborationCapsuleOpen)
  const { groups: shown, visible: lifetimeVisible, dismiss } = useCollaborationLifetime(groups, open)
  const visible = lifetimeVisible && (autoVisible || open)
  const { anchor, position } = useCapsulePosition(visible, open)
  const { t, locale } = useI18n()
  const copy = collaborationCopy(locale)
  const current = useStore($focusedRuntimeId)
  const navigate = useNavigate()
  const envelope = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const { tasks, live, failed, stopped, title, subtitle, Indicator } = collaborationSummary(shown, copy, t.agents)

  const sorted = [...shown].sort(
    (a, b) => Number(b.runtimeIds.includes(current || '')) - Number(a.runtimeIds.includes(current || ''))
  )

  const close = (restoreFocus = false) => {
    $collaborationCapsuleOpen.set(false)

    if (restoreFocus && tasks.length) {
      trigger.current?.focus({ preventScroll: true })
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      const target = event.target instanceof Element ? event.target : null

      if (
        target?.closest('[role=dialog], [role=menu], [data-slot=popover-content]') ||
        focusedWidgetOwnsEscape(target)
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      $collaborationCapsuleOpen.set(false)

      if (tasks.length) {
        trigger.current?.focus({ preventScroll: true })
      }
    }

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !envelope.current?.contains(event.target)) {
        $collaborationCapsuleOpen.set(false)
      }
    }

    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)

    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open, tasks.length])

  useEffect(() => {
    if (!open || !live.length) {
      return
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000)

    return () => window.clearInterval(timer)
  }, [open, live.length])

  const openSource = async (group: CollaborationGroup) => {
    setError((await openCollaborationGroup(group, navigate)) ? '' : copy.unavailable)
  }

  return (
    <>
      <span aria-hidden className="collaboration-capsule-anchor" hidden={!visible} ref={anchor} />
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {visible && tasks.length ? title : ''}
      </span>
      {visible &&
        position &&
        createPortal(
          <div
            className="collaboration-capsule-position"
            style={{ left: position.left, top: position.top, '--cc-top': `${position.top}px` } as CSSProperties}
          >
            <div
              className="collaboration-capsule"
              data-attention={failed.length > 0 || undefined}
              data-open={open || undefined}
              data-terminal={(!live.length && tasks.length > 0 && !stopped.length) || undefined}
              onKeyDown={event => {
                event.stopPropagation()

                if (event.key === 'Escape' && open) {
                  event.preventDefault()
                  close(true)
                }
              }}
              ref={envelope}
            >
              <button
                aria-expanded={open}
                aria-label={`${title}，${subtitle}`}
                className="cc-trigger"
                onClick={() => $collaborationCapsuleOpen.set(!open)}
                ref={trigger}
                type="button"
              >
                <span aria-hidden className="cc-avatar-stack">
                  {tasks.slice(0, 3).map(task => (
                    <CollaborationAvatar key={task.key} task={task} />
                  ))}
                </span>
                <span className="cc-copy">
                  <strong>{title}</strong>
                  <span>{subtitle}</span>
                </span>
                <span aria-hidden className="cc-end">
                  <span className="cc-indicator">
                    <Indicator />
                  </span>
                  <ChevronDown className="cc-chevron" />
                </span>
              </button>
              <PaneVisibleContext value={open && visible}>
                <div aria-label={copy.title} className="cc-panel" hidden={!open} role="region">
                  <div className="cc-panel-intro">
                    <span>{failed.length ? copy.attentionIntro : copy.intro}</span>
                    <Button className="cc-text-button" onClick={() => close(true)} size="inline" variant="text">
                      {copy.collapse}
                    </Button>
                  </div>
                  <div className="cc-task-list">
                    {sorted.length ? (
                      sorted.map(group => (
                        <section className="cc-task-group" key={group.key}>
                          <div className="cc-group-head">
                            <button className="cc-source-link" onClick={() => void openSource(group)} type="button">
                              {group.workspaceMode === 'bots' ? (
                                <Robot className="cc-icon" />
                              ) : (
                                <MessageCircle className="cc-icon" />
                              )}
                              <span>{group.title}</span>
                              <ChevronRight className="cc-icon" />
                            </button>
                            <span className="cc-source-badge">
                              {group.runtimeIds.includes(current || '')
                                ? copy.current
                                : group.workspaceMode === 'bots'
                                  ? group.roomBinding
                                    ? copy.room
                                    : copy.bot
                                  : copy.chat}
                            </span>
                          </div>
                          {group.tasks.map(task => (
                            <CollaborationTaskRow group={group} key={task.key} now={now} task={task} />
                          ))}
                        </section>
                      ))
                    ) : (
                      <div className="cc-empty">
                        <Network />
                        <p>{t.agents.emptyTitle}</p>
                        <span>{t.agents.emptyDesc}</span>
                      </div>
                    )}
                  </div>
                  {error && (
                    <p className="cc-navigation-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="cc-panel-footer">
                    <span>{copy.total(tasks.length, shown.length)}</span>
                    {!live.length && (
                      <Button
                        className="cc-text-button"
                        onClick={() => {
                          dismiss()
                          close(true)
                        }}
                        size="inline"
                        variant="text"
                      >
                        {copy.dismiss}
                      </Button>
                    )}
                  </div>
                </div>
              </PaneVisibleContext>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
