import type { ComponentProps, CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface FadeTextProps extends Omit<ComponentProps<'span'>, 'children'> {
  children: React.ReactNode
  /**
   * Width of the fade region on the trailing edge. Accepts any CSS length.
   * Defaults to 3rem so long strings clearly trail off — short enough to
   * preserve readable content, long enough to feel like a deliberate fade
   * rather than a clipped ellipsis.
   */
  fadeWidth?: string
}

/**
 * Single-line text that fades out instead of truncating with an ellipsis.
 *
 * Uses an inline mask-image so the fade resolves against whatever the parent
 * background is — no need to know the surface color, no after-pseudo overlap.
 * The mask is only applied when the text is actually overflowing, so short
 * strings render as plain text without an unnecessary gradient on their tail.
 */
export function FadeText({ children, className, fadeWidth = '3rem', style, ...rest }: FadeTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current

    if (!el) {
      return
    }

    const measure = () => {
      setOverflowing(el.scrollWidth - el.clientWidth > 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)

    return () => observer.disconnect()
  }, [children])

  const maskStyle: CSSProperties = overflowing
    ? {
        maskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}), transparent)`,
        WebkitMaskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}), transparent)`,
        ...style
      }
    : style ?? {}

  return (
    <span
      {...rest}
      className={cn('block min-w-0 max-w-full overflow-hidden whitespace-nowrap', className)}
      ref={ref}
      style={maskStyle}
    >
      {children}
    </span>
  )
}
