import type { ChatMessage } from '@/lib/chat-messages'

export function lastVisibleMessageIsUser(messages: ChatMessage[]): boolean {
  const lastVisible = [...messages].reverse().find(message => !message.hidden)

  return lastVisible?.role === 'user'
}

export function threadLoadingState(
  loadingSession: boolean,
  busy: boolean,
  awaitingResponse: boolean,
  lastVisibleIsUser: boolean
) {
  if (loadingSession) {
    return 'session'
  }

  if (busy && awaitingResponse && lastVisibleIsUser) {
    return 'response'
  }

  return undefined
}
