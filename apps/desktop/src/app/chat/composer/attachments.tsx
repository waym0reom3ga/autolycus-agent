import { X } from 'lucide-react'

import type { ComposerAttachment } from '@/store/composer'

import { ATTACHMENT_ICON } from './constants'

export function AttachmentList({
  attachments,
  onRemove
}: {
  attachments: ComposerAttachment[]
  onRemove?: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1">
      {attachments.map(a => (
        <AttachmentPill attachment={a} key={a.id} onRemove={onRemove} />
      ))}
    </div>
  )
}

function AttachmentPill({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove?: (id: string) => void }) {
  const Icon = ATTACHMENT_ICON[attachment.kind]

  return (
    <div className="group/attachment flex max-w-full items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 py-1 pl-1 pr-1.5 text-xs text-foreground/90">
      {attachment.previewUrl ? (
        <img alt="" className="size-9 rounded-xl object-cover" draggable={false} src={attachment.previewUrl} />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background/70 text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium">{attachment.label}</span>
        {attachment.detail && (
          <span className="truncate text-[0.6875rem] text-muted-foreground">{attachment.detail}</span>
        )}
      </span>
      {onRemove && (
        <button
          aria-label={`Remove ${attachment.label}`}
          className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground group-hover/attachment:opacity-100"
          onClick={() => onRemove(attachment.id)}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
