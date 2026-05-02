import { useCallback } from 'react'

import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { attachmentId, contextPath, pathLabel } from '@/lib/chat-runtime'
import {
  addComposerAttachment,
  type ComposerAttachment,
  removeComposerAttachment
} from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'

import type { ImageAttachResponse, ImageDetachResponse } from '../../types'

interface ComposerActionsOptions {
  activeSessionId: string | null
  currentCwd: string
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useComposerActions({ activeSessionId, currentCwd, requestGateway }: ComposerActionsOptions) {
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

  const pickImages = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

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
      try {
        const result = await requestGateway<ImageAttachResponse>('image.attach', {
          session_id: activeSessionId,
          path
        })
        const attachedPath = result.path || path

        if (result.attached) {
          const previewUrl = await window.hermesDesktop?.readFileDataUrl(attachedPath)

          addComposerAttachment({
            id: attachmentId('image', attachedPath),
            kind: 'image',
            label: pathLabel(attachedPath),
            detail: attachedPath,
            previewUrl,
            path: attachedPath
          })
        }
      } catch (err) {
        notifyError(err, 'Image attach failed')
      }
    }
  }, [activeSessionId, currentCwd, requestGateway])

  const pasteClipboardImage = useCallback(async () => {
    if (!activeSessionId) {
      return
    }

    try {
      const result = await requestGateway<ImageAttachResponse>('clipboard.paste', {
        session_id: activeSessionId
      })

      if (!result.attached) {
        notify({
          kind: 'warning',
          title: 'Clipboard',
          message: result.message || 'No image found in clipboard'
        })

        return
      }

      const attachedPath = result.path || 'clipboard'
      const previewUrl = result.path && (await window.hermesDesktop?.readFileDataUrl(result.path))

      addComposerAttachment({
        id: attachmentId('image', attachedPath),
        kind: 'image',
        label: pathLabel(attachedPath),
        detail: attachedPath,
        previewUrl: previewUrl || undefined,
        path: result.path
      })
    } catch (err) {
      notifyError(err, 'Clipboard paste failed')
    }
  }, [activeSessionId, requestGateway])

  const removeAttachment = useCallback(
    async (id: string) => {
      const removed = removeComposerAttachment(id)

      if (removed?.kind === 'image' && removed.path && activeSessionId) {
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
    pasteClipboardImage,
    pickContextPaths,
    pickImages,
    removeAttachment
  }
}
