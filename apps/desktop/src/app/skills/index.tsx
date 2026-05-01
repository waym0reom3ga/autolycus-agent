import { Brain, RefreshCw, Search, Wrench, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { getSkills, getToolsets, toggleSkill } from '@/hermes'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { SkillInfo, ToolsetInfo } from '@/types/hermes'

import { asText, includesQuery, prettyName, toolNames } from '../settings/helpers'
import { TITLEBAR_ICON_SIZE, titlebarButtonClass, titlebarHeaderBaseClass } from '../shell/titlebar'

type SkillsMode = 'skills' | 'toolsets'

function categoryFor(skill: SkillInfo): string {
  return asText(skill.category) || 'general'
}

function filteredSkills(skills: SkillInfo[], query: string, category: string | null): SkillInfo[] {
  const q = query.trim().toLowerCase()

  return skills
    .filter(skill => {
      if (category && categoryFor(skill) !== category) {
        return false
      }

      if (!q) {
        return true
      }

      return (
        includesQuery(skill.name, q) ||
        includesQuery(skill.description, q) ||
        includesQuery(skill.category, q)
      )
    })
    .sort((a, b) => asText(a.name).localeCompare(asText(b.name)))
}

function filteredToolsets(toolsets: ToolsetInfo[], query: string): ToolsetInfo[] {
  const q = query.trim().toLowerCase()

  return toolsets
    .filter(toolset => {
      if (!q) {
        return true
      }

      return (
        includesQuery(toolset.name, q) ||
        includesQuery(toolset.label, q) ||
        includesQuery(toolset.description, q) ||
        toolNames(toolset).some(name => includesQuery(name, q))
      )
    })
    .sort((a, b) => asText(a.label || a.name).localeCompare(asText(b.label || b.name)))
}

interface SkillsViewProps extends React.ComponentProps<'section'> {
  setTitlebarActions?: (actions: ReactNode | null) => void
}

export function SkillsView({ setTitlebarActions, ...props }: SkillsViewProps) {
  const [mode, setMode] = useState<SkillsMode>('skills')
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [toolsets, setToolsets] = useState<ToolsetInfo[] | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [savingSkill, setSavingSkill] = useState<string | null>(null)

  const refreshCapabilities = useCallback(async () => {
    setRefreshing(true)

    try {
      const [nextSkills, nextToolsets] = await Promise.all([getSkills(), getToolsets()])
      setSkills(nextSkills)
      setToolsets(nextToolsets)
    } catch (err) {
      notifyError(err, 'Skills failed to load')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshCapabilities()
  }, [refreshCapabilities])

  useEffect(() => {
    if (!setTitlebarActions) {
      return
    }

    setTitlebarActions(
      <button
        aria-label={refreshing ? 'Refreshing skills' : 'Refresh skills'}
        className={cn(titlebarButtonClass, 'grid place-items-center bg-transparent')}
        disabled={refreshing}
        onClick={() => void refreshCapabilities()}
        type="button"
      >
        <RefreshCw className={cn(refreshing && 'animate-spin')} size={TITLEBAR_ICON_SIZE} />
      </button>
    )

    return () => setTitlebarActions(null)
  }, [refreshCapabilities, refreshing, setTitlebarActions])

  const categories = useMemo(() => {
    if (!skills) {
      return []
    }

    const counts = new Map<string, number>()

    for (const skill of skills) {
      const key = categoryFor(skill)
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({ key, count }))
  }, [skills])

  const visibleSkills = useMemo(
    () => (skills ? filteredSkills(skills, query, mode === 'skills' ? activeCategory : null) : []),
    [activeCategory, mode, query, skills]
  )

  const visibleToolsets = useMemo(() => (toolsets ? filteredToolsets(toolsets, query) : []), [query, toolsets])

  const skillGroups = useMemo(() => {
    const groups = new Map<string, SkillInfo[]>()

    for (const skill of visibleSkills) {
      const key = categoryFor(skill)
      groups.set(key, [...(groups.get(key) || []), skill])
    }

    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [visibleSkills])

  const totalSkills = skills?.length || 0
  const enabledSkills = skills?.filter(skill => skill.enabled).length || 0
  const enabledToolsets = toolsets?.filter(toolset => toolset.enabled).length || 0

  async function handleToggleSkill(skill: SkillInfo, enabled: boolean) {
    setSavingSkill(skill.name)

    try {
      await toggleSkill(skill.name, enabled)
      setSkills(current => current?.map(row => (row.name === skill.name ? { ...row, enabled } : row)) ?? current)
      notify({
        kind: 'success',
        title: enabled ? 'Skill enabled' : 'Skill disabled',
        message: `${skill.name} applies to new sessions.`
      })
    } catch (err) {
      notifyError(err, `Failed to update ${skill.name}`)
    } finally {
      setSavingSkill(null)
    }
  }

  return (
    <section
      {...props}
      className="flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-background"
    >
      <header className={titlebarHeaderBaseClass}>
        <h2 className="text-base font-semibold leading-none tracking-tight">Skills</h2>
        <span className="text-xs text-muted-foreground">{enabledSkills}/{totalSkills} enabled</span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[1.0625rem] border border-border/50 bg-background/85">
        <div className="border-b border-border/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ModeButton active={mode === 'skills'} icon={Brain} onClick={() => setMode('skills')} text="Skills" />
            <ModeButton active={mode === 'toolsets'} icon={Wrench} onClick={() => setMode('toolsets')} text="Toolsets" />
            <div className="ml-auto w-full max-w-sm min-w-64">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 rounded-lg pl-8 pr-8 text-sm"
                  onChange={event => setQuery(event.target.value)}
                  placeholder={mode === 'skills' ? 'Search skills...' : 'Search toolsets...'}
                  value={query}
                />
                {query && (
                  <Button
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setQuery('')}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {mode === 'skills' && categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <CategoryButton
                active={activeCategory === null}
                count={totalSkills}
                label="All"
                onClick={() => setActiveCategory(null)}
              />
              {categories.map(category => (
                <CategoryButton
                  active={activeCategory === category.key}
                  count={category.count}
                  key={category.key}
                  label={prettyName(category.key)}
                  onClick={() => setActiveCategory(activeCategory === category.key ? null : category.key)}
                />
              ))}
            </div>
          )}
        </div>

        {!skills || !toolsets ? (
          <PageLoader label="Loading capabilities..." />
        ) : mode === 'skills' ? (
          <div className="h-full overflow-y-auto px-4 py-3">
            {visibleSkills.length === 0 ? (
              <EmptyState description="Try a broader search or different category." title="No skills found" />
            ) : (
              <div className="space-y-4">
                {skillGroups.map(([category, list]) => (
                  <div className="space-y-1.5" key={category}>
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {prettyName(category)}
                    </div>
                    <div className="divide-y divide-border/40 rounded-lg border border-border/40 bg-background/70">
                      {list.map(skill => (
                        <div className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={skill.name}>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{skill.name}</div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {asText(skill.description) || 'No description.'}
                            </p>
                          </div>
                          <Switch
                            checked={skill.enabled}
                            disabled={savingSkill === skill.name}
                            onCheckedChange={checked => void handleToggleSkill(skill, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-4 py-3">
            {visibleToolsets.length === 0 ? (
              <EmptyState description="Try a broader search query." title="No toolsets found" />
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">{enabledToolsets}/{toolsets.length} toolsets enabled</div>
                <div className="divide-y divide-border/40 rounded-lg border border-border/40 bg-background/70">
                  {visibleToolsets.map(toolset => {
                    const tools = toolNames(toolset)
                    const label = asText(toolset.label || toolset.name)

                    return (
                      <div className="px-3 py-2.5" key={toolset.name}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-medium">{label}</div>
                          <div className="flex items-center gap-1.5">
                            <StatusPill active={toolset.enabled}>{toolset.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
                            <StatusPill active={toolset.configured}>
                              {toolset.configured ? 'Configured' : 'Needs keys'}
                            </StatusPill>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{asText(toolset.description) || 'No description.'}</p>
                        {tools.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tools.map(name => (
                              <span
                                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
                                key={name}
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function ModeButton({
  active,
  icon: Icon,
  onClick,
  text
}: {
  active: boolean
  icon: LucideIcon
  onClick: () => void
  text: string
}) {
  return (
    <Button
      className={cn(
        'h-8 gap-1.5 rounded-md px-2.5 text-xs',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-3.5" />
      {text}
    </Button>
  )
}

function CategoryButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <Button
      className={cn(
        'h-7 rounded-full px-2.5 text-[0.68rem]',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
      <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[0.62rem] text-muted-foreground">{count}</span>
    </Button>
  )
}

function StatusPill({ active, children }: { active: boolean; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.64rem]',
        active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center text-center">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}
