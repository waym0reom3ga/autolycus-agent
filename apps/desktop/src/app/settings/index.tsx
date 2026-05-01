import { Download, KeyRound, Package, RotateCcw, Search, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getHermesConfigDefaults, getHermesConfigRecord, saveHermesConfig } from '@/hermes'
import { triggerHaptic } from '@/lib/haptics'
import { notifyError } from '@/store/notifications'

import { AppearanceSettings } from './appearance-settings'
import { ConfigSettings } from './config-settings'
import { SEARCH_PLACEHOLDER, SECTIONS } from './constants'
import { KeysSettings } from './keys-settings'
import { NavLink } from './primitives'
import { ToolsSettings } from './tools-settings'
import type { SettingsPageProps, SettingsQueryKey, SettingsView as SettingsViewId } from './types'

export function SettingsView({ onClose, onConfigSaved }: SettingsPageProps) {
  const [activeView, setActiveView] = useState<SettingsViewId>('config:model')

  const [queries, setQueries] = useState<Record<SettingsQueryKey, string>>({
    config: '',
    keys: '',
    tools: ''
  })

  const searchInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const queryKey: SettingsQueryKey = activeView.startsWith('config:') ? 'config' : (activeView as SettingsQueryKey)
  const query = queries[queryKey]
  const setQuery = (next: string) => setQueries(c => ({ ...c, [queryKey]: next }))

  const exportConfig = async () => {
    try {
      const cfg = await getHermesConfigRecord()
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hermes-config.json'
      a.click()
      URL.revokeObjectURL(url)
      triggerHaptic('success')
    } catch (err) {
      notifyError(err, 'Export failed')
    }
  }

  const resetConfig = async () => {
    if (!window.confirm('Reset all settings to Hermes defaults?')) {
      return
    }

    try {
      await saveHermesConfig(await getHermesConfigDefaults())
      triggerHaptic('success')
      onConfigSaved?.()
    } catch (err) {
      notifyError(err, 'Reset failed')
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        triggerHaptic('close')
        onClose()

        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-60 flex min-h-0 flex-col bg-background/98 p-0.75 backdrop-blur-xl">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 h-[calc(var(--titlebar-height)+0.1875rem)] [-webkit-app-region:drag]">
        <div className="pointer-events-auto absolute left-1/2 top-[calc(1rem+var(--titlebar-height)/2)] w-[min(36rem,calc(100vw-32rem))] min-w-80 -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <Input
            className="h-9 rounded-full border-transparent bg-background py-2 pl-8 pr-20 text-sm shadow-header focus-visible:bg-background"
            onChange={e => setQuery(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[queryKey]}
            ref={searchInputRef}
            value={query}
          />
          {query ? (
            <Button
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
              size="icon-xs"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          ) : (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-background/80 px-1.5 py-0.5 text-[0.62rem] leading-none text-muted-foreground shadow-xs">
              Cmd P
            </span>
          )}
        </div>

        <Button
          aria-label="Close settings"
          className="pointer-events-auto absolute right-3.75 top-[calc(0.1875rem+var(--titlebar-height)/2)] h-7 w-7 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-accent/70 hover:text-foreground [-webkit-app-region:no-drag]"
          onClick={() => {
            triggerHaptic('close')
            onClose()
          }}
          size="icon"
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] rounded-[1.0625rem] bg-background/90 pt-(--titlebar-height) max-[760px]:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto bg-muted/20 px-4 py-5">
          {SECTIONS.map(s => {
            const view = `config:${s.id}` as SettingsViewId

            return (
              <NavLink
                active={activeView === view && !queries.config.trim()}
                icon={s.icon}
                key={s.id}
                label={s.label}
                onClick={() => setActiveView(view)}
              />
            )
          })}
          <div className="my-2 h-px bg-border/30" />
          <NavLink
            active={activeView === 'keys'}
            icon={KeyRound}
            label="API Keys"
            onClick={() => setActiveView('keys')}
          />
          <NavLink
            active={activeView === 'tools'}
            icon={Package}
            label="Skills & Tools"
            onClick={() => setActiveView('tools')}
          />
          <div className="mt-auto flex items-center gap-1 pt-2">
            <Button
              className="text-muted-foreground"
              onClick={() => void exportConfig()}
              size="icon-xs"
              title="Export config"
              variant="ghost"
            >
              <Download />
            </Button>
            <Button
              className="text-muted-foreground"
              onClick={() => {
                triggerHaptic('open')
                importInputRef.current?.click()
              }}
              size="icon-xs"
              title="Import config"
              variant="ghost"
            >
              <Upload />
            </Button>
            <Button
              className="text-muted-foreground"
              onClick={() => {
                triggerHaptic('warning')
                void resetConfig()
              }}
              size="icon-xs"
              title="Reset to defaults"
              variant="ghost"
            >
              <RotateCcw />
            </Button>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeView === 'config:appearance' ? (
            <AppearanceSettings />
          ) : activeView.startsWith('config:') ? (
            <ConfigSettings
              activeSectionId={activeView.slice('config:'.length)}
              importInputRef={importInputRef}
              onConfigSaved={onConfigSaved}
              query={queries.config}
            />
          ) : activeView === 'keys' ? (
            <KeysSettings query={queries.keys} />
          ) : (
            <ToolsSettings query={queries.tools} />
          )}
        </main>
      </div>
    </div>
  )
}

export { SettingsView as SettingsPage }
