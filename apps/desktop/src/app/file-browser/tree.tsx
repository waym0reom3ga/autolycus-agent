import { useCallback, useEffect, useRef, useState } from 'react'
import { type NodeApi, type NodeRendererProps, Tree, type TreeApi } from 'react-arborist'

import { ChevronDown, ChevronRight, FileText, FolderOpen, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type { TreeNode } from './use-project-tree'

const ROW_HEIGHT = 28
const INDENT = 14

interface ProjectTreeProps {
  data: TreeNode[]
  onActivateFile: (path: string) => void
  onLoadChildren: (id: string) => void | Promise<void>
  onNodeOpenChange: (id: string, open: boolean) => void
  onPreviewFile?: (path: string) => void
  openState: Record<string, boolean>
}

export function ProjectTree({
  data,
  onActivateFile,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  openState
}: ProjectTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)
  const [size, setSize] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const el = containerRef.current

    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect
      setSize({ height, width })
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  const handleToggle = useCallback(
    (id: string) => {
      const node = treeRef.current?.get(id)

      if (!node) {
        return
      }

      onNodeOpenChange(id, node.isOpen)

      if (node.isOpen && node.data.children === undefined) {
        void onLoadChildren(id)
      }
    },
    [onLoadChildren, onNodeOpenChange]
  )

  const handleActivate = useCallback(
    (node: NodeApi<TreeNode>) => {
      if (!node.data.isDirectory) {
        onPreviewFile?.(node.data.id)
      }
    },
    [onPreviewFile]
  )

  return (
    <div className="min-h-0 flex-1 overflow-hidden px-2" ref={containerRef}>
      {size.height > 0 && size.width > 0 ? (
        <Tree<TreeNode>
          childrenAccessor={node => (node.isDirectory ? (node.children ?? []) : null)}
          data={data}
          disableDrag
          disableDrop
          disableEdit
          height={size.height}
          indent={INDENT}
          initialOpenState={openState}
          onActivate={handleActivate}
          onToggle={handleToggle}
          openByDefault={false}
          padding={2}
          ref={treeRef}
          rowHeight={ROW_HEIGHT}
          width={size.width}
        >
          {props => <ProjectTreeRow {...props} onAttachFile={onActivateFile} onPreviewFile={onPreviewFile} />}
        </Tree>
      ) : null}
    </div>
  )
}

function ProjectTreeRow({
  dragHandle,
  node,
  onAttachFile,
  onPreviewFile,
  style
}: NodeRendererProps<TreeNode> & { onAttachFile: (path: string) => void; onPreviewFile?: (path: string) => void }) {
  const isFolder = node.data.isDirectory
  const isPlaceholder = node.data.id.endsWith('::__loading__')
  const Caret = node.isOpen ? ChevronDown : ChevronRight

  return (
    <div
      aria-expanded={isFolder ? node.isOpen : undefined}
      aria-selected={node.isSelected}
      className={cn(
        'group/row flex h-full cursor-pointer select-none items-center gap-1 rounded-sm px-1.5 text-sm font-medium leading-snug text-foreground/90 transition-colors hover:bg-[color-mix(in_srgb,var(--dt-midground)_8%,transparent)]',
        node.isSelected && 'bg-accent/65 text-foreground',
        isPlaceholder && 'pointer-events-none italic text-muted-foreground/70'
      )}
      draggable={!isPlaceholder}
      onClick={event => {
        event.stopPropagation()

        if (isPlaceholder) {
          return
        }

        if (isFolder) {
          node.toggle()
        } else {
          node.select()

          if (event.shiftKey) {
            onAttachFile(node.data.id)
          }
        }
      }}
      onDoubleClick={event => {
        event.stopPropagation()

        if (!isFolder && !isPlaceholder) {
          onPreviewFile?.(node.data.id)
        }
      }}
      onDragStart={event => {
        if (isPlaceholder) {
          event.preventDefault()

          return
        }

        const payload = JSON.stringify([{ isDirectory: isFolder, path: node.data.id }])

        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('application/x-hermes-paths', payload)
        event.dataTransfer.setData('text/plain', node.data.id)
      }}
      ref={dragHandle}
      style={style}
    >
      <span aria-hidden className={cn('flex w-3.5 items-center justify-center', !isFolder && 'opacity-0')}>
        {isFolder && !isPlaceholder ? <Caret className="size-3 text-muted-foreground/70" /> : null}
      </span>
      <span aria-hidden className="flex w-3.5 items-center justify-center text-muted-foreground/85">
        {isPlaceholder ? (
          <Loader2 className="size-3 animate-spin" />
        ) : isFolder ? (
          <FolderOpen className="size-3.5" />
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
    </div>
  )
}
