import { Check, Palette } from 'lucide-react'

import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { useTheme } from '@/themes/context'
import { BUILTIN_THEMES } from '@/themes/presets'

import { MODE_OPTIONS } from './constants'
import { prettyName } from './helpers'
import { Pill, SectionHeading, SettingsContent } from './primitives'

function ThemePreview({ name }: { name: string }) {
  const t = BUILTIN_THEMES[name]

  if (!t) {
    return null
  }

  const c = t.colors

  return (
    <div
      className="h-20 overflow-hidden rounded-xl border shadow-xs"
      style={{ backgroundColor: c.background, borderColor: c.border }}
    >
      <div className="flex h-full">
        <div
          className="w-12 border-r"
          style={{
            backgroundColor: c.sidebarBackground ?? c.muted,
            borderColor: c.sidebarBorder ?? c.border
          }}
        />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-2.5 w-16 rounded-full" style={{ backgroundColor: c.foreground }} />
          <div className="h-2 w-24 rounded-full" style={{ backgroundColor: c.mutedForeground }} />
          <div className="mt-auto flex justify-end">
            <div
              className="h-5 w-16 rounded-full border"
              style={{
                backgroundColor: c.userBubble ?? c.muted,
                borderColor: c.userBubbleBorder ?? c.border
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { themeName, mode, availableThemes, setTheme, setMode } = useTheme()
  const activeTheme = availableThemes.find(t => t.name === themeName)

  return (
    <SettingsContent>
      <div className="space-y-7">
        <div>
          <SectionHeading icon={Palette} title="Appearance" />
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These are desktop-only display preferences. Mode controls brightness; theme controls the accent palette and
            chat surface styling.
          </p>
        </div>

        <section className="rounded-2xl border border-border/50 bg-card/55 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Color Mode</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Pick a fixed mode or let Hermes follow your system setting.
              </div>
            </div>
            <Pill>{prettyName(mode)}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map(({ id, label, description, icon: Icon }) => {
              const active = mode === id

              return (
                <button
                  className={cn(
                    'group rounded-xl border border-border/45 bg-background/55 p-3 text-left transition hover:border-primary/35 hover:bg-accent/45',
                    active && 'border-primary/65 bg-primary/8 ring-2 ring-primary/25'
                  )}
                  key={id}
                  onClick={() => {
                    triggerHaptic('crisp')
                    setMode(id)
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground transition group-hover:bg-background">
                      <Icon className="size-4" />
                    </span>
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-3 text-sm font-medium">{label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border/50 bg-card/55 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Desktop palettes only. The selected mode is applied on top.
              </div>
            </div>
            {activeTheme && <Pill>{activeTheme.label}</Pill>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableThemes.map(theme => {
              const active = themeName === theme.name

              return (
                <button
                  className={cn(
                    'rounded-2xl border border-border/45 bg-background/50 p-2.5 text-left transition hover:border-primary/35 hover:bg-accent/35',
                    active && 'border-primary/65 bg-primary/8 ring-2 ring-primary/25'
                  )}
                  key={theme.name}
                  onClick={() => {
                    triggerHaptic('crisp')
                    setTheme(theme.name)
                  }}
                  type="button"
                >
                  <ThemePreview name={theme.name} />
                  <div className="mt-3 flex items-start justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{theme.label}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {theme.description}
                      </div>
                    </div>
                    {active && (
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}
