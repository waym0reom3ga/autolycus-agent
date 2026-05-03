import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { ModelOptionsResponse, SessionRuntimeInfo } from '@/types/hermes'

import { formatRefValue } from '../components/assistant-ui/directive-text'
import {
  getGlobalModelInfo,
  getHermesConfig,
  getHermesConfigDefaults,
  getSessionMessages,
  type HermesGateway,
  listSessions,
  setGlobalModel
} from '../hermes'
import { chatMessageText, toChatMessages } from '../lib/chat-messages'
import { BUILTIN_PERSONALITIES, normalizePersonalityValue, personalityNamesFromConfig } from '../lib/chat-runtime'
import { extractPreviewCandidates } from '../lib/preview-targets'
import { $pinnedSessionIds, pinSession, unpinSession } from '../store/layout'
import { notify, notifyError } from '../store/notifications'
import {
  $previewTarget,
  beginPreviewServerRestart,
  completePreviewServerRestart,
  progressPreviewServerRestart,
  requestPreviewReload,
  setPreviewTarget
} from '../store/preview'
import {
  $activeSessionId,
  $currentCwd,
  $currentFastMode,
  $currentReasoningEffort,
  $currentServiceTier,
  $freshDraftReady,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
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
import { useGatewayBoot } from './gateway/hooks/use-gateway-boot'
import { useGatewayRequest } from './gateway/hooks/use-gateway-request'
import { ModelPickerOverlay } from './model-picker-overlay'
import { appViewForPath, isNewChatRoute, NEW_CHAT_ROUTE, routeSessionId, sessionRoute } from './routes'
import { useMessageStream } from './session/hooks/use-message-stream'
import { usePromptActions } from './session/hooks/use-prompt-actions'
import { useSessionActions } from './session/hooks/use-session-actions'
import { useSessionStateCache } from './session/hooks/use-session-state-cache'
import { SettingsView } from './settings'
import { AppShell } from './shell/app-shell'
import type { SetTitlebarToolGroup, TitlebarTool, TitlebarToolSide } from './shell/titlebar-controls'
import { SkillsView } from './skills'
import type { ContextSuggestion } from './types'

const DEFAULT_VOICE_RECORDING_SECONDS = 120

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
  const messages = useStore($messages)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const currentCwd = useStore($currentCwd)
  const freshDraftReady = useStore($freshDraftReady)
  const routedSessionId = routeSessionId(location.pathname)
  const currentView = appViewForPath(location.pathname)
  const routeToken = `${currentView}:${routedSessionId || ''}:${location.pathname}:${location.search}:${location.hash}`
  const routeTokenRef = useRef(routeToken)
  routeTokenRef.current = routeToken
  const getRouteToken = useCallback(() => routeTokenRef.current, [])
  const settingsOpen = currentView === 'settings'
  const chatOpen = currentView === 'chat'
  const settingsReturnPathRef = useRef(NEW_CHAT_ROUTE)
  const refreshSessionsRequestRef = useRef(0)

  const [titlebarToolGroups, setTitlebarToolGroups] = useState<
    Record<TitlebarToolSide, Record<string, readonly TitlebarTool[]>>
  >({ left: {}, right: {} })

  const [voiceMaxRecordingSeconds, setVoiceMaxRecordingSeconds] = useState(DEFAULT_VOICE_RECORDING_SECONDS)
  const [sttEnabled, setSttEnabled] = useState(true)

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

  const setTitlebarToolGroup = useCallback<SetTitlebarToolGroup>((id, tools, side = 'right') => {
    setTitlebarToolGroups(current => {
      const next = { ...current, [side]: { ...current[side] } }

      if (tools.length === 0) {
        delete next[side][id]
      } else {
        next[side][id] = tools
      }

      return next
    })
  }, [])

  const leftTitlebarTools = useMemo(
    () => Object.values(titlebarToolGroups.left).flat(),
    [titlebarToolGroups.left]
  )

  const titlebarTools = useMemo(
    () => Object.values(titlebarToolGroups.right).flat(),
    [titlebarToolGroups.right]
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

        if (lastPreviewRouteRef.current !== routeKey || activeSessionIdRef.current !== sessionId || $currentCwd.get() !== cwd) {
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
        const payload = event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
        const taskId = typeof payload.task_id === 'string' ? payload.task_id : ''

        if (taskId) {
          completePreviewServerRestart(taskId, typeof payload.text === 'string' ? payload.text : '')
        }
      }

      if (event.type === 'preview.restart.progress') {
        const payload = event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
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
    if (currentView !== 'settings') {
      settingsReturnPathRef.current = `${location.pathname}${location.search}${location.hash}`
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

  const closeSettingsToPreviousRoute = useCallback(() => {
    navigate(settingsReturnPathRef.current || NEW_CHAT_ROUTE, { replace: true })
  }, [navigate])

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

        if (rawHash && rawHash !== '/' && !rawHash.startsWith('/settings') && !rawHash.startsWith('/skills') && !rawHash.startsWith('/artifacts')) {
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
          onClose={closeSettingsToPreviousRoute}
          onConfigSaved={() => {
            void refreshHermesConfig()
            void refreshCurrentModel()
            void queryClient.invalidateQueries({ queryKey: ['model-options'] })
          }}
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
      onOpenModelPicker={() => setModelPickerOpen(true)}
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
      setTitlebarToolGroup={setTitlebarToolGroup}
    />
  )

  return (
    <AppShell
      inspectorWidth={SESSION_INSPECTOR_WIDTH}
      leftTitlebarTools={leftTitlebarTools}
      onOpenSettings={openSettings}
      overlays={overlays}
      previewWidth={PREVIEW_RAIL_WIDTH}
      rightRailOpen={chatOpen}
      settingsOpen={settingsOpen}
      sidebar={sidebar}
      titlebarTools={titlebarTools}
    >
      <Routes>
        <Route element={chatView} index />
        <Route element={chatView} path=":sessionId" />
        <Route element={<SkillsView setTitlebarToolGroup={setTitlebarToolGroup} />} path="skills" />
        <Route element={<ArtifactsView setTitlebarToolGroup={setTitlebarToolGroup} />} path="artifacts" />
        <Route element={null} path="settings" />
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
