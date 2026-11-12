import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { modelErrorRecoveryCopy } from '@/i18n/model-error-recovery'
import type { ChatMessage } from '@/lib/chat-messages'

interface ResolvedModelErrorProps {
  reason: NonNullable<ChatMessage['errorResolved']>
  title: string
  body: string
  errorText: string
}

/** A failed turn stays inspectable, without continuing to demand recovery. */
export function ResolvedModelError({ reason, title, body, errorText }: ResolvedModelErrorProps) {
  const { locale } = useI18n()
  const copy = modelErrorRecoveryCopy(locale)

  return (
    <details
      className="my-2 min-w-0 text-[length:var(--aino-text-caption)] text-muted-foreground"
      data-slot="aui_resolved-model-error"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 outline-offset-2 focus-visible:outline-2">
        <Codicon aria-hidden name="check" />
        <span>{copy[reason]}</span>
        <span aria-hidden>·</span>
        <span className="underline-offset-2 hover:underline">{copy.history}</span>
      </summary>
      <div className="mt-1 space-y-1 rounded-md border border-border/60 bg-muted/30 p-3">
        <div className="font-medium">{title}</div>
        <p>{body}</p>
        <pre className="wrap-anywhere whitespace-pre-wrap">{errorText}</pre>
      </div>
    </details>
  )
}
