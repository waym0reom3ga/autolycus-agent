import type { MutableRefObject } from 'react'
import { useCallback, useRef } from 'react'
import type { NavigateFunction } from 'react-router-dom'

import { deleteSession, getSessionMessages } from '@/hermes'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { normalizePersonalityValue } from '@/lib/chat-runtime'
import { clearComposerAttachments, clearComposerDraft } from '@/store/composer'
import { $pinnedSessionIds } from '@/store/layout'
import { clearNotifications, notify, notifyError } from '@/store/notifications'
import {
  $messages,
  $sessions,
  setActiveSessionId,
  setAwaitingResponse,
  setBusy,
  setCurrentBranch,
  setCurrentCwd,
  setCurrentModel,
  setCurrentPersonality,
  setCurrentProvider,
  setFreshDraftReady,
  setIntroSeed,
  setMessages,
  setSelectedStoredSessionId,
  setSessions
} from '@/store/session'
import type { SessionCreateResponse, SessionResumeResponse } from '@/types/hermes'

import { NEW_CHAT_ROUTE, sessionRoute, SETTINGS_ROUTE } from '../../routes'
import type { ClientSessionState, SidebarNavItem } from '../../types'

interface SessionActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  busyRef: MutableRefObject<boolean>
  ensureSessionState: (sessionId: string, storedSessionId?: string | null) => ClientSessionState
  navigate: NavigateFunction
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>>
  selectedStoredSessionId: string | null
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>>
  syncSessionStateToView: (sessionId: string, state: ClientSessionState) => void
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

export function useSessionActions({
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
}: SessionActionsOptions) {
  const resumeRequestRef = useRef(0)

  const startFreshSessionDraft = useCallback(
    (replaceRoute = false) => {
      busyRef.current = false
      setBusy(false)
      setAwaitingResponse(false)
      clearNotifications()
      setIntroSeed(seed => seed + 1)
      navigate(NEW_CHAT_ROUTE, { replace: replaceRoute })
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      setSelectedStoredSessionId(null)
      selectedStoredSessionIdRef.current = null
      setMessages([])
      clearComposerDraft()
      clearComposerAttachments()
      setFreshDraftReady(true)
    },
    [activeSessionIdRef, busyRef, navigate, selectedStoredSessionIdRef]
  )

  const createBackendSessionForSend = useCallback(async (): Promise<string | null> => {
    const created = await requestGateway<SessionCreateResponse>('session.create', { cols: 96 })
    setActiveSessionId(created.session_id)
    activeSessionIdRef.current = created.session_id
    ensureSessionState(created.session_id, created.stored_session_id ?? null)

    if (created.stored_session_id) {
      setSelectedStoredSessionId(created.stored_session_id)
      selectedStoredSessionIdRef.current = created.stored_session_id
      navigate(sessionRoute(created.stored_session_id), { replace: true })
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
  }, [activeSessionIdRef, ensureSessionState, navigate, requestGateway, selectedStoredSessionIdRef])

  const selectSidebarItem = useCallback(
    (item: SidebarNavItem) => {
      if (item.action === 'new-session') {
        startFreshSessionDraft()

        return
      }

      if (item.route) {
        navigate(item.route)
      }
    },
    [navigate, startFreshSessionDraft]
  )

  const openSettings = useCallback(() => {
    navigate(SETTINGS_ROUTE)
  }, [navigate])

  const closeSettings = useCallback(() => {
    if (selectedStoredSessionId) {
      navigate(sessionRoute(selectedStoredSessionId))

      return
    }

    navigate(NEW_CHAT_ROUTE)
  }, [navigate, selectedStoredSessionId])

  const resumeSession = useCallback(
    async (storedSessionId: string, replaceRoute = false) => {
      const requestId = resumeRequestRef.current + 1
      resumeRequestRef.current = requestId

      const isCurrentResume = () =>
        resumeRequestRef.current === requestId && selectedStoredSessionIdRef.current === storedSessionId

      const cachedRuntimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
      const cachedState = cachedRuntimeId && sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)

      if (cachedRuntimeId && cachedState) {
        setFreshDraftReady(false)
        clearNotifications()
        setSelectedStoredSessionId(storedSessionId)
        selectedStoredSessionIdRef.current = storedSessionId
        setActiveSessionId(cachedRuntimeId)
        activeSessionIdRef.current = cachedRuntimeId
        syncSessionStateToView(cachedRuntimeId, cachedState)
        clearComposerDraft()
        clearComposerAttachments()

        return
      }

      setFreshDraftReady(false)
      setActiveSessionId(null)
      activeSessionIdRef.current = null
      busyRef.current = true
      setBusy(true)
      setAwaitingResponse(false)
      clearNotifications()
      setSelectedStoredSessionId(storedSessionId)
      selectedStoredSessionIdRef.current = storedSessionId
      setMessages([])

      try {
        let resumeApplied = false

        const storedMessagesPromise = getSessionMessages(storedSessionId)
          .then(storedMessages => {
            if (!resumeApplied && isCurrentResume()) {
              setMessages(toChatMessages(storedMessages.messages))
            }
          })
          .catch(() => undefined)

        const resumePromise = requestGateway<SessionResumeResponse>('session.resume', {
          session_id: storedSessionId,
          cols: 96
        })

        void storedMessagesPromise

        const resumed = await resumePromise

        resumeApplied = true

        if (!isCurrentResume()) {
          return
        }

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
        if (!isCurrentResume()) {
          return
        }

        const fallback = await getSessionMessages(storedSessionId)

        if (!isCurrentResume()) {
          return
        }

        setMessages(toChatMessages(fallback.messages))
        notifyError(err, 'Resume failed')
      } finally {
        if (isCurrentResume()) {
          busyRef.current = false
          setBusy(false)
          setAwaitingResponse(false)
        }
      }
    },
    [
      activeSessionIdRef,
      busyRef,
      requestGateway,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      syncSessionStateToView,
      updateSessionState
    ]
  )

  const branchCurrentSession = useCallback(async (messageId?: string): Promise<boolean> => {
    const sourceSessionId = activeSessionIdRef.current

    if (!sourceSessionId) {
      notify({
        kind: 'warning',
        title: 'Nothing to branch',
        message: 'Start or resume a chat before branching.'
      })

      return false
    }

    if (busyRef.current) {
      notify({
        kind: 'warning',
        title: 'Session busy',
        message: 'Stop the current turn before branching this chat.'
      })

      return false
    }

    try {
      const currentMessages = $messages.get()
      const targetIndex = messageId ? currentMessages.findIndex(message => message.id === messageId) : -1
      const branchStart = targetIndex >= 0 ? targetIndex : Math.max(currentMessages.length - 1, 0)
      const branchEnd = targetIndex >= 0 ? targetIndex + 1 : currentMessages.length

      const branchMessages = currentMessages
        .slice(branchStart, branchEnd)
        .map(message => ({
          content: chatMessageText(message),
          source: message,
          role: message.role
        }))
        .filter(message => message.content.trim() && ['assistant', 'system', 'user'].includes(message.role))

      if (!branchMessages.length) {
        notify({
          kind: 'warning',
          title: 'Nothing to branch',
          message: 'This message has no text to branch from.'
        })

        return false
      }

      clearNotifications()

      const branched = await requestGateway<SessionCreateResponse>('session.create', {
        cols: 96,
        messages: branchMessages.map(({ content, role }) => ({ content, role })),
        title: 'Branch'
      })

      const routedSessionId = branched.stored_session_id ?? branched.session_id

      setFreshDraftReady(false)
      ensureSessionState(branched.session_id, routedSessionId)
      setActiveSessionId(branched.session_id)
      activeSessionIdRef.current = branched.session_id
      updateSessionState(
        branched.session_id,
        state => ({
          ...state,
          messages: branchMessages.map(({ source }) => source),
          busy: false,
          awaitingResponse: false
        }),
        routedSessionId
      )
      setSelectedStoredSessionId(routedSessionId)
      selectedStoredSessionIdRef.current = routedSessionId
      navigate(sessionRoute(routedSessionId))

      clearComposerDraft()
      clearComposerAttachments()

      if (branched.info?.model) {
        setCurrentModel(branched.info.model)
      }

      if (branched.info?.provider) {
        setCurrentProvider(branched.info.provider)
      }

      if (branched.info?.cwd) {
        setCurrentCwd(branched.info.cwd)
      }

      setCurrentBranch(branched.info?.branch || '')

      if (typeof branched.info?.personality === 'string') {
        setCurrentPersonality(normalizePersonalityValue(branched.info.personality))
      }

      return true
    } catch (err) {
      notifyError(err, 'Branch failed')

      return false
    }
  }, [activeSessionIdRef, busyRef, ensureSessionState, navigate, requestGateway, selectedStoredSessionIdRef, updateSessionState])

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
    [activeSessionId, selectedStoredSessionId, selectedStoredSessionIdRef, startFreshSessionDraft, requestGateway]
  )

  return {
    branchCurrentSession,
    closeSettings,
    createBackendSessionForSend,
    openSettings,
    removeSession,
    resumeSession,
    selectSidebarItem,
    startFreshSessionDraft
  }
}
