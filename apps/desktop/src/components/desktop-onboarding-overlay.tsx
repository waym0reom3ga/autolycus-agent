import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cancelOAuthSession,
  listOAuthProviders,
  pollOAuthSession,
  setEnvVar,
  startOAuthLogin,
  submitOAuthCode
} from '@/hermes'
import { Check, ChevronRight, ExternalLink, KeyRound, Loader2, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding, completeDesktopOnboarding } from '@/store/onboarding'
import type { OAuthProvider, OAuthStartResponse } from '@/types/hermes'

interface DesktopOnboardingOverlayProps {
  enabled: boolean
  onCompleted?: () => void
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface SetupStatus {
  provider_configured?: boolean
}

interface RuntimeCheck {
  error?: string
  ok?: boolean
}

interface ApiKeyOption {
  description: string
  docsUrl: string
  envKey: string
  id: string
  name: string
  placeholder?: string
  short?: string
}

const API_KEY_OPTIONS: ApiKeyOption[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    short: 'one key, many models',
    envKey: 'OPENROUTER_API_KEY',
    description: 'Hosts hundreds of models behind a single key. Good default for new installs.',
    docsUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'GPT-class models',
    envKey: 'OPENAI_API_KEY',
    description: 'Direct access to OpenAI models.',
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    short: 'Gemini models',
    envKey: 'GEMINI_API_KEY',
    description: 'Direct access to Google Gemini models.',
    docsUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    short: 'Grok models',
    envKey: 'XAI_API_KEY',
    description: 'Direct access to xAI Grok models.',
    docsUrl: 'https://console.x.ai/'
  },
  {
    id: 'local',
    name: 'Local / custom endpoint',
    short: 'self-hosted',
    envKey: 'OPENAI_BASE_URL',
    description: 'Point Hermes at a local or self-hosted OpenAI-compatible endpoint (vLLM, llama.cpp, Ollama, etc).',
    docsUrl: 'https://github.com/NousResearch/hermes-agent#bring-your-own-endpoint',
    placeholder: 'http://127.0.0.1:8000/v1'
  }
]

interface FlowState {
  copyState?: 'copied' | 'idle'
  errorMessage?: string
  expiresAt?: number
  provider?: OAuthProvider
  start?: OAuthStartResponse
  status: 'awaiting_user' | 'error' | 'idle' | 'polling' | 'starting' | 'submitting' | 'success'
  submitCode?: string
}

const POLL_INTERVAL_MS = 2000

export function DesktopOnboardingOverlay({
  enabled,
  onCompleted,
  requestGateway
}: DesktopOnboardingOverlayProps) {
  const onboarding = useStore($desktopOnboarding)
  const [providerConfigured, setProviderConfigured] = useState(true)
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[] | null>(null)
  const [mode, setMode] = useState<'apikey' | 'oauth'>('oauth')
  const [flow, setFlow] = useState<FlowState>({ status: 'idle' })
  const [apiKeyOption, setApiKeyOption] = useState<ApiKeyOption>(API_KEY_OPTIONS[0])
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const pollTimerRef = useRef<number | null>(null)
  const shouldShow = enabled || onboarding.requested

  const refreshSetupCheck = useMemo(
    () => async () => {
      try {
        const [status, runtime] = await Promise.all([
          requestGateway<SetupStatus>('setup.status').catch(() => ({}) as SetupStatus),
          requestGateway<RuntimeCheck>('setup.runtime_check').catch(() => ({ ok: false }) as RuntimeCheck)
        ])

        return runtime.ok !== undefined ? Boolean(runtime.ok) : Boolean(status.provider_configured)
      } catch {
        return false
      }
    },
    [requestGateway]
  )

  useEffect(() => {
    if (!shouldShow) {
      return
    }

    cancelledRef.current = false

    void (async () => {
      const ok = await refreshSetupCheck()

      if (cancelledRef.current) {
        return
      }

      setProviderConfigured(ok)

      if (ok) {
        completeDesktopOnboarding()

        return
      }

      try {
        const providers = await listOAuthProviders()

        if (cancelledRef.current) {
          return
        }

        setOauthProviders(providers.providers)
        setMode(providers.providers.length > 0 ? 'oauth' : 'apikey')
      } catch {
        if (!cancelledRef.current) {
          setOauthProviders([])
          setMode('apikey')
        }
      }
    })()

    return () => {
      cancelledRef.current = true
    }
  }, [refreshSetupCheck, shouldShow])

  useEffect(
    () => () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }

      if (flow.start?.session_id && flow.status !== 'success' && flow.status !== 'idle') {
        cancelOAuthSession(flow.start.session_id).catch(() => undefined)
      }
    },
    [flow.start?.session_id, flow.status]
  )

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  async function finalizeSuccess(providerName: string) {
    clearPollTimer()
    notify({ kind: 'success', title: 'Hermes is ready', message: `${providerName} connected.` })
    setFlow({ status: 'success' })

    try {
      await requestGateway('reload.env').catch(() => undefined)
    } catch {
      // best effort env reload
    }

    const ok = await refreshSetupCheck()

    if (ok) {
      setProviderConfigured(true)
      completeDesktopOnboarding()
      onCompleted?.()
    } else {
      setFlow({
        status: 'error',
        errorMessage: 'Connected, but Hermes still cannot resolve a usable provider. Try another provider.'
      })
    }
  }

  async function startProviderFlow(provider: OAuthProvider) {
    if (provider.flow === 'external') {
      notify({
        kind: 'info',
        title: `${provider.name} uses an external CLI`,
        message: `Run \`${provider.cli_command}\` in a terminal, then come back to retry.`
      })

      return
    }

    clearPollTimer()
    setFlow({ status: 'starting', provider })

    try {
      const start = await startOAuthLogin(provider.id)
      const expiresAt = Date.now() + start.expires_in * 1000

      if (start.flow === 'pkce') {
        await window.hermesDesktop?.openExternal(start.auth_url).catch(() => undefined)
        setFlow({ status: 'awaiting_user', provider, start, expiresAt })

        return
      }

      await window.hermesDesktop?.openExternal(start.verification_url).catch(() => undefined)
      setFlow({ status: 'polling', provider, start, expiresAt })
      pollTimerRef.current = window.setInterval(() => void pollOAuth(provider, start), POLL_INTERVAL_MS)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlow({ status: 'error', provider, errorMessage: `Could not start sign-in: ${message}` })
    }
  }

  async function pollOAuth(provider: OAuthProvider, start: OAuthStartResponse) {
    if (start.flow !== 'device_code') {
      return
    }

    try {
      const resp = await pollOAuthSession(provider.id, start.session_id)

      if (resp.status === 'approved') {
        clearPollTimer()
        await finalizeSuccess(provider.name)
      } else if (resp.status !== 'pending') {
        clearPollTimer()
        setFlow({
          status: 'error',
          provider,
          start,
          errorMessage: resp.error_message || `Sign-in ${resp.status}.`
        })
      }
    } catch (err) {
      clearPollTimer()
      const message = err instanceof Error ? err.message : String(err)
      setFlow({ status: 'error', provider, start, errorMessage: `Polling failed: ${message}` })
    }
  }

  async function submitPkce() {
    if (flow.status !== 'awaiting_user' || !flow.provider || flow.start?.flow !== 'pkce') {
      return
    }

    const code = (flow.submitCode || '').trim()

    if (!code) {
      return
    }

    const provider = flow.provider
    const start = flow.start
    setFlow(prev => ({ ...prev, status: 'submitting' }))

    try {
      const resp = await submitOAuthCode(provider.id, start.session_id, code)

      if (resp.ok && resp.status === 'approved') {
        await finalizeSuccess(provider.name)
      } else {
        setFlow({ status: 'error', provider, start, errorMessage: resp.message || 'Token exchange failed.' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFlow({ status: 'error', provider, start, errorMessage: message })
    }
  }

  function cancelFlow() {
    clearPollTimer()

    if (flow.start?.session_id) {
      cancelOAuthSession(flow.start.session_id).catch(() => undefined)
    }

    setFlow({ status: 'idle' })
  }

  async function copyDeviceCode() {
    if (flow.start?.flow !== 'device_code') {
      return
    }

    try {
      await navigator.clipboard.writeText(flow.start.user_code)
      setFlow(prev => ({ ...prev, copyState: 'copied' }))
      window.setTimeout(() => setFlow(prev => ({ ...prev, copyState: 'idle' })), 1500)
    } catch {
      // clipboard write blocked; user can still type the code manually
    }
  }

  async function saveApiKey() {
    const value = apiKeyValue.trim()
    const minLen = apiKeyOption.envKey === 'OPENAI_BASE_URL' ? 1 : 8

    if (!value || value.length < minLen || apiKeySaving) {
      return
    }

    setApiKeySaving(true)
    setApiKeyError(null)

    try {
      await setEnvVar(apiKeyOption.envKey, value)
      await requestGateway('reload.env').catch(() => undefined)
      const ok = await refreshSetupCheck()

      if (ok) {
        notify({ kind: 'success', title: 'Hermes is ready', message: `${apiKeyOption.name} connected.` })
        setProviderConfigured(true)
        completeDesktopOnboarding()
        setApiKeyValue('')
        onCompleted?.()
      } else {
        setApiKeyError(`Saved, but Hermes still cannot reach ${apiKeyOption.name}. Double-check the value.`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notifyError(err, `Could not save ${apiKeyOption.name}`)
      setApiKeyError(message)
    } finally {
      setApiKeySaving(false)
    }
  }

  if (!shouldShow || providerConfigured) {
    return null
  }

  const oauthList = oauthProviders ?? []

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl">
        <div className="border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Welcome to Hermes</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                Connect a model provider to start chatting. Most options take one click.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-6">
          {flow.status === 'idle' || flow.status === 'success' ? (
            <ProviderPicker
              apiKeyError={apiKeyError}
              apiKeyOption={apiKeyOption}
              apiKeySaving={apiKeySaving}
              apiKeyValue={apiKeyValue}
              loading={oauthProviders === null}
              mode={mode}
              oauthProviders={oauthList}
              onApiKeySave={() => void saveApiKey()}
              onApiKeySelect={setApiKeyOption}
              onApiKeyValueChange={setApiKeyValue}
              onModeChange={setMode}
              onProviderSelect={provider => void startProviderFlow(provider)}
            />
          ) : (
            <FlowPanel
              flow={flow}
              onCancel={cancelFlow}
              onCopyCode={() => void copyDeviceCode()}
              onSubmitCode={() => void submitPkce()}
              onSubmitCodeChange={code => setFlow(prev => ({ ...prev, submitCode: code }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface ProviderPickerProps {
  apiKeyError: null | string
  apiKeyOption: ApiKeyOption
  apiKeySaving: boolean
  apiKeyValue: string
  loading: boolean
  mode: 'apikey' | 'oauth'
  oauthProviders: OAuthProvider[]
  onApiKeySave: () => void
  onApiKeySelect: (option: ApiKeyOption) => void
  onApiKeyValueChange: (value: string) => void
  onModeChange: (mode: 'apikey' | 'oauth') => void
  onProviderSelect: (provider: OAuthProvider) => void
}

function ProviderPicker({
  apiKeyError,
  apiKeyOption,
  apiKeySaving,
  apiKeyValue,
  loading,
  mode,
  oauthProviders,
  onApiKeySave,
  onApiKeySelect,
  onApiKeyValueChange,
  onModeChange,
  onProviderSelect
}: ProviderPickerProps) {
  const hasOauth = oauthProviders.length > 0
  const minLen = apiKeyOption.envKey === 'OPENAI_BASE_URL' ? 1 : 8
  const canSave = apiKeyValue.trim().length >= minLen

  return (
    <>
      {hasOauth && (
        <div className="flex gap-1 rounded-full border border-border bg-muted/40 p-1 self-start text-xs font-medium">
          <button
            className={cn(
              'rounded-full px-3 py-1 transition',
              mode === 'oauth' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onModeChange('oauth')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={cn(
              'rounded-full px-3 py-1 transition',
              mode === 'apikey' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onModeChange('apikey')}
            type="button"
          >
            Use an API key
          </button>
        </div>
      )}

      {mode === 'oauth' && hasOauth ? (
        <div className="grid gap-2">
          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Looking up providers...
            </div>
          ) : (
            oauthProviders.map(provider => (
              <ProviderRow key={provider.id} onSelect={onProviderSelect} provider={provider} />
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {API_KEY_OPTIONS.map(option => (
              <button
                className={cn(
                  'rounded-2xl border bg-background/60 p-3 text-left transition hover:bg-accent/50',
                  apiKeyOption.id === option.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                )}
                key={option.id}
                onClick={() => onApiKeySelect(option)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{option.name}</span>
                  {apiKeyOption.id === option.id ? <Check className="size-4 text-primary" /> : null}
                </div>
                {option.short ? <p className="mt-1 text-xs text-muted-foreground">{option.short}</p> : null}
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm leading-6 text-muted-foreground">{apiKeyOption.description}</p>
              {apiKeyOption.docsUrl ? (
                <Button asChild size="xs" variant="ghost">
                  <a href={apiKeyOption.docsUrl} rel="noreferrer" target="_blank">
                    Get a key
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              ) : null}
            </div>
            <Input
              autoComplete="off"
              autoFocus
              className="font-mono"
              onChange={event => onApiKeyValueChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  onApiKeySave()
                }
              }}
              placeholder={apiKeyOption.placeholder || 'Paste API key'}
              type={apiKeyOption.envKey === 'OPENAI_BASE_URL' ? 'text' : 'password'}
              value={apiKeyValue}
            />
            {apiKeyError ? <p className="text-xs text-destructive">{apiKeyError}</p> : null}
          </div>

          <div className="flex justify-end">
            <Button disabled={!canSave || apiKeySaving} onClick={onApiKeySave}>
              {apiKeySaving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {apiKeySaving ? 'Connecting' : 'Connect'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function ProviderRow({
  provider,
  onSelect
}: {
  provider: OAuthProvider
  onSelect: (provider: OAuthProvider) => void
}) {
  const isExternal = provider.flow === 'external'
  const loggedIn = provider.status?.logged_in

  return (
    <button
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-4 text-left transition hover:border-primary/40 hover:bg-accent/40',
        loggedIn && 'border-primary/30'
      )}
      onClick={() => onSelect(provider)}
      type="button"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Sign in with {provider.name}</span>
          {loggedIn ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Check className="size-3" />
              Connected
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {isExternal ? `Use the ${provider.name} CLI: ${provider.cli_command}` : flowSubtitle(provider.flow)}
        </p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:text-foreground" />
    </button>
  )
}

function flowSubtitle(flow: OAuthProvider['flow']) {
  if (flow === 'pkce') {
    return 'Opens your browser, asks you to paste a one-time code back here.'
  }

  if (flow === 'device_code') {
    return 'Opens a verification page in your browser. Hermes connects automatically.'
  }

  return ''
}

interface FlowPanelProps {
  flow: FlowState
  onCancel: () => void
  onCopyCode: () => void
  onSubmitCode: () => void
  onSubmitCodeChange: (code: string) => void
}

function FlowPanel({ flow, onCancel, onCopyCode, onSubmitCode, onSubmitCodeChange }: FlowPanelProps) {
  if (flow.status === 'starting') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Starting sign-in for {flow.provider?.name}...
      </div>
    )
  }

  if (flow.status === 'submitting') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Verifying your code with {flow.provider?.name}...
      </div>
    )
  }

  if (flow.status === 'success') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
        <Check className="size-4" />
        {flow.provider?.name} connected. You're ready to chat.
      </div>
    )
  }

  if (flow.status === 'error') {
    return (
      <div className="grid gap-3">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {flow.errorMessage || 'Sign-in failed. Try again.'}
        </div>
        <div className="flex justify-end">
          <Button onClick={onCancel} variant="outline">
            Pick a different provider
          </Button>
        </div>
      </div>
    )
  }

  if (flow.status === 'awaiting_user' && flow.start?.flow === 'pkce' && flow.provider) {
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="text-sm font-semibold">Sign in with {flow.provider.name}</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>We opened {flow.provider.name} in your browser.</li>
            <li>Authorize Hermes there.</li>
            <li>Copy the authorization code and paste it below.</li>
          </ol>
        </div>
        <Input
          autoFocus
          onChange={event => onSubmitCodeChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              onSubmitCode()
            }
          }}
          placeholder="Paste authorization code"
          value={flow.submitCode || ''}
        />
        <div className="flex items-center justify-between gap-3">
          <Button asChild size="xs" variant="ghost">
            <a href={flow.start.auth_url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-3" />
              Re-open authorization page
            </a>
          </Button>
          <div className="flex gap-2">
            <Button onClick={onCancel} variant="ghost">
              Cancel
            </Button>
            <Button disabled={!(flow.submitCode || '').trim()} onClick={onSubmitCode}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (flow.status === 'polling' && flow.start?.flow === 'device_code' && flow.provider) {
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="text-sm font-semibold">Sign in with {flow.provider.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            We opened {flow.provider.name} in your browser. Enter this code there:
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 px-4 py-3">
          <code className="font-mono text-2xl tracking-[0.4em]">{flow.start.user_code}</code>
          <Button onClick={onCopyCode} size="sm" variant="outline">
            {flow.copyState === 'copied' ? <Check className="size-4" /> : 'Copy'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button asChild size="xs" variant="ghost">
            <a href={flow.start.verification_url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-3" />
              Re-open verification page
            </a>
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Waiting for you to authorize...
          </div>
          <Button onClick={onCancel} size="sm" variant="ghost">
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Working...
    </div>
  )
}
