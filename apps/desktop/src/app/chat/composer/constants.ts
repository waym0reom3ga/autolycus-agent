import type { Unstable_IconComponent } from '@assistant-ui/react'
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

export const DIRECTIVE_ICONS: Record<string, Unstable_IconComponent> = {
  file: FileText,
  folder: FolderOpen,
  image: ImageIcon,
  url: Link
}

export const DIRECTIVE_POPOVER_CLASS =
  'absolute bottom-24 left-1/2 z-50 w-[min(calc(100vw-1.5rem),26rem)] max-h-[min(24rem,calc(100vh-8rem))] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-popover/95 p-1.5 text-popover-foreground shadow-2xl backdrop-blur-md ring-1 ring-black/5'

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
