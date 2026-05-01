import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Thread } from './thread'

const createdAt = new Date('2026-05-01T00:00:00.000Z')

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', TestResizeObserver)

Element.prototype.scrollTo = function scrollTo() {}

async function wait(ms: number) {
  await act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, ms))
  })
}

function userMessage(): ThreadMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'Stream a response' }],
    attachments: [],
    createdAt,
    metadata: { custom: {} }
  } as ThreadMessage
}

function assistantMessage(text: string, running = true): ThreadMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function StreamingHarness() {
  const [messages, setMessages] = useState<ThreadMessage[]>([userMessage()])
  const [isRunning, setIsRunning] = useState(true)

  useEffect(() => {
    const first = window.setTimeout(() => {
      setMessages([userMessage(), assistantMessage('first chunk')])
    }, 50)

    const second = window.setTimeout(() => {
      setMessages([userMessage(), assistantMessage('first chunk second chunk')])
    }, 500)

    const complete = window.setTimeout(() => {
      setMessages([userMessage(), assistantMessage('first chunk second chunk', false)])
      setIsRunning(false)
    }, 700)

    return () => {
      window.clearTimeout(first)
      window.clearTimeout(second)
      window.clearTimeout(complete)
    }
  }, [])

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    isRunning,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread loading={isRunning && messages.at(-1)?.role !== 'assistant' ? 'response' : undefined} />
    </AssistantRuntimeProvider>
  )
}

describe('assistant-ui streaming renderer', () => {
  it('renders assistant text incrementally before completion', async () => {
    const { container } = render(<StreamingHarness />)

    expect(screen.getByRole('status', { name: 'Hermes is loading a response' })).toBeTruthy()

    await wait(80)

    await waitFor(() => {
      expect(container.textContent).toContain('first chunk')
    })
    expect(container.textContent).not.toContain('second chunk')
    expect(screen.queryByRole('status', { name: 'Hermes is loading a response' })).toBeNull()

    await wait(500)

    await waitFor(() => {
      expect(container.textContent).toContain('first chunk second chunk')
    })

    await wait(250)

    await waitFor(() => {
      expect(container.textContent).toContain('first chunk second chunk')
    })
  })
})
