import type { ReactNode } from 'react'

export function RailSectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground/90">{children}</div>
}

interface RailSectionProps {
  title: string
  children: ReactNode
}

export function RailSection({ title, children }: RailSectionProps) {
  return (
    <section className="grid gap-1.5 py-1.5">
      <RailSectionLabel>{title}</RailSectionLabel>
      {children}
    </section>
  )
}
