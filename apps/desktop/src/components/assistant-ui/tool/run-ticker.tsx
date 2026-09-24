import { Children, type CSSProperties, isValidElement, type ReactNode } from 'react'

/**
 * A one-line window over a growing list of rows.
 *
 * The active pending call slides into view, including an older call when a
 * newer parallel call finishes first. Inactive rows keep their runtimes but
 * cannot receive keyboard focus or appear in the accessibility tree.
 * Rows are clipped to a uniform line box so the reel's offset stays exact
 * whatever a row happens to contain.
 */
export function ToolRunTicker({ activeIndex, children }: { activeIndex: number; children: ReactNode }) {
  const rows = Children.toArray(children)

  return (
    <div className="tool-ticker" data-tool-ticker="">
      <div className="tool-ticker__reel" style={{ '--tool-ticker-index': activeIndex } as CSSProperties}>
        {rows.map((row, index) => (
          <div
            aria-hidden={index !== activeIndex || undefined}
            className="tool-ticker__row"
            inert={index !== activeIndex}
            key={isValidElement(row) ? (row.key ?? index) : index}
          >
            {row}
          </div>
        ))}
      </div>
    </div>
  )
}
