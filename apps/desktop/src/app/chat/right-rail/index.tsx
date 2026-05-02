import { useStore } from '@nanostores/react'
import type * as React from 'react'

import { SESSION_INSPECTOR_WIDTH, SessionInspector } from '@/components/session-inspector'
import { cn } from '@/lib/utils'
import { $inspectorOpen } from '@/store/layout'
import { $previewTarget } from '@/store/preview'
import type { SetTitlebarToolGroup } from '@/app/shell/titlebar-controls'
import {
  $availablePersonalities,
  $busy,
  $currentBranch,
  $currentCwd,
  $currentModel,
  $currentPersonality,
  $currentProvider,
  $gatewayState
} from '@/store/session'

import { PreviewPane } from './preview-pane'

interface ChatRightRailProps extends Pick<
  React.ComponentProps<typeof SessionInspector>,
  'onBrowseCwd' | 'onChangeCwd'
> {
  onOpenModelPicker: () => void
  onSelectPersonality: (name: string) => void
}

export function ChatRightRail({
  onBrowseCwd,
  onChangeCwd,
  onOpenModelPicker,
  onSelectPersonality
}: ChatRightRailProps) {
  const inspectorOpen = useStore($inspectorOpen)
  const gatewayOpen = useStore($gatewayState) === 'open'
  const busy = useStore($busy)
  const cwd = useStore($currentCwd)
  const branch = useStore($currentBranch)
  const model = useStore($currentModel)
  const provider = useStore($currentProvider)
  const personality = useStore($currentPersonality)
  const personalities = useStore($availablePersonalities)

  return (
    <div className="col-start-4 col-end-5 row-start-1 min-w-0 overflow-hidden">
      <SessionInspector
        branch={branch}
        busy={busy}
        cwd={cwd}
        modelLabel={model ? model.split('/').pop() || model : ''}
        modelTitle={provider ? `${provider}: ${model || ''}` : model}
        onBrowseCwd={onBrowseCwd}
        onChangeCwd={onChangeCwd}
        onOpenModelPicker={gatewayOpen ? onOpenModelPicker : undefined}
        onSelectPersonality={gatewayOpen ? onSelectPersonality : undefined}
        open={inspectorOpen}
        personalities={personalities}
        personality={personality}
        providerName={provider}
      />
    </div>
  )
}

export function ChatPreviewRail({ setTitlebarToolGroup }: { setTitlebarToolGroup?: SetTitlebarToolGroup }) {
  const inspectorOpen = useStore($inspectorOpen)
  const previewTarget = useStore($previewTarget)

  if (!previewTarget) {
    return <aside aria-hidden="true" className="col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden" />
  }

  return (
    <div
      className={cn(
        'pointer-events-none col-start-3 col-end-4 row-start-1 min-w-0 overflow-hidden',
        inspectorOpen && 'border-r border-border/60'
      )}
    >
      <PreviewPane setTitlebarToolGroup={setTitlebarToolGroup} target={previewTarget} />
    </div>
  )
}

export { SESSION_INSPECTOR_WIDTH }
export const PREVIEW_RAIL_WIDTH = 'clamp(18rem, 36vw, 38rem)'
