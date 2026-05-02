import { FileText, FolderOpen, ImageIcon, Link, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import type { ComposerAttachment } from '@/store/composer'

export const STACK_AT = 500
export const NARROW_VIEWPORT = '(max-width: 680px)'
export const EXPAND_HEIGHT_PX = 42

export const SHELL =
  'absolute bottom-0 left-1/2 z-30 w-[min(calc(100%_-_1rem),clamp(26rem,61.8%,56rem))] max-w-full -translate-x-1/2'

export const ICON_BTN = 'h-8 w-8 shrink-0 rounded-full'

export const GHOST_ICON_BTN = cn(ICON_BTN, 'text-muted-foreground hover:bg-accent hover:text-foreground')

export const COMPOSER_BACKDROP_STYLE = {
  backdropFilter: 'blur(.5rem) saturate(1.18)',
  WebkitBackdropFilter: 'blur(.5rem) saturate(1.18)'
} satisfies CSSProperties

export const ATTACHMENT_ICON: Record<ComposerAttachment['kind'], LucideIcon> = {
  folder: FolderOpen,
  url: Link,
  image: ImageIcon,
  file: FileText
}

export const COMPLETION_DRAWER_CLASS =
  'absolute inset-x-0 bottom-[calc(100%-0.0rem)] z-50 max-h-[min(23rem,calc(100vh-8rem))] overflow-y-auto overscroll-contain rounded-t-(--composer-active-radius) rounded-b-none border-x border-t border-b-0 border-ring/45 bg-popover/96 p-1.5 pb-3 text-popover-foreground shadow-[0_-1rem_2.25rem_-1.75rem_color-mix(in_srgb,var(--dt-foreground)_34%,transparent),0_-0.3125rem_0.875rem_-0.6875rem_color-mix(in_srgb,var(--dt-foreground)_22%,transparent)] backdrop-blur-md'

export const PROMPT_SNIPPETS = [
  {
    label: 'Code review',
    text: 'Please review this for bugs, regressions, and missing tests.'
  },
  {
    label: 'Implementation plan',
    text: 'Please make a concise implementation plan before changing code.'
  },
  {
    label: 'Explain this',
    text: 'Please explain how this works and point me to the key files.'
  }
]

export const ASK_PLACEHOLDERS = [
  'Hey friend, what can I help with?',
  "What's on your mind? I'm here with you.",
  'Need a hand? We can take it one step at a time.',
  'Want to walk through this bug together?',
  "Share what you're working on and we'll figure it out.",
  "Tell me where you're stuck and I'll stay with you.",
  'Duck mode: gentle debugging, together.'
]

export const EDGE_NEWLINES_RE = /^[\t ]*(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+[\t ]*$/g
export const DEFAULT_MAX_RECORDING_SECONDS = 120

// Conversation-mode VAD tuning — mirrors `tools.voice_mode` defaults so the
// browser pipeline feels like the CLI continuous loop.
export const CONVERSATION_SPEECH_LEVEL = 0.075
export const CONVERSATION_POST_SPEECH_SILENCE_MS = 1_250
export const CONVERSATION_IDLE_SILENCE_MS = 12_000
export const CONVERSATION_MAX_TURN_SECONDS = 60

export const VOICE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/wav'
]
