import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'

export type ToolViewMode = 'product' | 'technical'

const TOOL_VIEW_TECHNICAL_STORAGE_KEY = 'hermes.desktop.toolView.technical'

export const $toolViewMode = atom<ToolViewMode>(storedBoolean(TOOL_VIEW_TECHNICAL_STORAGE_KEY, false) ? 'technical' : 'product')

$toolViewMode.subscribe(mode => persistBoolean(TOOL_VIEW_TECHNICAL_STORAGE_KEY, mode === 'technical'))

export function setToolViewMode(mode: ToolViewMode) {
  $toolViewMode.set(mode)
}
