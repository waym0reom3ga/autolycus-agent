import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Activity, AlertCircle, Layers3, Loader2, type LucideIcon, RefreshCw, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $desktopActionTasks, buildRailTasks, type RailTask, type RailTaskStatus } from '@/store/activity'
import { $previewServerRestart } from '@/store/preview'
import { $sessions, $workingSessionIds } from '@/store/session'

import { OverlayCard } from '../overlays/overlay-chrome'
import { OverlayMain, OverlayNavItem, OverlaySidebar, OverlaySplitLayout } from '../overlays/overlay-split-layout'
import { OverlayView } from '../overlays/overlay-view'

type AgentsSection = 'tree' | 'activity' | 'history'

interface SectionDef {
  description: string
  icon: LucideIcon
  id: AgentsSection
  label: string
}

const SECTIONS: readonly SectionDef[] = [
  { description: 'Live subagent spawn tree for the current turn', icon: Layers3, id: 'tree', label: 'Spawn tree' },
  { description: 'Background work across sessions and the desktop', icon: Activity, id: 'activity', label: 'Activity' },
  { description: 'Past spawn snapshots, replay, and diff', icon: RefreshCw, id: 'history', label: 'History' }
]

const STATUS_TONE: Record<RailTaskStatus, string> = {
  error: 'text-destructive',
  running: 'text-foreground',
  success: 'text-emerald-500'
}

const STATUS_ICON: Record<RailTaskStatus, LucideIcon> = {
  error: AlertCircle,
  running: Loader2,
  success: Sparkles
}

interface AgentsViewProps {
  initialSection?: AgentsSection
  onClose: () => void
}

export function AgentsView({ initialSection = 'tree', onClose }: AgentsViewProps) {
  const [section, setSection] = useState<AgentsSection>(initialSection)

  const sessions = useStore($sessions)
  const workingSessionIds = useStore($workingSessionIds)
  const previewRestart = useStore($previewServerRestart)
  const desktopActionTasks = useStore($desktopActionTasks)

  const activityTasks = useMemo(
    () => buildRailTasks(workingSessionIds, sessions, previewRestart, desktopActionTasks),
    [desktopActionTasks, previewRestart, sessions, workingSessionIds]
  )

  const active = SECTIONS.find(s => s.id === section) ?? SECTIONS[0]!

  return (
    <OverlayView closeLabel="Close agents" onClose={onClose}>
      <OverlaySplitLayout>
        <OverlaySidebar>
          {SECTIONS.map(s => (
            <OverlayNavItem
              active={s.id === section}
              icon={s.icon}
              key={s.id}
              label={s.label}
              onClick={() => setSection(s.id)}
            />
          ))}
        </OverlaySidebar>

        <OverlayMain>
          <header className="mb-4">
            <h2 className="text-sm font-semibold text-foreground">{active.label}</h2>
            <p className="text-xs text-muted-foreground">{active.description}</p>
          </header>

          {section === 'activity' ? <ActivityList tasks={activityTasks} /> : <SectionStub label={active.label} />}
        </OverlayMain>
      </OverlaySplitLayout>
    </OverlayView>
  )
}

function ActivityList({ tasks }: { tasks: readonly RailTask[] }) {
  if (tasks.length === 0) {
    return (
      <OverlayCard className="px-3 py-4 text-sm text-muted-foreground">
        No background activity. Long-running tools, preview restarts, and parallel sessions surface here.
      </OverlayCard>
    )
  }

  return (
    <div className="grid min-h-0 gap-1.5 overflow-y-auto pr-1">
      {tasks.map(task => {
        const Icon = STATUS_ICON[task.status]

        return (
          <OverlayCard className="flex items-start gap-2.5 px-3 py-2" key={task.id}>
            <Icon
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                STATUS_TONE[task.status],
                task.status === 'running' && 'animate-spin'
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{task.label}</div>
              {task.detail && <div className="truncate text-xs text-muted-foreground">{task.detail}</div>}
            </div>
          </OverlayCard>
        )
      })}
    </div>
  )
}

function SectionStub({ label }: { label: string }) {
  return (
    <OverlayCard className="grid place-items-center gap-3 px-6 py-12 text-center">
      <Sparkles className="size-6 text-muted-foreground/70" />
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">{label} — coming soon</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Subagent stores aren&apos;t wired into the desktop yet. Once gateway events for{' '}
          <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.65rem]">
            subagent.spawn / progress / complete
          </code>{' '}
          land here, this view shows the live spawn tree, replay history, and pause/kill controls — modelled on the
          TUI&apos;s <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.65rem]">/agents</code> overlay.
        </p>
      </div>
    </OverlayCard>
  )
}
