import { useStore } from '@nanostores/react'
import {
  Children,
  type CSSProperties,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react'

import { cn } from '@/lib/utils'
import { $paneStates, ensurePaneRegistered } from '@/store/panes'

import { PaneShellContext, type PaneShellContextValue, type PaneSlot } from './context'

type PaneSide = 'left' | 'right'
type WidthValue = string | number

interface PaneRoleMarker {
  __paneShellRole?: 'pane' | 'main'
}

export interface PaneProps {
  children?: ReactNode
  className?: string
  defaultOpen?: boolean
  /** Forces the pane closed (track→0, aria-hidden) without writing to the store — for transient route gates. */
  disabled?: boolean
  id: string
  maxWidth?: WidthValue
  minWidth?: WidthValue
  resizable?: boolean
  side: PaneSide
  width?: WidthValue
}

export interface PaneMainProps {
  children?: ReactNode
  className?: string
}

export interface PaneShellProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

interface CollectedPane {
  defaultOpen: boolean
  disabled: boolean
  id: string
  side: PaneSide
  width: string
}

const DEFAULT_WIDTH = '16rem'

const widthToCss = (value: WidthValue | undefined, fallback: string) =>
  value === undefined ? fallback : typeof value === 'number' ? `${value}px` : value

function isRole(child: unknown, role: 'pane' | 'main'): child is ReactElement {
  return isValidElement(child) && (child.type as PaneRoleMarker)?.__paneShellRole === role
}

function collectPanes(children: ReactNode) {
  const left: CollectedPane[] = []
  const right: CollectedPane[] = []
  let mainCount = 0

  Children.forEach(children, child => {
    if (isRole(child, 'main')) {
      mainCount++

      return
    }

    if (!isRole(child, 'pane')) {return}

    const props = child.props as PaneProps

    const entry: CollectedPane = {
      defaultOpen: props.defaultOpen ?? true,
      disabled: props.disabled ?? false,
      id: props.id,
      side: props.side,
      width: widthToCss(props.width, DEFAULT_WIDTH)
    }

    ;(props.side === 'left' ? left : right).push(entry)
  })

  return { left, mainCount, right }
}

function trackForPane(pane: CollectedPane, states: Record<string, { open: boolean; widthOverride?: number }>) {
  const stateOpen = states[pane.id]?.open ?? pane.defaultOpen
  const open = !pane.disabled && stateOpen

  if (!open) {return { open: false, track: '0px' }}

  const override = states[pane.id]?.widthOverride

  return { open: true, track: override !== undefined ? `${override}px` : pane.width }
}

export function PaneShell({ children, className, style }: PaneShellProps) {
  const paneStates = useStore($paneStates)
  const { left, mainCount, right } = useMemo(() => collectPanes(children), [children])

  if (import.meta.env.DEV && mainCount > 1) {
    console.warn('[PaneShell] expected at most one <PaneMain>, got', mainCount)
  }

  const ctxValue = useMemo(() => {
    const paneById = new Map<string, PaneSlot>()
    const tracks: string[] = []
    const cssVars: Record<string, string> = {}
    let column = 1

    for (const pane of left) {
      const { open, track } = trackForPane(pane, paneStates)
      tracks.push(track)
      paneById.set(pane.id, { column, open, side: 'left' })
      cssVars[`--pane-${pane.id}-width`] = track
      column++
    }

    tracks.push('minmax(0,1fr)')
    const mainColumn = column++

    for (const pane of right) {
      const { open, track } = trackForPane(pane, paneStates)
      tracks.push(track)
      paneById.set(pane.id, { column, open, side: 'right' })
      cssVars[`--pane-${pane.id}-width`] = track
      column++
    }

    return { cssVars, gridTemplate: tracks.join(' '), mainColumn, paneById } satisfies PaneShellContextValue & {
      cssVars: Record<string, string>
      gridTemplate: string
    }
  }, [left, paneStates, right])

  const composedStyle = useMemo<CSSProperties>(
    () => ({ ...ctxValue.cssVars, ...style, gridTemplateColumns: ctxValue.gridTemplate }),
    [ctxValue.cssVars, ctxValue.gridTemplate, style]
  )

  return (
    <PaneShellContext.Provider value={{ mainColumn: ctxValue.mainColumn, paneById: ctxValue.paneById }}>
      <div className={cn('relative grid h-full min-h-0', className)} style={composedStyle}>
        {children}
      </div>
    </PaneShellContext.Provider>
  )
}

export function Pane({ children, className, defaultOpen = true, disabled = false, id }: PaneProps) {
  const ctx = useContext(PaneShellContext)
  const registered = useRef(false)

  useEffect(() => {
    if (registered.current) {return}
    registered.current = true
    ensurePaneRegistered(id, { open: defaultOpen })
  }, [defaultOpen, id])

  if (!ctx) {
    if (import.meta.env.DEV) {console.warn(`[Pane:${id}] must be rendered inside <PaneShell>`)}

    return null
  }

  const slot = ctx.paneById.get(id)

  if (!slot) {return null}

  const open = slot.open && !disabled

  return (
    <div
      aria-hidden={!open}
      className={cn('row-start-1 min-w-0 overflow-hidden', !open && 'pointer-events-none', className)}
      data-pane-id={id}
      data-pane-open={open ? 'true' : 'false'}
      data-pane-side={slot.side}
      style={{ gridColumn: `${slot.column} / ${slot.column + 1}` }}
    >
      {children}
    </div>
  )
}

;(Pane as unknown as PaneRoleMarker).__paneShellRole = 'pane'

export function PaneMain({ children, className }: PaneMainProps) {
  const ctx = useContext(PaneShellContext)

  if (!ctx) {
    if (import.meta.env.DEV) {console.warn('[PaneMain] must be rendered inside <PaneShell>')}

    return null
  }

  return (
    <div
      className={cn('row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      data-pane-main="true"
      style={{ gridColumn: `${ctx.mainColumn} / ${ctx.mainColumn + 1}` }}
    >
      {children}
    </div>
  )
}

;(PaneMain as unknown as PaneRoleMarker).__paneShellRole = 'main'
