import './liquid-glass-overrides.css'

import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import LiquidGlass from 'liquid-glass-react'
import {
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  useEffect,
  useRef,
  useState
} from 'react'

import { hermesDirectiveFormatter } from '@/components/assistant-ui/directive-text'
import { useMediaQuery } from '@/hooks/use-media-query'
import { chatMessageText } from '@/lib/chat-messages'
import { DATA_IMAGE_URL_RE, dataUrlToBlob } from '@/lib/embedded-images'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $composerAttachments, $composerDraft } from '@/store/composer'
import { $messages } from '@/store/session'
import { $threadScrolledUp } from '@/store/thread-scroll'

import { extractDroppedFiles } from '../hooks/use-composer-actions'

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
import { SkinSlashPopover } from './skin-slash-popover'
import { SlashPopover } from './slash-popover'
import type { ChatBarProps } from './types'
import { UrlDialog } from './url-dialog'
import { VoiceActivity, VoicePlaybackActivity } from './voice-activity'

const COMPOSER_SHELL_CLASS =
  'group/composer absolute bottom-0 left-1/2 z-30 max-w-full pt-2 pb-[var(--composer-shell-pad-block-end)]'

function extractClipboardImageBlobs(clipboard: DataTransfer): Blob[] {
  const blobs: Blob[] = []
  const seen = new Set<Blob>()

  const push = (blob: Blob | null) => {
    if (!blob || blob.size === 0 || seen.has(blob)) {
      return
    }

    seen.add(blob)
    blobs.push(blob)
  }

  if (clipboard.items?.length) {
    for (const item of clipboard.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        push(item.getAsFile())
      }
    }
  }

  if (clipboard.files?.length) {
    for (let i = 0; i < clipboard.files.length; i += 1) {
      const file = clipboard.files.item(i)

      if (file && file.type.startsWith('image/')) {
        push(file)
      }
    }
  }

  if (blobs.length > 0) {
    return blobs
  }

  const text = clipboard.getData('text/plain').trim()

  if (DATA_IMAGE_URL_RE.test(text)) {
    push(dataUrlToBlob(text))
  }

  if (blobs.length === 0) {
    const html = clipboard.getData('text/html')

    if (html) {
      const matches = html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["'](data:image\/[^"']+)["']/gi)

      for (const match of matches) {
        push(dataUrlToBlob(match[1]))
      }
    }
  }

  return blobs
}

// Below this composer width the input gets cramped — drop controls onto a second row.
const COMPOSER_STACK_BREAKPOINT_PX = 380

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
  onAttachDroppedItems,
  onAttachImageBlob,
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
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const lastSpokenIdRef = useRef<string | null>(null)

  const narrow = useMediaQuery('(max-width: 480px)')

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

  const placeholder = disabled
    ? stacked
      ? 'Starting...'
      : 'Starting Hermes...'
    : stacked
      ? 'Ask anything'
      : askPlaceholder

  const glassTweaks = useComposerGlassTweaks()

  const focusInput = () => window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))

  useEffect(() => {
    if (!disabled) {
      focusInput()
    }
  }, [disabled, focusKey])

  useEffect(() => {
    draftRef.current = draft
    $composerDraft.set(draft)
  }, [draft])

  useEffect(
    () =>
      $composerDraft.subscribe(value => {
        if (value !== draftRef.current) {
          aui.composer().setText(value)
        }
      }),
    [aui]
  )

  useEffect(() => {
    if (urlOpen) {
      window.requestAnimationFrame(() => urlInputRef.current?.focus({ preventScroll: true }))
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

    const update = () => setTight(el.getBoundingClientRect().width < COMPOSER_STACK_BREAKPOINT_PX)

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

  const selectSkinSlashCommand = (command: string) => {
    draftRef.current = command
    aui.composer().setText(command)
    focusInput()
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageBlobs = extractClipboardImageBlobs(event.clipboardData)

    if (imageBlobs.length > 0) {
      event.preventDefault()

      if (onAttachImageBlob) {
        triggerHaptic('selection')

        for (const blob of imageBlobs) {
          void onAttachImageBlob(blob)
        }
      }

      return
    }

    const pastedText = event.clipboardData.getData('text')

    if (!pastedText) {
      return
    }

    // Some clipboard sources deliver an image as a giant `data:image/...;base64,...`
    // text/plain payload. Without this guard the whole base64 string would be
    // inserted into the textarea (and persisted as the user message). Drop it
    // outright — image pastes belong on the image-blob path above.
    if (DATA_IMAGE_URL_RE.test(pastedText.trim())) {
      event.preventDefault()

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

      current.focus({ preventScroll: true })
      current.setSelectionRange(cursor, cursor)
    })
  }

  const dragHasAttachments = (transfer: DataTransfer | null) => {
    if (!transfer) {
      return false
    }

    if (Array.from(transfer.types || []).includes('Files')) {
      return true
    }

    return Array.from(transfer.items || []).some(item => item.kind === 'file')
  }

  const resetDragState = () => {
    dragDepthRef.current = 0
    setDragActive(false)
  }

  const handleDragEnter = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!onAttachDroppedItems || !dragHasAttachments(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    dragDepthRef.current += 1

    if (!dragActive) {
      setDragActive(true)
    }
  }

  const handleDragOver = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!onAttachDroppedItems || !dragHasAttachments(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!onAttachDroppedItems) {
      return
    }

    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

    if (dragDepthRef.current === 0) {
      setDragActive(false)
    }
  }

  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!onAttachDroppedItems) {
      return
    }

    event.preventDefault()
    resetDragState()

    const candidates = extractDroppedFiles(event.dataTransfer)

    if (candidates.length === 0) {
      return
    }

    void Promise.resolve(onAttachDroppedItems(candidates)).then(attached => {
      if (attached) {
        triggerHaptic('selection')
        focusInput()
      }
    })
  }

  const clearDraft = () => {
    aui.composer().setText('')
    draftRef.current = ''
  }

  const submitDraft = () => {
    if (busy) {
      triggerHaptic('cancel')
      onCancel()
    } else if (draft.trim() || attachments.length > 0) {
      const submitted = draft
      triggerHaptic('submit')
      clearDraft()
      void onSubmit(submitted)
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
    clearDraft()
    await onSubmit(text)
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
        'min-h-(--composer-input-min-height) max-h-(--composer-input-max-height) resize-none overflow-y-auto bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed',
        stacked && 'pl-3',
        stacked ? 'w-full' : 'min-w-(--composer-input-inline-min-width) flex-1'
      )}
      disabled={disabled}
      onPaste={handlePaste}
      placeholder={placeholder}
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
          data-drag-active={dragActive ? '' : undefined}
          data-slot="composer-root"
          data-thread-scrolled-up={scrolledUp ? '' : undefined}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
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
          <SkinSlashPopover draft={draft} onSelect={selectSkinSlashCommand} />
          <div className="pointer-events-none absolute inset-0" style={{ background: glassTweaks.fadeBackground }} />
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
                'group-has-data-[state=open]/composer:shadow-[0_0.0625rem_0_0.0625rem_color-mix(in_srgb,var(--dt-ring)_35%,transparent),0_0.5rem_1.5rem_color-mix(in_srgb,var(--shadow-ink)_6%,transparent)]',
                dragActive && 'border-primary/70 shadow-composer-focus ring-2 ring-primary/40'
              )}
              data-slot="composer-surface"
            >
              <div aria-hidden className={COMPOSER_FROST_CLASS} />
              {dragActive && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-3 flex items-center justify-center rounded-(--composer-active-radius) bg-primary/10 text-sm font-medium text-primary backdrop-blur-[1px]"
                >
                  Drop files to attach
                </div>
              )}
              <div
                className={cn(
                  'relative z-1 flex min-h-0 w-full flex-col gap-(--composer-row-gap) px-(--composer-surface-pad-x) py-(--composer-surface-pad-y) transition-opacity duration-200 ease-out',
                  scrolledUp ? COMPOSER_SCROLLED_DIM_CLASS : 'opacity-100'
                )}
                data-slot="composer-fade"
              >
                <VoiceActivity state={voiceActivityState} />
                <VoicePlaybackActivity />
                {attachments.length > 0 && <AttachmentList attachments={attachments} onRemove={onRemoveAttachment} />}
                {stacked ? (
                  <>
                    {input}
                    <div className="flex w-full items-center gap-(--composer-control-gap)">
                      {contextMenu}
                      {controls}
                    </div>
                  </>
                ) : (
                  <div className="flex w-full items-end gap-(--composer-control-gap)">
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
      <div className="relative isolate h-(--composer-fallback-height) w-full overflow-hidden rounded-(--composer-active-radius) border border-input/70 shadow-composer">
        <div aria-hidden className={COMPOSER_FROST_CLASS} />
      </div>
    </div>
  )
}
