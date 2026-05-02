import { ComposerPrimitive, unstable_useMentionAdapter, useAui, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import LiquidGlass from 'liquid-glass-react'
import { FileText } from 'lucide-react'
import { type ClipboardEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

import { hermesDirectiveFormatter } from '@/components/assistant-ui/directive-text'
import { chatMessageText } from '@/lib/chat-messages'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $composerAttachments } from '@/store/composer'
import { $messages } from '@/store/session'
import { $threadScrolledUp } from '@/store/thread-scroll'

import { AttachmentList } from './attachments'
import {
  ASK_PLACEHOLDERS,
  COMPOSER_BACKDROP_STYLE,
  DEFAULT_MAX_RECORDING_SECONDS,
  DIRECTIVE_ICONS,
  EDGE_NEWLINES_RE,
  EXPAND_HEIGHT_PX,
  NARROW_VIEWPORT,
  SHELL,
  STACK_AT
} from './constants'
import { ContextMenu } from './context-menu'
import { ComposerControls } from './controls'
import { buildMentionCategories, DirectivePopover } from './directive-popover'
import { useComposerGlassTweaks } from './hooks/use-composer-glass-tweaks'
import { useVoiceConversation } from './hooks/use-voice-conversation'
import { useVoiceRecorder } from './hooks/use-voice-recorder'
import type { ChatBarProps } from './types'
import { UrlDialog } from './url-dialog'
import { VoiceActivity, VoicePlaybackActivity } from './voice-activity'

function trimPastedEdgeNewlines(text: string): string {
  return text.replace(EDGE_NEWLINES_RE, '')
}

export function ChatBar({
  busy,
  disabled,
  focusKey,
  maxRecordingSeconds = DEFAULT_MAX_RECORDING_SECONDS,
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
  const [stack, setStack] = useState(false)
  const lastSpokenIdRef = useRef<string | null>(null)

  const [askPlaceholder] = useState(
    () => ASK_PLACEHOLDERS[Math.floor(Math.random() * ASK_PLACEHOLDERS.length)] || 'Ask anything'
  )

  const mentionCategories = useMemo(() => buildMentionCategories(state.tools.suggestions), [state.tools.suggestions])

  const mention = unstable_useMentionAdapter({
    categories: mentionCategories,
    includeModelContextTools: false,
    formatter: hermesDirectiveFormatter,
    iconMap: DIRECTIVE_ICONS,
    fallbackIcon: FileText
  })

  const stacked = expanded || stack
  const hasComposerPayload = draft.trim().length > 0 || attachments.length > 0
  const canSubmit = busy || hasComposerPayload

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

    const wraps = (textareaRef.current?.scrollHeight ?? 0) > EXPAND_HEIGHT_PX

    if (draft.includes('\n') || wraps) {
      setExpanded(true)
    }
  }, [draft, expanded])

  useEffect(() => {
    const mq = window.matchMedia(NARROW_VIEWPORT)

    const update = () => {
      const w = composerRef.current?.getBoundingClientRect().width ?? window.innerWidth

      setStack(mq.matches || w < STACK_AT)
    }

    update()
    mq.addEventListener('change', update)
    const ro = new ResizeObserver(update)

    if (composerRef.current) {
      ro.observe(composerRef.current)
    }

    return () => {
      mq.removeEventListener('change', update)
      ro.disconnect()
    }
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

    const trimmedText = trimPastedEdgeNewlines(pastedText)

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
        <DirectivePopover
          adapter={mention.adapter}
          directive={mention.directive}
          fallbackIcon={mention.fallbackIcon ?? FileText}
          iconMap={mention.iconMap ?? DIRECTIVE_ICONS}
        />
        <ComposerPrimitive.Root
          className={cn(SHELL, 'group/composer pb-8 pt-2')}
          onSubmit={e => {
            e.preventDefault()
            submitDraft()
          }}
          ref={composerRef}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 top-0"
            style={{ background: glassTweaks.fadeBackground }}
          />
          <div className="relative w-full">
            <div
              className={cn(
                'composer-liquid-shell-wrap absolute inset-0 transition-opacity duration-200 ease-out',
                scrolledUp
                  ? 'opacity-70 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'
                  : 'opacity-100'
              )}
              data-glass-frame="true"
              data-show-library-rims={glassTweaks.showLibraryRims ? 'true' : undefined}
              ref={glassShellRef}
              style={
                {
                  '--composer-glass-radius': `${glassTweaks.liquid.cornerRadius}px`
                } as CSSProperties
              }
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
                style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' }}
              >
                <span className="block h-full w-full" />
              </LiquidGlass>
            </div>
            <div
              className={cn(
                'relative z-4 flex w-full flex-col gap-1.5 overflow-hidden border border-input/70 bg-card/72 px-2 py-1.5 shadow-composer transition-[border-color,box-shadow,opacity] duration-200 ease-out group-focus-within/composer:border-ring/35 group-focus-within/composer:shadow-composer-focus',
                scrolledUp
                  ? 'opacity-60 group-hover/composer:opacity-100 group-focus-within/composer:opacity-100'
                  : 'opacity-100'
              )}
              style={{ ...COMPOSER_BACKDROP_STYLE, borderRadius: `${glassTweaks.liquid.cornerRadius}px` }}
            >
              <VoiceActivity state={voiceActivityState} />
              <VoicePlaybackActivity />
              {attachments.length > 0 && <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />}
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
    <div className={cn(SHELL, 'bg-linear-to-b from-transparent to-background/55 pb-8 pt-2')}>
      <div className="relative h-11 w-full">
        <div className="absolute inset-0 rounded-[1.25rem] bg-card/1" style={COMPOSER_BACKDROP_STYLE} />
        <div className="absolute inset-0 rounded-[1.25rem] border border-input/70 bg-card/72 shadow-composer" />
      </div>
    </div>
  )
}
