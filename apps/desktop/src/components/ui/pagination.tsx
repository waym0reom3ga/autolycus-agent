import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      aria-label="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      data-slot="pagination"
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul className={cn('flex h-5 flex-row items-center gap-0.5', className)} data-slot="pagination-content" {...props} />
}

function PaginationItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li className={cn('flex h-5 items-center', className)} data-slot="pagination-item" {...props} />
}

interface PaginationButtonProps extends React.ComponentProps<'button'> {
  isActive?: boolean
}

function PaginationButton({ className, isActive, ...props }: PaginationButtonProps) {
  return (
    <button
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-transparent px-1 text-[0.6875rem] leading-none tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-45',
        isActive
          ? 'border-border bg-background text-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className
      )}
      data-active={isActive}
      data-slot="pagination-button"
      type="button"
      {...props}
    />
  )
}

function PaginationPrevious({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      aria-label="Go to previous page"
      className={cn(
        'inline-flex h-5 items-center justify-center gap-0.5 rounded border border-transparent px-1 text-[0.6875rem] leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45',
        className
      )}
      data-slot="pagination-previous"
      type="button"
      {...props}
    >
      <ChevronLeft className="size-3" />
      <span>Prev</span>
    </button>
  )
}

function PaginationNext({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      aria-label="Go to next page"
      className={cn(
        'inline-flex h-5 items-center justify-center gap-0.5 rounded border border-transparent px-1 text-[0.6875rem] leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45',
        className
      )}
      data-slot="pagination-next"
      type="button"
      {...props}
    >
      <span>Next</span>
      <ChevronRight className="size-3" />
    </button>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      className={cn('flex size-5 items-center justify-center', className)}
      data-slot="pagination-ellipsis"
      {...props}
    >
      <MoreHorizontal className="size-3" />
    </span>
  )
}

export {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
}
