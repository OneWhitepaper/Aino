/**
 * The leaf components a group-chat room composes: the room picture controls,
 * the mention-aware composer input, and the card a member's pending
 * clarify/approval prompt renders as.
 *
 * None of them reaches back into the room surface, so they sit below
 * `group-chat-view.tsx` — and the group-creation dialog can share the picture
 * controls without either surface importing the other.
 */

import {
  Button,
  cn,
  Codicon,
  host,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  RowButton,
  Textarea,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import type { ClipboardEvent, ReactNode, Ref, RefObject } from 'react'
import { useId, useImperativeHandle, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $imagenAvailable, normalizeAvatarImage, pickImageFromDevice, probeImagen } from './avatar-image'
import { $botMeta, botHandle, botMentionTag } from './data'
import { appendGroupChatEntry } from './group-chat'
import { groupMentionClipboardHandlers } from './group-chat-mention-clipboard'
import {
  editGroupMentions,
  groupMentionDisplayOffset,
  projectGroupMentions,
  replaceGroupMentionRange
} from './group-chat-mentions'
import { groupMemberKey } from './group-membership'
import { answerGroupClarify } from './group-turns'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, GroupPrompt } from './types'

/** The `image.generate` reply. Older gateways answer `image`, newer ones
 *  `image_data`; both are data URLs. */
interface ImageGenerateResponse {
  error?: string
  image?: string
  image_data?: string
  success?: boolean
}

interface GroupImageControlsProps {
  image: null | string
  onImage: (image: null | string) => void
  seedMembers?: string[]
  seedName: string
}

/** Compact picture controls shared by group-chat creation and settings:
 *  a live preview (image, else the organization glyph), Upload / Generate /
 *  Remove. Reuses the bot-avatar pipeline (device picker, 256px normalize,
 *  image.generate probe) so room pictures cost the same as bot avatars. */
export function GroupImageControls({ image, onImage, seedName, seedMembers }: GroupImageControlsProps) {
  const b = useBots()
  const { t } = useI18n()
  const imagen = useValue($imagenAvailable)
  const [busy, setBusy] = useState(false)

  if (imagen === null) {
    void probeImagen()
  }

  const upload = async () => {
    const raw = await pickImageFromDevice()

    if (raw) {
      onImage(await normalizeAvatarImage(raw))
    }
  }

  const generate = async () => {
    if (busy) {
      return
    }

    setBusy(true)

    try {
      const who = [seedName, seedMembers?.length ? `a team of ${seedMembers.join(', ')}` : '']
        .filter(Boolean)
        .join(' — ')

      const res = await host.request<ImageGenerateResponse>('image.generate', {
        prompt:
          `Group chat icon for an AI agent team called "${who || 'a bot team'}". ` +
          'Friendly minimal emblem, bold flat vector style, solid color background, centered, no text.',
        aspect_ratio: 'square'
      })

      if (!res?.success) {
        throw new Error(res?.error || b.group.pictureGenerationFailed)
      }

      const img = res.image_data || res.image

      if (img) {
        onImage(await normalizeAvatarImage(img))
      }
    } catch (err) {
      host.notifyError(err, b.group.pictureGenerationFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--chrome-action-hover)">
        {image ? (
          <img alt="" className="size-full object-cover" src={image} />
        ) : (
          <Codicon className="text-(--ui-text-tertiary)" name="organization" />
        )}
      </div>
      <Button onClick={upload} size="sm" type="button" variant="secondary">
        {b.avatar.upload}
      </Button>
      {imagen ? (
        <Button disabled={busy} onClick={generate} size="sm" type="button" variant="secondary">
          {busy ? b.avatar.generating : b.avatar.generate}
        </Button>
      ) : null}
      {image ? (
        <Button onClick={() => onImage(null)} size="sm" type="button" variant="ghost">
          {t.common.remove}
        </Button>
      ) : null}
    </div>
  )
}

interface MentionToken {
  query: string
  start: number
}

function mentionTokenAt(text: string, caret: number): MentionToken | null {
  const match = /(^|\s)@([^\s@]*)$/u.exec(text.slice(0, caret))

  return match ? { query: match[2].toLocaleLowerCase(), start: caret - match[2].length - 1 } : null
}

interface MentionOption {
  handle: string
  label: string
  detail?: string
  avatar: ReactNode
}

interface GroupMentionInputProps {
  'aria-label'?: string
  autoFocus?: boolean
  className?: string
  disabled?: boolean
  appearance?: 'field' | 'composer'
  ref?: Ref<GroupMentionInputHandle>
  /** Addresses stay frozen; the name/avatar resolvers must belong to this room's source. */
  handleFor?: (member: GroupMember) => string | undefined
  nameFor?: (member: GroupMember) => string
  avatarFor?: (member: GroupMember) => ReactNode
  detailFor?: (member: GroupMember) => string | undefined
  everyoneLabel?: string
  pickerLabel?: string
  /** Exact room and source authority; clipboard recipient bindings never cross it. */
  mentionScope?: string
  onInvalidMentionPaste?: () => void
  members: GroupMember[]
  onChange: (value: string) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onSubmitDraft?: () => void
  placeholder?: string
  /** Canonical draft text, including frozen addresses rather than display names. */
  value: string
}

export interface GroupMentionInputHandle {
  focus: () => void
  focusEnd: () => void
  openMentions: () => void
  mention: (handle: string) => void
}

/** Focus a reply composer after its draft has painted. */
export function focusComposerEnd(
  input: RefObject<{
    focus: () => void
    focusEnd?: () => void
    value?: string
    setSelectionRange?: (start: number, end: number) => void
  } | null>
) {
  requestAnimationFrame(() => {
    const el = input.current

    if (!el) {
      return
    }

    if (el.focusEnd) {
      el.focusEnd()

      return
    }

    el.focus()

    if (el.value !== undefined) {
      el.setSelectionRange?.(el.value.length, el.value.length)
    }
  })
}

/** The native textarea shows names while its owning draft keeps exact addresses.
 * Display names never become a lookup key, including when names are duplicated. */
export function GroupMentionInput({
  handleFor,
  nameFor,
  avatarFor,
  detailFor,
  everyoneLabel,
  pickerLabel,
  mentionScope,
  onInvalidMentionPaste,
  members,
  onChange,
  onSubmitDraft,
  value,
  appearance = 'field',
  ref,
  ...inputProps
}: GroupMentionInputProps) {
  const b = useBots()
  const allMeta: Record<string, BotMeta> = useValue($botMeta)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const editSelection = useRef<{ start: number; end: number } | undefined>(undefined)
  const composing = useRef(false)
  const [token, setToken] = useState<MentionToken | null>(null)
  const [selected, setSelected] = useState(0)
  const listId = useId()
  const allLabel = everyoneLabel || b.canonical.allMembers

  const seats = groupMentionSeats({ members, handleFor, nameFor, avatarFor, detailFor }, allMeta)

  const identities = [...seats, { handle: 'everyone', label: allLabel }, { handle: 'all', label: allLabel }]
  const projection = projectGroupMentions(value, identities)
  const query = token?.query || ''

  const options: MentionOption[] = token
    ? [
        ...(['everyone', 'all', allLabel.toLocaleLowerCase()].some(key => key.includes(query))
          ? [{ handle: 'everyone', label: allLabel, avatar: <Codicon name="organization" /> }]
          : []),
        ...seats
          .filter(
            member =>
              member.handle.toLocaleLowerCase().includes(query) || member.label.toLocaleLowerCase().includes(query)
          )
          .map(member => ({
            ...member,
            // Only an otherwise indistinguishable duplicate needs its address as a secondary detail.
            detail:
              member.detail ||
              (seats.some(other => other.handle !== member.handle && other.label === member.label)
                ? `@${member.handle}`
                : undefined)
          }))
      ]
    : []

  const open = Boolean(token) && options.length > 0
  const active = open ? Math.min(selected, options.length - 1) : 0

  const refreshToken = (target: HTMLTextAreaElement) => {
    const caret = target.selectionStart ?? target.value.length
    const bound = projection.spans.some(span => caret > span.start && caret <= span.end)
    setToken(bound ? null : mentionTokenAt(target.value, caret))
    setSelected(0)
  }

  const update = (next: { raw: string; rawCaret: number }, focus = true) => {
    onChange(next.raw)
    const pos = groupMentionDisplayOffset(projectGroupMentions(next.raw, identities), next.rawCaret)
    requestAnimationFrame(() => {
      const el = inputRef.current

      if (!el || composing.current || (!focus && el.ownerDocument.activeElement !== el)) {
        return
      }

      if (focus) {
        el.focus()
      }

      el.setSelectionRange(pos, pos)
    })
  }

  const insert = (handle: string) => {
    if (!token) {
      return
    }

    update(
      replaceGroupMentionRange(
        projection,
        token.start,
        inputRef.current?.selectionStart ?? projection.text.length,
        `@${handle} `
      )
    )
    setToken(null)
  }

  const clipboard = groupMentionClipboardHandlers({
    scope: mentionScope,
    projection,
    identities,
    onPaste: inputProps.onPaste,
    onInvalidMentionPaste,
    update,
    rememberSelection: selection => {
      editSelection.current = selection
    },
    closePicker: () => setToken(null)
  })

  useImperativeHandle(ref, () => {
    const append = (handle?: string) => {
      if (inputProps.disabled) {
        return
      }

      const el = inputRef.current
      const start = el?.selectionStart ?? projection.text.length
      const end = el?.selectionEnd ?? start
      const prefix = projection.text.slice(0, start)
      const address = `${prefix && !/\s$/.test(prefix) ? ' ' : ''}@${handle === undefined ? '' : `${handle} `}`
      const next = replaceGroupMentionRange(projection, start, end, address)
      update(next)
      const pos = groupMentionDisplayOffset(projectGroupMentions(next.raw, identities), next.rawCaret)
      setToken(handle === undefined ? { start: pos - 1, query: '' } : null)
      setSelected(0)
    }

    return {
      focus: () => inputRef.current?.focus(),
      focusEnd: () => {
        const el = inputRef.current
        el?.focus()
        el?.setSelectionRange(el.value.length, el.value.length)
      },
      openMentions: () => append(),
      mention: handle => append(handle)
    }
  })

  return (
    <Popover
      onOpenChange={next => {
        if (!next) {
          setToken(null)
        }
      }}
      open={open}
    >
      <PopoverAnchor asChild>
        <div className="aino-group-mention-input relative min-w-0 flex-1">
          <Textarea
            {...inputProps}
            {...clipboard}
            appearance={appearance}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              appearance === 'composer'
                ? 'field-sizing-content max-h-40 overflow-y-auto'
                : 'field-sizing-content max-h-[min(50vh,24rem)] min-h-9 resize-none overflow-y-auto',
              inputProps.className
            )}
            onBeforeInput={event => {
              editSelection.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd
              }
            }}
            onBlur={() => setToken(null)}
            onChange={event => {
              const next = editGroupMentions(
                projection,
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
                editSelection.current
              )

              editSelection.current = undefined
              update(next, false)
              setToken(
                composing.current
                  ? null
                  : mentionTokenAt(event.target.value, event.target.selectionStart ?? event.target.value.length)
              )
              setSelected(0)
            }}
            onClick={event => refreshToken(event.target as HTMLTextAreaElement)}
            onCompositionEnd={event => {
              composing.current = false
              refreshToken(event.currentTarget)
            }}
            onCompositionStart={() => {
              composing.current = true
              setToken(null)
            }}
            onKeyDown={event => {
              editSelection.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd
              }

              if (event.nativeEvent?.isComposing || event.keyCode === 229) {
                return
              }

              if (open) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)

                  return
                }

                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  insert(options[active].handle)

                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setToken(null)

                  return
                }
              }

              if (
                (event.key === 'Backspace' || event.key === 'Delete') &&
                event.currentTarget.selectionStart === event.currentTarget.selectionEnd
              ) {
                const caret = event.currentTarget.selectionStart

                const span = projection.spans.find(span =>
                  event.key === 'Backspace'
                    ? caret > span.start && caret <= span.end
                    : caret >= span.start && caret < span.end
                )

                if (span) {
                  event.preventDefault()
                  update(replaceGroupMentionRange(projection, span.start, span.end, ''))
                  setToken(null)

                  return
                }
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onSubmitDraft?.()
              }
            }}
            ref={inputRef}
            rows={1}
            value={projection.text}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="aino-group-mention-popover"
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => {
          if (inputRef.current?.contains(event.target as Node)) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={event => event.preventDefault()}
        showArrow={false}
        side="top"
        sideOffset={12}
      >
        {pickerLabel && <div className="aino-group-mention-heading">{pickerLabel}</div>}
        <GroupMentionOptions
          active={active}
          listId={listId}
          onActiveChange={setSelected}
          onSelect={insert}
          options={options}
          pickerLabel={pickerLabel}
        />
      </PopoverContent>
    </Popover>
  )
}

function groupMentionSeats(
  {
    members,
    handleFor,
    nameFor,
    avatarFor,
    detailFor
  }: Pick<GroupMentionInputProps, 'members' | 'handleFor' | 'nameFor' | 'avatarFor' | 'detailFor'>,
  allMeta: Record<string, BotMeta>
): MentionOption[] {
  return members
    .map(member => {
      const meta = botRosterMeta(member, allMeta)
      const handle = String(handleFor?.(member) ?? (botMentionTag(member) || botHandle(member.name, member))).trim()
      const label = nameFor?.(member) || displayName(member, meta)
      const appearance = botAppearance(member.name, meta)

      return {
        handle,
        label,
        detail: detailFor?.(member) || member.connectionLabel,
        avatar: avatarFor?.(member) ?? (
          <BotFace {...appearance} color={avatarColor(appearance.color, member.name)} name={member.name} size={30} />
        )
      }
    })
    .filter(member => member.handle)
}

interface GroupMentionOptionsProps {
  active: number
  listId: string
  onActiveChange: (index: number) => void
  onSelect: (handle: string) => void
  options: MentionOption[]
  pickerLabel?: string
}

function GroupMentionOptions({
  active,
  listId,
  onActiveChange,
  onSelect,
  options,
  pickerLabel
}: GroupMentionOptionsProps) {
  return (
    <div aria-label={pickerLabel} className="aino-group-mention-list" id={listId} role="listbox">
      {options.map((option, index) => (
        <RowButton
          aria-selected={index === active}
          className="aino-group-mention-option"
          data-selected={index === active || undefined}
          id={`${listId}-${index}`}
          key={option.handle}
          onClick={() => onSelect(option.handle)}
          onMouseDown={event => {
            event.preventDefault()
            onSelect(option.handle)
          }}
          onMouseEnter={() => onActiveChange(index)}
          role="option"
          tabIndex={-1}
        >
          <span aria-hidden="true" className="aino-group-mention-avatar">
            {option.avatar}
          </span>
          <span className="aino-group-mention-person">
            <span className="aino-group-mention-name">{option.label}</span>
            {option.detail && <span className="aino-group-mention-detail">{option.detail}</span>}
          </span>
          {index === active && (
            <span aria-hidden="true" className="aino-group-mention-enter">
              <Codicon name="arrow-small-right" />
            </span>
          )}
        </RowButton>
      ))}
    </div>
  )
}

/** A pending prompt as the room renders it. */
export type GroupRoomPrompt = GroupPrompt & {
  /** TODO(bot-mode-types): nothing ever sets this — syncGroupClarify builds
   *  every entry without a thread — so the answer GroupClarifyCard echoes back
   *  into the room always lands in the 'legacy' thread instead of the thread
   *  the member asked from. */
  thread?: string
}

/** A sub-question normalized for rendering: one card row, one answer. */
interface GroupClarifyQuestion {
  choices: string[]
  multiSelect: boolean
  qid: string
  question: string
}

interface GroupClarifyCardProps {
  entry: GroupRoomPrompt
  members: GroupMember[]
}

/** One member's pending prompt, rendered in the room (#90694).
 *  - clarify: choices as tap buttons (multi-select stages; single-select
 *    stages one), free text always available, batch sub-questions each get
 *    their own input.
 *  - approval: the command in a code row plus the server's choice set
 *    (once/session/always/deny) as buttons — no free text; approvals are a
 *    closed choice. Answer sends via the member's own source. */
export function GroupClarifyCard({ entry, members }: GroupClarifyCardProps) {
  const b = useBots()
  const { t } = useI18n()

  const approvalLabels: Record<string, string> = {
    once: b.canonical.allowOnce,
    deny: b.canonical.deny,
    session: t.assistant.approval.allowSession,
    always: t.assistant.approval.alwaysAllow
  }

  const { group } = entry
  const isApproval = entry.kind === 'approval'
  const member = members.find(m => groupMemberKey(m) === entry.memberKey) || members.find(m => m.name === entry.member)
  const allMeta = useValue($botMeta)
  const memberName = member ? displayName(member, botRosterMeta(member, allMeta)) : b.canonical.memberGeneric
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [sending, setSending] = useState(false)

  const questions: GroupClarifyQuestion[] = isApproval
    ? [
        {
          qid: 'approval',
          question: entry.question,
          choices: entry.choices,
          multiSelect: false
        }
      ]
    : entry.questions.map(q => ({
        qid: q.qid,
        question: typeof q.question === 'string' ? q.question : '',
        choices: Array.isArray(q.choices) ? q.choices.filter(c => typeof c === 'string' && c) : [],
        multiSelect: Boolean(q.multi_select)
      }))

  const answerFor = (q: GroupClarifyQuestion) => {
    const chosen = picked[q.qid] || []

    if (chosen.length) {
      return q.multiSelect ? JSON.stringify(chosen) : chosen[0]
    }

    return isApproval ? '' : (drafts[q.qid] || '').trim()
  }

  const anyAnswered = questions.some(q => answerFor(q))

  /** `chosen` short-circuits the staged answer: approval choices submit on
   *  click (#91706), so the value travels with the click instead of waiting
   *  for a re-render of `picked` and a second Respond click. */
  const submit = async (chosen?: string) => {
    const resolve = (q: GroupClarifyQuestion) => chosen ?? answerFor(q)

    if (!member || sending || !questions.some(q => resolve(q))) {
      return
    }

    setSending(true)

    try {
      if (isApproval) {
        await answerGroupClarify(entry, member, resolve(questions[0]))
      } else {
        const answers: Record<string, null | string> = {}

        for (const q of questions) {
          answers[q.qid] = resolve(q) || null
        }

        await answerGroupClarify(entry, member, answers)
      }

      // Echo the exchange into the room log so the thread reads complete.
      const summary = isApproval
        ? `${resolve(questions[0])} — ${entry.command || entry.question || b.group.commandApproval}`
        : questions
            .filter(q => resolve(q))
            .map(q => (questions.length > 1 ? `${q.question}: ${resolve(q)}` : resolve(q)))
            .join('\n')

      appendGroupChatEntry(
        group,
        {
          kind: 'user',
          name: 'You'
        },
        summary,
        entry.thread || 'legacy'
      )
    } catch (err: any) {
      host.notify({
        kind: 'error',
        message: b.group.answerFailed(memberName, String(err?.message || err))
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-1.5 rounded-md border border-(--ui-accent)/50 bg-(--ui-accent)/5 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Codicon className="shrink-0 text-(--ui-accent)" name={isApproval ? 'shield' : 'question'} />
        {isApproval ? b.group.wantsToRunCommand(memberName) : b.group.asks(memberName)}
      </div>
      {isApproval && entry.command ? (
        <code className="block overflow-x-auto rounded bg-(--ui-bg-secondary,rgba(0,0,0,0.25)) px-2 py-1 font-mono text-[length:var(--aino-text-caption)] whitespace-pre-wrap break-all">
          {entry.command}
        </code>
      ) : null}
      {questions.map(q => (
        <div className="grid gap-1" key={`q:${q.qid}`}>
          {q.question ? <div className="text-xs whitespace-pre-wrap">{q.question}</div> : null}
          {q.choices.length ? (
            <div className="flex flex-wrap gap-1">
              {q.choices.map(choice => {
                const chosen = (picked[q.qid] || []).includes(choice)

                return (
                  <Button
                    className={cn(
                      'h-6 px-2 text-[length:var(--aino-text-caption)]',
                      isApproval && choice === 'deny' && !chosen && 'text-destructive'
                    )}
                    disabled={sending || !member}
                    key={`choice:${q.qid}:${choice}`}
                    onClick={() => {
                      // Approvals are a closed choice set: the click IS the
                      // answer (#91706). Staging it behind a footer button
                      // left users with a highlighted choice and no way to
                      // send it when the footer was clipped or covered.
                      if (isApproval) {
                        setPicked({
                          [q.qid]: [choice]
                        })
                        void submit(choice)

                        return
                      }

                      setDrafts(prev => ({
                        ...prev,
                        [q.qid]: ''
                      }))
                      setPicked(prev => {
                        const current = prev[q.qid] || []

                        const next = q.multiSelect
                          ? chosen
                            ? current.filter(c => c !== choice)
                            : [...current, choice]
                          : chosen
                            ? []
                            : [choice]

                        return {
                          ...prev,
                          [q.qid]: next
                        }
                      })
                    }}
                    size="sm"
                    variant={chosen ? 'default' : 'secondary'}
                  >
                    {isApproval ? approvalLabels[choice] || choice : choice}
                  </Button>
                )
              })}
            </div>
          ) : null}
          {/* Approvals are a closed choice set — no free-text input. */}
          {isApproval ? null : (
            <Input
              aria-label={b.group.answerTo(entry.member)}
              className="h-7 text-xs"
              key={`input:${q.qid}`}
              onChange={event => {
                const value = event.target.value
                setPicked(prev => ({
                  ...prev,
                  [q.qid]: []
                }))
                setDrafts(prev => ({
                  ...prev,
                  [q.qid]: value
                }))
              }}
              onKeyDown={event => {
                // IME guard: Enter confirming a composed word must not submit.
                if (event.nativeEvent?.isComposing || event.keyCode === 229) {
                  return
                }

                if (event.key === 'Enter' && questions.length === 1) {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder={q.choices.length ? b.group.answerOwnPlaceholder : b.group.answerPlaceholder}
              value={drafts[q.qid] || ''}
            />
          )}
        </div>
      ))}
      {/* Approval choices submit on click; only clarify answers need a footer. */}
      {isApproval ? null : (
        <div className="flex justify-end">
          <Button disabled={sending || !anyAnswered || !member} onClick={() => void submit()} size="sm">
            {sending ? b.group.sending : b.group.answer}
          </Button>
        </div>
      )}
    </div>
  )
}
