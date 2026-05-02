import './liquid-glass-overrides.css'

import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import LiquidGlass from 'liquid-glass-react'
import { type ClipboardEvent, type CSSProperties, useEffect, useRef, useState } from 'react'

import { hermesDirectiveFormatter } from '@/components/assistant-ui/directive-text'
import { useMediaQuery } from '@/hooks/use-media-query'
import { chatMessageText } from '@/lib/chat-messages'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $composerAttachments } from '@/store/composer'
import { $messages } from '@/store/session'
import { $threadScrolledUp } from '@/store/thread-scroll'

import { AttachmentList } from './attachments'
import { ContextMenu } from './context-menu'
import { ComposerControls } from './controls'
import { DirectivePopover } from './directive-popover'
import { HelpHint } from './help-hint'
import { useAtCompletions } from './hooks/use-at-completions'
import { useComposerGlassTweaks } from './hooks/use-composer-glass-tweaks'
import { useSlashCompletions } from './hooks/use-slash-completions'
import { useVoiceConversation } from './hooks/use-voice-conversation'
import { useVoiceRecorder } from './hooks/use-voice-recorder'
import { SlashPopover } from './slash-popover'
import type { ChatBarProps } from './types'
import { UrlDialog } from './url-dialog'
import { VoiceActivity, VoicePlaybackActivity } from './voice-activity'

const COMPOSER_SHELL_CLASS =
  'group/composer absolute bottom-0 left-1/2 z-30 w-[min(calc(100%-1rem),clamp(26rem,61.8%,56rem))] max-w-full -translate-x-1/2 pt-2 pb-[var(--composer-shell-pad-block-end)]'

const COMPOSER_SCROLLED_DIM_CLASS =
  'opacity-30 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'

const COMPOSER_FROST_CLASS = cn(
  'pointer-events-none absolute inset-0 -z-10 rounded-(--composer-active-radius)',
  'bg-[color-mix(in_srgb,var(--dt-card)_72%,transparent)]',
  'backdrop-blur-[0.75rem] backdrop-saturate-[1.12]',
  '[-webkit-backdrop-filter:blur(0.75rem)_saturate(1.12)]',
  'transition-[background-color,backdrop-filter,-webkit-backdrop-filter] duration-150 ease-out',
  'group-data-[thread-scrolled-up]/composer:bg-[color-mix(in_srgb,var(--dt-card)_48%,transparent)]',
  'group-focus-within/composer:bg-[var(--dt-card)]',
  'group-focus-within/composer:[backdrop-filter:none]',
  'group-focus-within/composer:[-webkit-backdrop-filter:none]'
)

export function ChatBar({
  busy,
  cwd,
  disabled,
  focusKey,
  gateway,
  maxRecordingSeconds = 120,
  sessionId,
  state,
  onCancel,
  onAddUrl,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages,
  onRemoveAttachment,
  onSubmit,
  onTranscribeAudio
}: ChatBarProps) {
  const aui = useAui()
  const draft = useAuiState(s => s.composer.text)
  const attachments = useStore($composerAttachments)
  const scrolledUp = useStore($threadScrolledUp)

  const composerRef = useRef<HTMLFormElement | null>(null)
  const glassShellRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef(draft)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)

  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [voiceConversationActive, setVoiceConversationActive] = useState(false)
  const [tight, setTight] = useState(false)
  const lastSpokenIdRef = useRef<string | null>(null)

  const narrow = useMediaQuery('(max-width: 680px)')

  const [askPlaceholder] = useState(() => {
    const lines = [
      'Hey friend, what can I help with?',
      "What's on your mind? I'm here with you.",
      'Need a hand? We can take it one step at a time.',
      'Want to walk through this bug together?',
      "Share what you're working on and we'll figure it out.",
      "Tell me where you're stuck and I'll stay with you.",
      'Duck mode: gentle debugging, together.'
    ]

    return lines[Math.floor(Math.random() * lines.length)] ?? 'Ask anything'
  })

  const at = useAtCompletions({ gateway: gateway ?? null, sessionId: sessionId ?? null, cwd: cwd ?? null })
  const slash = useSlashCompletions({ gateway: gateway ?? null })

  const stacked = expanded || narrow || tight
  const hasComposerPayload = draft.trim().length > 0 || attachments.length > 0
  const canSubmit = busy || hasComposerPayload
  const showHelpHint = draft === '?'

  const glassTweaks = useComposerGlassTweaks()

  const focusInput = () => window.requestAnimationFrame(() => textareaRef.current?.focus())

  useEffect(() => {
    if (!disabled) {
      focusInput()
    }
  }, [disabled, focusKey])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (urlOpen) {
      window.requestAnimationFrame(() => urlInputRef.current?.focus())
    }
  }, [urlOpen])

  useEffect(() => {
    if (!draft) {
      setExpanded(false)

      return
    }

    if (expanded) {
      return
    }

    const wraps = (textareaRef.current?.scrollHeight ?? 0) > 42

    if (draft.includes('\n') || wraps) {
      setExpanded(true)
    }
  }, [draft, expanded])

  useEffect(() => {
    const el = composerRef.current

    if (!el) {
      return
    }

    const update = () => setTight(el.getBoundingClientRect().width < 500)

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)

    return () => ro.disconnect()
  }, [])

  const insertText = (text: string) => {
    const currentDraft = draftRef.current
    const sep = currentDraft && !currentDraft.endsWith('\n') ? '\n' : ''
    const nextDraft = `${currentDraft}${sep}${text}`

    draftRef.current = nextDraft
    aui.composer().setText(nextDraft)
    focusInput()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text')

    if (!pastedText) {
      return
    }

    const trimmedText = pastedText.replace(/^[\t ]*(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+[\t ]*$/g, '')

    if (trimmedText === pastedText) {
      return
    }

    event.preventDefault()
    const textarea = event.currentTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    const nextDraft = textarea.value.slice(0, start) + trimmedText + textarea.value.slice(end)

    const cursor = start + trimmedText.length

    aui.composer().setText(nextDraft)
    window.requestAnimationFrame(() => {
      const current = textareaRef.current

      if (!current) {
        return
      }

      current.focus()
      current.setSelectionRange(cursor, cursor)
    })
  }

  const submitDraft = () => {
    if (busy) {
      triggerHaptic('cancel')
      onCancel()
    } else if (draft.trim() || attachments.length > 0) {
      triggerHaptic('submit')
      void onSubmit(draft)
      aui.composer().setText('')
    }

    focusInput()
  }

  const submitUrl = () => {
    const url = urlValue.trim()

    if (!url) {
      return
    }

    if (onAddUrl) {
      onAddUrl(url)
    } else {
      insertText(`@url:${url}`)
    }

    triggerHaptic('success')
    setUrlValue('')
    setUrlOpen(false)
  }

  const { dictate, voiceActivityState, voiceStatus } = useVoiceRecorder({
    focusInput,
    maxRecordingSeconds,
    onTranscript: insertText,
    onTranscribeAudio
  })

  const pendingResponse = () => {
    const messages = $messages.get()
    const last = messages.findLast(m => m.role === 'assistant' && !m.hidden)

    if (!last || last.id === lastSpokenIdRef.current) {
      return null
    }

    const text = chatMessageText(last).trim()

    if (!text) {
      return null
    }

    return {
      id: last.id,
      pending: Boolean(last.pending),
      text
    }
  }

  const consumePendingResponse = () => {
    const messages = $messages.get()
    const last = messages.findLast(m => m.role === 'assistant' && !m.hidden)

    if (last) {
      lastSpokenIdRef.current = last.id
    }
  }

  const submitVoiceTurn = async (text: string) => {
    if (busy) {
      return
    }

    triggerHaptic('submit')
    await onSubmit(text)
    aui.composer().setText('')
    draftRef.current = ''
  }

  const conversation = useVoiceConversation({
    busy,
    consumePendingResponse,
    enabled: voiceConversationActive,
    onFatalError: () => setVoiceConversationActive(false),
    onSubmit: submitVoiceTurn,
    onTranscribeAudio,
    pendingResponse
  })

  const contextMenu = (
    <ContextMenu
      onInsertText={insertText}
      onOpenUrlDialog={() => {
        triggerHaptic('open')
        setUrlOpen(true)
      }}
      onPasteClipboardImage={onPasteClipboardImage}
      onPickFiles={onPickFiles}
      onPickFolders={onPickFolders}
      onPickImages={onPickImages}
      state={state}
    />
  )

  const controls = (
    <ComposerControls
      busy={busy}
      canSubmit={canSubmit}
      conversation={{
        active: voiceConversationActive,
        level: conversation.level,
        muted: conversation.muted,
        onEnd: () => {
          setVoiceConversationActive(false)
          void conversation.end()
        },
        onStart: () => setVoiceConversationActive(true),
        onStopTurn: conversation.stopTurn,
        onToggleMute: conversation.toggleMute,
        status: conversation.status
      }}
      disabled={disabled}
      hasComposerPayload={hasComposerPayload}
      onDictate={dictate}
      state={state}
      voiceStatus={voiceStatus}
    />
  )

  const input = (
    <ComposerPrimitive.Input
      className={cn(
        'min-h-8 max-h-37.5 resize-none overflow-y-auto bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed',
        stacked && 'pl-3',
        stacked ? 'w-full' : 'min-w-48 flex-1'
      )}
      disabled={disabled}
      onPaste={handlePaste}
      placeholder={disabled ? 'Starting Hermes...' : askPlaceholder}
      ref={textareaRef}
      rows={1}
      unstable_focusOnScrollToBottom={false}
    />
  )

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          className={COMPOSER_SHELL_CLASS}
          data-slot="composer-root"
          data-thread-scrolled-up={scrolledUp ? '' : undefined}
          onSubmit={e => {
            e.preventDefault()
            submitDraft()
          }}
          ref={composerRef}
          style={
            {
              '--composer-active-radius': `${glassTweaks.liquid.cornerRadius}px`,
              '--composer-glass-radius': `${glassTweaks.liquid.cornerRadius}px`
            } as CSSProperties
          }
        >
          {showHelpHint && <HelpHint />}
          <DirectivePopover
            adapter={at.adapter}
            directive={{ formatter: hermesDirectiveFormatter }}
            loading={at.loading}
          />
          <SlashPopover adapter={slash.adapter} loading={slash.loading} />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: glassTweaks.fadeBackground }}
          />
          <div className="relative w-full">
            <div
              className={cn(
                'composer-liquid-shell-wrap absolute inset-0 isolate overflow-hidden rounded-(--composer-glass-radius,20px) transition-opacity duration-200 ease-out',
                'group-has-data-[state=open]/composer:rounded-t-none',
                scrolledUp ? COMPOSER_SCROLLED_DIM_CLASS : 'opacity-100'
              )}
              data-glass-frame="true"
              data-show-library-rims={glassTweaks.showLibraryRims ? 'true' : undefined}
              data-slot="composer-liquid-shell-wrap"
              ref={glassShellRef}
            >
              <LiquidGlass
                aberrationIntensity={glassTweaks.liquid.aberrationIntensity}
                blurAmount={glassTweaks.liquid.blurAmount}
                className="composer-liquid-shell pointer-events-none absolute inset-0 h-full w-full"
                cornerRadius={glassTweaks.liquid.cornerRadius}
                displacementScale={glassTweaks.liquid.displacementScale}
                elasticity={glassTweaks.liquid.elasticity}
                key={glassTweaks.liquidKey}
                mode={glassTweaks.liquid.mode}
                mouseContainer={composerRef}
                padding="0"
                saturation={glassTweaks.liquid.saturation}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              >
                <span className="block h-full w-full" />
              </LiquidGlass>
            </div>
            <div
              className={cn(
                'relative z-4 isolate overflow-hidden rounded-(--composer-active-radius) border border-input/70 shadow-composer transition-[border-color,box-shadow] duration-200 ease-out',
                'group-focus-within/composer:border-ring/35 group-focus-within/composer:shadow-composer-focus',
                'group-has-data-[state=open]/composer:rounded-t-none group-has-data-[state=open]/composer:border-t-transparent',
                'group-has-data-[state=open]/composer:shadow-[0_0.0625rem_0_0.0625rem_color-mix(in_srgb,var(--dt-ring)_35%,transparent),0_0.5rem_1.5rem_color-mix(in_srgb,var(--shadow-ink)_6%,transparent)]'
              )}
              data-slot="composer-surface"
            >
              <div aria-hidden className={COMPOSER_FROST_CLASS} />
              <div
                className={cn(
                  'relative z-1 flex min-h-0 w-full flex-col gap-1.5 px-2 py-1.5 transition-opacity duration-200 ease-out',
                  scrolledUp ? COMPOSER_SCROLLED_DIM_CLASS : 'opacity-100'
                )}
                data-slot="composer-fade"
              >
                <VoiceActivity state={voiceActivityState} />
                <VoicePlaybackActivity />
                {attachments.length > 0 && (
                  <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />
                )}
                {stacked ? (
                  <>
                    {input}
                    <div className="flex w-full items-center gap-1.5">
                      {contextMenu}
                      {controls}
                    </div>
                  </>
                ) : (
                  <div className="flex w-full items-end gap-1.5">
                    {contextMenu}
                    {input}
                    {controls}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>

      <UrlDialog
        inputRef={urlInputRef}
        onChange={setUrlValue}
        onOpenChange={setUrlOpen}
        onSubmit={submitUrl}
        open={urlOpen}
        value={urlValue}
      />
    </>
  )
}

export function ChatBarFallback() {
  return (
    <div
      className={cn(COMPOSER_SHELL_CLASS, 'bg-linear-to-b from-transparent to-background/55')}
      data-slot="composer-root"
      style={{ '--composer-active-radius': '1.25rem' } as CSSProperties}
    >
      <div className="relative isolate h-11 w-full overflow-hidden rounded-(--composer-active-radius) border border-input/70 shadow-composer">
        <div aria-hidden className={COMPOSER_FROST_CLASS} />
      </div>
    </div>
  )
}
