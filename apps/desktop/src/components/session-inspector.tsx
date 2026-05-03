'use client'

import type { FC } from 'react'

import { AgentSection } from '@/app/chat/right-rail/agent-section'
import { ProjectSection } from '@/app/chat/right-rail/project-section'
import { cn } from '@/lib/utils'

export interface SessionInspectorProps {
  open: boolean
  cwd: string
  branch: string
  busy: boolean
  modelLabel: string
  modelTitle?: string
  providerName?: string
  reasoningEffort: string
  serviceTier: string
  fastMode: boolean
  personality: string
  personalities: string[]
  onChangeCwd?: (cwd: string) => void
  onBrowseCwd?: () => void
  onOpenModelPicker?: () => void
  onSetReasoningEffort?: (effort: string) => void
  onSetFastMode?: (enabled: boolean) => void
  onSelectPersonality?: (name: string) => void
}

export const SESSION_INSPECTOR_WIDTH = '14rem'

export const SessionInspector: FC<SessionInspectorProps> = ({
  open,
  cwd,
  branch,
  busy,
  modelLabel,
  providerName,
  reasoningEffort,
  serviceTier,
  fastMode,
  personality,
  personalities,
  onChangeCwd,
  onBrowseCwd,
  onOpenModelPicker,
  onSetFastMode,
  onSetReasoningEffort,
  onSelectPersonality
}) => (
  <aside
    aria-hidden={!open}
    className={cn(
      'relative flex h-screen w-full min-w-0 flex-col overflow-hidden bg-transparent pb-2 pl-2 pr-3 pt-[calc(var(--titlebar-height)+0.25rem)] text-muted-foreground transition-none',
      open ? 'opacity-100' : 'pointer-events-none opacity-0'
    )}
    data-open={open}
  >
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pl-1.5 pr-1 text-xs">
      <ProjectSection
        branch={branch}
        busy={busy}
        cwd={cwd}
        onBrowseCwd={onBrowseCwd}
        onChangeCwd={onChangeCwd}
      />
      <AgentSection
        fastMode={fastMode}
        modelLabel={modelLabel}
        onOpenModelPicker={onOpenModelPicker}
        onSelectPersonality={onSelectPersonality}
        onSetFastMode={onSetFastMode}
        onSetReasoningEffort={onSetReasoningEffort}
        personalities={personalities}
        personality={personality}
        providerName={providerName}
        reasoningEffort={reasoningEffort}
        serviceTier={serviceTier}
      />
    </div>
  </aside>
)
