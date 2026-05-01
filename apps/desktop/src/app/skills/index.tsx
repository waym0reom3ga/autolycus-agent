import { Sparkles } from 'lucide-react'
import type * as React from 'react'

import { titlebarHeaderClass } from '../shell/titlebar'

export function SkillsView(props: React.ComponentProps<'section'>) {
  return (
    <section
      {...props}
      className="flex h-[calc(100vh-0.375rem)] min-w-0 flex-col overflow-hidden rounded-[0.9375rem] bg-background"
    >
      <header className={titlebarHeaderClass}>
        <h2 className="text-base font-semibold leading-none tracking-tight">Skills</h2>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center px-8 text-center">
        <div className="max-w-md space-y-3">
          <Sparkles className="mx-auto size-8 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Skills view is ready</h3>
          <p className="text-sm text-muted-foreground">
            Skill management already lives in Settings. This route gives it a dedicated view boundary so the real screen
            can move here without touching the app shell again.
          </p>
        </div>
      </div>
    </section>
  )
}
