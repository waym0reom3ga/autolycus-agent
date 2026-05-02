import { FileText, FolderOpen, ImageIcon, Link, X } from 'lucide-react'

import type { ComposerAttachment } from '@/store/composer'

export function AttachmentList({
  attachments,
  onRemove
}: {
  attachments: ComposerAttachment[]
  onRemove?: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 px-1 pt-1">
      {attachments.map(a => (
        <AttachmentPill attachment={a} key={a.id} onRemove={onRemove} />
      ))}
    </div>
  )
}

function AttachmentPill({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove?: (id: string) => void }) {
  const Icon = { folder: FolderOpen, url: Link, image: ImageIcon, file: FileText }[attachment.kind]

  return (
    <div
      className="group/attachment relative shrink-0"
      title={attachment.label}
    >
      {attachment.previewUrl && attachment.kind === 'image' ? (
        <img
          alt={attachment.label}
          className="size-7 rounded-md border border-border/70 object-cover"
          draggable={false}
          src={attachment.previewUrl}
        />
      ) : (
        <span className="grid size-7 place-items-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
      )}
      {onRemove && (
        <button
          aria-label={`Remove ${attachment.label}`}
          className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full border border-border/70 bg-background text-muted-foreground opacity-0 shadow-xs transition hover:bg-accent hover:text-foreground group-hover/attachment:opacity-100 focus-visible:opacity-100"
          onClick={() => onRemove(attachment.id)}
          type="button"
        >
          <X className="size-2.5" />
        </button>
      )}
    </div>
  )
}
