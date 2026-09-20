import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { type ClarifyQuestion, normalizeChoices, normalizeQuestions } from '@/store/clarify'
import type { ConversationOwner } from '@/store/conversation-owner'
import type { ConversationRuntime } from '@/store/conversation-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

import { requireConversationRuntime } from './conversation-runtime-controls'

export interface ConversationRequestProps {
  owner: ConversationOwner
  request: ConversationRuntime['pendingRequests'][string]
  respond: (id: string, result: Record<string, unknown>) => void
  refresh: () => Promise<unknown>
}

export function ConversationClarify({ owner, request, respond, refresh }: ConversationRequestProps) {
  const { t } = useI18n()
  const batch = normalizeQuestions(request.params.questions)

  const questions: ClarifyQuestion[] = batch.length
    ? batch
    : [
        {
          qid: 'single',
          question: String(request.params.question ?? ''),
          choices: normalizeChoices(request.params.choices),
          multiSelect: request.params.multi_select === true
        }
      ]

  const locked = request.params.answers as Record<string, string> | undefined
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [accepted, setAccepted] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = (question: ClarifyQuestion) =>
    locked?.[question.qid] ??
    accepted[question.qid] ??
    answers[question.qid] ??
    (selections[question.qid]?.length
      ? question.multiSelect
        ? JSON.stringify(selections[question.qid])
        : selections[question.qid][0]
      : '')

  const send = async (skip = false) => {
    setWorking(true)
    setError(null)

    try {
      if (skip || !batch.length) {
        respond(request.id, batch.length ? {} : { answer: skip ? '' : value(questions[0]) })

        return
      }

      requireConversationRuntime(owner, request.coordinates)

      for (const question of questions) {
        if (locked?.[question.qid] !== undefined || accepted[question.qid] !== undefined) {
          continue
        }

        requireConversationRuntime(owner, request.coordinates)

        const result = await requestGatewayForAgent<{ status: string }>(owner.connectionId, 'default', 'clarify.lock', {
          request_id: request.id,
          question_id: question.qid,
          answer: value(question)
        })

        if (result.status !== 'ok') {
          throw new Error(t.composer.conversation.clarifyExpired)
        }

        setAccepted(current => ({ ...current, [question.qid]: value(question) }))
      }

      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={event => {
        event.preventDefault()
        void send()
      }}
    >
      {questions.map(question => {
        const isLocked = locked?.[question.qid] !== undefined || accepted[question.qid] !== undefined

        return (
          <fieldset className="space-y-2" disabled={working || isLocked} key={question.qid}>
            <legend>{question.question}</legend>
            {isLocked ? (
              <p>{value(question)}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {question.choices?.map(choice => (
                    <Button
                      aria-pressed={selections[question.qid]?.includes(choice) ?? false}
                      key={choice}
                      onClick={() => {
                        setAnswers(current => {
                          const next = { ...current }
                          delete next[question.qid]

                          return next
                        })
                        setSelections(current => ({
                          ...current,
                          [question.qid]: question.multiSelect
                            ? current[question.qid]?.includes(choice)
                              ? current[question.qid].filter(item => item !== choice)
                              : [...(current[question.qid] ?? []), choice]
                            : [choice]
                        }))
                      }}
                      type="button"
                      variant="outline"
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
                <Input
                  aria-label={question.question}
                  onChange={event => setAnswers(current => ({ ...current, [question.qid]: event.target.value }))}
                  value={answers[question.qid] ?? ''}
                />
              </>
            )}
          </fieldset>
        )
      })}
      <div className="flex gap-2">
        <Button disabled={working || questions.some(question => !value(question).trim())} type="submit">
          {t.composer.send}
        </Button>
        <Button disabled={working} onClick={() => void send(true)} type="button" variant="outline">
          {t.common.cancel}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
