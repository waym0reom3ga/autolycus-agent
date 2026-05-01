import { useCallback, useEffect, useRef, useState } from 'react'

import { speakText } from '@/hermes'
import { notify, notifyError } from '@/store/notifications'

import {
  CONVERSATION_IDLE_SILENCE_MS,
  CONVERSATION_MAX_TURN_SECONDS,
  CONVERSATION_POST_SPEECH_SILENCE_MS,
  CONVERSATION_SPEECH_LEVEL
} from '../constants'

import { useMicRecorder } from './use-mic-recorder'

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface VoiceConversationOptions {
  busy: boolean
  enabled: boolean
  onFatalError?: () => void
  onSubmit: (text: string) => void
  onTranscribeAudio?: (audio: Blob) => Promise<string>
  pendingResponseText: () => string | null
  consumePendingResponse: () => void
}

export function useVoiceConversation({
  busy,
  enabled,
  onFatalError,
  onSubmit,
  onTranscribeAudio,
  pendingResponseText,
  consumePendingResponse
}: VoiceConversationOptions) {
  const { handle, level } = useMicRecorder()
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [muted, setMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const turnTimeoutRef = useRef<number | null>(null)
  const pendingStartRef = useRef(false)
  const lastSpokenRef = useRef<string | null>(null)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(muted)
  const busyRef = useRef(busy)
  const statusRef = useRef<ConversationStatus>('idle')
  const wasEnabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const clearTurnTimeout = () => {
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current)
      turnTimeoutRef.current = null
    }
  }

  const stopAudio = useCallback(() => {
    const audio = audioRef.current

    if (audio) {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [])

  const handleTurn = useCallback(async () => {
    clearTurnTimeout()
    setStatus('transcribing')
    const result = await handle.stop()

    if (!result || !result.heardSpeech || !onTranscribeAudio) {
      if (enabledRef.current && !mutedRef.current && !busyRef.current && statusRef.current !== 'speaking') {
        pendingStartRef.current = true
      }

      setStatus('idle')

      return
    }

    try {
      const transcript = (await onTranscribeAudio(result.audio)).trim()

      if (!transcript) {
        if (enabledRef.current) {
          pendingStartRef.current = true
        }

        setStatus('idle')

        return
      }

      onSubmit(transcript)
      setStatus('thinking')
    } catch (error) {
      notifyError(error, 'Voice transcription failed')

      if (enabledRef.current && !mutedRef.current && !busyRef.current) {
        pendingStartRef.current = true
      }

      setStatus('idle')
    }
  }, [handle, onSubmit, onTranscribeAudio])

  const startListening = useCallback(async () => {
    pendingStartRef.current = false

    if (!enabledRef.current || mutedRef.current || busyRef.current) {
      return
    }

    if (statusRef.current !== 'idle') {
      return
    }

    try {
      await handle.start({
        silenceLevel: CONVERSATION_SPEECH_LEVEL,
        silenceMs: CONVERSATION_POST_SPEECH_SILENCE_MS,
        idleSilenceMs: CONVERSATION_IDLE_SILENCE_MS,
        onError: error => {
          notifyError(error, 'Microphone failed')
          pendingStartRef.current = false
          onFatalError?.()
        },
        onSilence: () => void handleTurn()
      })
      setStatus('listening')
      turnTimeoutRef.current = window.setTimeout(
        () => void handleTurn(),
        CONVERSATION_MAX_TURN_SECONDS * 1000
      )
    } catch (error) {
      notifyError(error, 'Could not start voice session')
      pendingStartRef.current = false
      setStatus('idle')
      onFatalError?.()
    }
  }, [handle, handleTurn, onFatalError])

  const speak = useCallback(
    async (text: string) => {
      stopAudio()
      setStatus('speaking')

      try {
        const response = await speakText(text)
        const audio = new Audio(response.data_url)
        audioRef.current = audio

        await new Promise<void>((resolve, reject) => {
          audio.addEventListener('ended', () => resolve(), { once: true })
          audio.addEventListener('error', () => reject(new Error('Playback failed')), { once: true })
          void audio.play().catch(reject)
        })
      } catch (error) {
        notifyError(error, 'Voice playback failed')
      } finally {
        audioRef.current = null

        if (enabledRef.current) {
          pendingStartRef.current = true
          setStatus('idle')
        } else {
          setStatus('idle')
        }
      }
    },
    [stopAudio]
  )

  const start = useCallback(async () => {
    if (!onTranscribeAudio) {
      notify({
        kind: 'warning',
        title: 'Voice unavailable',
        message: 'Configure speech-to-text to use voice mode.'
      })
      onFatalError?.()

      return
    }

    setMuted(false)
    lastSpokenRef.current = null
    pendingStartRef.current = true
  }, [onFatalError, onTranscribeAudio])

  const end = useCallback(async () => {
    pendingStartRef.current = false
    clearTurnTimeout()
    stopAudio()
    handle.cancel()
    lastSpokenRef.current = null
    consumePendingResponse()
    setMuted(false)
    setStatus('idle')
  }, [consumePendingResponse, handle, stopAudio])

  const toggleMute = useCallback(() => {
    setMuted(value => {
      const next = !value

      if (next) {
        clearTurnTimeout()
        handle.cancel()
        setStatus('idle')
      } else if (enabledRef.current && !busyRef.current && statusRef.current === 'idle') {
        pendingStartRef.current = true
      }

      return next
    })
  }, [handle])

  // Drive the loop: speak any new assistant response, otherwise start listening
  // when the agent is idle and we're between turns.
  useEffect(() => {
    if (!enabled || muted) {
      return
    }

    const text = pendingResponseText()
    const trimmed = text?.trim() ?? ''

    if (trimmed && trimmed !== lastSpokenRef.current && status !== 'speaking') {
      lastSpokenRef.current = trimmed
      consumePendingResponse()
      void speak(trimmed)

      return
    }

    if (busy || status !== 'idle') {
      return
    }

    if (pendingStartRef.current) {
      void startListening()
    }
  }, [busy, consumePendingResponse, enabled, muted, pendingResponseText, speak, startListening, status])

  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      void start()
    }

    if (!enabled && wasEnabledRef.current) {
      void end()
    }

    wasEnabledRef.current = enabled
  }, [enabled, end, start])

  return { end, level, muted, start, status, toggleMute }
}
