import { ArrowUp, AudioLines, Loader2, Mic, MicOff, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

import { GHOST_ICON_BTN, ICON_BTN } from './constants'
import type { ConversationStatus } from './hooks/use-voice-conversation'
import type { ChatBarState, VoiceStatus } from './types'

interface ConversationProps {
  active: boolean
  level: number
  muted: boolean
  status: ConversationStatus
  onEnd: () => void
  onStart: () => void
  onStopTurn: () => void
  onToggleMute: () => void
}

export function ComposerControls({
  busy,
  canSubmit,
  conversation,
  disabled,
  hasComposerPayload,
  state,
  voiceStatus,
  onDictate
}: {
  busy: boolean
  canSubmit: boolean
  conversation: ConversationProps
  disabled: boolean
  hasComposerPayload: boolean
  state: ChatBarState
  voiceStatus: VoiceStatus
  onDictate: () => void
}) {
  if (conversation.active) {
    return <ConversationPill {...conversation} disabled={disabled} />
  }

  const showVoicePrimary = !busy && !hasComposerPayload

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <DictationButton disabled={disabled} onToggle={onDictate} state={state.voice} status={voiceStatus} />
      {showVoicePrimary ? (
        <Button
          aria-label="Start voice conversation"
          className={cn(ICON_BTN, 'p-0')}
          disabled={disabled}
          onClick={() => {
            triggerHaptic('open')
            conversation.onStart()
          }}
          size="icon"
          title="Start voice conversation"
          type="button"
        >
          <AudioLines size={17} />
        </Button>
      ) : (
        <Button
          aria-label={busy ? 'Stop' : 'Send'}
          className={cn(ICON_BTN, 'p-0')}
          disabled={disabled || !canSubmit}
          type="submit"
        >
          {busy ? <span className="block size-3 rounded-[0.1875rem] bg-current" /> : <ArrowUp size={18} />}
        </Button>
      )}
    </div>
  )
}

function ConversationPill({
  disabled,
  level,
  muted,
  onEnd,
  onStopTurn,
  onToggleMute,
  status
}: ConversationProps & { disabled: boolean }) {
  const speaking = status === 'speaking'
  const listening = status === 'listening' && !muted

  const label =
    status === 'speaking'
      ? 'Speaking'
      : status === 'transcribing'
        ? 'Transcribing'
        : status === 'thinking'
          ? 'Thinking'
          : muted
            ? 'Muted'
            : 'Listening'

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button
        aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={muted}
        className={cn(GHOST_ICON_BTN, 'p-0', muted && 'bg-muted text-muted-foreground')}
        disabled={disabled}
        onClick={() => {
          triggerHaptic('selection')
          onToggleMute()
        }}
        size="icon"
        title={muted ? 'Unmute microphone' : 'Mute microphone'}
        type="button"
        variant="ghost"
      >
        {muted ? <MicOff size={16} /> : <Mic size={16} />}
      </Button>
      {listening && (
        <Button
          aria-label="Stop listening and send"
          className="h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={disabled}
          onClick={() => {
            triggerHaptic('submit')
            onStopTurn()
          }}
          title="Stop listening and send"
          type="button"
          variant="ghost"
        >
          <Square className="fill-current" size={11} />
          <span>Stop</span>
        </Button>
      )}
      <Button
        aria-label="End voice conversation"
        className="h-8 gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        disabled={disabled}
        onClick={() => {
          triggerHaptic('close')
          onEnd()
        }}
        title="End voice conversation"
        type="button"
      >
        <ConversationIndicator level={level} listening={listening} speaking={speaking} />
        <span>End</span>
      </Button>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  )
}

function ConversationIndicator({
  level,
  listening,
  speaking
}: {
  level: number
  listening: boolean
  speaking: boolean
}) {
  if (speaking) {
    return <Loader2 className="animate-spin" size={12} />
  }

  const bars = [0.55, 0.85, 1, 0.85, 0.55]
  const normalized = Math.max(0, Math.min(level, 1))

  return (
    <span aria-hidden="true" className="flex h-3 items-center gap-0.5">
      {bars.map((weight, index) => {
        const height = listening ? 0.3 + Math.min(0.7, normalized * weight) : 0.3

        return (
          <span
            className="w-0.5 rounded-full bg-current"
            key={index}
            style={{ height: `${height * 100}%` }}
          />
        )
      })}
    </span>
  )
}

function DictationButton({
  disabled,
  state,
  status,
  onToggle
}: {
  disabled: boolean
  state: ChatBarState['voice']
  status: VoiceStatus
  onToggle: () => void
}) {
  const active = state.active || status !== 'idle'

  const aria =
    status === 'recording'
      ? 'Stop dictation'
      : status === 'transcribing'
        ? 'Transcribing dictation'
        : 'Voice dictation'

  return (
    <Button
      aria-label={aria}
      aria-pressed={active}
      className={cn(
        GHOST_ICON_BTN,
        'p-0',
        'data-[active=true]:bg-accent data-[active=true]:text-foreground',
        status === 'recording' && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
        status === 'transcribing' && 'bg-primary/10 text-primary'
      )}
      data-active={active}
      disabled={disabled || !state.enabled || status === 'transcribing'}
      onClick={() => {
        triggerHaptic(active ? 'close' : 'open')
        onToggle()
      }}
      size="icon"
      title={aria}
      type="button"
      variant="ghost"
    >
      {status === 'recording' ? (
        <Square className="fill-current" size={12} />
      ) : status === 'transcribing' ? (
        <Loader2 className="animate-spin" size={16} />
      ) : (
        <Mic size={16} />
      )}
    </Button>
  )
}
