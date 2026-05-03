'use client'

import { useMemo } from 'react'

import { RailActionRow } from './rail-action-row'
import { RailSection } from './rail-section'
import { type RailSelectOption, RailSelectRow } from './rail-select-row'
import { RailToggleRow } from './rail-toggle-row'

const REASONING_OPTIONS: RailSelectOption[] = [
  { value: 'none', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' }
]

interface AgentSectionProps {
  modelLabel: string
  providerName?: string
  reasoningEffort: string
  serviceTier: string
  fastMode: boolean
  personality: string
  personalities: string[]
  onOpenModelPicker?: () => void
  onSetReasoningEffort?: (effort: string) => void
  onSetFastMode?: (enabled: boolean) => void
  onSelectPersonality?: (name: string) => void
}

export function AgentSection({
  modelLabel,
  providerName,
  reasoningEffort,
  serviceTier,
  fastMode,
  personality,
  personalities,
  onOpenModelPicker,
  onSetReasoningEffort,
  onSetFastMode,
  onSelectPersonality
}: AgentSectionProps) {
  const activeReasoning = normalizeReasoningEffort(reasoningEffort)
  const fastEnabled = fastMode || ['fast', 'priority'].includes(serviceTier.trim().toLowerCase())

  const activePersonality = personalityOptionKey(personality)

  const personalityOptions = useMemo<RailSelectOption[]>(
    () =>
      [...new Set(['none', ...personalities, personality].map(personalityOptionKey).filter(Boolean))].map(name => ({
        value: name,
        label: name === 'none' ? 'None' : titleize(name)
      })),
    [personalities, personality]
  )

  return (
    <RailSection title="Agent">
      <RailActionRow
        ariaLabel="Change model"
        onClick={onOpenModelPicker}
        primary={modelLabel || 'Hermes'}
        secondary={providerName}
      />
      <RailSelectRow
        ariaLabel="Change reasoning effort"
        label="Reasoning"
        menuLabel="Reasoning"
        onChange={onSetReasoningEffort}
        options={REASONING_OPTIONS}
        value={activeReasoning}
      />
      <RailToggleRow checked={fastEnabled} label="Fast mode" onChange={onSetFastMode} />
      <RailSelectRow
        ariaLabel="Change personality"
        label="Personality"
        menuLabel="Personality"
        menuWidthClass="w-52"
        onChange={onSelectPersonality}
        options={personalityOptions}
        value={activePersonality}
      />
    </RailSection>
  )
}

function personalityOptionKey(value?: string): string {
  const key = value?.trim().toLowerCase() || 'none'

  return key === 'default' ? 'none' : key
}

function normalizeReasoningEffort(value: string): string {
  const normalized = value.trim().toLowerCase()

  return REASONING_OPTIONS.some(option => option.value === normalized) ? normalized : 'medium'
}

function titleize(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, m => m.toUpperCase())
}
