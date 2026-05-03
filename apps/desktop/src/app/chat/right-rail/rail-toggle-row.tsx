'use client'

import { useId } from 'react'

import { Switch } from '@/components/ui/switch'

interface RailToggleRowProps {
  label: string
  checked: boolean
  valueLabel?: string
  onChange?: (enabled: boolean) => void
}

export function RailToggleRow({ label, checked, valueLabel, onChange }: RailToggleRowProps) {
  const id = useId()
  const disabled = !onChange

  return (
    <label
      className={`-ml-1.5 w-[calc(100%_+_0.375rem)] group flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-left transition-[background-color,border-color,color,box-shadow] ${disabled ? 'cursor-default' : 'cursor-pointer hover:border-input hover:bg-background hover:text-foreground focus-within:border-ring focus-within:bg-background focus-within:ring-[0.1875rem] focus-within:ring-ring/30'}`}
      htmlFor={id}
    >
      <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground group-hover:text-foreground group-focus-within:text-foreground">
        {label}
      </span>
      <span className="truncate text-[0.6875rem] text-foreground/75">{valueLabel ?? (checked ? 'On' : 'Off')}</span>
      <Switch
        checked={checked}
        className="h-4 w-7 [&_[data-slot=switch-thumb]]:size-3 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-3"
        disabled={disabled}
        id={id}
        onCheckedChange={next => onChange?.(next)}
      />
    </label>
  )
}
