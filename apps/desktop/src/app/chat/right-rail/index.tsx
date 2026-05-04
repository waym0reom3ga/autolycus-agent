import { useStore } from '@nanostores/react'
import { type ReactNode, useMemo } from 'react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { Button } from '@/components/ui/button'
import { AlertCircle, Loader2, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $desktopActionTasks, buildRailTasks, type RailTask, type RailTaskStatus } from '@/store/activity'
import { $inspectorOpen } from '@/store/layout'
import { $previewReloadRequest, $previewServerRestart, $previewTarget } from '@/store/preview'
import { $sessions, $workingSessionIds } from '@/store/session'

import { PreviewPane } from './preview-pane'

export const SESSION_INSPECTOR_WIDTH = 'clamp(13.5rem, 21vw, 20rem)'
export const PREVIEW_RAIL_WIDTH = 'clamp(18rem, 36vw, 38rem)'

const RAIL_TASK_LIMIT = 6

const TASK_ICONS: Record<RailTaskStatus, ReactNode> = {
  error: <AlertCircle className="size-3 text-destructive" />,
  running: <Loader2 className="size-3 animate-spin text-muted-foreground" />,
  success: <Sparkles className="size-3 text-emerald-500" />
}

interface ChatRightRailProps {
  onOpenCommandCenterSystem: () => void
  onOpenSkills: () => void
}

export function ChatRightRail({ onOpenCommandCenterSystem, onOpenSkills }: ChatRightRailProps) {
  const inspectorOpen = useStore($inspectorOpen)
  const sessions = useStore($sessions)
  const workingSessionIds = useStore($workingSessionIds)
  const previewRestart = useStore($previewServerRestart)
  const desktopActionTasks = useStore($desktopActionTasks)

  const tasks = useMemo(
    () => buildRailTasks(workingSessionIds, sessions, previewRestart, desktopActionTasks),
    [desktopActionTasks, previewRestart, sessions, workingSessionIds]
  )

  return (
    <div
      className={cn(
        'col-start-4 col-end-5 row-start-1 min-w-0 overflow-hidden',
        inspectorOpen && 'border-l border-border/60'
      )}
    >
      <aside
        aria-hidden={!inspectorOpen}
        className={cn(
          'relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-transparent pb-2 pl-2 pr-3 pt-[calc(var(--titlebar-height)+0.25rem)] text-muted-foreground transition-none',
          inspectorOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <RailHeader onOpenAll={onOpenCommandCenterSystem} />

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5">
          {tasks.length === 0 ? <EmptyRail /> : tasks.slice(0, RAIL_TASK_LIMIT).map(task => <RailRow key={task.id} task={task} />)}
        </div>

        <RailFooter onOpenSkills={onOpenSkills} onOpenSystem={onOpenCommandCenterSystem} />
      </aside>
    </div>
  )
}

export function ChatPreviewRail({
  onRestartServer,
  setTitlebarToolGroup
}: {
  onRestartServer?: (url: string, context?: string) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}) {
  const previewReloadRequest = useStore($previewReloadRequest)
  const previewTarget = useStore($previewTarget)

  if (!previewTarget) {
    return <aside aria-hidden="true" className="col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden" />
  }

  return (
    <div className="pointer-events-none col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden">
      <PreviewPane
        onRestartServer={onRestartServer}
        reloadRequest={previewReloadRequest}
        setTitlebarToolGroup={setTitlebarToolGroup}
        target={previewTarget}
      />
    </div>
  )
}

function RailHeader({ onOpenAll }: { onOpenAll: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-1 px-1.5">
      <span className="text-[0.68rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/85">Background</span>
      <Button className="h-6 px-2 text-[0.68rem]" onClick={onOpenAll} size="sm" variant="ghost">
        View all
      </Button>
    </div>
  )
}

function RailFooter({ onOpenSkills, onOpenSystem }: { onOpenSkills: () => void; onOpenSystem: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-1 px-1.5">
      <Button className="h-6 flex-1 justify-start px-2 text-[0.68rem]" onClick={onOpenSkills} size="sm" variant="ghost">
        Agents
      </Button>
      <Button className="h-6 flex-1 justify-start px-2 text-[0.68rem]" onClick={onOpenSystem} size="sm" variant="ghost">
        System
      </Button>
    </div>
  )
}

function EmptyRail() {
  return (
    <div className="rounded-md border border-border/45 bg-background/55 px-2.5 py-2 text-[0.68rem] text-muted-foreground/80">
      No background activity.
    </div>
  )
}

function RailRow({ task }: { task: RailTask }) {
  return (
    <div className="rounded-md border border-border/45 bg-background/58 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {TASK_ICONS[task.status]}
        <span className="truncate text-[0.72rem] font-medium text-foreground/90">{task.label}</span>
      </div>
      <div className="mt-0.5 truncate pl-4.5 text-[0.66rem] text-muted-foreground/80">{task.detail}</div>
    </div>
  )
}
