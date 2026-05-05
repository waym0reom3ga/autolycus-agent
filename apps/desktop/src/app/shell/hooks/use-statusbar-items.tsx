import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import type { CommandCenterSection } from '@/app/command-center'
import { buildGatewayLogItems } from '@/lib/gateway-events'
import { Activity, AlertCircle, Command, Cpu, FolderOpen, GitBranch, Loader2, Sparkles } from '@/lib/icons'
import { compactPath, contextBarLabel, LiveDuration, usageContextLabel } from '@/lib/statusbar'
import { cn } from '@/lib/utils'
import { $desktopActionTasks } from '@/store/activity'
import { $previewServerRestartStatus } from '@/store/preview'
import {
  $busy,
  $currentBranch,
  $currentCwd,
  $currentModel,
  $currentProvider,
  $currentUsage,
  $sessionStartedAt,
  $turnStartedAt,
  $workingSessionIds,
  setModelPickerOpen
} from '@/store/session'
import type { StatusResponse } from '@/types/hermes'

import type { StatusbarItem, StatusbarMenuItem } from '../statusbar-controls'

interface StatusbarItemsOptions {
  agentsOpen: boolean
  browseSessionCwd: () => Promise<void>
  commandCenterOpen: boolean
  extraLeftItems: readonly StatusbarItem[]
  extraRightItems: readonly StatusbarItem[]
  gatewayLogLines: readonly string[]
  openAgents: () => void
  openCommandCenterSection: (section: CommandCenterSection) => void
  statusSnapshot: StatusResponse | null
  toggleCommandCenter: () => void
}

export function useStatusbarItems({
  agentsOpen,
  browseSessionCwd,
  commandCenterOpen,
  extraLeftItems,
  extraRightItems,
  gatewayLogLines,
  openAgents,
  openCommandCenterSection,
  statusSnapshot,
  toggleCommandCenter
}: StatusbarItemsOptions) {
  const busy = useStore($busy)
  const currentBranch = useStore($currentBranch)
  const currentCwd = useStore($currentCwd)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const currentUsage = useStore($currentUsage)
  const desktopActionTasks = useStore($desktopActionTasks)
  const previewServerRestartStatus = useStore($previewServerRestartStatus)
  const sessionStartedAt = useStore($sessionStartedAt)
  const turnStartedAt = useStore($turnStartedAt)
  const workingSessionIds = useStore($workingSessionIds)

  const contextUsage = useMemo(() => usageContextLabel(currentUsage), [currentUsage])
  const contextBar = useMemo(() => contextBarLabel(currentUsage), [currentUsage])

  const platformMenuItems = useMemo<readonly StatusbarMenuItem[]>(
    () =>
      Object.entries(statusSnapshot?.gateway_platforms || {})
        .sort(([l], [r]) => l.localeCompare(r))
        .map(([name, platform]) => ({ disabled: true, id: `platform:${name}`, label: `${name} · ${platform.state}` })),
    [statusSnapshot?.gateway_platforms]
  )

  const gatewayMenuItems = useMemo<readonly StatusbarMenuItem[]>(
    () => [
      { id: 'gateway:open-system', label: 'Open system panel', onSelect: () => openCommandCenterSection('system') },
      ...buildGatewayLogItems(gatewayLogLines),
      ...platformMenuItems
    ],
    [gatewayLogLines, openCommandCenterSection, platformMenuItems]
  )

  const { bgFailed, bgRunning } = useMemo(() => {
    const actions = Object.values(desktopActionTasks)
    const running = actions.filter(t => t.status.running).length
    const failed = actions.filter(t => !t.status.running && (t.status.exit_code ?? 0) !== 0).length
    const previewRunning = previewServerRestartStatus === 'running' ? 1 : 0
    const previewFailed = previewServerRestartStatus === 'error' ? 1 : 0

    return { bgFailed: failed + previewFailed, bgRunning: workingSessionIds.length + running + previewRunning }
  }, [desktopActionTasks, previewServerRestartStatus, workingSessionIds])

  const gatewayUp = Boolean(statusSnapshot?.gateway_running)

  const coreLeftStatusbarItems = useMemo<readonly StatusbarItem[]>(
    () => [
      {
        className: `h-6 w-6 justify-center px-0${commandCenterOpen ? ' bg-accent/55 text-foreground' : ''}`,
        icon: <Command className="size-3.5" />,
        id: 'command-center',
        onSelect: toggleCommandCenter,
        title: commandCenterOpen ? 'Close Command Center' : 'Open Command Center',
        variant: 'action'
      },
      {
        className: gatewayUp ? undefined : 'text-destructive hover:text-destructive',
        detail: gatewayUp ? statusSnapshot?.gateway_state || 'online' : 'offline',
        icon: gatewayUp ? <Activity className="size-3" /> : <AlertCircle className="size-3" />,
        id: 'gateway-health',
        label: 'Gateway',
        menuClassName: 'w-96',
        menuItems: gatewayMenuItems,
        title: 'Gateway and platform health',
        variant: 'menu'
      },
      {
        className: cn(
          agentsOpen && 'bg-accent/55 text-foreground',
          bgFailed > 0 && 'text-destructive hover:text-destructive'
        ),
        detail: bgFailed > 0 ? `${bgFailed} failed` : bgRunning > 0 ? `${bgRunning} running` : undefined,
        icon:
          bgFailed > 0 ? (
            <AlertCircle className="size-3" />
          ) : bgRunning > 0 ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          ),
        id: 'agents',
        label: 'Agents',
        onSelect: openAgents,
        title: agentsOpen ? 'Close agents' : 'Open agents',
        variant: 'action'
      }
    ],
    [
      agentsOpen,
      bgFailed,
      bgRunning,
      commandCenterOpen,
      gatewayMenuItems,
      gatewayUp,
      openAgents,
      statusSnapshot?.gateway_state,
      toggleCommandCenter
    ]
  )

  const coreRightStatusbarItems = useMemo<readonly StatusbarItem[]>(
    () => [
      {
        detail: <LiveDuration since={turnStartedAt} />,
        hidden: !busy || !turnStartedAt,
        icon: <Loader2 className="size-3 animate-spin" />,
        id: 'running-timer',
        label: 'Running',
        title: 'Current turn elapsed',
        variant: 'text'
      },
      {
        detail: contextBar || undefined,
        hidden: !contextUsage,
        id: 'context-usage',
        label: contextUsage,
        title: 'Context usage',
        variant: 'text'
      },
      {
        detail: <LiveDuration since={sessionStartedAt} />,
        hidden: !sessionStartedAt,
        id: 'session-timer',
        label: 'Session',
        title: 'Runtime session elapsed',
        variant: 'text'
      },
      {
        detail: currentProvider || '',
        icon: <Cpu className="size-3" />,
        id: 'model-summary',
        label: currentModel || 'No model selected',
        onSelect: () => setModelPickerOpen(true),
        title: currentProvider ? `Switch model · ${currentProvider}: ${currentModel || ''}` : 'Open model picker',
        variant: 'action'
      },
      {
        icon: <FolderOpen className="size-3" />,
        id: 'cwd',
        label: currentCwd ? compactPath(currentCwd) : 'No project cwd',
        onSelect: () => void browseSessionCwd(),
        title: currentCwd ? `Change working directory · ${currentCwd}` : 'Choose working directory',
        variant: 'action'
      },
      {
        hidden: !currentBranch,
        icon: <GitBranch className="size-3" />,
        id: 'branch',
        label: currentBranch,
        title: currentBranch ? `Current branch: ${currentBranch}` : undefined,
        variant: 'text'
      }
    ],
    [
      browseSessionCwd,
      busy,
      contextBar,
      contextUsage,
      currentBranch,
      currentCwd,
      currentModel,
      currentProvider,
      sessionStartedAt,
      turnStartedAt
    ]
  )

  const leftStatusbarItems = useMemo(
    () => [...coreLeftStatusbarItems, ...extraLeftItems],
    [coreLeftStatusbarItems, extraLeftItems]
  )

  const statusbarItems = useMemo(
    () => [...extraRightItems, ...coreRightStatusbarItems],
    [coreRightStatusbarItems, extraRightItems]
  )

  return { leftStatusbarItems, statusbarItems }
}
