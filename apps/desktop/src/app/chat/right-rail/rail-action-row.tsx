'use client'

import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface RailActionRowProps {
  primary: string
  secondary?: string
  ariaLabel?: string
  onClick?: () => void
}

export function RailActionRow({ primary, secondary, ariaLabel, onClick }: RailActionRowProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        '-ml-1.5 w-[calc(100%_+_0.375rem)] group grid gap-px rounded-md border border-transparent bg-transparent px-1.5 py-1 text-left transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/30 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent'
      )}
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground/85">{primary}</span>
        {onClick && (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        )}
      </span>
      {secondary && <span className="truncate text-[0.625rem] text-muted-foreground/70">{secondary}</span>}
    </button>
  )
}
