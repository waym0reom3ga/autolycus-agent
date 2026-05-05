import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { FadeText } from '@/components/ui/fade-text'
import { FolderOpen, RefreshCw } from '@/lib/icons'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

import { ProjectTree } from './tree'
import { useProjectTree } from './use-project-tree'

const HEADER_ACTION_CLASS =
  'pointer-events-none size-6 shrink-0 opacity-0 text-muted-foreground/75 transition-opacity hover:text-foreground focus-visible:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100'

interface FileBrowserPaneProps {
  /** Activates a file row — drops the path into the composer as `@file:` ref. */
  onActivateFile: (path: string) => void
  onChangeCwd: (path: string) => Promise<void> | void
}

export function FileBrowserPane({ onActivateFile, onChangeCwd }: FileBrowserPaneProps) {
  const currentCwd = useStore($currentCwd).trim()
  const hasCwd = currentCwd.length > 0

  const cwdName = hasCwd
    ? (currentCwd
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? currentCwd)
    : 'No folder selected'

  const { data, loadChildren, openState, refreshRoot, rootError, rootLoading, setNodeOpen } = useProjectTree(currentCwd)

  const chooseFolder = async () => {
    const selected = await window.hermesDesktop?.selectPaths({
      title: 'Change working directory',
      defaultPath: hasCwd ? currentCwd : undefined,
      directories: true,
      multiple: false
    })

    if (selected?.[0]) {
      await onChangeCwd(selected[0])
    }
  }

  const previewFile = async (path: string) => {
    try {
      const preview = await normalizeOrLocalPreviewTarget(path, currentCwd || undefined)

      if (!preview) {
        throw new Error(`Could not preview ${path}`)
      }

      setCurrentSessionPreviewTarget(preview, 'file-browser', path)
    } catch (error) {
      notifyError(error, 'Preview unavailable')
    }
  }

  return (
    <aside
      aria-label="File browser"
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-border/60 bg-[color-mix(in_srgb,var(--dt-sidebar-bg)_94%,transparent)] pt-[calc(var(--titlebar-height)-0.625rem)] text-muted-foreground [backdrop-filter:blur(1.5rem)_saturate(1.08)]"
    >
      <header className="group/project-header shrink-0 pl-4 pr-2 pb-1 pt-0">
        <div className="flex items-center gap-1.5">
          <FadeText
            className="flex-1 px-2 pb-1 pt-1 text-[0.64rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/70"
            title={hasCwd ? currentCwd : 'No folder selected'}
          >
            {cwdName}
          </FadeText>
          <Button
            aria-label="Change working directory"
            className={HEADER_ACTION_CLASS}
            onClick={() => void chooseFolder()}
            size="icon"
            title="Change working directory"
            variant="ghost"
          >
            <FolderOpen className="size-3.5" />
          </Button>
          <Button
            aria-label="Refresh tree"
            className={HEADER_ACTION_CLASS}
            disabled={!hasCwd || rootLoading}
            onClick={() => void refreshRoot()}
            size="icon"
            title="Refresh tree"
            variant="ghost"
          >
            <RefreshCw className={cn('size-3.5', rootLoading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <FileTreeBody
        cwd={currentCwd}
        data={data}
        error={rootError}
        loading={rootLoading}
        onActivateFile={onActivateFile}
        onLoadChildren={loadChildren}
        onNodeOpenChange={setNodeOpen}
        onPreviewFile={previewFile}
        openState={openState}
      />
    </aside>
  )
}

interface FileTreeBodyProps {
  cwd: string
  data: ReturnType<typeof useProjectTree>['data']
  error: string | null
  loading: boolean
  onActivateFile: (path: string) => void
  onLoadChildren: (id: string) => void | Promise<void>
  onNodeOpenChange: (id: string, open: boolean) => void
  onPreviewFile?: (path: string) => void
  openState: ReturnType<typeof useProjectTree>['openState']
}

function FileTreeBody({
  cwd,
  data,
  error,
  loading,
  onActivateFile,
  onLoadChildren,
  onNodeOpenChange,
  onPreviewFile,
  openState
}: FileTreeBodyProps) {
  if (!cwd) {
    return <EmptyState body="Set a working directory from the status bar to browse files." title="No project" />
  }

  if (error) {
    return <EmptyState body={`Could not read this folder (${error}).`} title="Unreadable" />
  }

  if (loading && data.length === 0) {
    return <EmptyState body="Reading project…" title="Loading" />
  }

  if (data.length === 0) {
    return <EmptyState body="This folder is empty." title="Empty" />
  }

  return (
    <ProjectTree
      data={data}
      onActivateFile={onActivateFile}
      onLoadChildren={onLoadChildren}
      onNodeOpenChange={onNodeOpenChange}
      onPreviewFile={onPreviewFile}
      openState={openState}
    />
  )
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
      <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/75">{title}</div>
      <div className="text-[0.68rem] leading-relaxed text-muted-foreground/65">{body}</div>
    </div>
  )
}
