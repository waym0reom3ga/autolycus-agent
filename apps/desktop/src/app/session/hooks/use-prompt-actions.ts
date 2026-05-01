import type { ThreadMessage } from '@assistant-ui/react'
import { type MutableRefObject, useCallback } from 'react'

import { transcribeAudio } from '@/hermes'
import { appendTextPart, branchGroupForUser, type ChatMessage, chatMessageText, textPart } from '@/lib/chat-messages'
import {
  attachmentDisplayText,
  INTERRUPTED_MARKER,
  parseCommandDispatch,
  parseSlashCommand,
  SLASH_COMMAND_RE
} from '@/lib/chat-runtime'
import { triggerHaptic } from '@/lib/haptics'
import { $composerAttachments, clearComposerAttachments } from '@/store/composer'
import { clearNotifications, notify, notifyError } from '@/store/notifications'
import { $busy, $messages, setAwaitingResponse, setBusy } from '@/store/session'

import type { ClientSessionState, SlashExecResponse } from '../../types'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read recorded audio'))
      }
    })
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read recorded audio')))
    reader.readAsDataURL(blob)
  })
}

interface PromptActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  busyRef: MutableRefObject<boolean>
  createBackendSessionForSend: () => Promise<string | null>
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  sttEnabled: boolean
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

export function usePromptActions({
  activeSessionId,
  activeSessionIdRef,
  busyRef,
  createBackendSessionForSend,
  requestGateway,
  selectedStoredSessionIdRef,
  sttEnabled,
  updateSessionState
}: PromptActionsOptions) {
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
        await requestGateway('prompt.submit', { session_id: sessionId, text })
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
        triggerHaptic('selection')
        await executeSlashCommand(visibleText)

        return
      }

      await submitPromptText(rawText)
    },
    [executeSlashCommand, submitPromptText]
  )

  const transcribeVoiceAudio = useCallback(
    async (audio: Blob) => {
      if (!sttEnabled) {
        throw new Error('Speech-to-text is disabled in settings.')
      }

      const dataUrl = await blobToDataUrl(audio)
      const result = await transcribeAudio(dataUrl, audio.type)

      return result.transcript
    },
    [sttEnabled]
  )

  const cancelRun = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

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
      await requestGateway('session.interrupt', { session_id: activeSessionId })
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
        await requestGateway('prompt.submit', { session_id: activeSessionId, text: userText })
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

  return { cancelRun, handleThreadMessagesChange, reloadFromMessage, submitText, transcribeVoiceAudio }
}
