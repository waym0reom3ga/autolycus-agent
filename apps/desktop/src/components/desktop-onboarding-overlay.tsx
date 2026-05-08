import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getEnvVars, setEnvVar } from '@/hermes'
import { AlertCircle, Check, ExternalLink, KeyRound, Loader2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding, completeDesktopOnboarding } from '@/store/onboarding'
import type { EnvVarInfo } from '@/types/hermes'

interface DesktopOnboardingOverlayProps {
  enabled: boolean
  onCompleted?: () => void
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface SetupStatus {
  provider_configured?: boolean
}

interface ProviderOption {
  key: string
  label: string
  helper: string
}

const PREFERRED_PROVIDER_KEYS: ProviderOption[] = [
  {
    key: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    helper: 'Works with many hosted models and is a good default for new installs.'
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    helper: 'Use Claude models directly.'
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    helper: 'Use OpenAI models directly.'
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini',
    helper: 'Use Google Gemini models.'
  },
  {
    key: 'XAI_API_KEY',
    label: 'xAI',
    helper: 'Use Grok models.'
  },
  {
    key: 'OPENAI_BASE_URL',
    label: 'Local / OpenAI-compatible',
    helper: 'Use a local or self-hosted OpenAI-compatible endpoint. API key may not be required.'
  }
]

function optionLabel(option: ProviderOption, info?: EnvVarInfo) {
  return info?.description ? `${option.label} (${option.key})` : option.label
}

export function DesktopOnboardingOverlay({
  enabled,
  onCompleted,
  requestGateway
}: DesktopOnboardingOverlayProps) {
  const onboarding = useStore($desktopOnboarding)
  const [checking, setChecking] = useState(false)
  const [envVars, setEnvVars] = useState<Record<string, EnvVarInfo> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providerConfigured, setProviderConfigured] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedKey, setSelectedKey] = useState(PREFERRED_PROVIDER_KEYS[0].key)
  const [value, setValue] = useState('')
  const shouldCheck = enabled || onboarding.requested

  useEffect(() => {
    if (!shouldCheck) {
      return
    }

    let cancelled = false

    async function checkSetup() {
      setChecking(true)
      setError(null)

      try {
        const [status, vars] = await Promise.all([requestGateway<SetupStatus>('setup.status'), getEnvVars()])

        if (cancelled) {
          return
        }

        setProviderConfigured(Boolean(status.provider_configured))
        setEnvVars(vars)

        if (status.provider_configured) {
          completeDesktopOnboarding()
        }

        const firstAvailable = PREFERRED_PROVIDER_KEYS.find(option => vars[option.key])

        if (firstAvailable) {
          setSelectedKey(current => (vars[current] ? current : firstAvailable.key))
        }
      } catch (err) {
        if (!cancelled) {
          setProviderConfigured(false)
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) {
          setChecking(false)
        }
      }
    }

    void checkSetup()

    return () => void (cancelled = true)
  }, [requestGateway, shouldCheck])

  const providerOptions = useMemo(
    () => PREFERRED_PROVIDER_KEYS.filter(option => !envVars || envVars[option.key]),
    [envVars]
  )

  const selectedInfo = envVars?.[selectedKey]
  const selectedOption = providerOptions.find(option => option.key === selectedKey) ?? PREFERRED_PROVIDER_KEYS[0]
  const canSave = selectedKey === 'OPENAI_BASE_URL' ? value.trim().length > 0 : value.trim().length > 8

  async function handleSave() {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await setEnvVar(selectedKey, value.trim())
      await requestGateway('reload.env').catch(() => undefined)
      const status = await requestGateway<SetupStatus>('setup.status')

      if (!status.provider_configured) {
        setError('Credential was saved, but Hermes still does not see a configured provider.')

        return
      }

      notify({ kind: 'success', title: 'Hermes is ready', message: `${selectedKey} saved.` })
      setProviderConfigured(true)
      setValue('')
      completeDesktopOnboarding()
      onCompleted?.()
    } catch (err) {
      notifyError(err, `Failed to save ${selectedKey}`)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!shouldCheck || providerConfigured) {
    return null
  }

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl">
        <div className="border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Set up Hermes</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                  Add one inference provider before starting your first chat. This writes to the current Hermes
                  profile's `.env` file and takes effect immediately.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-6">
          {checking ? (
            <div className="flex items-center gap-2 rounded-2xl bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking provider setup...
            </div>
          ) : null}

          {onboarding.reason ? (
            <div className="flex gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{onboarding.reason}</span>
            </div>
          ) : null}

          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Provider</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {providerOptions.map(option => (
                <button
                  className={cn(
                    'rounded-2xl border bg-background/60 p-3 text-left transition hover:bg-accent/50',
                    selectedKey === option.key ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                  )}
                  key={option.key}
                  onClick={() => {
                    setSelectedKey(option.key)
                    setValue('')
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{optionLabel(option, envVars?.[option.key])}</span>
                    {selectedKey === option.key ? <Check className="size-4 text-primary" /> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.helper}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {selectedKey}
              </label>
              {selectedInfo?.url ? (
                <Button asChild size="xs" variant="ghost">
                  <a href={selectedInfo.url} rel="noreferrer" target="_blank">
                    Docs
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              ) : null}
            </div>
            <Input
              autoComplete="off"
              autoFocus
              className="font-mono"
              onChange={event => setValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  void handleSave()
                }
              }}
              placeholder={selectedKey === 'OPENAI_BASE_URL' ? 'http://127.0.0.1:8000/v1' : 'Paste API key'}
              type={selectedInfo?.is_password === false || selectedKey === 'OPENAI_BASE_URL' ? 'text' : 'password'}
              value={value}
            />
            <p className="text-xs leading-5 text-muted-foreground">{selectedOption.helper}</p>
          </div>

          {error ? (
            <div className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end border-t border-border pt-5">
            <Button disabled={!canSave || saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {saving ? 'Saving' : 'Save and continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
