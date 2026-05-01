import { atom } from 'nanostores'

import { triggerHaptic } from '@/lib/haptics'

export interface ComposerAttachment {
  id: string
  kind: 'image' | 'file' | 'folder' | 'url'
  label: string
  detail?: string
  refText?: string
  previewUrl?: string
  path?: string
}

export const $composerDraft = atom('')
export const $composerAttachments = atom<ComposerAttachment[]>([])

export function setComposerDraft(value: string) {
  $composerDraft.set(value)
}

export function clearComposerDraft() {
  $composerDraft.set('')
}

export function addComposerAttachment(attachment: ComposerAttachment) {
  const previous = $composerAttachments.get()
  const next = upsertAttachment(previous, attachment)
  $composerAttachments.set(next)

  if (next.length > previous.length && attachment.kind !== 'url') {
    triggerHaptic('selection')
  }
}

export function removeComposerAttachment(id: string): ComposerAttachment | null {
  const current = $composerAttachments.get()
  const removed = current.find(attachment => attachment.id === id) || null
  $composerAttachments.set(current.filter(attachment => attachment.id !== id))

  return removed
}

export function clearComposerAttachments() {
  $composerAttachments.set([])
}

function upsertAttachment(attachments: ComposerAttachment[], attachment: ComposerAttachment) {
  const index = attachments.findIndex(item => item.id === attachment.id)

  if (index < 0) {
    return [...attachments, attachment]
  }

  const next = [...attachments]
  next[index] = attachment

  return next
}
