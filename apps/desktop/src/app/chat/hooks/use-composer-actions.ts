import { useCallback } from 'react'

import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { attachmentId, contextPath, pathLabel } from '@/lib/chat-runtime'
import { addComposerAttachment, type ComposerAttachment, removeComposerAttachment } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'

import type { ImageDetachResponse } from '../../types'

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico)$/i

const BLOB_MIME_EXTENSION: Record<string, string> = {
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/x-icon': '.ico'
}

function blobExtension(blob: Blob): string {
  const mime = blob.type.split(';')[0]?.trim().toLowerCase()

  return (mime && BLOB_MIME_EXTENSION[mime]) || '.png'
}

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(filePath)
}

export interface DroppedFile {
  file: File
  path: string
}

/**
 * Eagerly resolve files from a drop event into [File, path] pairs.
 *
 * Must be called synchronously from inside the drop handler — `DataTransfer`
 * items are detached as soon as the handler returns, and `webUtils.getPathForFile`
 * also requires the original (non-cloned) File reference.
 */
export function extractDroppedFiles(transfer: DataTransfer): DroppedFile[] {
  const result: DroppedFile[] = []
  const seen = new Set<File>()
  const getPath = window.hermesDesktop?.getPathForFile

  const fileList = transfer.files
  if (fileList) {
    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList.item(i)
      if (!file || seen.has(file)) continue
      seen.add(file)
      let path = ''
      if (getPath) {
        try {
          path = getPath(file) || ''
        } catch {
          path = ''
        }
      }
      result.push({ file, path })
    }
  }

  const items = transfer.items
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file || seen.has(file)) continue
      seen.add(file)
      let path = ''
      if (getPath) {
        try {
          path = getPath(file) || ''
        } catch {
          path = ''
        }
      }
      result.push({ file, path })
    }
  }

  return result
}

interface ComposerActionsOptions {
  activeSessionId: string | null
  currentCwd: string
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useComposerActions({
  activeSessionId,
  currentCwd,
  requestGateway
}: ComposerActionsOptions) {
  const addContextRefAttachment = useCallback((refText: string, label?: string, detail?: string) => {
    let kind: ComposerAttachment['kind'] = 'file'

    if (refText.startsWith('@folder:')) {
      kind = 'folder'
    }

    if (refText.startsWith('@url:')) {
      kind = 'url'
    }

    addComposerAttachment({
      id: attachmentId(kind, refText),
      kind,
      label: label || refText.replace(/^@(file|folder|url):/, ''),
      detail,
      refText
    })
  }, [])

  const pickContextPaths = useCallback(
    async (kind: 'file' | 'folder') => {
      const paths = await window.hermesDesktop?.selectPaths({
        title: kind === 'file' ? 'Add files as context' : 'Add folders as context',
        defaultPath: currentCwd || undefined,
        directories: kind === 'folder'
      })

      if (!paths?.length) {
        return
      }

      for (const path of paths) {
        const rel = contextPath(path, currentCwd)

        addComposerAttachment({
          id: attachmentId(kind, rel),
          kind,
          label: pathLabel(path),
          detail: rel,
          refText: `@${kind}:${formatRefValue(rel)}`,
          path
        })
      }
    },
    [currentCwd]
  )

  const attachContextFilePath = useCallback(
    (filePath: string) => {
      if (!filePath) {
        return false
      }

      const rel = contextPath(filePath, currentCwd)

      addComposerAttachment({
        id: attachmentId('file', rel),
        kind: 'file',
        label: pathLabel(filePath),
        detail: rel,
        refText: `@file:${formatRefValue(rel)}`,
        path: filePath
      })

      return true
    },
    [currentCwd]
  )

  const attachImagePath = useCallback(
    async (filePath: string) => {
      if (!filePath) {
        return false
      }

      const baseAttachment: ComposerAttachment = {
        id: attachmentId('image', filePath),
        kind: 'image',
        label: pathLabel(filePath),
        detail: filePath,
        path: filePath
      }

      addComposerAttachment(baseAttachment)

      try {
        const previewUrl = await window.hermesDesktop?.readFileDataUrl(filePath)

        if (previewUrl) {
          addComposerAttachment({ ...baseAttachment, previewUrl })
        }

        return true
      } catch (err) {
        notifyError(err, 'Image preview failed')

        return true
      }
    },
    []
  )

  const attachImageBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        return false
      }

      if (blob.type && !blob.type.startsWith('image/')) {
        return false
      }

      try {
        const buffer = await blob.arrayBuffer()
        const data = new Uint8Array(buffer)
        const savedPath = await window.hermesDesktop?.saveImageBuffer(data, blobExtension(blob))

        if (!savedPath) {
          notify({ kind: 'error', title: 'Image attach', message: 'Failed to write image to disk.' })

          return false
        }

        return attachImagePath(savedPath)
      } catch (err) {
        notifyError(err, 'Image attach failed')

        return false
      }
    },
    [attachImagePath]
  )

  const pickImages = useCallback(async () => {
    const paths = await window.hermesDesktop?.selectPaths({
      title: 'Attach images',
      defaultPath: currentCwd || undefined,
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff']
        }
      ]
    })

    if (!paths?.length) {
      return
    }

    for (const path of paths) {
      await attachImagePath(path)
    }
  }, [attachImagePath, currentCwd])

  const pasteClipboardImage = useCallback(async () => {
    try {
      const path = await window.hermesDesktop?.saveClipboardImage()

      if (!path) {
        notify({
          kind: 'warning',
          title: 'Clipboard',
          message: 'No image found in clipboard'
        })

        return
      }

      await attachImagePath(path)
    } catch (err) {
      notifyError(err, 'Clipboard paste failed')
    }
  }, [attachImagePath])

  const attachDroppedItems = useCallback(
    async (candidates: DroppedFile[]) => {
      if (candidates.length === 0) {
        return false
      }

      let attached = false
      let lastFailure: string | null = null

      for (const { file, path: knownPath } of candidates) {
        const fallbackPath = !knownPath && window.hermesDesktop?.getPathForFile ? window.hermesDesktop.getPathForFile(file) : ''
        const filePath = knownPath || fallbackPath || ''
        const isImage = file.type.startsWith('image/') || isImagePath(file.name) || (filePath && isImagePath(filePath))

        if (isImage) {
          if ((filePath && (await attachImagePath(filePath))) || (await attachImageBlob(file))) {
            attached = true
            continue
          }

          lastFailure = `Could not attach ${file.name || 'image'}`
          continue
        }

        if (filePath && attachContextFilePath(filePath)) {
          attached = true
          continue
        }

        lastFailure = `Could not attach ${file.name || 'file'}`
      }

      if (!attached && lastFailure) {
        notify({ kind: 'warning', title: 'Drop files', message: lastFailure })
      }

      return attached
    },
    [attachContextFilePath, attachImageBlob, attachImagePath]
  )

  const removeAttachment = useCallback(
    async (id: string) => {
      const removed = removeComposerAttachment(id)

      if (
        removed?.kind === 'image' &&
        removed.path &&
        activeSessionId &&
        removed.attachedSessionId &&
        removed.attachedSessionId === activeSessionId
      ) {
        await requestGateway<ImageDetachResponse>('image.detach', {
          session_id: activeSessionId,
          path: removed.path
        }).catch(() => undefined)
      }
    },
    [activeSessionId, requestGateway]
  )

  return {
    addContextRefAttachment,
    attachDroppedItems,
    attachImageBlob,
    attachImagePath,
    pasteClipboardImage,
    pickContextPaths,
    pickImages,
    removeAttachment
  }
}
