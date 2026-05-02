import { atom } from 'nanostores'

export interface PreviewTarget {
  kind: 'file' | 'url'
  label: string
  source: string
  url: string
}

export const $previewTarget = atom<PreviewTarget | null>(null)

function isSamePreviewTarget(a: PreviewTarget | null, b: PreviewTarget | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.kind === b.kind && a.label === b.label && a.source === b.source && a.url === b.url
}

export function setPreviewTarget(target: PreviewTarget | null) {
  if (isSamePreviewTarget($previewTarget.get(), target)) {
    return
  }

  $previewTarget.set(target)
}
