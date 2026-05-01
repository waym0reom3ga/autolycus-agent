'use client'

import { type ReactNode } from 'react'

export const ToolGroupRoot = ({ children }: { children: ReactNode }) => (
  <div className="my-2 flex flex-col gap-1">{children}</div>
)
export const ToolGroupTrigger = (_props: { count?: number; active?: boolean }) => null
export const ToolGroupContent = ({ children }: { children: ReactNode }) => <div>{children}</div>
