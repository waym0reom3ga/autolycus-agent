import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import type { ModelOptionsResponse, SessionRuntimeInfo } from '@/types/hermes'

import {
  getGlobalModelInfo,
  getHermesConfig,
  getHermesConfigDefaults,
  getSessionMessages,
  type HermesGateway,
  listSessions,
  setGlobalModel
} from '../hermes'
import { formatRefValue } from '../components/assistant-ui/directive-text'
import { toChatMessages } from '../lib/chat-messages'
import { BUILTIN_PERSONALITIES, normalizePersonalityValue, personalityNamesFromConfig } from '../lib/chat-runtime'
import { $pinnedSessionIds, pinSession, unpinSession } from '../store/layout'
import { notify, notifyError } from '../store/notifications'
import {
  $activeSessionId,
  $currentCwd,
  $freshDraftReady,
  $gatewayState,
  $selectedStoredSessionId,
  setAvailablePersonalities,
  setAwaitingResponse,
  setBusy,
  setContextSuggestions,
  setCurrentBranch,
  setCurrentCwd,
  setCurrentModel,
  setCurrentPersonality,
  setCurrentProvider,
  setIntroPersonality,
  setMessages,
  setModelPickerOpen,
  setSessions,
  setSessionsLoading
} from '../store/session'

import { ArtifactsView } from './artifacts'
import { ChatView, SESSION_INSPECTOR_WIDTH } from './chat'
import { useComposerActions } from './chat/hooks/use-composer-actions'
import { ChatSidebar } from './chat/sidebar'
import { useGatewayBoot } from './gateway/hooks/use-gateway-boot'
import { useGatewayRequest } from './gateway/hooks/use-gateway-request'
import { ModelPickerOverlay } from './model-picker-overlay'
import {
  appViewForPath,
  isNewChatRoute,
  NEW_CHAT_ROUTE,
  routeSessionId,
  sessionRoute
} from './routes'
import { useMessageStream } from './session/hooks/use-message-stream'
import { usePromptActions } from './session/hooks/use-prompt-actions'
import { useSessionActions } from './session/hooks/use-session-actions'
import { useSessionStateCache } from './session/hooks/use-session-state-cache'
import { SettingsView } from './settings'
import { AppShell } from './shell/app-shell'
import { SkillsView } from './skills'
import type { ContextSuggestion } from './types'

const DEFAULT_VOICE_RECORDING_SECONDS = 120

function normalizeRecordingLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_VOICE_RECORDING_SECONDS
}

export function DesktopController() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const busyRef = useRef(false)
  const gatewayState = useStore($gatewayState)
  const activeSessionId = useStore($activeSessionId)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const currentCwd = useStore($currentCwd)
  const freshDraftReady = useStore($freshDraftReady)
  const routedSessionId = routeSessionId(location.pathname)
  const currentView = appViewForPath(location.pathname)
  const settingsOpen = currentView === 'settings'
  const chatOpen = currentView === 'chat'
  const settingsReturnPathRef = useRef(NEW_CHAT_ROUTE)
  const [titlebarActions, setTitlebarActions] = useState<ReactNode>(null)
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
    setSessionsLoading(true)

    try {
      const result = await listSessions(50)
      setSessions(result.sessions)
    } finally {
      setSessionsLoading(false)
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

    try {
      const result = await requestGateway<{ items?: ContextSuggestion[] }>('complete.path', {
        session_id: activeSessionId,
        word: '@file:',
        cwd: currentCwd || undefined
      })

      setContextSuggestions((result.items || []).filter(item => item.text))
    } catch {
      setContextSuggestions([])
    }
  }, [activeSessionId, currentCwd, requestGateway])

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

  const changeSessionCwd = useCallback(
    async (cwd: string) => {
      const trimmed = cwd.trim()

      if (!trimmed) {
        return
      }

      const persistGlobal = async () => {
        await requestGateway('config.set', {
          ...(activeSessionId && { session_id: activeSessionId }),
          key: 'terminal.cwd',
          value: trimmed
        })
        setCurrentCwd(trimmed)

        if (!activeSessionId) {
          setCurrentBranch('')
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
      }

      setVoiceMaxRecordingSeconds(normalizeRecordingLimit(config.voice?.max_recording_seconds))
      setSttEnabled(config.stt?.enabled !== false)
    } catch {
      // Config is nice-to-have for the empty-state copy; the chat still works.
    }
  }, [activeSessionIdRef])

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

  const { addContextRefAttachment, pasteClipboardImage, pickContextPaths, pickImages, removeAttachment } =
    useComposerActions({
      activeSessionId,
      currentCwd,
      requestGateway
    })

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
    ensureSessionState,
    navigate,
    requestGateway,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionId,
    selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    syncSessionStateToView,
    updateSessionState
  })

  useEffect(() => {
    if (currentView !== 'settings') {
      settingsReturnPathRef.current = `${location.pathname}${location.search}${location.hash}`
    }
  }, [currentView, location.hash, location.pathname, location.search])

  const closeSettingsToPreviousRoute = useCallback(() => {
    navigate(settingsReturnPathRef.current || NEW_CHAT_ROUTE, { replace: true })
  }, [navigate])

  const branchInNewChat = useCallback(
    async (messageId: string) => {
      const branched = await branchCurrentSession(messageId)

      if (branched) {
        await refreshSessions().catch(() => undefined)
      }
    },
    [branchCurrentSession, refreshSessions]
  )

  const { cancelRun, handleThreadMessagesChange, reloadFromMessage, submitText, transcribeVoiceAudio } =
    usePromptActions({
      activeSessionId,
      activeSessionIdRef,
      busyRef,
      createBackendSessionForSend,
      requestGateway,
      selectedStoredSessionIdRef,
      sttEnabled,
      updateSessionState
    })

  useGatewayBoot({
    handleGatewayEvent,
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
    } else if (isNewChatRoute(location.pathname) && (selectedStoredSessionId || activeSessionId || !freshDraftReady)) {
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
      onBranchInNewChat={messageId => void branchInNewChat(messageId)}
      onBrowseCwd={() => void browseSessionCwd()}
      onCancel={() => void cancelRun()}
      onChangeCwd={cwd => void changeSessionCwd(cwd)}
      onDeleteSelectedSession={() => {
        if (selectedStoredSessionId) {
          void removeSession(selectedStoredSessionId)
        }
      }}
      onOpenModelPicker={() => setModelPickerOpen(true)}
      onPasteClipboardImage={() => void pasteClipboardImage()}
      onPickFiles={() => void pickContextPaths('file')}
      onPickFolders={() => void pickContextPaths('folder')}
      onPickImages={() => void pickImages()}
      onReload={reloadFromMessage}
      onRemoveAttachment={id => void removeAttachment(id)}
      onSelectPersonality={name => void selectPersonality(name)}
      onSubmit={submitText}
      onThreadMessagesChange={handleThreadMessagesChange}
      onToggleSelectedPin={toggleSelectedPin}
      onTranscribeAudio={transcribeVoiceAudio}
    />
  )

  return (
    <AppShell
      inspectorWidth={SESSION_INSPECTOR_WIDTH}
      onOpenSettings={openSettings}
      overlays={overlays}
      rightRailOpen={chatOpen}
      settingsOpen={settingsOpen}
      sidebar={sidebar}
      titlebarActions={titlebarActions}
    >
      <Routes>
        <Route element={chatView} index />
        <Route element={chatView} path=":sessionId" />
        <Route element={<SkillsView setTitlebarActions={setTitlebarActions} />} path="skills" />
        <Route element={<ArtifactsView setTitlebarActions={setTitlebarActions} />} path="artifacts" />
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
