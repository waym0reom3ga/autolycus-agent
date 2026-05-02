import {
  AssistantRuntimeProvider,
  ExportedMessageRepository,
  type ThreadMessage,
  useExternalStoreRuntime
} from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { Suspense, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { Thread } from '@/components/assistant-ui/thread'
import { NotificationStack } from '@/components/notifications'
import { Button } from '@/components/ui/button'
import { getGlobalModelOptions, type HermesGateway } from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages'
import { quickModelOptions, sessionTitle, toRuntimeMessage } from '@/lib/chat-runtime'
import { cn } from '@/lib/utils'
import { $pinnedSessionIds } from '@/store/layout'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $contextSuggestions,
  $currentModel,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $introPersonality,
  $introSeed,
  $messages,
  $selectedStoredSessionId,
  $sessions
} from '@/store/session'
import type { ModelOptionsResponse } from '@/types/hermes'

import { routeSessionId } from '../routes'
import { titlebarHeaderBaseClass, titlebarHeaderShadowClass } from '../shell/titlebar'

import { ChatBar, ChatBarFallback } from './composer'
import type { ChatBarState } from './composer/types'
import { ChatRightRail } from './right-rail'
import { SessionActionsMenu } from './sidebar/session-actions-menu'

interface ChatViewProps extends Omit<React.ComponentProps<'div'>, 'onSubmit'> {
  gateway: HermesGateway | null
  onToggleSelectedPin: () => void
  onDeleteSelectedSession: () => void
  onCancel: () => void
  onAddContextRef: (refText: string, label?: string, detail?: string) => void
  onAddUrl: (url: string) => void
  onBranchInNewChat: (messageId: string) => void
  maxVoiceRecordingSeconds?: number
  onPasteClipboardImage: () => void
  onPickFiles: () => void
  onPickFolders: () => void
  onPickImages: () => void
  onRemoveAttachment: (id: string) => void
  onSubmit: (text: string) => Promise<void> | void
  onChangeCwd: (cwd: string) => void
  onBrowseCwd: () => void
  onOpenModelPicker: () => void
  onSelectPersonality: (name: string) => void
  onThreadMessagesChange: (messages: readonly ThreadMessage[]) => void
  onReload: (parentId: string | null) => Promise<void>
  onTranscribeAudio?: (audio: Blob) => Promise<string>
}

function threadLoadingState(loadingSession: boolean, busy: boolean, awaitingResponse: boolean) {
  if (loadingSession) {
    return 'session'
  }

  if (!busy) {
    return undefined
  }

  return awaitingResponse ? 'response' : 'working'
}

export function ChatView({
  gateway,
  onToggleSelectedPin,
  onDeleteSelectedSession,
  onCancel,
  onAddContextRef,
  onAddUrl,
  onBranchInNewChat,
  maxVoiceRecordingSeconds,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages,
  onRemoveAttachment,
  onSubmit,
  onChangeCwd,
  onBrowseCwd,
  onOpenModelPicker,
  onSelectPersonality,
  onThreadMessagesChange,
  onReload,
  onTranscribeAudio
}: ChatViewProps) {
  const location = useLocation()
  const activeSessionId = useStore($activeSessionId)
  const awaitingResponse = useStore($awaitingResponse)
  const busy = useStore($busy)
  const contextSuggestions = useStore($contextSuggestions)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const freshDraftReady = useStore($freshDraftReady)
  const gatewayState = useStore($gatewayState)
  const gatewayOpen = gatewayState === 'open'
  const introPersonality = useStore($introPersonality)
  const introSeed = useStore($introSeed)
  const messages = useStore($messages)
  const pinnedSessionIds = useStore($pinnedSessionIds)
  const selectedSessionId = useStore($selectedStoredSessionId)
  const sessions = useStore($sessions)
  const runtimeMessageCacheRef = useRef(new WeakMap<ChatMessage, ThreadMessage>())
  const activeStoredSession = sessions.find(session => session.id === selectedSessionId) || null
  const isRoutedSessionView = Boolean(routeSessionId(location.pathname))
  const selectedIsPinned = selectedSessionId ? pinnedSessionIds.includes(selectedSessionId) : false

  const showIntro =
    freshDraftReady && !isRoutedSessionView && !selectedSessionId && !activeSessionId && messages.length === 0

  const loadingSession = isRoutedSessionView && messages.length === 0
  const threadLoading = threadLoadingState(loadingSession, busy, awaitingResponse)
  const showChatBar = !loadingSession
  const threadKey = selectedSessionId || activeSessionId || (isRoutedSessionView ? location.pathname : 'new')
  const title = activeStoredSession ? sessionTitle(activeStoredSession) : ''

  const modelOptionsQuery = useQuery<ModelOptionsResponse>({
    queryKey: ['model-options', activeSessionId || 'global'],
    queryFn: () => {
      if (!activeSessionId) {
        return getGlobalModelOptions()
      }

      if (!gateway) {
        throw new Error('Hermes gateway unavailable')
      }

      return gateway.request<ModelOptionsResponse>('model.options', { session_id: activeSessionId })
    },
    enabled: gatewayOpen
  })

  const quickModels = useMemo(
    () => quickModelOptions(modelOptionsQuery.data, currentProvider, currentModel),
    [currentModel, currentProvider, modelOptionsQuery.data]
  )

  const chatBarState = useMemo<ChatBarState>(
    () => ({
      model: {
        model: currentModel,
        provider: currentProvider,
        canSwitch: gatewayOpen,
        loading: !gatewayOpen || (!currentModel && !currentProvider),
        quickModels
      },
      tools: {
        enabled: true,
        label: 'Add context',
        suggestions: contextSuggestions
      },
      voice: {
        enabled: true,
        active: false
      }
    }),
    [contextSuggestions, currentModel, currentProvider, gatewayOpen, quickModels]
  )

  const runtimeMessageRepository = useMemo(() => {
    const items: { message: ThreadMessage; parentId: string | null }[] = []
    const branchParentByGroup = new Map<string, string | null>()
    let visibleParentId: string | null = null
    let headId: string | null = null

    for (const message of messages) {
      let parentId = visibleParentId

      if (message.role === 'assistant' && message.branchGroupId) {
        if (!branchParentByGroup.has(message.branchGroupId)) {
          branchParentByGroup.set(message.branchGroupId, visibleParentId)
        }

        parentId = branchParentByGroup.get(message.branchGroupId) ?? null
      }

      const cachedMessage = runtimeMessageCacheRef.current.get(message)
      const runtimeMessage = cachedMessage ?? toRuntimeMessage(message)

      if (!cachedMessage) {
        runtimeMessageCacheRef.current.set(message, runtimeMessage)
      }

      items.push({ message: runtimeMessage, parentId })

      if (!message.hidden) {
        visibleParentId = message.id
        headId = message.id
      }
    }

    return ExportedMessageRepository.fromBranchableArray(items, { headId })
  }, [messages])

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository: runtimeMessageRepository,
    isRunning: busy,
    setMessages: onThreadMessagesChange,
    onNew: async () => {
      // Submission is handled explicitly by ChatBar.
      // Keeping this no-op avoids duplicate prompt.submit calls.
    },
    onCancel: async () => onCancel(),
    onReload
  })

  return (
    <>
      <div className="flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-transparent">
        <header className={cn(titlebarHeaderBaseClass, isRoutedSessionView && titlebarHeaderShadowClass)}>
          <div className="min-w-0 flex-1">
            {title && (
              <SessionActionsMenu
                align="end"
                onDelete={selectedSessionId ? onDeleteSelectedSession : undefined}
                onPin={selectedSessionId ? onToggleSelectedPin : undefined}
                pinned={selectedIsPinned}
                sideOffset={8}
                title={title}
              >
                <Button
                  className="h-7 min-w-0 gap-1.5 rounded-lg px-1 py-0 text-foreground hover:bg-accent/70 data-[state=open]:bg-accent/70 [-webkit-app-region:no-drag]"
                  type="button"
                  variant="ghost"
                >
                  <h2 className="max-w-[62vw] truncate text-base font-semibold leading-none tracking-tight">{title}</h2>
                  <ChevronDown className="shrink-0 text-foreground/75" size={16} />
                </Button>
              </SessionActionsMenu>
            )}
          </div>
        </header>

        <NotificationStack />

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.0625rem] bg-transparent">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread
              intro={showIntro ? { personality: introPersonality, seed: introSeed } : undefined}
              loading={threadLoading}
              onBranchInNewChat={onBranchInNewChat}
              sessionKey={threadKey}
            />
            {showChatBar && (
              <Suspense fallback={<ChatBarFallback />}>
                <ChatBar
                  busy={busy}
                  disabled={!gatewayOpen}
                  focusKey={activeSessionId}
                  maxRecordingSeconds={maxVoiceRecordingSeconds}
                  onAddContextRef={onAddContextRef}
                  onAddUrl={onAddUrl}
                  onCancel={onCancel}
                  onPasteClipboardImage={onPasteClipboardImage}
                  onPickFiles={onPickFiles}
                  onPickFolders={onPickFolders}
                  onPickImages={onPickImages}
                  onRemoveAttachment={onRemoveAttachment}
                  onSubmit={onSubmit}
                  onTranscribeAudio={onTranscribeAudio}
                  state={chatBarState}
                />
              </Suspense>
            )}
          </AssistantRuntimeProvider>
        </div>
      </div>

      <ChatRightRail
        onBrowseCwd={onBrowseCwd}
        onChangeCwd={onChangeCwd}
        onOpenModelPicker={onOpenModelPicker}
        onSelectPersonality={onSelectPersonality}
      />
    </>
  )
}

export { SESSION_INSPECTOR_WIDTH } from './right-rail'
