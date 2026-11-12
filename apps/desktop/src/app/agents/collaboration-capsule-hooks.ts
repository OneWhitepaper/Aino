import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CollaborationGroup } from '@/store/collaboration-capsule'

import { TITLEBAR_CHROME_CHANGED_EVENT } from '../shell/titlebar'

import { capsulePlacement } from './collaboration-capsule-placement'

export function useCollaborationLifetime(groups: CollaborationGroup[], open: boolean) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const tasks = groups.flatMap(group => group.tasks)

  const pendingKeys = tasks
    .filter(task => !dismissed.has(`${task.key}:${task.status}`))
    .map(task => `${task.key}:${task.status}`)

  const version = pendingKeys.length ? JSON.stringify(pendingKeys) : ''
  const active = tasks.some(task => task.status === 'running' || task.status === 'queued')
  const attention = tasks.some(task => task.status === 'failed' && !dismissed.has(`${task.key}:${task.status}`))

  useEffect(() => {
    if (!version || active || attention || open) {
      return
    }

    const terminalKeys = JSON.parse(version) as string[]
    const timer = window.setTimeout(() => setDismissed(previous => new Set([...previous, ...terminalKeys])), 6000)

    return () => window.clearTimeout(timer)
  }, [version, active, attention, open])

  const visibleGroups = groups
    .map(group => ({
      ...group,
      tasks: group.tasks.filter(
        task => task.status === 'running' || task.status === 'queued' || !dismissed.has(`${task.key}:${task.status}`)
      )
    }))
    .filter(group => group.tasks.length)

  return {
    groups: visibleGroups,
    visible: open || visibleGroups.length > 0,
    dismiss: () =>
      setDismissed(
        previous =>
          new Set([
            ...previous,
            ...tasks
              .filter(task => task.status !== 'running' && task.status !== 'queued')
              .map(task => `${task.key}:${task.status}`)
          ])
      )
  }
}

/** Keep one DOM envelope while it morphs; a portal clears the native titlebar clip. */
export function useCapsulePosition(visible: boolean, expanded: boolean) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = anchor.current

    if (!visible || !element) {
      return
    }

    const leftControls = document.querySelector<HTMLElement>('[data-titlebar-cluster="left"]')
    const rightControls = document.querySelector<HTMLElement>('[data-titlebar-cluster="right"]')
    const titlebar = element.closest('[data-slot="app-titlebar"]')

    const measuredControls = (control: HTMLElement | null) => {
      const rect = control?.getBoundingClientRect()

      return rect?.width && rect.height ? rect : undefined
    }

    const measure = () => {
      const rect = element.getBoundingClientRect()

      const next = capsulePlacement({
        anchor: rect,
        viewportWidth: window.innerWidth,
        expanded,
        titlebarBottom: titlebar?.getBoundingClientRect().bottom ?? rect.bottom,
        leftControls: measuredControls(leftControls),
        rightControls: measuredControls(rightControls)
      })

      setPosition(previous => (previous?.left === next.left && previous.top === next.top ? previous : next))
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)

    if (element.parentElement) {
      observer.observe(element.parentElement)
    }

    for (const controls of [leftControls, rightControls]) {
      if (controls) {
        observer.observe(controls)
      }
    }

    const geometry = new MutationObserver(measure)
    geometry.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    measure()
    window.addEventListener(TITLEBAR_CHROME_CHANGED_EVENT, measure)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      geometry.disconnect()
      window.removeEventListener(TITLEBAR_CHROME_CHANGED_EVENT, measure)
      window.removeEventListener('resize', measure)
    }
  }, [visible, expanded])

  return { anchor, position }
}
