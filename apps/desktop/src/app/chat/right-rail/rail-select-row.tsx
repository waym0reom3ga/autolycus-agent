'use client'

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface RailSelectOption {
  value: string
  label: string
}

interface RailSelectRowProps {
  label: string
  menuLabel?: string
  value: string
  options: RailSelectOption[]
  valueLabel?: ReactNode
  ariaLabel?: string
  menuWidthClass?: string
  onChange?: (value: string) => void
}

export function RailSelectRow({
  label,
  menuLabel,
  value,
  options,
  valueLabel,
  ariaLabel,
  menuWidthClass = 'w-44',
  onChange
}: RailSelectRowProps) {
  const [open, setOpen] = useState(false)
  const activeOption = options.find(option => option.value === value)
  const displayLabel = valueLabel ?? activeOption?.label ?? value

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild disabled={!onChange}>
        <button
          aria-label={ariaLabel ?? `Change ${label.toLowerCase()}`}
          className="-ml-1.5 w-[calc(100%_+_0.375rem)] group flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-left transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/30 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground group-hover:text-foreground group-focus-within:text-foreground">
            {label}
          </span>
          <span className="truncate text-[0.6875rem] text-foreground/75">{displayLabel}</span>
          {onChange && (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(menuWidthClass, 'border-border/70 bg-popover/95 shadow-md')}
        side="bottom"
        sideOffset={6}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">{menuLabel ?? label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map(option => (
          <DropdownMenuCheckboxItem
            checked={value === option.value}
            className="text-xs text-muted-foreground focus:text-foreground"
            key={option.value}
            onSelect={e => {
              e.preventDefault()
              onChange?.(option.value)
              setOpen(false)
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
