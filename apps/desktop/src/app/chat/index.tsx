import {
  type AppendMessage,
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
  $currentCwd,
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
import type { SetTitlebarToolGroup } from '../shell/titlebar-controls'

import { ChatBar, ChatBarFallback } from './composer'
import type { ChatBarState } from './composer/types'
import type { DroppedFile } from './hooks/use-composer-actions'
import { ChatPreviewRail, ChatRightRail } from './right-rail'
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
  onAttachImageBlob: (blob: Blob) => Promise<boolean | void> | boolean | void
  onAttachDroppedItems: (candidates: DroppedFile[]) => Promise<boolean | void> | boolean | void
  onPasteClipboardImage: () => void
  onPickFiles: () => void
  onPickFolders: () => void
  onPickImages: () => void
  onRemoveAttachment: (id: string) => void
  onSubmit: (text: string) => Promise<void> | void
  onChangeCwd: (cwd: string) => void
  onBrowseCwd: () => void
  onOpenModelPicker: () => void
  onRestartPreviewServer?: (url: string, context?: string) => Promise<string>
  onSetFastMode: (enabled: boolean) => void
  onSetReasoningEffort: (effort: string) => void
  onSelectPersonality: (name: string) => void
  onThreadMessagesChange: (messages: readonly ThreadMessage[]) => void
  onEdit: (message: AppendMessage) => Promise<void>
  onReload: (parentId: string | null) => Promise<void>
  onTranscribeAudio?: (audio: Blob) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}

function threadLoadingState(
  loadingSession: boolean,
  busy: boolean,
  awaitingResponse: boolean,
  lastMessageIsUser: boolean
) {
  if (loadingSession) {
    return 'session'
  }

  // Only show the response spinner when we're actually waiting for an
  // assistant reply to a user message. Previously any `busy && awaiting`
  // window showed the spinner — including the brief gateway-hydration blip
  // right after a session resume, which produced a visible flicker chain:
  //   session spinner → response spinner → content.
  // Gating on `lastMessageIsUser` means the spinner only appears when the
  // user actually just sent something and there's no assistant reply yet.
  if (busy && awaitingResponse && lastMessageIsUser) {
    return 'response'
  }

  return undefined
}

export function ChatView({
  className,
  gateway,
  onToggleSelectedPin,
  onDeleteSelectedSession,
  onCancel,
  onAddContextRef,
  onAddUrl,
  onAttachImageBlob,
  onAttachDroppedItems,
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
  onRestartPreviewServer,
  onSetFastMode,
  onSetReasoningEffort,
  onSelectPersonality,
  onThreadMessagesChange,
  onEdit,
  onReload,
  onTranscribeAudio,
  setTitlebarToolGroup
}: ChatViewProps) {
  const location = useLocation()
  const activeSessionId = useStore($activeSessionId)
  const awaitingResponse = useStore($awaitingResponse)
  const busy = useStore($busy)
  const contextSuggestions = useStore($contextSuggestions)
  const currentCwd = useStore($currentCwd)
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

  // Session is still loading if the route references a session we haven't
  // resumed yet. Once `activeSessionId` is set (runtime has resumed), the
  // session exists — even if it has zero messages (a brand-new routed
  // session). The flicker where `busy` flips true briefly during hydrate
  // is handled by `threadLoadingState`'s `lastMessageIsUser` gate.
  const loadingSession = isRoutedSessionView && messages.length === 0 && !activeSessionId
  const lastMessageIsUser = messages.at(-1)?.role === 'user'
  const threadLoading = threadLoadingState(loadingSession, busy, awaitingResponse, lastMessageIsUser)
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
    onEdit,
    onCancel: async () => onCancel(),
    onReload
  })

  return (
    <>
      <div className={cn('relative col-start-2 col-end-3 row-start-1 flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-transparent', className)}>
        <header className={cn(titlebarHeaderBaseClass, isRoutedSessionView && titlebarHeaderShadowClass)}>
          <div className="min-w-0 flex-1">
            {title && (
              <SessionActionsMenu
                align="start"
                onDelete={selectedSessionId ? onDeleteSelectedSession : undefined}
                onPin={selectedSessionId ? onToggleSelectedPin : undefined}
                pinned={selectedIsPinned}
                sessionId={selectedSessionId || activeSessionId || ''}
                sideOffset={8}
                title={title}
              >
                <Button
                  className="pointer-events-auto h-7 min-w-0 gap-1.5 rounded-lg px-1 py-0 text-foreground hover:bg-accent/70 data-[state=open]:bg-accent/70 [-webkit-app-region:no-drag]"
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

        <div className="relative min-h-0 max-w-full flex-1 overflow-hidden rounded-[1.0625rem] bg-transparent contain-[layout_paint]">
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
                  cwd={currentCwd}
                  disabled={!gatewayOpen}
                  focusKey={activeSessionId}
                  gateway={gateway}
                  maxRecordingSeconds={maxVoiceRecordingSeconds}
                  onAddContextRef={onAddContextRef}
                  onAddUrl={onAddUrl}
                  onAttachDroppedItems={onAttachDroppedItems}
                  onAttachImageBlob={onAttachImageBlob}
                  onCancel={onCancel}
                  onPasteClipboardImage={onPasteClipboardImage}
                  onPickFiles={onPickFiles}
                  onPickFolders={onPickFolders}
                  onPickImages={onPickImages}
                  onRemoveAttachment={onRemoveAttachment}
                  onSubmit={onSubmit}
                  onTranscribeAudio={onTranscribeAudio}
                  sessionId={activeSessionId}
                  state={chatBarState}
                />
              </Suspense>
            )}
          </AssistantRuntimeProvider>
        </div>
      </div>

      <ChatPreviewRail onRestartServer={onRestartPreviewServer} setTitlebarToolGroup={setTitlebarToolGroup} />
      <ChatRightRail
        onBrowseCwd={onBrowseCwd}
        onChangeCwd={onChangeCwd}
        onOpenModelPicker={onOpenModelPicker}
        onSelectPersonality={onSelectPersonality}
        onSetFastMode={onSetFastMode}
        onSetReasoningEffort={onSetReasoningEffort}
      />
    </>
  )
}

export { PREVIEW_RAIL_WIDTH, SESSION_INSPECTOR_WIDTH } from './right-rail'
