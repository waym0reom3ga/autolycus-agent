import type { ThreadMessage } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import type {
  ModelOptionsResponse,
  RpcEvent,
  SessionCreateResponse,
  SessionResumeResponse,
  SessionRuntimeInfo
} from '@/types/hermes'

import type { HermesConnection } from '../global'
import {
  deleteSession,
  getGlobalModelInfo,
  getHermesConfig,
  getHermesConfigDefaults,
  getSessionMessages,
  HermesGateway,
  listSessions,
  setGlobalModel
} from '../hermes'
import {
  appendReasoningPart,
  appendTextPart,
  branchGroupForUser,
  type ChatMessage,
  type ChatMessagePart,
  chatMessageText,
  type GatewayEventPayload,
  reasoningPart,
  textPart,
  toChatMessages,
  upsertToolPart
} from '../lib/chat-messages'
import {
  attachmentDisplayText,
  BUILTIN_PERSONALITIES,
  coerceGatewayText,
  coerceThinkingText,
  INTERRUPTED_MARKER,
  normalizePersonalityValue,
  parseCommandDispatch,
  parseSlashCommand,
  personalityNamesFromConfig,
  SLASH_COMMAND_RE
} from '../lib/chat-runtime'
import {
  $composerAttachments,
  clearComposerAttachments,
  clearComposerDraft
} from '../store/composer'
import { $pinnedSessionIds, pinSession, unpinSession } from '../store/layout'
import { clearNotifications, notify, notifyError } from '../store/notifications'
import {
  $activeSessionId,
  $busy,
  $currentCwd,
  $gatewayState,
  $messages,
  $selectedStoredSessionId,
  $sessions,
  setActiveSessionId,
  setAvailablePersonalities,
  setAwaitingResponse,
  setBusy,
  setConnection,
  setContextSuggestions,
  setCurrentBranch,
  setCurrentCwd,
  setCurrentModel,
  setCurrentPersonality,
  setCurrentProvider,
  setFreshDraftReady,
  setGatewayState,
  setIntroPersonality,
  setIntroSeed,
  setMessages,
  setModelPickerOpen,
  setSelectedStoredSessionId,
  setSessions,
  setSessionsLoading
} from '../store/session'

import { ArtifactsView } from './artifacts'
import { ChatView, SESSION_INSPECTOR_WIDTH } from './chat'
import { ChatSidebar } from './chat/sidebar'
import { useComposerActions } from './chat/use-composer-actions'
import { ModelPickerOverlay } from './model-picker-overlay'
import {
  type AppView,
  currentAppView,
  NEW_CHAT_ROUTE,
  routeSessionId,
  SETTINGS_ROUTE,
  writeRoute,
  writeSessionRoute
} from './routes'
import { useSessionStateCache } from './session/use-session-state-cache'
import { SettingsView } from './settings'
import { AppShell } from './shell/app-shell'
import { SkillsView } from './skills'
import type { ContextSuggestion, SidebarNavItem, SlashExecResponse } from './types'

export default function App() {
  const queryClient = useQueryClient()
  const gatewayRef = useRef<HermesGateway | null>(null)
  const connectionRef = useRef<HermesConnection | null>(null)
  const busyRef = useRef(false)
  const reconnectingRef = useRef<Promise<HermesGateway | null> | null>(null)
  const gatewayState = useStore($gatewayState)
  const activeSessionId = useStore($activeSessionId)
  const selectedStoredSessionId = useStore($selectedStoredSessionId)
  const currentCwd = useStore($currentCwd)
  const [currentView, setCurrentView] = useState<AppView>(() => currentAppView())
  const settingsOpen = currentView === 'settings'
  const chatOpen = currentView === 'chat'
  const gatewayStateRef = useRef(gatewayState)

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

  useEffect(() => {
    gatewayStateRef.current = gatewayState
  }, [gatewayState])

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

  const ensureGatewayOpen = useCallback(async () => {
    const existing = gatewayRef.current

    if (!existing) {
      return null
    }

    if (gatewayStateRef.current === 'open') {
      return existing
    }

    if (reconnectingRef.current) {
      return reconnectingRef.current
    }

    reconnectingRef.current = (async () => {
      const desktop = window.hermesDesktop

      if (!desktop) {
        return null
      }

      const conn = connectionRef.current || (await desktop.getConnection())
      connectionRef.current = conn
      setConnection(conn)

      try {
        await existing.connect(conn.wsUrl)

        return existing
      } catch {
        return null
      } finally {
        reconnectingRef.current = null
      }
    })()

    return reconnectingRef.current
  }, [])

  const requestGateway = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}) => {
      const gateway = gatewayRef.current

      if (!gateway) {
        throw new Error('Hermes gateway unavailable')
      }

      try {
        return await gateway.request<T>(method, params)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (!/not connected|connection closed/i.test(message)) {
          throw error
        }

        const recovered = await ensureGatewayOpen()

        if (!recovered) {
          throw error
        }

        return recovered.request<T>(method, params)
      }
    },
    [ensureGatewayOpen]
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

      if (activeSessionId) {
        void requestGateway('slash.exec', {
          session_id: activeSessionId,
          command: `/model ${selection.model} --provider ${selection.provider}${
            selection.persistGlobal ? ' --global' : ''
          }`
        })
          .then(() => {
            if (selection.persistGlobal) {
              void refreshCurrentModel()
            }

            void queryClient.invalidateQueries({
              queryKey: selection.persistGlobal ? ['model-options'] : ['model-options', activeSessionId]
            })
          })
          .catch(err => {
            notifyError(err, 'Model switch failed')
          })

        return
      }

      void setGlobalModel(selection.provider, selection.model)
        .then(() => {
          void refreshCurrentModel()
          void queryClient.invalidateQueries({ queryKey: ['model-options'] })
        })
        .catch(err => {
          notifyError(err, 'Model switch failed')
        })
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
    } catch {
      // Config is nice-to-have for the empty-state copy; the chat still works.
    }
  }, [activeSessionIdRef])

  const selectPersonality = useCallback(
    async (name: string) => {
      const trimmed = (name || '').trim() || 'default'
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
              value: trimmed === 'default' ? '' : trimmed
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

  // Patch the in-flight assistant message (or seed it). Centralises the
  // streamId/groupId bookkeeping every event callback would otherwise repeat.
  const mutateStream = useCallback(
    (
      sessionId: string,
      transform: (parts: ChatMessagePart[], message: ChatMessage) => ChatMessagePart[],
      seed: () => ChatMessagePart[],
      opts: {
        sync?: boolean
        pending?: (message: ChatMessage) => boolean
      } = {}
    ) => {
      const apply = () => {
        updateSessionState(sessionId, state => {
          // After a stop, drop any late deltas / tool events for the
          // cancelled turn so they don't keep growing the (now finalized)
          // assistant bubble or, worse, seed a brand-new bubble that
          // appears to belong to the next user message.
          if (state.interrupted) {
            return state
          }

          const streamId = state.streamId ?? `assistant-stream-${Date.now()}`
          const groupId = state.pendingBranchGroup ?? undefined
          const prev = state.messages
          let nextMessages: ChatMessage[]

          if (!prev.some(m => m.id === streamId)) {
            nextMessages = [
              ...prev,
              {
                id: streamId,
                role: 'assistant',
                parts: seed(),
                pending: true,
                branchGroupId: groupId
              }
            ]
          } else {
            nextMessages = prev.map(m =>
              m.id === streamId
                ? {
                    ...m,
                    parts: transform(m.parts, m),
                    pending: opts.pending ? opts.pending(m) : true
                  }
                : m
            )
          }

          return {
            ...state,
            messages: nextMessages,
            streamId,
            sawAssistantPayload: true,
            awaitingResponse: false
          }
        })
      }

      opts.sync ? flushSync(apply) : apply()
    },
    [updateSessionState]
  )

  const appendAssistantDelta = useCallback(
    (sessionId: string, delta: string) => {
      if (!delta) {
        return
      }

      mutateStream(
        sessionId,
        parts => appendTextPart(parts, delta),
        () => [textPart(delta)],
        { sync: true }
      )
    },
    [mutateStream]
  )

  const appendReasoningDelta = useCallback(
    (sessionId: string, delta: string, replace = false) => {
      if (!delta) {
        return
      }

      mutateStream(
        sessionId,
        (parts, message) => {
          if (replace && chatMessageText(message).trim()) {
            return parts
          }

          if (replace) {
            return [...parts.filter(part => part.type !== 'reasoning'), reasoningPart(delta)]
          }

          return appendReasoningPart(parts, delta)
        },
        () => [reasoningPart(delta)],
        { sync: true }
      )
    },
    [mutateStream]
  )

  const upsertToolCall = useCallback(
    (sessionId: string, payload: GatewayEventPayload | undefined, phase: 'running' | 'complete') => {
      mutateStream(
        sessionId,
        parts => upsertToolPart(parts, payload, phase),
        () => upsertToolPart([], payload, phase),
        { pending: m => phase !== 'complete' || (m.pending ?? false) }
      )
    },
    [mutateStream]
  )

  const completeAssistantMessage = useCallback(
    (sessionId: string, text: string) => {
      let shouldHydrate = false

      const completedState = updateSessionState(sessionId, state => {
        // Late completion from an already-cancelled turn: cancelRun has
        // already finalized the bubble and added the [interrupted] marker;
        // re-running the dedupe below would erase that marker and replace
        // the partial with the (just-cancelled) full text.
        if (state.interrupted) {
          return state
        }

        const streamId = state.streamId
        const finalText = text.trim()
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
        const dedupeReference = normalize(finalText)

        const replaceTextPart = (parts: ChatMessagePart[]) => {
          const kept = parts.filter(part => {
            if (part.type === 'text') {
              return false
            }

            if (part.type !== 'reasoning' || !dedupeReference) {
              return true
            }

            const r = normalize(part.text)

            return !(r && (dedupeReference.startsWith(r) || r.startsWith(dedupeReference)))
          })

          return text ? [...kept, textPart(text)] : kept
        }

        const completeMessage = (message: ChatMessage): ChatMessage => ({
          ...message,
          parts: replaceTextPart(message.parts),
          pending: false
        })

        const prev = state.messages
        let nextMessages = prev

        if (streamId && prev.some(m => m.id === streamId)) {
          nextMessages = prev.map(m => (m.id === streamId ? completeMessage(m) : m))
        } else {
          const fallbackIndex = [...prev]
            .reverse()
            .findIndex(message => message.role === 'assistant' && !message.hidden)

          if (fallbackIndex >= 0) {
            const index = prev.length - 1 - fallbackIndex
            const existing = prev[index]
            const existingText = chatMessageText(existing).trim()

            if (existing.pending || (finalText && existingText === finalText)) {
              nextMessages = prev.map((message, messageIndex) =>
                messageIndex === index ? completeMessage(message) : message
              )
            } else if (text) {
              nextMessages = [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  parts: [textPart(text)],
                  branchGroupId: state.pendingBranchGroup ?? undefined
                }
              ]
            }
          } else if (text) {
            nextMessages = [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                parts: [textPart(text)],
                branchGroupId: state.pendingBranchGroup ?? undefined
              }
            ]
          }
        }

        shouldHydrate = !state.sawAssistantPayload || !finalText

        return {
          ...state,
          messages: nextMessages,
          streamId: null,
          pendingBranchGroup: null,
          awaitingResponse: false,
          busy: false
        }
      })

      void refreshSessions().catch(() => undefined)

      if (shouldHydrate) {
        void hydrateFromStoredSession(3, completedState.storedSessionId, sessionId)
      }

      if (document.hidden && sessionId === activeSessionIdRef.current) {
        void window.hermesDesktop?.notify({
          title: 'Hermes finished',
          body: text.slice(0, 140) || 'The response is ready.'
        })
      }
    },
    [activeSessionIdRef, hydrateFromStoredSession, refreshSessions, updateSessionState]
  )

  const handleGatewayEvent = useCallback(
    (event: RpcEvent) => {
      const payload = event.payload as GatewayEventPayload | undefined
      const explicitSid = event.session_id || ''
      const sessionId = explicitSid || activeSessionIdRef.current
      const isActiveEvent = !!sessionId && sessionId === activeSessionIdRef.current

      if (event.type === 'gateway.ready') {
        return
      } else if (event.type === 'session.info') {
        // Apply session-scoped fields when the event targets the active
        // session, OR when it's a global broadcast and we have no session.
        const apply = explicitSid ? isActiveEvent : !activeSessionIdRef.current
        const modelChanged = typeof payload?.model === 'string'
        const providerChanged = typeof payload?.provider === 'string'

        if (apply) {
          if (modelChanged) {
            setCurrentModel(payload!.model || '')
          }

          if (providerChanged) {
            setCurrentProvider(payload!.provider || '')
          }

          if (typeof payload?.cwd === 'string') {
            setCurrentCwd(payload.cwd)
          }

          if (typeof payload?.branch === 'string') {
            setCurrentBranch(payload.branch)
          }

          if (typeof payload?.personality === 'string') {
            setCurrentPersonality(normalizePersonalityValue(payload.personality))
          }
        }

        void refreshHermesConfig()

        if (modelChanged || providerChanged) {
          void queryClient.invalidateQueries({
            queryKey: explicitSid && sessionId ? ['model-options', sessionId] : ['model-options']
          })
        }
      } else if (event.type === 'message.start') {
        if (!sessionId) {
          return
        }

        updateSessionState(sessionId, state => ({
          ...state,
          busy: true,
          awaitingResponse: true,
          sawAssistantPayload: false,
          interrupted: false
        }))
      } else if (event.type === 'message.delta') {
        if (sessionId) {
          appendAssistantDelta(sessionId, coerceGatewayText(payload?.text))
        }
      } else if (event.type === 'thinking.delta') {
        if (sessionId) {
          appendReasoningDelta(sessionId, coerceThinkingText(payload?.text))
        }
      } else if (event.type === 'reasoning.delta') {
        if (sessionId) {
          appendReasoningDelta(sessionId, coerceGatewayText(payload?.text))
        }
      } else if (event.type === 'reasoning.available') {
        if (sessionId) {
          appendReasoningDelta(sessionId, coerceGatewayText(payload?.text), true)
        }
      } else if (event.type === 'message.complete') {
        if (!sessionId) {
          return
        }

        const finalText = coerceGatewayText(payload?.text) || coerceGatewayText(payload?.rendered)
        completeAssistantMessage(sessionId, finalText)
      } else if (event.type === 'tool.start' || event.type === 'tool.progress' || event.type === 'tool.generating') {
        if (!sessionId) {
          return
        }

        upsertToolCall(sessionId, payload, 'running')
      } else if (event.type === 'tool.complete') {
        if (sessionId) {
          upsertToolCall(sessionId, payload, 'complete')
        }
      } else if (event.type === 'error') {
        if (isActiveEvent) {
          notify({
            kind: 'error',
            title: 'Hermes error',
            message: payload?.message || 'Hermes reported an error'
          })
        }

        if (sessionId) {
          updateSessionState(sessionId, state => ({
            ...state,
            awaitingResponse: false,
            busy: false
          }))
        }
      }
    },
    [
      appendAssistantDelta,
      appendReasoningDelta,
      activeSessionIdRef,
      completeAssistantMessage,
      queryClient,
      refreshHermesConfig,
      updateSessionState,
      upsertToolCall
    ]
  )

  const startFreshSessionDraft = useCallback((replaceRoute = false) => {
    setCurrentView('chat')
    busyRef.current = false
    setBusy(false)
    setAwaitingResponse(false)
    clearNotifications()
    setIntroSeed(seed => seed + 1)
    writeRoute(NEW_CHAT_ROUTE, replaceRoute)
    setActiveSessionId(null)
    activeSessionIdRef.current = null
    setSelectedStoredSessionId(null)
    selectedStoredSessionIdRef.current = null
    setMessages([])
    clearComposerDraft()
    clearComposerAttachments()
    setFreshDraftReady(true)
  }, [activeSessionIdRef, selectedStoredSessionIdRef])

  const createBackendSessionForSend = useCallback(async (): Promise<string | null> => {
    const created = await requestGateway<SessionCreateResponse>('session.create', { cols: 96 })
    setActiveSessionId(created.session_id)
    activeSessionIdRef.current = created.session_id
    ensureSessionState(created.session_id, created.stored_session_id ?? null)

    if (created.stored_session_id) {
      setSelectedStoredSessionId(created.stored_session_id)
      selectedStoredSessionIdRef.current = created.stored_session_id

      if (window.location.hash === NEW_CHAT_ROUTE) {
        writeSessionRoute(created.stored_session_id, true)
      }
    }

    if (created.info?.model) {
      setCurrentModel(created.info.model)
    }

    if (created.info?.provider) {
      setCurrentProvider(created.info.provider)
    }

    if (created.info?.cwd) {
      setCurrentCwd(created.info.cwd)
    }

    if (created.info?.branch) {
      setCurrentBranch(created.info.branch)
    }

    if (typeof created.info?.personality === 'string') {
      setCurrentPersonality(normalizePersonalityValue(created.info.personality))
    }

    return created.session_id
  }, [activeSessionIdRef, ensureSessionState, requestGateway, selectedStoredSessionIdRef])

  const selectSidebarItem = useCallback(
    (item: SidebarNavItem) => {
      if (item.action === 'new-session') {
        setCurrentView('chat')
        startFreshSessionDraft()

        return
      }

      if (item.route) {
        setCurrentView(item.id === 'skills' ? 'skills' : 'artifacts')
        writeRoute(item.route)
      }
    },
    [startFreshSessionDraft]
  )

  const openSettings = useCallback(() => {
    setCurrentView('settings')
    writeRoute(SETTINGS_ROUTE)
  }, [])

  const closeSettings = useCallback(() => {
    setCurrentView('chat')

    if (selectedStoredSessionId) {
      writeSessionRoute(selectedStoredSessionId)

      return
    }

    writeRoute(NEW_CHAT_ROUTE)
  }, [selectedStoredSessionId])

  const resumeSession = useCallback(
    async (storedSessionId: string, replaceRoute = false) => {
      const cachedRuntimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
      const cachedState = cachedRuntimeId && sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)

      if (cachedRuntimeId && cachedState) {
        setFreshDraftReady(false)
        clearNotifications()
        setSelectedStoredSessionId(storedSessionId)
        selectedStoredSessionIdRef.current = storedSessionId
        writeSessionRoute(storedSessionId, replaceRoute)
        setActiveSessionId(cachedRuntimeId)
        activeSessionIdRef.current = cachedRuntimeId
        syncSessionStateToView(cachedRuntimeId, cachedState)
        clearComposerDraft()
        clearComposerAttachments()

        return
      }

      setFreshDraftReady(false)
      setBusy(true)
      setAwaitingResponse(false)
      clearNotifications()
      setSelectedStoredSessionId(storedSessionId)
      selectedStoredSessionIdRef.current = storedSessionId
      writeSessionRoute(storedSessionId, replaceRoute)

      try {
        const resumed = await requestGateway<SessionResumeResponse>('session.resume', {
          session_id: storedSessionId,
          cols: 96
        })

        setActiveSessionId(resumed.session_id)
        activeSessionIdRef.current = resumed.session_id
        updateSessionState(
          resumed.session_id,
          state => ({
            ...state,
            messages: toChatMessages(resumed.messages),
            busy: false,
            awaitingResponse: false
          }),
          storedSessionId
        )
        clearComposerDraft()
        clearComposerAttachments()

        if (resumed.info?.model) {
          setCurrentModel(resumed.info.model)
        }

        if (resumed.info?.provider) {
          setCurrentProvider(resumed.info.provider)
        }

        if (resumed.info?.cwd) {
          setCurrentCwd(resumed.info.cwd)
        }

        setCurrentBranch(resumed.info?.branch || '')

        if (typeof resumed.info?.personality === 'string') {
          setCurrentPersonality(normalizePersonalityValue(resumed.info.personality))
        }
      } catch (err) {
        const fallback = await getSessionMessages(storedSessionId)
        setMessages(toChatMessages(fallback.messages))
        notifyError(err, 'Resume failed')
      } finally {
        busyRef.current = false
        setBusy(false)
        setAwaitingResponse(false)
      }
    },
    [
      activeSessionIdRef,
      requestGateway,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      syncSessionStateToView,
      updateSessionState
    ]
  )

  const removeSession = useCallback(
    async (storedSessionId: string) => {
      clearNotifications()
      const removed = $sessions.get().find(s => s.id === storedSessionId)
      const wasSelected = selectedStoredSessionId === storedSessionId
      const previousMessages = $messages.get()
      const previousPinnedSessionIds = $pinnedSessionIds.get()

      setSessions(prev => prev.filter(s => s.id !== storedSessionId))
      $pinnedSessionIds.set(previousPinnedSessionIds.filter(id => id !== storedSessionId))

      if (wasSelected) {
        setSelectedStoredSessionId(null)
        selectedStoredSessionIdRef.current = null
        setMessages([])
      }

      try {
        if (wasSelected && activeSessionId) {
          await requestGateway('session.close', {
            session_id: activeSessionId
          }).catch(() => undefined)
        }

        await deleteSession(storedSessionId)

        if (wasSelected) {
          startFreshSessionDraft()
        }
      } catch (err) {
        if (removed) {
          setSessions(prev => [removed, ...prev])
        }

        $pinnedSessionIds.set(previousPinnedSessionIds)

        if (wasSelected) {
          setSelectedStoredSessionId(storedSessionId)
          selectedStoredSessionIdRef.current = storedSessionId
          setMessages(previousMessages)
        }

        notifyError(err, 'Delete failed')
      }
    },
    [
      activeSessionId,
      selectedStoredSessionId,
      selectedStoredSessionIdRef,
      startFreshSessionDraft,
      requestGateway
    ]
  )

  const appendSessionTextMessage = useCallback(
    (sessionId: string, role: ChatMessage['role'], text: string) => {
      const body = text.trim()

      if (!body) {
        return
      }

      updateSessionState(
        sessionId,
        state => ({
          ...state,
          messages: [
            ...state.messages,
            {
              id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role,
              parts: [textPart(body)]
            }
          ]
        }),
        selectedStoredSessionIdRef.current
      )
    },
    [selectedStoredSessionIdRef, updateSessionState]
  )

  const submitPromptText = useCallback(
    async (rawText: string) => {
      const visibleText = rawText.trim()
      const attachments = $composerAttachments.get()

      const contextRefs = attachments
        .map(attachment => attachment.refText)
        .filter(Boolean)
        .join('\n')

      const hasImageAttachment = attachments.some(attachment => attachment.kind === 'image')
      const displayRefs = attachments.map(attachmentDisplayText).filter(Boolean).join('\n')

      const text =
        [contextRefs, visibleText].filter(Boolean).join('\n\n') ||
        (hasImageAttachment ? 'What do you see in this image?' : '')

      if (!text || busyRef.current) {
        return
      }

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        parts: [
          textPart(
            [displayRefs, visibleText].filter(Boolean).join('\n\n') ||
              attachments.map(attachment => attachment.label).join(', ')
          )
        ]
      }

      busyRef.current = true
      setBusy(true)
      setAwaitingResponse(true)
      clearNotifications()
      const sessionId = activeSessionId ? activeSessionId : await createBackendSessionForSend()

      if (!sessionId) {
        busyRef.current = false
        setBusy(false)
        setAwaitingResponse(false)
        notify({
          kind: 'error',
          title: 'Session unavailable',
          message: 'Could not create a new session'
        })

        return
      }

      updateSessionState(
        sessionId,
        state => ({
          ...state,
          messages: [...state.messages, userMessage],
          busy: true,
          awaitingResponse: true,
          pendingBranchGroup: null,
          sawAssistantPayload: false,
          interrupted: false
        }),
        selectedStoredSessionIdRef.current
      )

      try {
        await requestGateway('prompt.submit', {
          session_id: sessionId,
          text
        })
        clearComposerAttachments()
      } catch (err) {
        busyRef.current = false
        updateSessionState(sessionId, state => ({
          ...state,
          messages: state.messages.filter(message => message.id !== userMessage.id),
          busy: false,
          awaitingResponse: false
        }))
        notifyError(err, 'Prompt failed')
      }
    },
    [activeSessionId, createBackendSessionForSend, requestGateway, selectedStoredSessionIdRef, updateSessionState]
  )

  const executeSlashCommand = useCallback(
    async (rawCommand: string, options?: { sessionId?: string; recordInput?: boolean }) => {
      const runSlash = async (commandText: string, sessionHint?: string, recordInput = true): Promise<void> => {
        const command = commandText.trim()
        const { name, arg } = parseSlashCommand(command)
        const sessionId = sessionHint || activeSessionIdRef.current || (await createBackendSessionForSend())

        if (!sessionId) {
          notify({
            kind: 'error',
            title: 'Session unavailable',
            message: 'Could not create a new session'
          })

          return
        }

        const renderSlashOutput = (text: string) => appendSessionTextMessage(sessionId, 'system', text)

        if (recordInput) {
          appendSessionTextMessage(sessionId, 'user', command)
        }

        if (!name) {
          renderSlashOutput('empty slash command')

          return
        }

        try {
          const result = await requestGateway<SlashExecResponse>('slash.exec', {
            session_id: sessionId,
            command: command.replace(/^\/+/, '')
          })

          const body = result?.output || `/${name}: no output`
          renderSlashOutput(result?.warning ? `warning: ${result.warning}\n${body}` : body)

          return
        } catch {
          // Fall back to command.dispatch for skill/send/alias directives.
        }

        try {
          const dispatch = parseCommandDispatch(
            await requestGateway<unknown>('command.dispatch', {
              session_id: sessionId,
              name,
              arg
            })
          )

          if (!dispatch) {
            renderSlashOutput('error: invalid response: command.dispatch')

            return
          }

          if (dispatch.type === 'exec' || dispatch.type === 'plugin') {
            renderSlashOutput(dispatch.output ?? '(no output)')

            return
          }

          if (dispatch.type === 'alias') {
            await runSlash(`/${dispatch.target}${arg ? ` ${arg}` : ''}`, sessionId, false)

            return
          }

          const message = ('message' in dispatch ? dispatch.message : '')?.trim() ?? ''

          if (!message) {
            renderSlashOutput(
              `/${name}: ${dispatch.type === 'skill' ? 'skill payload missing message' : 'empty message'}`
            )

            return
          }

          if (dispatch.type === 'skill') {
            renderSlashOutput(`⚡ loading skill: ${dispatch.name}`)
          }

          if (busyRef.current) {
            renderSlashOutput('session busy — /interrupt the current turn before sending this command')

            return
          }

          await submitPromptText(message)
        } catch (err) {
          renderSlashOutput(`error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      await runSlash(rawCommand, options?.sessionId, options?.recordInput ?? true)
    },
    [activeSessionIdRef, appendSessionTextMessage, createBackendSessionForSend, requestGateway, submitPromptText]
  )

  const submitText = useCallback(
    async (rawText: string) => {
      const visibleText = rawText.trim()
      const attachments = $composerAttachments.get()

      if (!attachments.length && SLASH_COMMAND_RE.test(visibleText)) {
        await executeSlashCommand(visibleText)

        return
      }

      await submitPromptText(rawText)
    },
    [executeSlashCommand, submitPromptText]
  )

  const cancelRun = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

    // Mark the session interrupted *before* we await the server: any deltas
    // that race the interrupt round-trip are dropped via the gate in
    // `mutateStream`/`completeAssistantMessage`, and the in-flight bubble
    // freezes immediately at whatever it had streamed.
    updateSessionState(activeSessionId, state => {
      const streamId = state.streamId

      const messages = streamId
        ? state.messages.map(message =>
            message.id === streamId
              ? {
                  ...message,
                  parts: chatMessageText(message).trim()
                    ? appendTextPart(message.parts, INTERRUPTED_MARKER)
                    : [...message.parts, textPart(INTERRUPTED_MARKER.trim())],
                  pending: false
                }
              : message
          )
        : state.messages

      return {
        ...state,
        messages,
        busy: false,
        awaitingResponse: false,
        streamId: null,
        pendingBranchGroup: null,
        interrupted: true
      }
    })

    try {
      await requestGateway('session.interrupt', {
        session_id: activeSessionId
      })
    } catch (err) {
      notifyError(err, 'Stop failed')
    }
  }, [activeSessionId, requestGateway, updateSessionState])

  const reloadFromMessage = useCallback(
    async (parentId: string | null) => {
      if (!activeSessionId || $busy.get()) {
        return
      }

      const messages = $messages.get()
      const parentIndex = parentId ? messages.findIndex(message => message.id === parentId) : messages.length - 1

      const userIndex =
        parentIndex >= 0
          ? [...messages.slice(0, parentIndex + 1)].reverse().findIndex(message => message.role === 'user')
          : -1

      if (userIndex < 0) {
        return
      }

      const absoluteUserIndex = parentIndex - userIndex
      const userMessage = messages[absoluteUserIndex]
      const userText = userMessage ? chatMessageText(userMessage).trim() : ''

      if (!userText) {
        return
      }

      const targetAssistant =
        parentId && messages[parentIndex]?.role === 'assistant'
          ? messages[parentIndex]
          : messages.slice(absoluteUserIndex + 1).find(message => message.role === 'assistant')

      const branchGroupId = targetAssistant?.branchGroupId ?? branchGroupForUser(userMessage)

      clearNotifications()
      updateSessionState(activeSessionId, state => {
        const nextUserIndex = state.messages.findIndex(
          (message, index) => index > absoluteUserIndex && message.role === 'user'
        )

        const end = nextUserIndex < 0 ? state.messages.length : nextUserIndex

        return {
          ...state,
          busy: true,
          awaitingResponse: true,
          pendingBranchGroup: branchGroupId,
          sawAssistantPayload: false,
          interrupted: false,
          messages: [
            ...state.messages.slice(0, absoluteUserIndex + 1),
            ...state.messages
              .slice(absoluteUserIndex + 1, end)
              .map(message => (message.role === 'assistant' ? { ...message, branchGroupId, hidden: true } : message))
          ]
        }
      })

      try {
        await requestGateway('prompt.submit', {
          session_id: activeSessionId,
          text: userText
        })
      } catch (err) {
        updateSessionState(activeSessionId, state => ({
          ...state,
          busy: false,
          awaitingResponse: false
        }))
        notifyError(err, 'Regenerate failed')
      }
    },
    [activeSessionId, requestGateway, updateSessionState]
  )

  const handleThreadMessagesChange = useCallback(
    (nextMessages: readonly ThreadMessage[]) => {
      const visibleIds = new Set(nextMessages.map(message => message.id))
      const sessionId = activeSessionIdRef.current

      if (!sessionId) {
        return
      }

      updateSessionState(sessionId, state => ({
        ...state,
        messages: state.messages.map(message =>
          message.role === 'assistant' && message.branchGroupId
            ? { ...message, hidden: !visibleIds.has(message.id) }
            : message
        )
      }))
    },
    [activeSessionIdRef, updateSessionState]
  )

  useEffect(() => {
    let cancelled = false
    const desktop = window.hermesDesktop

    if (!desktop) {
      setSessionsLoading(false)

      return () => void (cancelled = true)
    }

    const gateway = new HermesGateway()
    gatewayRef.current = gateway

    const offState = gateway.onState(st => void setGatewayState(st))

    const offEvent = gateway.onEvent(handleGatewayEvent)

    const offExit = desktop.onBackendExit(() => {
      notify({
        kind: 'error',
        title: 'Backend stopped',
        message: 'Hermes background process exited.',
        durationMs: 0
      })
    })

    async function boot() {
      try {
        const conn = await desktop.getConnection()

        if (cancelled) {
          return
        }

        connectionRef.current = conn
        setConnection(conn)
        await gateway.connect(conn.wsUrl)

        if (cancelled) {
          return
        }

        await refreshHermesConfig()

        if (cancelled) {
          return
        }

        await refreshSessions()

        if (cancelled) {
          return
        }

        const routedSessionId = routeSessionId()
        const routedView = currentAppView()
        setCurrentView(routedView)

        if (routedSessionId) {
          await resumeSession(routedSessionId, true)
        } else if (routedView !== 'chat') {
          return
        } else {
          startFreshSessionDraft(true)
        }
      } catch (err) {
        if (!cancelled) {
          notifyError(err, 'Desktop boot failed')
          setSessionsLoading(false)
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
      offState()
      offEvent()
      offExit()
      gateway.close()
    }
  }, [handleGatewayEvent, refreshHermesConfig, refreshSessions, resumeSession, startFreshSessionDraft])

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
    const handleRouteChange = () => {
      const nextView = currentAppView()
      setCurrentView(nextView)

      if (nextView !== 'chat') {
        return
      }

      const routedSessionId = routeSessionId()

      if (routedSessionId) {
        if (
          routedSessionId !== selectedStoredSessionId &&
          routedSessionId !== selectedStoredSessionIdRef.current &&
          routedSessionId !== activeSessionIdRef.current
        ) {
          void resumeSession(routedSessionId, true)
        }
      } else if (window.location.hash === NEW_CHAT_ROUTE && selectedStoredSessionId) {
        startFreshSessionDraft(true)
      }
    }

    window.addEventListener('hashchange', handleRouteChange)
    window.addEventListener('popstate', handleRouteChange)

    return () => {
      window.removeEventListener('hashchange', handleRouteChange)
      window.removeEventListener('popstate', handleRouteChange)
    }
  }, [activeSessionIdRef, resumeSession, selectedStoredSessionId, selectedStoredSessionIdRef, startFreshSessionDraft])

  const sidebar = (
    <ChatSidebar
      currentView={currentView}
      onDeleteSession={sessionId => void removeSession(sessionId)}
      onNavigate={selectSidebarItem}
      onRefreshSessions={() => void refreshSessions()}
      onResumeSession={sessionId => void resumeSession(sessionId)}
    />
  )

  const overlays = (
    <>
      <ModelPickerOverlay gateway={gatewayRef.current || undefined} onSelect={selectModel} />

      {settingsOpen && (
        <SettingsView
          onClose={closeSettings}
          onConfigSaved={() => {
            void refreshHermesConfig()
            void refreshCurrentModel()
            void queryClient.invalidateQueries({ queryKey: ['model-options'] })
          }}
        />
      )}
    </>
  )

  return (
    <AppShell
      inspectorWidth={SESSION_INSPECTOR_WIDTH}
      onOpenSettings={openSettings}
      overlays={overlays}
      rightRailOpen={chatOpen}
      settingsOpen={settingsOpen}
      sidebar={sidebar}
    >
      {currentView === 'chat' && (
        <ChatView
          gateway={gatewayRef.current}
          onAddContextRef={addContextRefAttachment}
          onAddUrl={url => addContextRefAttachment(`@url:${url}`, url)}
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
          onSubmit={text => void submitText(text)}
          onThreadMessagesChange={handleThreadMessagesChange}
          onToggleSelectedPin={toggleSelectedPin}
        />
      )}
      {currentView === 'skills' && <SkillsView />}
      {currentView === 'artifacts' && <ArtifactsView />}
    </AppShell>
  )
}
