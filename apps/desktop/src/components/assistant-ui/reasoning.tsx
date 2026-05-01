'use client'

// Minimal reasoning stubs — not surfaced by the Hermes gateway yet.
import { type ReactNode } from 'react'

export const ReasoningRoot = ({ children }: { children: ReactNode; defaultOpen?: boolean }) => (
  <div className="my-1">{children}</div>
)
export const ReasoningTrigger = (_props: { active?: boolean }) => null
export const ReasoningContent = ({ children, 'aria-busy': _busy }: { children: ReactNode; 'aria-busy'?: boolean }) => (
  <div className="border-l-2 border-border pl-3 text-xs text-muted-foreground">{children}</div>
)
export const ReasoningText = ({ children }: { children: ReactNode }) => <div>{children}</div>
export const Reasoning = (_props: object) => null
