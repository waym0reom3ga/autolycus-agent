import type { ReactNode } from 'react'

import type { LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface OverlaySplitLayoutProps {
  children: ReactNode
  className?: string
}

interface OverlaySidebarProps {
  children: ReactNode
  className?: string
}

interface OverlayMainProps {
  children: ReactNode
  className?: string
}

interface OverlayNavItemProps {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
  trailing?: ReactNode
}

export function OverlaySplitLayout({ children, className }: OverlaySplitLayoutProps) {
  return (
    <div
      className={cn(
        'grid h-full min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-[0.95rem] border border-[color-mix(in_srgb,var(--dt-border)_58%,transparent)] bg-[color-mix(in_srgb,var(--dt-card)_94%,transparent)] shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,white_46%,transparent),0_0.5rem_1.5rem_-1rem_color-mix(in_srgb,#000_22%,transparent)] max-[760px]:grid-cols-1',
        className
      )}
    >
      {children}
    </div>
  )
}

export function OverlaySidebar({ children, className }: OverlaySidebarProps) {
  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-[color-mix(in_srgb,var(--dt-border)_48%,transparent)] bg-[color-mix(in_srgb,var(--dt-muted)_55%,var(--dt-card))] px-3.5 py-4',
        className
      )}
    >
      {children}
    </aside>
  )
}

export function OverlayMain({ children, className }: OverlayMainProps) {
  return (
    <main className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent p-4', className)}>{children}</main>
  )
}

export function OverlayNavItem({ active, icon: Icon, label, onClick, trailing }: OverlayNavItemProps) {
  return (
    <button
      className={cn(
        'flex h-8 w-full items-center justify-start gap-2 rounded-md border px-2.5 text-left text-sm font-medium transition-colors',
        active
          ? 'border-[color-mix(in_srgb,var(--dt-primary)_34%,var(--dt-border))] bg-[color-mix(in_srgb,var(--dt-primary)_10%,var(--dt-card))] text-foreground shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,white_40%,transparent)]'
          : 'border-transparent bg-transparent text-foreground/78 hover:border-[color-mix(in_srgb,var(--dt-border)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--dt-card)_78%,transparent)] hover:text-foreground'
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className={cn('size-4 shrink-0', active ? 'text-foreground/80' : 'text-muted-foreground/80')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
