import type { RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Search, X } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface OverlaySearchInputProps {
  placeholder: string
  value: string
  onChange: (value: string) => void
  containerClassName?: string
  inputClassName?: string
  loading?: boolean
  onClear?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}

export function OverlaySearchInput({
  placeholder,
  value,
  onChange,
  containerClassName,
  inputClassName,
  loading = false,
  onClear,
  inputRef
}: OverlaySearchInputProps) {
  const clear = onClear ?? (() => onChange(''))

  return (
    <div className={cn('relative', containerClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
      <Input
        className={cn(
          'h-8.5 rounded-full border border-[color-mix(in_srgb,var(--dt-border)_60%,transparent)] bg-[color-mix(in_srgb,var(--dt-card)_85%,transparent)] py-2 pl-8 pr-12 text-sm shadow-[inset_0_0.0625rem_0_color-mix(in_srgb,white_38%,transparent)] focus-visible:border-[color-mix(in_srgb,var(--dt-ring)_70%,transparent)] focus-visible:bg-background',
          inputClassName
        )}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        ref={inputRef}
        value={value}
      />
      {loading ? (
        <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground/70" />
      ) : value ? (
        <Button
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/85 hover:bg-accent/60 hover:text-foreground"
          onClick={clear}
          size="icon-xs"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
