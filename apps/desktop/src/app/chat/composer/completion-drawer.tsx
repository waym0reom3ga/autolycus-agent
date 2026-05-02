import type { Unstable_TriggerAdapter } from '@assistant-ui/core'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ReactNode } from 'react'

export const COMPLETION_DRAWER_CLASS = 'composer-completion-drawer'
export const COMPLETION_DRAWER_ROW_CLASS = 'composer-completion-row'

export function ComposerCompletionDrawer({
  adapter,
  ariaLabel,
  char,
  children
}: {
  adapter: Unstable_TriggerAdapter
  ariaLabel: string
  char: string
  children: ReactNode
}) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      adapter={adapter}
      aria-label={ariaLabel}
      char={char}
      className={COMPLETION_DRAWER_CLASS}
      data-slot="composer-completion-drawer"
    >
      {children}
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}

export function CompletionDrawerEmpty({
  children,
  title
}: {
  children?: ReactNode
  title: string
}) {
  return (
    <div className="px-3 py-3 text-sm text-muted-foreground">
      <p>{title}</p>
      {children && <p className="mt-1 text-xs text-muted-foreground/80">{children}</p>}
    </div>
  )
}
