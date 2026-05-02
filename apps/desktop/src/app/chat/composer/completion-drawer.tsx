import type { Unstable_TriggerAdapter } from '@assistant-ui/core'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ReactNode } from 'react'

export const COMPLETION_DRAWER_CLASS = [
  'absolute inset-x-0 bottom-[calc(100%-0.5rem)] z-50',
  'max-h-[min(23rem,calc(100vh-8rem))] overflow-y-auto overscroll-contain',
  'rounded-t-(--composer-active-radius) border border-b-0',
  'border-[color-mix(in_srgb,var(--dt-ring)_45%,transparent)]',
  'bg-[color-mix(in_srgb,var(--dt-popover)_96%,transparent)]',
  'px-1.5 pb-3 pt-1.5 text-popover-foreground',
  'backdrop-blur-[0.75rem] backdrop-saturate-[1.1]',
  '[-webkit-backdrop-filter:blur(0.75rem)_saturate(1.1)]',
  'data-[state=open]:-mb-2',
  'data-[state=open]:shadow-[0_-0.0625rem_0_0.0625rem_color-mix(in_srgb,var(--dt-ring)_35%,transparent),0_-1rem_2.25rem_-1.75rem_color-mix(in_srgb,var(--dt-foreground)_34%,transparent),0_-0.3125rem_0.875rem_-0.6875rem_color-mix(in_srgb,var(--dt-foreground)_22%,transparent)]'
].join(' ')

export const COMPLETION_DRAWER_ROW_CLASS = [
  'flex w-full min-w-0 items-baseline gap-2 rounded-md px-2.5 py-1',
  'text-left text-xs transition-colors',
  'hover:bg-[color-mix(in_srgb,var(--dt-accent)_70%,transparent)]',
  'data-[highlighted]:bg-[color-mix(in_srgb,var(--dt-accent)_70%,transparent)]'
].join(' ')

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

export function CompletionDrawerEmpty({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div className="px-3 py-3 text-sm text-muted-foreground">
      <p>{title}</p>
      {children && <p className="mt-1 text-xs text-muted-foreground/80">{children}</p>}
    </div>
  )
}
