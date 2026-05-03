import type { QueryClient } from '@tanstack/react-query'
import { type MutableRefObject, useCallback } from 'react'

import {
  appendAssistantTextPart,
  appendReasoningPart,
  assistantTextPart,
  type ChatMessage,
  type ChatMessagePart,
  chatMessageText,
  type GatewayEventPayload,
  reasoningPart,
  renderMediaTags,
  upsertToolPart
} from '@/lib/chat-messages'
import { coerceGatewayText, coerceThinkingText, normalizePersonalityValue } from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import { setClarifyRequest } from '@/store/clarify'
import { notify } from '@/store/notifications'
import {
  setCurrentBranch,
  setCurrentCwd,
  setCurrentFastMode,
  setCurrentModel,
  setCurrentPersonality,
  setCurrentProvider,
  setCurrentReasoningEffort,
  setCurrentServiceTier
} from '@/store/session'
import { recordToolDiff } from '@/store/tool-diffs'
import type { RpcEvent } from '@/types/hermes'

import type { ClientSessionState } from '../../types'

interface MessageStreamOptions {
  activeSessionIdRef: MutableRefObject<string | null>
  hydrateFromStoredSession: (
    attempts?: number,
    storedSessionId?: string | null,
    runtimeSessionId?: string | null
  ) => Promise<void>
  queryClient: QueryClient
  refreshHermesConfig: () => Promise<void>
  refreshSessions: () => Promise<void>
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

export function useMessageStream({
  activeSessionIdRef,
  hydrateFromStoredSession,
  queryClient,
  refreshHermesConfig,
  refreshSessions,
  updateSessionState
}: MessageStreamOptions) {
  // Patch the in-flight assistant message (or seed it). Centralises the
  // streamId/groupId bookkeeping every event callback would otherwise repeat.
  const mutateStream = useCallback(
    (
      sessionId: string,
      transform: (parts: ChatMessagePart[], message: ChatMessage) => ChatMessagePart[],
      seed: () => ChatMessagePart[],
      opts: {
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

      apply()
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
        parts => appendAssistantTextPart(parts, delta),
        () => [assistantTextPart(delta)]
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
        () => [reasoningPart(delta)]
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
        const finalText = renderMediaTags(text).trim()
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

          return finalText ? [...kept, assistantTextPart(finalText)] : kept
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
            } else if (finalText) {
              nextMessages = [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  parts: [assistantTextPart(finalText)],
                  branchGroupId: state.pendingBranchGroup ?? undefined
                }
              ]
            }
          } else if (finalText) {
            nextMessages = [
              ...prev,
              {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                parts: [assistantTextPart(finalText)],
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
        const runningChanged = typeof payload?.running === 'boolean'

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

          if (typeof payload?.reasoning_effort === 'string') {
            setCurrentReasoningEffort(payload.reasoning_effort)
          }

          if (typeof payload?.service_tier === 'string') {
            setCurrentServiceTier(payload.service_tier)
          }

          if (typeof payload?.fast === 'boolean') {
            setCurrentFastMode(payload.fast)
          }

          if (runningChanged && sessionId) {
            updateSessionState(sessionId, state => {
              const busy = Boolean(payload!.running)

              if (state.busy === busy && (busy || !state.awaitingResponse)) {
                return state
              }

              if (busy) {
                return {
                  ...state,
                  busy
                }
              }

              if (state.awaitingResponse && !state.sawAssistantPayload) {
                return state
              }

              return {
                ...state,
                awaitingResponse: false,
                busy,
                pendingBranchGroup: null,
                streamId: null
              }
            })
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

        if (isActiveEvent) {
          triggerHaptic('streamStart')
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
          appendReasoningDelta(sessionId, coerceThinkingText(payload?.text))
        }
      } else if (event.type === 'reasoning.available') {
        if (sessionId) {
          appendReasoningDelta(sessionId, coerceThinkingText(payload?.text), true)
        }
      } else if (event.type === 'message.complete') {
        if (!sessionId) {
          return
        }

        if (isActiveEvent) {
          triggerHaptic('streamDone')
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

        if (typeof payload?.inline_diff === 'string' && payload.inline_diff.trim()) {
          recordToolDiff(payload.tool_id || payload.name || '', payload.inline_diff)
        }
      } else if (event.type === 'clarify.request') {
        if (!isActiveEvent) {
          return
        }

        // Surface the clarify tool's overlay. The Python side is blocked on
        // `clarify.respond`, so without this handler the agent would hang
        // forever (see tools/clarify_tool.py + tui_gateway/server.py:_block).
        const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''
        const question = typeof payload?.question === 'string' ? payload.question : ''

        if (requestId && question) {
          setClarifyRequest({
            requestId,
            question,
            choices: Array.isArray(payload?.choices) ? payload!.choices!.filter(c => typeof c === 'string') : null,
            sessionId: sessionId ?? null
          })
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

  return {
    appendAssistantDelta,
    appendReasoningDelta,
    completeAssistantMessage,
    handleGatewayEvent,
    upsertToolCall
  }
}
