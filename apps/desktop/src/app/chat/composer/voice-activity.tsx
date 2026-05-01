import { Loader2, Mic } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { VoiceActivityState } from './types'

function formatElapsed(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function VoiceLevelBars({ level, active }: { active: boolean; level: number }) {
  const normalized = Math.max(0, Math.min(level, 1))
  const bars = [0.5, 0.78, 1, 0.78, 0.5]

  return (
    <div aria-hidden="true" className="flex h-4 items-center gap-0.5">
      {bars.map((weight, index) => {
        const height = active ? 0.25 + Math.min(0.68, normalized * weight) : 0.25

        return (
          <span
            className={cn(
              'w-0.5 rounded-full bg-current transition-[height,opacity] duration-100 ease-out',
              active ? 'opacity-80' : 'animate-pulse opacity-45'
            )}
            key={index}
            style={{ height: `${height * 100}%` }}
          />
        )
      })}
    </div>
  )
}

export function VoiceActivity({
  state
}: {
  state: VoiceActivityState
}) {
  if (state.status === 'idle') {
    return null
  }

  const recording = state.status === 'recording'
  const title = recording ? 'Dictating' : 'Transcribing'

  return (
    <div
      aria-live="polite"
      className={cn(
        'flex h-8 items-center gap-2 rounded-xl border border-border/55 bg-muted/55 px-2.5 text-xs text-muted-foreground',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-sm'
      )}
      role="status"
    >
      <div
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full',
          recording ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'
        )}
      >
        {recording ? <Mic size={12} /> : <Loader2 className="animate-spin" size={12} />}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium text-foreground/85">{title}</span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground/85">{formatElapsed(state.elapsedSeconds)}</span>
      </div>

      <VoiceLevelBars active={recording} level={state.level} />
    </div>
  )
}
