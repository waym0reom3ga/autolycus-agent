import type { ComponentProps, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface StatusbarMenuItem {
  id: string
  icon?: ReactNode
  label: string
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  onSelect?: () => void
  title?: string
  to?: string
}

export interface StatusbarItem {
  id: string
  label?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  menuClassName?: string
  menuItems?: readonly StatusbarMenuItem[]
  onSelect?: () => void
  title?: string
  to?: string
  variant?: 'action' | 'link' | 'menu' | 'text'
}

export type StatusbarItemSide = 'left' | 'right'
export type SetStatusbarItemGroup = (id: string, items: readonly StatusbarItem[], side?: StatusbarItemSide) => void

interface StatusbarControlsProps extends ComponentProps<'footer'> {
  leftItems?: readonly StatusbarItem[]
  items?: readonly StatusbarItem[]
}

const statusbarItemClass =
  'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[0.69rem] text-muted-foreground/95 transition-colors hover:bg-accent/55 hover:text-foreground disabled:cursor-default disabled:opacity-45'

export function StatusbarControls({ className, leftItems = [], items = [], ...props }: StatusbarControlsProps) {
  const navigate = useNavigate()

  return (
    <footer
      className={cn(
        'col-span-4 row-start-2 row-end-3 flex h-7 items-center justify-between gap-2 border-t border-border/55 bg-[color-mix(in_srgb,var(--dt-muted)_45%,var(--dt-card))] px-2.5 py-1 text-muted-foreground/95 [-webkit-app-region:no-drag]',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {leftItems.filter(item => !item.hidden).map(item => (
          <StatusbarItemView item={item} key={`left:${item.id}`} navigate={navigate} />
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {items.filter(item => !item.hidden).map(item => (
          <StatusbarItemView item={item} key={`right:${item.id}`} navigate={navigate} />
        ))}
      </div>
    </footer>
  )
}

function StatusbarItemView({
  item,
  navigate
}: {
  item: StatusbarItem
  navigate: ReturnType<typeof useNavigate>
}) {
  const content = (
    <>
      {item.icon}
      {item.label && <span className="truncate">{item.label}</span>}
      {item.detail && <span className="truncate text-muted-foreground/80">{item.detail}</span>}
    </>
  )

  const title = item.title ?? (typeof item.label === 'string' ? item.label : undefined)

  if (item.variant === 'menu' && item.menuItems && item.menuItems.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(statusbarItemClass, item.className)}
            disabled={item.disabled}
            title={title}
            type="button"
          >
            {content}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn('w-56', item.menuClassName)} side="top" sideOffset={8}>
          {item.menuItems
            .filter(menuItem => !menuItem.hidden)
            .map(menuItem => (
              <DropdownMenuItem
                className={cn('gap-2 text-foreground focus:bg-accent [&_svg]:size-4', menuItem.className)}
                disabled={menuItem.disabled}
                key={menuItem.id}
                onSelect={() => {
                  if (menuItem.to) {
                    navigate(menuItem.to)
                  }

                  menuItem.onSelect?.()
                }}
              >
                {menuItem.href ? (
                  <a
                    className="inline-flex w-full items-center gap-2"
                    href={menuItem.href}
                    rel="noreferrer"
                    target="_blank"
                    title={menuItem.title ?? menuItem.label}
                  >
                    {menuItem.icon}
                    <span className="truncate">{menuItem.label}</span>
                  </a>
                ) : (
                  <>
                    {menuItem.icon}
                    <span className="truncate">{menuItem.label}</span>
                  </>
                )}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (item.variant === 'text' && !item.onSelect && !item.to && !item.href) {
    return (
      <div className={cn('inline-flex items-center gap-1.5 px-1 text-[0.69rem] text-muted-foreground/90', item.className)}>
        {content}
      </div>
    )
  }

  if (item.href || item.variant === 'link') {
    return (
      <a
        className={cn(statusbarItemClass, item.className)}
        href={item.href}
        rel="noreferrer"
        target="_blank"
        title={title}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      className={cn(statusbarItemClass, item.className)}
      disabled={item.disabled}
      onClick={() => {
        if (item.to) {
          navigate(item.to)
        }

        item.onSelect?.()
      }}
      title={title}
      type="button"
    >
      {content}
    </button>
  )
}
