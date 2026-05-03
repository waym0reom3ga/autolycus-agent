import { useStore } from '@nanostores/react'
import type * as React from 'react'

import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import { SESSION_INSPECTOR_WIDTH, SessionInspector } from '@/components/session-inspector'
import { cn } from '@/lib/utils'
import { $inspectorOpen } from '@/store/layout'
import { $previewReloadRequest, $previewTarget } from '@/store/preview'
import {
  $availablePersonalities,
  $busy,
  $currentBranch,
  $currentCwd,
  $currentFastMode,
  $currentModel,
  $currentPersonality,
  $currentProvider,
  $currentReasoningEffort,
  $currentServiceTier,
  $gatewayState
} from '@/store/session'

import { PreviewPane } from './preview-pane'

interface ChatRightRailProps extends Pick<
  React.ComponentProps<typeof SessionInspector>,
  'onBrowseCwd' | 'onChangeCwd'
> {
  onOpenModelPicker: () => void
  onSetFastMode: (enabled: boolean) => void
  onSetReasoningEffort: (effort: string) => void
  onSelectPersonality: (name: string) => void
}

export function ChatRightRail({
  onBrowseCwd,
  onChangeCwd,
  onOpenModelPicker,
  onSetFastMode,
  onSetReasoningEffort,
  onSelectPersonality
}: ChatRightRailProps) {
  const inspectorOpen = useStore($inspectorOpen)
  const gatewayOpen = useStore($gatewayState) === 'open'
  const busy = useStore($busy)
  const cwd = useStore($currentCwd)
  const branch = useStore($currentBranch)
  const model = useStore($currentModel)
  const provider = useStore($currentProvider)
  const reasoningEffort = useStore($currentReasoningEffort)
  const serviceTier = useStore($currentServiceTier)
  const fastMode = useStore($currentFastMode)
  const personality = useStore($currentPersonality)
  const personalities = useStore($availablePersonalities)

  return (
    <div
      className={cn(
        'col-start-4 col-end-5 row-start-1 min-w-0 overflow-hidden',
        inspectorOpen && 'border-l border-border/60'
      )}
    >
      <SessionInspector
        branch={branch}
        busy={busy}
        cwd={cwd}
        fastMode={fastMode}
        modelLabel={model ? model.split('/').pop() || model : ''}
        modelTitle={provider ? `${provider}: ${model || ''}` : model}
        onBrowseCwd={onBrowseCwd}
        onChangeCwd={onChangeCwd}
        onOpenModelPicker={gatewayOpen ? onOpenModelPicker : undefined}
        onSelectPersonality={gatewayOpen ? onSelectPersonality : undefined}
        onSetFastMode={gatewayOpen ? onSetFastMode : undefined}
        onSetReasoningEffort={gatewayOpen ? onSetReasoningEffort : undefined}
        open={inspectorOpen}
        personalities={personalities}
        personality={personality}
        providerName={provider}
        reasoningEffort={reasoningEffort}
        serviceTier={serviceTier}
      />
    </div>
  )
}

export function ChatPreviewRail({
  onRestartServer,
  setTitlebarToolGroup
}: {
  onRestartServer?: (url: string, context?: string) => Promise<string>
  setTitlebarToolGroup?: SetTitlebarToolGroup
}) {
  const previewReloadRequest = useStore($previewReloadRequest)
  const previewTarget = useStore($previewTarget)

  if (!previewTarget) {
    return <aside aria-hidden="true" className="col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden" />
  }

  return (
    <div
      className="pointer-events-none col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden"
    >
      <PreviewPane
        onRestartServer={onRestartServer}
        reloadRequest={previewReloadRequest}
        setTitlebarToolGroup={setTitlebarToolGroup}
        target={previewTarget}
      />
    </div>
  )
}

export { SESSION_INSPECTOR_WIDTH }
export const PREVIEW_RAIL_WIDTH = 'clamp(18rem, 36vw, 38rem)'
