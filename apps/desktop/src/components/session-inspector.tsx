'use client'

import { ChevronDown, FolderOpen, GitBranch, Pencil } from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type SessionInspectorProps = {
  open: boolean
  cwd: string
  branch: string
  busy: boolean
  modelLabel: string
  modelTitle?: string
  providerName?: string
  personality: string
  personalities: string[]
  onChangeCwd?: (cwd: string) => void
  onBrowseCwd?: () => void
  onOpenModelPicker?: () => void
  onSelectPersonality?: (name: string) => void
}

export const SESSION_INSPECTOR_WIDTH = '14rem'

// Quiet button-like row: invisible until hovered/focused.
const quietControl =
  'rounded-md border border-transparent bg-transparent transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/30'

// Bleed interactive rows leftwards by 6px so the hover ring doesn't look
// indented relative to the section labels above them.
const bleed = '-ml-1.5 w-[calc(100%_+_0.375rem)]'

const disabledRow = 'disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent'

export const SessionInspector: FC<SessionInspectorProps> = ({
  open,
  cwd,
  branch,
  busy,
  modelLabel,
  modelTitle,
  providerName,
  personality,
  personalities,
  onChangeCwd,
  onBrowseCwd,
  onOpenModelPicker,
  onSelectPersonality
}) => (
  <aside
    aria-hidden={!open}
    className={cn(
      'relative flex h-screen w-full min-w-0 flex-col overflow-hidden bg-transparent pb-2 pl-2 pr-3 pt-[calc(var(--titlebar-height)+0.25rem)] text-muted-foreground transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'
    )}
    data-open={open}
  >
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pl-1.5 pr-1 text-xs">
      <WorkspaceSection branch={branch} busy={busy} cwd={cwd} onBrowseCwd={onBrowseCwd} onChangeCwd={onChangeCwd} />
      <AgentSection
        current={personality}
        label={modelLabel}
        onOpen={onOpenModelPicker}
        onSelect={onSelectPersonality}
        options={personalities}
        providerName={providerName}
        title={modelTitle}
      />
    </div>
  </aside>
)

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground/90">{children}</div>
}

function WorkspaceSection({
  cwd,
  branch,
  busy,
  onChangeCwd,
  onBrowseCwd
}: {
  cwd: string
  branch: string
  busy: boolean
  onChangeCwd?: (cwd: string) => void
  onBrowseCwd?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cwd)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canChange = Boolean(onChangeCwd) && !busy
  const beginEdit = () => canChange && setEditing(true)

  useEffect(() => {
    if (!editing) {
      setDraft(cwd)
    }
  }, [cwd, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  const apply = () => {
    const next = draft.trim()

    if (next && next !== cwd) {
      onChangeCwd?.(next)
    }

    setEditing(false)
  }

  const branchLabel = branch.trim()

  return (
    <section className="grid gap-1.5 py-1.5">
      <SectionLabel>cwd</SectionLabel>
      {editing ? (
        <Input
          className="h-7 bg-background px-2 font-mono text-[0.6875rem]"
          onBlur={apply}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              apply()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          placeholder="/path/to/project"
          ref={inputRef}
          value={draft}
        />
      ) : (
        <div
          className={cn(
            quietControl,
            'group grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 px-1.5 py-1 font-mono text-[0.6875rem] text-foreground/75'
          )}
        >
          <button
            aria-label="Browse workspace folder"
            className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none disabled:cursor-default disabled:hover:text-muted-foreground/60"
            disabled={!canChange || !onBrowseCwd}
            onClick={onBrowseCwd}
            type="button"
          >
            <FolderOpen className="size-3" />
          </button>
          <button
            aria-label="Edit working directory"
            className="min-w-0 truncate text-right focus-visible:outline-none disabled:cursor-default"
            dir="rtl"
            disabled={!canChange}
            onClick={beginEdit}
            type="button"
          >
            <span dir="ltr">{compactPath(cwd) || '—'}</span>
          </button>
          {canChange && (
            <button
              aria-hidden="true"
              className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/60 opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:outline-none"
              onClick={beginEdit}
              tabIndex={-1}
              type="button"
            >
              <Pencil className="size-3" />
            </button>
          )}
        </div>
      )}

      {branchLabel && (
        <div className={cn(quietControl, bleed, 'flex min-w-0 items-center gap-1 px-1.5 py-1 text-[0.6875rem]')}>
          <GitBranch className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 truncate font-mono text-foreground/75">{branchLabel}</span>
        </div>
      )}
    </section>
  )
}

function personalityOptionKey(value?: string): string {
  const key = value?.trim().toLowerCase() || 'none'

  return key === 'default' ? 'none' : key
}

function AgentSection({
  label: modelLabel,
  onOpen,
  providerName,
  current,
  options,
  onSelect
}: {
  label: string
  title?: string
  providerName?: string
  onOpen?: () => void
  current: string
  options: string[]
  onSelect?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)

  const merged = useMemo(
    () => [...new Set(['none', ...options, current].map(personalityOptionKey).filter(Boolean))],
    [current, options]
  )

  const activeKey = personalityOptionKey(current)
  const personalityLabel = activeKey === 'none' ? 'None' : titleize(activeKey)

  return (
    <section className="grid gap-1.5 py-1.5">
      <SectionLabel>Agent</SectionLabel>
      <button
        aria-label="Change model"
        className={cn(quietControl, bleed, disabledRow, 'group grid gap-px px-1.5 py-1 text-left')}
        disabled={!onOpen}
        onClick={onOpen}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground/85">
            {modelLabel || 'Hermes'}
          </span>
          {onOpen && (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
        {providerName && <span className="truncate text-[0.625rem] text-muted-foreground/70">{providerName}</span>}
      </button>
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild disabled={!onSelect}>
          <button
            aria-label="Change personality"
            className={cn(quietControl, bleed, disabledRow, 'group flex items-center gap-1.5 px-1.5 py-1 text-left')}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
              {personalityLabel}
            </span>
            {onSelect && (
              <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-52 border-border/70 bg-popover/95 shadow-md"
          side="bottom"
          sideOffset={6}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">Personality</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {merged.map(name => (
            <DropdownMenuCheckboxItem
              checked={activeKey === name}
              className="text-xs text-muted-foreground focus:text-foreground"
              key={name}
              onSelect={e => {
                e.preventDefault()
                onSelect?.(name)
                setOpen(false)
              }}
            >
              {titleize(name)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </section>
  )
}

function compactPath(path: string): string {
  if (!path) {
    return ''
  }

  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)

  return parts.length <= 4 ? normalized || path : `.../${parts.slice(-3).join('/')}`
}

function titleize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, m => m.toUpperCase())
}
