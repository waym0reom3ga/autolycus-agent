import { Layers3 } from 'lucide-react'
import type * as React from 'react'

import { titlebarHeaderClass } from '../shell/titlebar'

export function ArtifactsView(props: React.ComponentProps<'section'>) {
  return (
    <section
      {...props}
      className="flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-background"
    >
      <header className={titlebarHeaderClass}>
        <h2 className="text-base font-semibold leading-none tracking-tight">Artifacts</h2>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
        <div className="max-w-md space-y-3">
          <Layers3 className="mx-auto size-8 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Artifacts view is ready</h3>
          <p className="text-sm text-muted-foreground">
            Generated files and visual outputs now have a dedicated route and view module instead of being folded into
            App.tsx.
          </p>
        </div>
      </div>
    </section>
  )
}
