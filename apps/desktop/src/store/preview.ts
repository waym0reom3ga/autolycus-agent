import { atom } from 'nanostores'

export interface PreviewTarget {
  kind: 'file' | 'url'
  label: string
  source: string
  url: string
}

export const $previewTarget = atom<PreviewTarget | null>(null)

export function setPreviewTarget(target: PreviewTarget | null) {
  $previewTarget.set(target)
}
