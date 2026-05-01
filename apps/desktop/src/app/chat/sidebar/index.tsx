import { useStore } from '@nanostores/react'
import { ChevronDown, Layers3, Pin, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import type { SessionInfo } from '@/hermes'
import { cn } from '@/lib/utils'
import {
  $isSidebarResizing,
  $pinnedSessionIds,
  $sidebarOpen,
  $sidebarPinsOpen,
  $sidebarRecentsOpen,
  pinSession,
  setSidebarPinsOpen,
  setSidebarRecentsOpen,
  unpinSession
} from '@/store/layout'
import { $selectedStoredSessionId, $sessions, $sessionsLoading, $workingSessionIds } from '@/store/session'

import { type AppView, ARTIFACTS_ROUTE, SKILLS_ROUTE } from '../../routes'
import type { SidebarNavItem } from '../../types'

import { SidebarSessionRow } from './session-row'

const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    id: 'new-session',
    label: 'New session',
    icon: Plus,
    action: 'new-session'
  },
  { id: 'skills', label: 'Skills', icon: Sparkles, route: SKILLS_ROUTE },
  { id: 'artifacts', label: 'Artifacts', icon: Layers3, route: ARTIFACTS_ROUTE }
]

const sidebarNavItemClass =
  'flex h-7 w-full justify-start gap-2 rounded-md px-2 text-left text-sm font-medium text-muted-foreground transition-colors duration-300 ease-out hover:bg-accent hover:text-foreground hover:transition-none'

interface ChatSidebarProps extends React.ComponentProps<typeof Sidebar> {
  currentView: AppView
  onNavigate: (item: SidebarNavItem) => void
  onRefreshSessions: () => void
  onResumeSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
}

export function ChatSidebar({
  currentView,
  onNavigate,
  onRefreshSessions,
  onResumeSession,
  onDeleteSession
}: ChatSidebarProps) {
  const sidebarOpen = useStore($sidebarOpen)
  const pinnedSessionIds = useStore($pinnedSessionIds)
  const isSidebarResizing = useStore($isSidebarResizing)
  const pinsOpen = useStore($sidebarPinsOpen)
  const recentsOpen = useStore($sidebarRecentsOpen)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const sessionsLoading = useStore($sessionsLoading)
  const workingSessionIds = useStore($workingSessionIds)

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    const aTime = a.last_active || a.started_at || 0
    const bTime = b.last_active || b.started_at || 0

    return bTime - aTime
  }), [sessions])

  const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions])
  const workingSessionIdSet = useMemo(() => new Set(workingSessionIds), [workingSessionIds])
  const visiblePinnedIds = pinnedSessionIds.filter(id => sessionsById.has(id))
  const visiblePinnedIdSet = new Set(visiblePinnedIds)

  const pinnedSessions = visiblePinnedIds
    .map(id => sessionsById.get(id))
    .filter((session): session is SessionInfo => Boolean(session))

  const recentSessions = sortedSessions.filter(session => !visiblePinnedIdSet.has(session.id))

  const showSessionSkeletons = sessionsLoading && sortedSessions.length === 0

  return (
    <Sidebar
      className={cn(
        'relative h-screen min-w-0 overflow-hidden border-r border-t-0 border-b-0 border-l-0 text-foreground [backdrop-filter:blur(1.5rem)_saturate(1.08)]',
        isSidebarResizing
          ? 'transition-none'
          : 'transition-[opacity,transform,border-color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        sidebarOpen
          ? 'translate-x-0 border-(--sidebar-edge-border) bg-[color-mix(in_srgb,var(--dt-sidebar-bg)_97%,transparent)] opacity-100'
          : 'pointer-events-none -translate-x-2 border-transparent bg-transparent opacity-0'
      )}
      collapsible="none"
    >
      <SidebarContent className="gap-0 overflow-hidden bg-transparent">
        <SidebarGroup className="shrink-0 pl-4 pr-2 pb-2 pt-[calc(var(--titlebar-height)+0.25rem)]">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {SIDEBAR_NAV.map(item => {
                const isInteractive = Boolean(item.action) || Boolean(item.route)

                const active =
                  (item.id === 'skills' && currentView === 'skills') ||
                  (item.id === 'artifacts' && currentView === 'artifacts')

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      aria-disabled={!isInteractive}
                      className={cn(
                        sidebarNavItemClass,
                        active && 'bg-accent text-foreground',
                        !isInteractive && 'cursor-default hover:bg-transparent hover:text-muted-foreground'
                      )}
                      onClick={() => onNavigate(item)}
                      tooltip={item.label}
                      type="button"
                    >
                      <item.icon className="size-4 shrink-0 text-[color-mix(in_srgb,currentColor_72%,transparent)]" />
                      {sidebarOpen && <span className="max-[46.25rem]:hidden">{item.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {sidebarOpen && (
          <SidebarGroup className="shrink-0 pl-4 pr-2 pb-1 pt-0">
            <SidebarSectionHeader label="Pinned" onToggle={() => setSidebarPinsOpen(!pinsOpen)} open={pinsOpen} />
            {pinsOpen && (
              <SidebarGroupContent className="flex min-h-10 shrink-0 flex-col gap-px rounded-lg pb-2 pt-1">
                {pinnedSessions.length === 0 && (
                  <div className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground opacity-50">
                    <Pin size={14} />
                    <span>Shift+click to pin</span>
                  </div>
                )}
                {pinnedSessions.map(session => (
                  <SidebarSessionRow
                    isPinned
                    isSelected={session.id === selectedSessionId}
                    isWorking={workingSessionIdSet.has(session.id)}
                    key={session.id}
                    onDelete={() => onDeleteSession(session.id)}
                    onPin={() => unpinSession(session.id)}
                    onResume={() => onResumeSession(session.id)}
                    session={session}
                  />
                ))}
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {sidebarOpen && (
          <SidebarGroup className="min-h-0 flex-1 pl-4 pr-2 py-0">
            <SidebarSectionHeader
              action={
                <Button
                  aria-label={sessionsLoading ? 'Refreshing sessions' : 'Refresh sessions'}
                  className="size-4 rounded-sm p-0 text-muted-foreground opacity-10 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 disabled:opacity-35 [&_svg]:size-3!"
                  disabled={sessionsLoading}
                  onClick={event => {
                    event.stopPropagation()
                    setSidebarRecentsOpen(true)
                    onRefreshSessions()
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <RefreshCw className={cn(sessionsLoading && 'animate-spin')} />
                </Button>
              }
              label="Sessions"
              onToggle={() => setSidebarRecentsOpen(!recentsOpen)}
              open={recentsOpen}
            />

            {recentsOpen && (
              <SidebarGroupContent className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain pb-1.75">
                {showSessionSkeletons && <SidebarSessionSkeletons />}
                {!showSessionSkeletons && sortedSessions.length === 0 && <SidebarEmptySessionState />}
                {!showSessionSkeletons && sortedSessions.length > 0 && recentSessions.length === 0 && (
                  <SidebarAllPinnedState />
                )}
                {recentSessions.map(session => (
                  <SidebarSessionRow
                    isPinned={false}
                    isSelected={session.id === selectedSessionId}
                    isWorking={workingSessionIdSet.has(session.id)}
                    key={session.id}
                    onDelete={() => onDeleteSession(session.id)}
                    onPin={() => pinSession(session.id)}
                    onResume={() => onResumeSession(session.id)}
                    session={session}
                  />
                ))}
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}

interface SidebarSectionHeaderProps extends React.ComponentProps<'div'> {
  label: string
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
}

function SidebarSectionHeader({ label, open, onToggle, action }: SidebarSectionHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between px-2 pb-1 pt-1.5">
      <SidebarGroupLabel asChild className="h-auto p-0 text-muted-foreground">
        <button
          className="group/section-label flex w-fit items-center gap-1 bg-transparent text-left text-xs font-bold leading-none"
          onClick={onToggle}
          type="button"
        >
          <span className="text-xs font-semibold uppercase leading-none">{label}</span>

          <ChevronDown
            className={cn('size-3 opacity-0 transition group-hover/section-label:opacity-100', !open && '-rotate-90')}
          />
        </button>
      </SidebarGroupLabel>
      {action}
    </div>
  )
}

function SidebarSessionSkeletons() {
  const widths = ['w-32', 'w-40', 'w-28', 'w-36', 'w-24']

  return (
    <div aria-hidden="true" className="grid gap-px">
      {widths.map((width, index) => (
        <div
          className="grid min-h-7 grid-cols-[minmax(0,1fr)_1.5rem] items-center rounded-lg px-2"
          key={`${width}-${index}`}
        >
          <Skeleton className={cn('h-3.5 rounded-full', width)} />
          <Skeleton className="mx-auto size-4 rounded-md opacity-60" />
        </div>
      ))}
    </div>
  )
}

function SidebarEmptySessionState() {
  return (
    <div className="grid min-h-35 place-items-center rounded-lg px-3 text-center text-xs text-muted-foreground">
      Recent chats will appear here.
    </div>
  )
}

function SidebarAllPinnedState() {
  return (
    <div className="grid min-h-24 place-items-center rounded-lg px-3 text-center text-xs text-muted-foreground">
      Pinned sessions stay above.
    </div>
  )
}
