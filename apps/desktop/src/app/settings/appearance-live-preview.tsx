import './appearance-live-preview.css'

import { useStore } from '@nanostores/react'
import type { CSSProperties } from 'react'

import { $terminalFontFamily, resolveTerminalFontFamily } from '@/app/right-sidebar/terminal/terminal-font'
import { useI18n } from '@/i18n'
import { ArrowUp, ChevronRight, PanelTop, Plus } from '@/lib/icons'
import { $backdrop } from '@/store/backdrop'
import { $chatTextScale } from '@/store/chat-text-scale'
import { $composerPopoutGesturesEnabled } from '@/store/composer-popout'
import { $fileBrowserOpen } from '@/store/layout'
import { $reactionsEnabled } from '@/store/reactions-enabled'
import { $reasoningCollapsedByDefault } from '@/store/reasoning-disclosure'
import { $sessionListDensity } from '@/store/session-list-density'
import { $tabStripDefault } from '@/store/tabstrip-prefs'
import { $textDirection } from '@/store/text-direction'
import { $hideThreadTimeline } from '@/store/thread-timeline'
import { $hideCodeDiffs, $toolViewMode } from '@/store/tool-view'
import { $zoomPercent } from '@/store/zoom'

interface AppearanceLivePreviewProps {
  variant: 'theme' | 'layout' | 'chat'
}

/** A synthetic conversation; presentation reads existing stores and never starts backend work. */
export function AppearanceLivePreview({ variant }: AppearanceLivePreviewProps) {
  const { t } = useI18n()
  const copy = t.appearancePage
  const textScale = useStore($chatTextScale)
  const zoom = useStore($zoomPercent)
  const density = useStore($sessionListDensity)
  const tabs = useStore($tabStripDefault)
  const files = useStore($fileBrowserOpen)
  const toolMode = useStore($toolViewMode)
  const hideDiffs = useStore($hideCodeDiffs)
  const reasoningCollapsed = useStore($reasoningCollapsedByDefault)
  const direction = useStore($textDirection)
  const hideTimeline = useStore($hideThreadTimeline)
  const popout = useStore($composerPopoutGesturesEnabled)
  const backdrop = useStore($backdrop)
  const reactions = useStore($reactionsEnabled)
  const terminalFont = useStore($terminalFontFamily)
  const note = { theme: copy.previewThemeNote, layout: copy.previewLayoutNote, chat: copy.previewChatNote }[variant]

  return (
    <aside aria-label={copy.preview} className="appearance-live-column">
      <div
        className="appearance-preview"
        data-appearance-preview={variant}
        data-preview-backdrop={backdrop || undefined}
        data-preview-popout={popout || undefined}
        style={{ '--appearance-preview-text-scale': String(textScale / 100) } as CSSProperties}
      >
        <div className="appearance-preview-heading">
          <span>
            <PanelTop aria-hidden="true" />
            {copy.preview}
          </span>
          <span className="appearance-preview-zoom">{zoom}%</span>
        </div>
        <div className="appearance-preview-demo">
          <div className="appearance-preview-sidebar">
            <div className="appearance-preview-brand">Aino</div>
            {[copy.sample.project, copy.sample.session].map(title => (
              <div className="appearance-preview-session" key={title}>
                <span>{title}</span>
                {density !== 'compact' && (
                  <span className="appearance-preview-session-detail">{copy.sample.detail}</span>
                )}
                {density === 'detailed' && (
                  <span className="appearance-preview-session-detail">{copy.sample.time}</span>
                )}
              </div>
            ))}
          </div>
          <div className="appearance-preview-chat">
            <div className="appearance-preview-title">
              <span>{copy.sample.project}</span>
              <PanelTop aria-hidden="true" />
            </div>
            {tabs !== 'never' && (
              <div className="appearance-preview-tabs" data-preview-tabs="">
                <span>{copy.sample.summary}</span>
                <span>README.md</span>
              </div>
            )}
            <div className="appearance-preview-user" dir={direction}>
              {copy.sample.user}
            </div>
            <div className="appearance-preview-assistant">
              <div className="appearance-preview-tool">
                <ChevronRight aria-hidden="true" />
                {copy.sample.tool}
              </div>
              {toolMode === 'technical' && (
                <pre
                  className="appearance-preview-code"
                  data-preview-technical=""
                >{`read_file({ path: 'README.md' })\n{ lines: 42, status: 'completed' }`}</pre>
              )}
              <details className="appearance-preview-reasoning" data-preview-reasoning="" open={!reasoningCollapsed}>
                <summary>
                  <ChevronRight aria-hidden="true" />
                  {copy.sample.reasoningTitle}
                </summary>
                <p dir={direction}>{copy.sample.reasoning}</p>
              </details>
              <p className="appearance-preview-message" dir={direction}>
                {copy.sample.assistant}
              </p>
              {reactions && (
                <div aria-label={t.settings.appearance.reactionsTitle} className="appearance-preview-reaction">
                  ♡
                </div>
              )}
              {files && (
                <div className="appearance-preview-files" data-preview-files="">
                  <span>{copy.sample.files}</span>
                  <span>README.md</span>
                  <span>docs / guide.md</span>
                </div>
              )}
              {!hideDiffs && (
                <pre
                  className="appearance-preview-code"
                  data-preview-diff=""
                >{`${copy.sample.diffAdd}\n${copy.sample.diffRemove}`}</pre>
              )}
            </div>
            {!hideTimeline && <span aria-hidden="true" className="appearance-preview-timeline" />}
            <div className="appearance-preview-composer">
              <div className="appearance-preview-input">
                <span dir={direction}>{copy.sample.composer}</span>
                <div>
                  <span>
                    <Plus aria-hidden="true" />
                    Aino
                  </span>
                  <ArrowUp aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {variant === 'theme' && terminalFont && (
          <div className="appearance-preview-terminal" style={{ fontFamily: resolveTerminalFontFamily(terminalFont) }}>
            ~/project git:main ❯ npm run dev
          </div>
        )}
        <p className="appearance-preview-caption">{copy.previewCaption}</p>
      </div>
      <p className="appearance-preview-note">{note}</p>
    </aside>
  )
}
