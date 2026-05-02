import { useStore } from '@nanostores/react'
import type * as React from 'react'

import { SESSION_INSPECTOR_WIDTH, SessionInspector } from '@/components/session-inspector'
import { $inspectorOpen } from '@/store/layout'
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
  )
}

export { SESSION_INSPECTOR_WIDTH }
