'use client'

import { FolderOpen, GitBranch, Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'

import { RailSection } from './rail-section'

interface ProjectSectionProps {
  cwd: string
  branch: string
  busy: boolean
  onChangeCwd?: (cwd: string) => void
  onBrowseCwd?: () => void
}

export function ProjectSection({ cwd, branch, busy, onChangeCwd, onBrowseCwd }: ProjectSectionProps) {
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
    <RailSection title="Project">
      {editing ? (
        <Input
          className="-ml-1.5 w-[calc(100%_+_0.375rem)] h-7 bg-background px-1.5 font-mono text-[0.6875rem]"
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
        <div className="-ml-1.5 w-[calc(100%_+_0.375rem)] group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-[0.6875rem] text-foreground/75 transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/30">
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
        <div className="-ml-1.5 w-[calc(100%_+_0.375rem)] flex min-w-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[0.6875rem] transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground">
          <GitBranch className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 truncate font-mono text-foreground/75">{branchLabel}</span>
        </div>
      )}
    </RailSection>
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
