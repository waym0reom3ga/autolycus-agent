import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, ChevronRight, ExternalLink, KeyRound, Loader2, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $desktopOnboarding,
  cancelOnboardingFlow,
  copyDeviceCode,
  type OnboardingContext,
  type OnboardingFlow,
  refreshOnboarding,
  saveOnboardingApiKey,
  setOnboardingCode,
  setOnboardingMode,
  startProviderOAuth,
  submitOnboardingCode
} from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

interface DesktopOnboardingOverlayProps {
  enabled: boolean
  onCompleted?: () => void
  requestGateway: OnboardingContext['requestGateway']
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

const PROVIDER_DISPLAY: Record<string, { order: number; title: string }> = {
  nous: { order: 0, title: 'Nous Portal' },
  anthropic: { order: 1, title: 'Anthropic Claude' },
  'openai-codex': { order: 2, title: 'OpenAI Codex / ChatGPT' },
  'minimax-oauth': { order: 3, title: 'MiniMax' },
  'claude-code': { order: 4, title: 'Claude Code' },
  'qwen-oauth': { order: 5, title: 'Qwen Code' }
}

const FLOW_SUBTITLES: Record<OAuthProvider['flow'], string> = {
  pkce: 'Opens your browser to sign in, then continues here.',
  device_code: 'Opens a verification page in your browser. Hermes connects automatically.',
  external: 'Sign in once in your terminal, then come back to chat.'
}

function providerTitle(provider: OAuthProvider) {
  return PROVIDER_DISPLAY[provider.id]?.title ?? provider.name
}

function sortProviders(providers: OAuthProvider[]) {
  return [...providers].sort((a, b) => {
    const order = (PROVIDER_DISPLAY[a.id]?.order ?? 99) - (PROVIDER_DISPLAY[b.id]?.order ?? 99)

    return order !== 0 ? order : a.name.localeCompare(b.name)
  })
}

export function DesktopOnboardingOverlay({ enabled, onCompleted, requestGateway }: DesktopOnboardingOverlayProps) {
  const onboarding = useStore($desktopOnboarding)
  const visible = (enabled || onboarding.requested) && !onboarding.configured
  const ctxRef = useRef<OnboardingContext>({ requestGateway, onCompleted })
  ctxRef.current = { requestGateway, onCompleted }

  const ctx = useMemo<OnboardingContext>(
    () => ({
      requestGateway: (...args) => ctxRef.current.requestGateway(...args),
      onCompleted: () => ctxRef.current.onCompleted?.()
    }),
    []
  )

  useEffect(() => {
    if (!enabled && !onboarding.requested) {
      return
    }

    void refreshOnboarding(ctx)
  }, [ctx, enabled, onboarding.requested])

  if (!visible) {
    return null
  }

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl">
        <Header />
        <div className="grid gap-5 p-6">
          {onboarding.flow.status === 'idle' || onboarding.flow.status === 'success' ? (
            <Picker ctx={ctx} />
          ) : (
            <FlowPanel ctx={ctx} flow={onboarding.flow} />
          )}
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
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
  )
}

function Picker({ ctx }: { ctx: OnboardingContext }) {
  const { mode, providers } = useStore($desktopOnboarding)
  const ordered = useMemo(() => (providers ? sortProviders(providers) : []), [providers])
  const hasOauth = ordered.length > 0

  return (
    <>
      {hasOauth && (
        <ModeTabs
          mode={mode}
          onChange={setOnboardingMode}
          tabs={[
            { id: 'oauth', label: 'Sign in' },
            { id: 'apikey', label: 'API key' }
          ]}
        />
      )}

      {mode === 'oauth' && hasOauth ? (
        <div className="grid gap-2">
          {providers === null ? (
            <Status icon={<Loader2 className="size-4 animate-spin" />}>Looking up providers...</Status>
          ) : (
            ordered.map(provider => (
              <ProviderRow key={provider.id} onSelect={p => void startProviderOAuth(p, ctx)} provider={provider} />
            ))
          )}
        </div>
      ) : (
        <ApiKeyForm ctx={ctx} />
      )}
    </>
  )
}

interface ModeTab<T extends string> {
  id: T
  label: string
}

interface ModeTabsProps<T extends string> {
  mode: T
  onChange: (mode: T) => void
  tabs: ModeTab<T>[]
}

const TAB_COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4'
}

function ModeTabs<T extends string>({ mode, onChange, tabs }: ModeTabsProps<T>) {
  return (
    <div
      aria-label="Connection method"
      className={cn(
        'grid w-full max-w-xs gap-1 rounded-full border border-border bg-muted/40 p-1 text-xs font-medium',
        TAB_COLS[tabs.length] ?? 'grid-cols-2'
      )}
      role="tablist"
    >
      {tabs.map(tab => (
        <button
          aria-selected={tab.id === mode}
          className={cn(
            'rounded-full px-3 py-1.5 text-center transition',
            tab.id === mode ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function ProviderRow({
  provider,
  onSelect
}: {
  onSelect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const title = providerTitle(provider)
  const loggedIn = provider.status?.logged_in
  const Trail = provider.flow === 'external' ? ExternalLink : ChevronRight

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
          <span className="text-sm font-semibold">{title}</span>
          {loggedIn ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Check className="size-3" />
              Connected
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{FLOW_SUBTITLES[provider.flow]}</p>
      </div>
      <Trail className="size-4 text-muted-foreground transition group-hover:text-foreground" />
    </button>
  )
}

function ApiKeyForm({ ctx }: { ctx: OnboardingContext }) {
  const [option, setOption] = useState<ApiKeyOption>(API_KEY_OPTIONS[0])
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const isLocal = option.envKey === 'OPENAI_BASE_URL'
  const canSave = value.trim().length >= (isLocal ? 1 : 8)

  const submit = async () => {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setError(null)
    const result = await saveOnboardingApiKey(option.envKey, value, option.name, ctx)

    if (!result.ok) {
      setError(result.message ?? 'Could not save credential.')
    } else {
      setValue('')
    }

    setSaving(false)
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {API_KEY_OPTIONS.map(o => (
          <button
            className={cn(
              'rounded-2xl border bg-background/60 p-3 text-left transition hover:bg-accent/50',
              option.id === o.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'
            )}
            key={o.id}
            onClick={() => {
              setOption(o)
              setValue('')
              setError(null)
            }}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{o.name}</span>
              {option.id === o.id ? <Check className="size-4 text-primary" /> : null}
            </div>
            {o.short ? <p className="mt-1 text-xs text-muted-foreground">{o.short}</p> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm leading-6 text-muted-foreground">{option.description}</p>
          {option.docsUrl ? (
            <Button asChild size="xs" variant="ghost">
              <a href={option.docsUrl} rel="noreferrer" target="_blank">
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
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void submit()}
          placeholder={option.placeholder || 'Paste API key'}
          type={isLocal ? 'text' : 'password'}
          value={value}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="flex justify-end">
        <Button disabled={!canSave || saving} onClick={() => void submit()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {saving ? 'Connecting' : 'Connect'}
        </Button>
      </div>
    </div>
  )
}

function FlowPanel({ ctx, flow }: { ctx: OnboardingContext; flow: OnboardingFlow }) {
  const title = 'provider' in flow && flow.provider ? providerTitle(flow.provider) : ''

  if (flow.status === 'starting') {
    return <Status icon={<Loader2 className="size-4 animate-spin" />}>Starting sign-in for {title}...</Status>
  }

  if (flow.status === 'submitting') {
    return <Status icon={<Loader2 className="size-4 animate-spin" />}>Verifying your code with {title}...</Status>
  }

  if (flow.status === 'success') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
        <Check className="size-4" />
        {title} connected. You're ready to chat.
      </div>
    )
  }

  if (flow.status === 'error') {
    return (
      <div className="grid gap-3">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {flow.message || 'Sign-in failed. Try again.'}
        </div>
        <div className="flex justify-end">
          <Button onClick={cancelOnboardingFlow} variant="outline">
            Pick a different provider
          </Button>
        </div>
      </div>
    )
  }

  if (flow.status === 'awaiting_user') {
    return (
      <div className="grid gap-4">
        <div>
          <h3 className="text-sm font-semibold">Sign in with {title}</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>We opened {title} in your browser.</li>
            <li>Authorize Hermes there.</li>
            <li>Copy the authorization code and paste it below.</li>
          </ol>
        </div>
        <Input
          autoFocus
          onChange={event => setOnboardingCode(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void submitOnboardingCode(ctx)}
          placeholder="Paste authorization code"
          value={flow.code}
        />
        <div className="flex items-center justify-between gap-3">
          <Button asChild size="xs" variant="ghost">
            <a href={flow.start.auth_url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-3" />
              Re-open authorization page
            </a>
          </Button>
          <div className="flex gap-2">
            <Button onClick={cancelOnboardingFlow} variant="ghost">
              Cancel
            </Button>
            <Button disabled={!flow.code.trim()} onClick={() => void submitOnboardingCode(ctx)}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (flow.status !== 'polling') {
    return null
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-semibold">Sign in with {title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We opened {title} in your browser. Enter this code there:
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 px-4 py-3">
        <code className="font-mono text-2xl tracking-[0.4em]">{flow.start.user_code}</code>
        <Button onClick={() => void copyDeviceCode()} size="sm" variant="outline">
          {flow.copied ? <Check className="size-4" /> : 'Copy'}
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
        <Button onClick={cancelOnboardingFlow} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Status({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}
