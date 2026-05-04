import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { ModelOptionsResponse, SessionRuntimeInfo, StatusResponse } from '@/types/hermes'

import { formatRefValue } from '../components/assistant-ui/directive-text'
import {
  getGlobalModelInfo,
  getHermesConfig,
  getHermesConfigDefaults,
  getLogs,
  getSessionMessages,
  getStatus,
  type HermesGateway,
  listSessions,
  setGlobalModel
} from '../hermes'
import { chatMessageText, toChatMessages } from '../lib/chat-messages'
import { BUILTIN_PERSONALITIES, normalizePersonalityValue, personalityNamesFromConfig } from '../lib/chat-runtime'
import { Activity, AlertCircle, Command, Cpu, FolderOpen, GitBranch, Loader2 } from '../lib/icons'
import { extractPreviewCandidates } from '../lib/preview-targets'
import { compactPath, contextBarLabel, LiveDuration, usageContextLabel } from '../lib/statusbar'
import { $desktopActionTasks } from '../store/activity'
import { $pinnedSessionIds, pinSession, unpinSession } from '../store/layout'
import { notify, notifyError } from '../store/notifications'
import {
  $previewServerRestart,
  $previewTarget,
  beginPreviewServerRestart,
  completePreviewServerRestart,
  progressPreviewServerRestart,
  requestPreviewReload,
  setPreviewTarget
} from '../store/preview'
import {
  $activeSessionId,
  $busy,
  $currentBranch,
  $currentCwd,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $currentServiceTier,
  $currentUsage,
  $freshDraftReady,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
  $sessions,
  $sessionStartedAt,
  $turnStartedAt,
  $workingSessionIds,
  setAvailablePersonalities,
  setAwaitingResponse,
  setBusy,
  setContextSuggestions,
  setCurrentBranch,
  setCurrentCwd,
  setCurrentFastMode,
  setCurrentModel,
  setCurrentPersonality,
  setCurrentProvider,
  setCurrentReasoningEffort,
  setCurrentServiceTier,
  setIntroPersonality,
  setMessages,
  setModelPickerOpen,
  setSessions,
  setSessionsLoading
} from '../store/session'
import { useTheme } from '../themes/context'

import { ArtifactsView } from './artifacts'
import { ChatView, PREVIEW_RAIL_WIDTH, SESSION_INSPECTOR_WIDTH } from './chat'
import { useComposerActions } from './chat/hooks/use-composer-actions'
import { ChatSidebar } from './chat/sidebar'
import { type CommandCenterSection, CommandCenterView } from './command-center'
import { useGatewayBoot } from './gateway/hooks/use-gateway-boot'
import { useGatewayRequest } from './gateway/hooks/use-gateway-request'
import { ModelPickerOverlay } from './model-picker-overlay'
import {
  appViewForPath,
  COMMAND_CENTER_ROUTE,
  isNewChatRoute,
  NEW_CHAT_ROUTE,
  routeSessionId,
  sessionRoute,
  SKILLS_ROUTE
} from './routes'
import { useMessageStream } from './session/hooks/use-message-stream'
import { usePromptActions } from './session/hooks/use-prompt-actions'
import { useSessionActions } from './session/hooks/use-session-actions'
import { useSessionStateCache } from './session/hooks/use-session-state-cache'
import { SettingsView } from './settings'
import { AppShell } from './shell/app-shell'
import type { StatusbarItem, StatusbarMenuItem } from './shell/statusbar-controls'
import type { TitlebarTool } from './shell/titlebar-controls'
import { useGroupRegistry } from './shell/use-group-registry'
import { SkillsView } from './skills'
import type { ContextSuggestion } from './types'

const DEFAULT_VOICE_RECORDING_SECONDS = 120
const COMMAND_CENTER_SECTIONS = ['models', 'sessions', 'system'] as const
const STATUS_REFRESH_MS = 15_000
const GATEWAY_LOG_TAIL = 5

function normalizeRecordingLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_VOICE_RECORDING_SECONDS
}

function gatewayEventPreviewText(event: { payload?: unknown; type?: string }): string {
  const payload = event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
  const fields = event.type?.startsWith('message.') ? ['text', 'rendered', 'preview'] : ['preview']

  return fields
    .map(key => payload[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
}

function buildGatewayLogItems(lines: readonly string[]): readonly StatusbarMenuItem[] {
  if (lines.length === 0) {
    return [
      {
        className: 'text-muted-foreground',
        disabled: true,
        id: 'gateway-log-empty',
        label: 'No recent gateway log lines'
      }
    ]
  }

  return lines.slice(-GATEWAY_LOG_TAIL).map((line, index) => ({
    className: 'font-mono text-[0.68rem] text-muted-foreground',
    disabled: true,
    id: `gateway-log:${index}`,
    label: line.trim().slice(0, 120) || '(blank log line)'
  }))
}

function gatewayEventCompletedFileDiff(event: { payload?: unknown; type?: string }): boolean {
  if (event.type !== 'tool.complete' || !event.payload || typeof event.payload !== 'object') {
    return false
  }

  const inlineDiff = (event.payload as Record<string, unknown>).inline_diff

  return typeof inlineDiff === 'string' && inlineDiff.trim().length > 0
}

export function DesktopController() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const busyRef = useRef(false)
  const creatingSessionRef = useRef(false)
  const gatewayState = useStore($gatewayState)
  const { availableThemes, setTheme, themeName } = useTheme()
  const activeSessionId = useStore($activeSessionId)
  const busy = useStore($busy)
  const currentBranch = useStore($currentBranch)
  const currentUsage = useStore($currentUsage)
  const messages = useStore($messages)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const desktopActionTasks = useStore($desktopActionTasks)
  const previewServerRestart = useStore($previewServerRestart)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const sessionStartedAt = useStore($sessionStartedAt)
  const sessions = useStore($sessions)
  const turnStartedAt = useStore($turnStartedAt)
  const currentCwd = useStore($currentCwd)
  const workingSessionIds = useStore($workingSessionIds)
  const freshDraftReady = useStore($freshDraftReady)
  const routedSessionId = routeSessionId(location.pathname)
  const currentView = appViewForPath(location.pathname)
  const routeToken = `${currentView}:${routedSessionId || ''}:${location.pathname}:${location.search}:${location.hash}`
  const routeTokenRef = useRef(routeToken)
  routeTokenRef.current = routeToken
  const getRouteToken = useCallback(() => routeTokenRef.current, [])
  const settingsOpen = currentView === 'settings'
  const commandCenterOpen = currentView === 'command-center'
  const chatOpen = currentView === 'chat'

  const commandCenterInitialSection = useMemo<CommandCenterSection | undefined>(() => {
    const section = new URLSearchParams(location.search).get('section')

    return COMMAND_CENTER_SECTIONS.find(value => value === section)
  }, [location.search])

  const overlayReturnPathRef = useRef(NEW_CHAT_ROUTE)
  const refreshSessionsRequestRef = useRef(0)

  const titlebarToolGroups = useGroupRegistry<TitlebarTool>()
  const statusbarItemGroups = useGroupRegistry<StatusbarItem>()
  const setTitlebarToolGroup = titlebarToolGroups.set
  const setStatusbarItemGroup = statusbarItemGroups.set

  const [voiceMaxRecordingSeconds, setVoiceMaxRecordingSeconds] = useState(DEFAULT_VOICE_RECORDING_SECONDS)
  const [sttEnabled, setSttEnabled] = useState(true)
  const [gatewayLogLines, setGatewayLogLines] = useState<string[]>([])
  const [statusSnapshot, setStatusSnapshot] = useState<StatusResponse | null>(null)

  const {
    activeSessionIdRef,
    ensureSessionState,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    syncSessionStateToView,
    updateSessionState
  } = useSessionStateCache({
    activeSessionId,
    busyRef,
    selectedStoredSessionId,
    setAwaitingResponse,
    setBusy,
    setMessages
  })

  const openCommandCenterSection = useCallback(
    (section: CommandCenterSection) => {
      navigate(`${COMMAND_CENTER_ROUTE}?section=${section}`)
    },
    [navigate]
  )

  const closeOverlayToPreviousRoute = useCallback(() => {
    navigate(overlayReturnPathRef.current || NEW_CHAT_ROUTE, { replace: true })
  }, [navigate])

  const toggleCommandCenter = useCallback(() => {
    if (commandCenterOpen) {
      closeOverlayToPreviousRoute()

      return
    }

    navigate(COMMAND_CENTER_ROUTE)
  }, [closeOverlayToPreviousRoute, commandCenterOpen, navigate])

  const contextUsage = useMemo(() => usageContextLabel(currentUsage), [currentUsage])
  const contextBar = useMemo(() => contextBarLabel(currentUsage), [currentUsage])

  const platformMenuItems = useMemo<readonly StatusbarMenuItem[]>(
    () =>
      Object.entries(statusSnapshot?.gateway_platforms || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, platform]) => ({
          id: `platform:${name}`,
          label: `${name} · ${platform.state}`,
          disabled: true
        })),
    [statusSnapshot?.gateway_platforms]
  )

  const gatewayMenuItems = useMemo<readonly StatusbarMenuItem[]>(
    () => [
      {
        id: 'gateway:open-system',
        label: 'Open system panel',
        onSelect: () => openCommandCenterSection('system')
      },
      ...buildGatewayLogItems(gatewayLogLines),
      ...platformMenuItems
    ],
    [gatewayLogLines, openCommandCenterSection, platformMenuItems]
  )

  const backgroundSummary = useMemo(() => {
    const actions = Object.values(desktopActionTasks)
    const runningActions = actions.filter(task => task.status.running).length
    const failedActions = actions.filter(task => !task.status.running && (task.status.exit_code ?? 0) !== 0).length
    const runningPreview = previewServerRestart?.status === 'running' ? 1 : 0
    const failedPreview = previewServerRestart?.status === 'error' ? 1 : 0

    return {
      running: workingSessionIds.length + runningActions + runningPreview,
      failed: failedActions + failedPreview
    }
  }, [desktopActionTasks, previewServerRestart, workingSessionIds])

  const gatewayUp = Boolean(statusSnapshot?.gateway_running)
  const bgRunning = backgroundSummary.running
  const bgFailed = backgroundSummary.failed

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
        className: bgFailed > 0 ? 'text-destructive hover:text-destructive' : undefined,
        detail: bgFailed > 0 ? `${bgFailed} failed` : `${bgRunning} running`,
        hidden: bgRunning === 0 && bgFailed === 0,
        icon: bgFailed > 0 ? <AlertCircle className="size-3" /> : <Loader2 className="size-3 animate-spin" />,
        id: 'background-summary',
        label: 'Background',
        onSelect: () => openCommandCenterSection('system'),
        title: 'Open background task details',
        variant: 'action'
      }
    ],
    [bgFailed, bgRunning, commandCenterOpen, gatewayMenuItems, gatewayUp, openCommandCenterSection, statusSnapshot?.gateway_state, toggleCommandCenter]
  )

  const leftStatusbarItems = useMemo(
    () => [...coreLeftStatusbarItems, ...statusbarItemGroups.flat.left],
    [coreLeftStatusbarItems, statusbarItemGroups.flat.left]
  )

  const toggleSelectedPin = useCallback(() => {
    const sessionId = $selectedStoredSessionId.get()

    if (!sessionId) {
      return
    }

    if ($pinnedSessionIds.get().includes(sessionId)) {
      unpinSession(sessionId)
    } else {
      pinSession(sessionId)
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    const requestId = refreshSessionsRequestRef.current + 1
    refreshSessionsRequestRef.current = requestId
    setSessionsLoading(true)

    try {
      const result = await listSessions(50)

      if (refreshSessionsRequestRef.current === requestId) {
        setSessions(result.sessions)
      }
    } finally {
      if (refreshSessionsRequestRef.current === requestId) {
        setSessionsLoading(false)
      }
    }
  }, [])

  const { connectionRef, gatewayRef, requestGateway } = useGatewayRequest()

  const setBootGateway = useCallback(
    (gateway: HermesGateway | null) => {
      gatewayRef.current = gateway
    },
    [gatewayRef]
  )

  const setBootConnection = useCallback(
    (connection: Awaited<ReturnType<NonNullable<typeof window.hermesDesktop>['getConnection']>> | null) => {
      connectionRef.current = connection
    },
    [connectionRef]
  )

  useEffect(() => {
    let cancelled = false

    const refreshStatus = async () => {
      try {
        const [next, logs] = await Promise.all([
          getStatus(),
          getLogs({ file: 'gateway', lines: 12 }).catch(() => ({ lines: [] }))
        ])

        if (cancelled) {
          return
        }

        setStatusSnapshot(next)
        setGatewayLogLines(logs.lines.map(line => line.trim()).filter(Boolean))
      } catch {
        // Keep the last successful snapshot.
      }
    }

    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), STATUS_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [gatewayState])

  const updateModelOptionsCache = useCallback(
    (provider: string, model: string, includeGlobal: boolean) => {
      const patch = (prev: ModelOptionsResponse | undefined) => ({
        ...(prev ?? {}),
        provider,
        model
      })

      queryClient.setQueryData<ModelOptionsResponse>(['model-options', activeSessionId || 'global'], patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResponse>(['model-options', 'global'], patch)
      }
    },
    [activeSessionId, queryClient]
  )

  const refreshContextSuggestions = useCallback(async () => {
    if (!activeSessionId) {
      setContextSuggestions([])

      return
    }

    const sessionId = activeSessionId
    const cwd = currentCwd || ''

    try {
      const result = await requestGateway<{ items?: ContextSuggestion[] }>('complete.path', {
        session_id: sessionId,
        word: '@file:',
        cwd: cwd || undefined
      })

      if (activeSessionIdRef.current === sessionId && $currentCwd.get() === cwd) {
        setContextSuggestions((result.items || []).filter(item => item.text))
      }
    } catch {
      if (activeSessionIdRef.current === sessionId && $currentCwd.get() === cwd) {
        setContextSuggestions([])
      }
    }
  }, [activeSessionId, activeSessionIdRef, currentCwd, requestGateway])

  const refreshCurrentModel = useCallback(async () => {
    try {
      const result = await getGlobalModelInfo()

      if (typeof result.model === 'string') {
        setCurrentModel(result.model)
      }

      if (typeof result.provider === 'string') {
        setCurrentProvider(result.provider)
      }
    } catch {
      // The delayed session.info event can still update this once the agent is ready.
    }
  }, [])

  const refreshProjectBranch = useCallback(
    async (cwd: string) => {
      const targetCwd = cwd.trim()

      if (!targetCwd || activeSessionIdRef.current) {
        return
      }

      try {
        const info = await requestGateway<{ branch?: string; cwd?: string }>('config.get', {
          key: 'project',
          cwd: targetCwd
        })

        if (!activeSessionIdRef.current && ($currentCwd.get() || targetCwd) === (info.cwd || targetCwd)) {
          setCurrentBranch(info.branch || '')
        }
      } catch {
        setCurrentBranch('')
      }
    },
    [activeSessionIdRef, requestGateway]
  )

  const changeSessionCwd = useCallback(
    async (cwd: string) => {
      const trimmed = cwd.trim()

      if (!trimmed) {
        return
      }

      const persistGlobal = async () => {
        const info = await requestGateway<{ branch?: string; cwd?: string; value?: string }>('config.set', {
          ...(activeSessionId && { session_id: activeSessionId }),
          key: 'terminal.cwd',
          value: trimmed
        })

        const nextCwd = info.cwd || info.value || trimmed

        setCurrentCwd(nextCwd)

        if (!activeSessionId) {
          setCurrentBranch(info.branch || '')
        }
      }

      if (!activeSessionId) {
        try {
          await persistGlobal()
        } catch (err) {
          notifyError(err, 'Working directory change failed')
        }

        return
      }

      try {
        const info = await requestGateway<SessionRuntimeInfo>('session.cwd.set', {
          session_id: activeSessionId,
          cwd: trimmed
        })

        setCurrentCwd(info.cwd || trimmed)
        setCurrentBranch(info.branch || '')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        if (!message.includes('unknown method')) {
          notifyError(err, 'Working directory change failed')

          return
        }

        try {
          await persistGlobal()
          notify({
            kind: 'warning',
            title: 'Working directory saved',
            message: 'Restart the desktop backend to apply cwd changes to this active session.'
          })
        } catch (fallbackErr) {
          notifyError(fallbackErr, 'Working directory change failed')
        }
      }
    },
    [activeSessionId, requestGateway]
  )

  const browseSessionCwd = useCallback(async () => {
    const paths = await window.hermesDesktop?.selectPaths({
      title: 'Change working directory',
      defaultPath: currentCwd || undefined,
      directories: true,
      multiple: false
    })

    if (paths?.[0]) {
      await changeSessionCwd(paths[0])
    }
  }, [changeSessionCwd, currentCwd])

  const coreRightStatusbarItems = useMemo<readonly StatusbarItem[]>(
    () => [
      {
        hidden: !busy || !turnStartedAt,
        icon: <Loader2 className="size-3 animate-spin" />,
        id: 'running-timer',
        label: 'Running',
        detail: <LiveDuration since={turnStartedAt} />,
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
        hidden: !sessionStartedAt,
        id: 'session-timer',
        label: 'Session',
        detail: <LiveDuration since={sessionStartedAt} />,
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
        id: 'cwd',
        icon: <FolderOpen className="size-3" />,
        label: currentCwd ? compactPath(currentCwd) : 'No project cwd',
        onSelect: () => void browseSessionCwd(),
        title: currentCwd ? `Change working directory · ${currentCwd}` : 'Choose working directory',
        variant: 'action'
      },
      {
        hidden: !currentBranch,
        id: 'branch',
        icon: <GitBranch className="size-3" />,
        label: currentBranch,
        title: currentBranch ? `Current branch: ${currentBranch}` : undefined,
        variant: 'text'
      }
    ],
    [browseSessionCwd, busy, contextBar, contextUsage, currentBranch, currentCwd, currentModel, currentProvider, sessionStartedAt, turnStartedAt]
  )

  const statusbarItems = useMemo(
    () => [...statusbarItemGroups.flat.right, ...coreRightStatusbarItems],
    [coreRightStatusbarItems, statusbarItemGroups.flat.right]
  )

  const selectModel = useCallback(
    (selection: { provider: string; model: string; persistGlobal: boolean }) => {
      setCurrentModel(selection.model)
      setCurrentProvider(selection.provider)
      updateModelOptionsCache(selection.provider, selection.model, selection.persistGlobal || !activeSessionId)

      void (async () => {
        try {
          if (activeSessionId) {
            await requestGateway('slash.exec', {
              session_id: activeSessionId,
              command: `/model ${selection.model} --provider ${selection.provider}${
                selection.persistGlobal ? ' --global' : ''
              }`
            })

            if (selection.persistGlobal) {
              void refreshCurrentModel()
            }

            void queryClient.invalidateQueries({
              queryKey: selection.persistGlobal ? ['model-options'] : ['model-options', activeSessionId]
            })

            return
          }

          await setGlobalModel(selection.provider, selection.model)
          void refreshCurrentModel()
          void queryClient.invalidateQueries({ queryKey: ['model-options'] })
        } catch (err) {
          notifyError(err, 'Model switch failed')
        }
      })()
    },
    [activeSessionId, queryClient, refreshCurrentModel, requestGateway, updateModelOptionsCache]
  )

  const refreshHermesConfig = useCallback(async () => {
    try {
      const [config, defaults] = await Promise.all([getHermesConfig(), getHermesConfigDefaults().catch(() => ({}))])

      const configPersonality = normalizePersonalityValue(
        typeof config.display?.personality === 'string' ? config.display.personality : ''
      )

      setIntroPersonality(configPersonality)
      setCurrentPersonality(prev => (activeSessionIdRef.current ? prev || configPersonality : configPersonality))
      setAvailablePersonalities([
        ...new Set([
          'none',
          ...BUILTIN_PERSONALITIES,
          ...personalityNamesFromConfig(defaults),
          ...personalityNamesFromConfig(config)
        ])
      ])

      const cwd = (config.terminal?.cwd ?? '').trim()

      if (cwd && cwd !== '.') {
        setCurrentCwd(prev => prev || cwd)
        void refreshProjectBranch($currentCwd.get() || cwd)
      }

      const reasoningEffort = (config.agent?.reasoning_effort ?? '').trim()
      const serviceTier = (config.agent?.service_tier ?? '').trim()

      setCurrentReasoningEffort(prev => (activeSessionIdRef.current ? prev : reasoningEffort))
      setCurrentServiceTier(prev => (activeSessionIdRef.current ? prev : serviceTier))
      setCurrentFastMode(prev =>
        activeSessionIdRef.current ? prev : ['fast', 'priority', 'on'].includes(serviceTier.toLowerCase())
      )

      setVoiceMaxRecordingSeconds(normalizeRecordingLimit(config.voice?.max_recording_seconds))
      setSttEnabled(config.stt?.enabled !== false)
    } catch {
      // Config is nice-to-have for the empty-state copy; the chat still works.
    }
  }, [activeSessionIdRef, refreshProjectBranch])

  const selectPersonality = useCallback(
    async (name: string) => {
      const trimmed = (name || '').trim() || 'none'
      const normalized = normalizePersonalityValue(trimmed)
      setCurrentPersonality(normalized)

      if (!activeSessionId) {
        setIntroPersonality(normalized)
      }

      try {
        await (activeSessionId
          ? requestGateway('slash.exec', {
              session_id: activeSessionId,
              command: `/personality ${trimmed}`
            })
          : requestGateway('config.set', {
              key: 'personality',
              value: trimmed
            }))

        if (!activeSessionId) {
          void refreshHermesConfig()
        }
      } catch (err) {
        void refreshHermesConfig()
        notifyError(err, 'Personality change failed')
      }
    },
    [activeSessionId, refreshHermesConfig, requestGateway]
  )

  const setReasoningEffort = useCallback(
    async (effort: string) => {
      const value = effort.trim().toLowerCase()
      const previous = $currentReasoningEffort.get()
      setCurrentReasoningEffort(value)

      try {
        await requestGateway('config.set', {
          ...(activeSessionId && { session_id: activeSessionId }),
          key: 'reasoning',
          value
        })
      } catch (err) {
        setCurrentReasoningEffort(previous)
        void refreshHermesConfig()
        notifyError(err, 'Reasoning change failed')
      }
    },
    [activeSessionId, refreshHermesConfig, requestGateway]
  )

  const setFastMode = useCallback(
    async (enabled: boolean) => {
      const previousFast = $currentFastMode.get()
      const previousTier = $currentServiceTier.get()
      setCurrentFastMode(enabled)
      setCurrentServiceTier(enabled ? 'priority' : '')

      try {
        await requestGateway('config.set', {
          ...(activeSessionId && { session_id: activeSessionId }),
          key: 'fast',
          value: enabled ? 'fast' : 'normal'
        })
      } catch (err) {
        setCurrentFastMode(previousFast)
        setCurrentServiceTier(previousTier)
        void refreshHermesConfig()
        notifyError(err, 'Fast mode change failed')
      }
    },
    [activeSessionId, refreshHermesConfig, requestGateway]
  )

  const hydrateFromStoredSession = useCallback(
    async (
      attempts = 1,
      storedSessionId = selectedStoredSessionIdRef.current,
      runtimeSessionId = activeSessionIdRef.current
    ) => {
      if (!storedSessionId || !runtimeSessionId) {
        return
      }

      for (let index = 0; index < Math.max(1, attempts); index += 1) {
        try {
          const latest = await getSessionMessages(storedSessionId)
          updateSessionState(
            runtimeSessionId,
            state => ({
              ...state,
              messages: toChatMessages(latest.messages)
            }),
            storedSessionId
          )

          return
        } catch {
          // Best-effort fallback when live stream payloads are empty.
        }

        if (index < attempts - 1) {
          await new Promise(resolve => window.setTimeout(resolve, 250))
        }
      }
    },
    [activeSessionIdRef, selectedStoredSessionIdRef, updateSessionState]
  )

  const { handleGatewayEvent } = useMessageStream({
    activeSessionIdRef,
    hydrateFromStoredSession,
    queryClient,
    refreshHermesConfig,
    refreshSessions,
    updateSessionState
  })

  const lastPreviewUrlRef = useRef<string>('')

  const openDetectedPreview = useCallback(
    async (text: string) => {
      const desktop = window.hermesDesktop
      const routeKey = lastPreviewRouteRef.current
      const sessionId = activeSessionIdRef.current
      const cwd = currentCwd || ''

      if (!desktop?.normalizePreviewTarget) {
        return
      }

      for (const candidate of extractPreviewCandidates(text)) {
        const target = await desktop.normalizePreviewTarget(candidate, cwd || undefined).catch(() => null)

        if (
          lastPreviewRouteRef.current !== routeKey ||
          activeSessionIdRef.current !== sessionId ||
          $currentCwd.get() !== cwd
        ) {
          return
        }

        if (!target || target.url === lastPreviewUrlRef.current) {
          continue
        }

        lastPreviewUrlRef.current = target.url
        setPreviewTarget(target)

        return
      }
    },
    [activeSessionIdRef, currentCwd]
  )

  const restartPreviewServer = useCallback(
    async (url: string, context?: string) => {
      const sessionId = activeSessionIdRef.current

      if (!sessionId) {
        throw new Error('No active session for background restart')
      }

      const cwd = $currentCwd.get() || currentCwd || ''

      const result = await requestGateway<{ task_id?: string }>('preview.restart', {
        context: context || undefined,
        cwd: cwd || undefined,
        session_id: sessionId,
        url
      })

      const taskId = result.task_id || ''

      if (!taskId) {
        throw new Error('Background restart did not return a task id')
      }

      beginPreviewServerRestart(taskId, url)

      return taskId
    },
    [activeSessionIdRef, currentCwd, requestGateway]
  )

  const handleDesktopGatewayEvent = useCallback(
    (event: Parameters<typeof handleGatewayEvent>[0]) => {
      handleGatewayEvent(event)

      if (event.type === 'preview.restart.complete') {
        const payload =
          event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}

        const taskId = typeof payload.task_id === 'string' ? payload.task_id : ''

        if (taskId) {
          completePreviewServerRestart(taskId, typeof payload.text === 'string' ? payload.text : '')
        }
      }

      if (event.type === 'preview.restart.progress') {
        const payload =
          event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}

        const taskId = typeof payload.task_id === 'string' ? payload.task_id : ''

        if (taskId) {
          progressPreviewServerRestart(taskId, typeof payload.text === 'string' ? payload.text : '')
        }
      }

      if (event.session_id && event.session_id !== activeSessionIdRef.current) {
        return
      }

      const previewText = gatewayEventPreviewText(event)

      if (previewText) {
        void openDetectedPreview(previewText)
      }

      if ($previewTarget.get()?.kind === 'url' && gatewayEventCompletedFileDiff(event)) {
        requestPreviewReload()
      }
    },
    [activeSessionIdRef, handleGatewayEvent, openDetectedPreview]
  )

  useEffect(() => {
    const latestAssistant = [...messages].reverse().find(message => message.role === 'assistant' && !message.pending)
    const text = latestAssistant ? chatMessageText(latestAssistant) : ''

    if (text) {
      void openDetectedPreview(text)
    }
  }, [messages, openDetectedPreview])

  const {
    branchCurrentSession,
    createBackendSessionForSend,
    openSettings,
    removeSession,
    resumeSession,
    selectSidebarItem,
    startFreshSessionDraft
  } = useSessionActions({
    activeSessionId,
    activeSessionIdRef,
    busyRef,
    creatingSessionRef,
    ensureSessionState,
    getRouteToken,
    navigate,
    requestGateway,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionId,
    selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    syncSessionStateToView,
    updateSessionState
  })

  const {
    addContextRefAttachment,
    attachDroppedItems,
    attachImageBlob,
    pasteClipboardImage,
    pickContextPaths,
    pickImages,
    removeAttachment
  } = useComposerActions({
    activeSessionId,
    currentCwd,
    requestGateway
  })

  useEffect(() => {
    if (currentView !== 'settings' && currentView !== 'command-center') {
      overlayReturnPathRef.current = `${location.pathname}${location.search}${location.hash}`
    }
  }, [currentView, location.hash, location.pathname, location.search])

  const previewRouteKey = `${currentView}:${routedSessionId || ''}:${selectedStoredSessionId || ''}`
  const lastPreviewRouteRef = useRef(previewRouteKey)

  useEffect(() => {
    if (lastPreviewRouteRef.current !== previewRouteKey) {
      lastPreviewRouteRef.current = previewRouteKey
      lastPreviewUrlRef.current = ''
      setPreviewTarget(null)
    }
  }, [previewRouteKey])

  const branchInNewChat = useCallback(
    async (messageId?: string) => {
      const branched = await branchCurrentSession(messageId)

      if (branched) {
        await refreshSessions().catch(() => undefined)
      }

      return branched
    },
    [branchCurrentSession, refreshSessions]
  )

  const handleSkinCommand = useCallback(
    (rawArg: string) => {
      const arg = rawArg.trim()
      const names = availableThemes.map(theme => theme.name)

      if (!availableThemes.length) {
        return 'No desktop themes are available.'
      }

      const activeIndex = Math.max(
        0,
        availableThemes.findIndex(theme => theme.name === themeName)
      )

      if (!arg || arg === 'next') {
        const next = availableThemes[(activeIndex + 1) % availableThemes.length]

        setTheme(next.name)

        return `Desktop theme switched to ${next.label}.`
      }

      if (arg === 'list' || arg === 'ls' || arg === 'status') {
        const rows = availableThemes.map(theme => {
          const marker = theme.name === themeName ? '*' : ' '

          return `${marker} ${theme.name.padEnd(10)} ${theme.label}`
        })

        return [`Desktop themes:`, ...rows, '', 'Use /skin <name>, or /skin to cycle.'].join('\n')
      }

      const normalized = arg.toLowerCase()

      const aliases: Record<string, string> = {
        ares: 'ember',
        hermes: 'default'
      }

      const targetName = aliases[normalized] || normalized

      const target = availableThemes.find(
        theme => theme.name.toLowerCase() === targetName || theme.label.toLowerCase() === normalized
      )

      if (!target) {
        return `Unknown desktop theme: ${arg}\nAvailable: ${names.join(', ')}`
      }

      setTheme(target.name)

      return `Desktop theme switched to ${target.label}.`
    },
    [availableThemes, setTheme, themeName]
  )

  const { cancelRun, editMessage, handleThreadMessagesChange, reloadFromMessage, submitText, transcribeVoiceAudio } =
    usePromptActions({
      activeSessionId,
      activeSessionIdRef,
      branchCurrentSession: branchInNewChat,
      busyRef,
      createBackendSessionForSend,
      handleSkinCommand,
      requestGateway,
      selectedStoredSessionIdRef,
      startFreshSessionDraft,
      sttEnabled,
      updateSessionState
    })

  useGatewayBoot({
    handleGatewayEvent: handleDesktopGatewayEvent,
    onConnectionReady: setBootConnection,
    onGatewayReady: setBootGateway,
    refreshHermesConfig,
    refreshSessions
  })

  useEffect(() => {
    if (gatewayState === 'open') {
      void refreshCurrentModel()
      void refreshSessions().catch(() => undefined)
    }
  }, [gatewayState, refreshCurrentModel, refreshSessions])

  useEffect(() => {
    if (gatewayState === 'open' && activeSessionId) {
      void refreshContextSuggestions()
    }
  }, [activeSessionId, gatewayState, refreshContextSuggestions])

  useEffect(() => {
    if (currentView !== 'chat' || gatewayState !== 'open') {
      return
    }

    if (routedSessionId) {
      const cachedRuntimeId = runtimeIdByStoredSessionIdRef.current.get(routedSessionId)

      const alreadyActive =
        routedSessionId === selectedStoredSessionIdRef.current &&
        Boolean(cachedRuntimeId) &&
        cachedRuntimeId === activeSessionIdRef.current

      if (!alreadyActive) {
        void resumeSession(routedSessionId, true)
      }
    } else if (
      isNewChatRoute(location.pathname) &&
      !creatingSessionRef.current &&
      (selectedStoredSessionId || activeSessionId || !freshDraftReady)
    ) {
      // Guard: during HashRouter boot the `location.pathname` can read `/`
      // briefly before the hash-portion (which holds the real route) is
      // parsed. If the window hash clearly references a session, defer —
      // `routedSessionId` will update in a tick and the routedSessionId
      // branch above will handle resume. Without this guard, a ctrl+R on
      // `#/:sessionId` calls startFreshSessionDraft → navigates to `/` →
      // wipes messages → races the real resume, producing the visible
      // "5 loading states" flash chain.
      if (typeof window !== 'undefined') {
        const rawHash = window.location.hash.replace(/^#/, '')

        if (
          rawHash &&
          rawHash !== '/' &&
          !rawHash.startsWith('/settings') &&
          !rawHash.startsWith('/skills') &&
          !rawHash.startsWith('/artifacts')
        ) {
          return
        }
      }

      startFreshSessionDraft(true)
    }
  }, [
    activeSessionIdRef,
    activeSessionId,
    currentView,
    freshDraftReady,
    gatewayState,
    location.pathname,
    resumeSession,
    routedSessionId,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionId,
    selectedStoredSessionIdRef,
    startFreshSessionDraft
  ])

  const sidebar = (
    <ChatSidebar
      currentView={currentView}
      onDeleteSession={sessionId => void removeSession(sessionId)}
      onNavigate={selectSidebarItem}
      onRefreshSessions={() => void refreshSessions()}
      onResumeSession={sessionId => navigate(sessionRoute(sessionId))}
    />
  )

  const overlays = (
    <>
      <ModelPickerOverlay gateway={gatewayRef.current || undefined} onSelect={selectModel} />

      {settingsOpen && (
        <SettingsView
          onClose={closeOverlayToPreviousRoute}
          onConfigSaved={() => {
            void refreshHermesConfig()
            void refreshCurrentModel()
            void queryClient.invalidateQueries({ queryKey: ['model-options'] })
          }}
        />
      )}

      {commandCenterOpen && (
        <CommandCenterView
          initialSection={commandCenterInitialSection}
          onClose={closeOverlayToPreviousRoute}
          onDeleteSession={removeSession}
          onMainModelChanged={(provider, model) => {
            setCurrentProvider(provider)
            setCurrentModel(model)
            updateModelOptionsCache(provider, model, true)
            void refreshCurrentModel()
            void queryClient.invalidateQueries({ queryKey: ['model-options'] })
          }}
          onNavigateRoute={path => navigate(path)}
          onOpenSession={sessionId => navigate(sessionRoute(sessionId))}
        />
      )}
    </>
  )

  const chatView = (
    <ChatView
      gateway={gatewayRef.current}
      maxVoiceRecordingSeconds={voiceMaxRecordingSeconds}
      onAddContextRef={addContextRefAttachment}
      onAddUrl={url => addContextRefAttachment(`@url:${formatRefValue(url)}`, url)}
      onAttachDroppedItems={attachDroppedItems}
      onAttachImageBlob={attachImageBlob}
      onBranchInNewChat={messageId => void branchInNewChat(messageId)}
      onBrowseCwd={() => void browseSessionCwd()}
      onCancel={() => void cancelRun()}
      onChangeCwd={cwd => void changeSessionCwd(cwd)}
      onDeleteSelectedSession={() => {
        if (selectedStoredSessionId) {
          void removeSession(selectedStoredSessionId)
        }
      }}
      onEdit={editMessage}
      onOpenCommandCenterSystem={() => openCommandCenterSection('system')}
      onOpenModelPicker={() => setModelPickerOpen(true)}
      onOpenSkills={() => navigate(SKILLS_ROUTE)}
      onPasteClipboardImage={() => void pasteClipboardImage()}
      onPickFiles={() => void pickContextPaths('file')}
      onPickFolders={() => void pickContextPaths('folder')}
      onPickImages={() => void pickImages()}
      onReload={reloadFromMessage}
      onRemoveAttachment={id => void removeAttachment(id)}
      onRestartPreviewServer={restartPreviewServer}
      onSelectPersonality={name => void selectPersonality(name)}
      onSetFastMode={enabled => void setFastMode(enabled)}
      onSetReasoningEffort={effort => void setReasoningEffort(effort)}
      onSubmit={submitText}
      onThreadMessagesChange={handleThreadMessagesChange}
      onToggleSelectedPin={toggleSelectedPin}
      onTranscribeAudio={transcribeVoiceAudio}
      setStatusbarItemGroup={setStatusbarItemGroup}
      setTitlebarToolGroup={setTitlebarToolGroup}
    />
  )

  return (
    <AppShell
      inspectorWidth={SESSION_INSPECTOR_WIDTH}
      leftStatusbarItems={leftStatusbarItems}
      leftTitlebarTools={titlebarToolGroups.flat.left}
      onOpenSettings={openSettings}
      overlays={overlays}
      previewWidth={PREVIEW_RAIL_WIDTH}
      rightRailOpen={chatOpen}
      sidebar={sidebar}
      statusbarItems={statusbarItems}
      titlebarTools={titlebarToolGroups.flat.right}
    >
      <Routes>
        <Route element={chatView} index />
        <Route element={chatView} path=":sessionId" />
        <Route
          element={<SkillsView setStatusbarItemGroup={setStatusbarItemGroup} setTitlebarToolGroup={setTitlebarToolGroup} />}
          path="skills"
        />
        <Route
          element={
            <ArtifactsView setStatusbarItemGroup={setStatusbarItemGroup} setTitlebarToolGroup={setTitlebarToolGroup} />
          }
          path="artifacts"
        />
        <Route element={null} path="settings" />
        <Route element={null} path="command-center" />
        <Route element={<Navigate replace to={NEW_CHAT_ROUTE} />} path="new" />
        <Route element={<LegacySessionRedirect />} path="sessions/:sessionId" />
        <Route element={<Navigate replace to={NEW_CHAT_ROUTE} />} path="*" />
      </Routes>
    </AppShell>
  )
}

function LegacySessionRedirect() {
  const { sessionId } = useParams()

  return <Navigate replace to={sessionId ? sessionRoute(sessionId) : NEW_CHAT_ROUTE} />
}
