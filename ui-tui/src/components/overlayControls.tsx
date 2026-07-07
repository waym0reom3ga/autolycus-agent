import { Text, useInput } from '@lycus/ink'
import { exec } from 'child_process'

import type { Theme } from '../theme.js'

export function useOverlayKeys({ disabled = false, onBack, onClose }: OverlayKeysOptions) {
  useInput((ch, key) => {
    if (disabled) {
      return
    }

    // VT switching: Alt+F2-F6 switch to tty2-tty6 while keeping Lycus running
    if (key.alt && /^f[2-6]$/.test(key.name?.toLowerCase() ?? '')) {
      const vtNum = parseInt(key.name![1], 10)
      if (vtNum >= 2 && vtNum <= 6) {
        exec(`chvt ${vtNum}`, () => {})
        return
      }
    }

    if (ch === 'q') {
      return onClose()
    }

    if (key.escape) {
      return onBack ? onBack() : onClose()
    }
  })
}

export function OverlayHint({ children, t }: OverlayHintProps) {
  return (
    <Text color={t.color.muted} wrap="truncate-end">
      {children}
    </Text>
  )
}

export const windowOffset = (count: number, selected: number, visible: number) =>
  Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible))

export function windowItems<T>(items: T[], selected: number, visible: number) {
  const offset = windowOffset(items.length, selected, visible)

  return {
    items: items.slice(offset, offset + visible),
    offset
  }
}

interface OverlayHintProps {
  children: string
  t: Theme
}

interface OverlayKeysOptions {
  disabled?: boolean
  onBack?: () => void
  onClose: () => void
}
