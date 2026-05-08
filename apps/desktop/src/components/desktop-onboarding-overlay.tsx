import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, ChevronLeft, ChevronRight, ExternalLink, KeyRound, Loader2, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $desktopBoot, type DesktopBootState } from '@/store/boot'
import {
  $desktopOnboarding,
  cancelOnboardingFlow,
  copyDeviceCode,
  copyExternalCommand,
  type OnboardingContext,
  type OnboardingFlow,
  recheckExternalSignin,
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

const MIN_KEY_LENGTH = 8

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

const providerTitle = (p: OAuthProvider) => PROVIDER_DISPLAY[p.id]?.title ?? p.name
const orderOf = (p: OAuthProvider) => PROVIDER_DISPLAY[p.id]?.order ?? 99

const sortProviders = (providers: OAuthProvider[]) =>
  [...providers].sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name))

export function DesktopOnboardingOverlay({ enabled, onCompleted, requestGateway }: DesktopOnboardingOverlayProps) {
  const onboarding = useStore($desktopOnboarding)
  const boot = useStore($desktopBoot)
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
    if (enabled || onboarding.requested) {
      void refreshOnboarding(ctx)
    }
  }, [ctx, enabled, onboarding.requested])

  // Mount from frame 1 so we replace the boot overlay seamlessly. The
  // configured field stays null until the runtime check resolves; only then
  // do we know whether to dismiss (true) or surface the picker (false).
  if (onboarding.configured === true) {
    return null
  }

  const { flow } = onboarding
  const ready = enabled && onboarding.configured === false
  const showPicker = flow.status === 'idle' || flow.status === 'success'

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card/95 shadow-2xl">
        <Header />
        <div className="grid gap-5 p-6">
          {ready ? (
            showPicker ? (
              <Picker ctx={ctx} />
            ) : (
              <FlowPanel ctx={ctx} flow={flow} />
            )
          ) : (
            <Preparing boot={boot} />
          )}
        </div>
      </div>
    </div>
  )
}

function Preparing({ boot }: { boot: DesktopBootState }) {
  const progress = Math.max(2, Math.min(100, Math.round(boot.progress)))
  const hasError = Boolean(boot.error)

  return (
    <div className="grid gap-3" role="status">
      <p className="text-sm text-muted-foreground">
        While we get you set up — Hermes is finishing install. This usually takes under a minute on first run.
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
            hasError && 'bg-destructive'
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{boot.message}</span>
        <span>{progress}%</span>
      </div>
      {hasError ? <p className="text-xs text-destructive">{boot.error}</p> : null}
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

  if (mode === 'apikey' || !hasOauth) {
    return <ApiKeyForm canGoBack={hasOauth} ctx={ctx} />
  }

  return (
    <div className="grid gap-3">
      {providers === null ? (
        <Status>Looking up providers...</Status>
      ) : (
        ordered.map(provider => (
          <ProviderRow key={provider.id} onSelect={p => void startProviderOAuth(p, ctx)} provider={provider} />
        ))
      )}
      <FooterLink onClick={() => setOnboardingMode('apikey')}>I have an API key</FooterLink>
    </div>
  )
}

function FooterLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div className="pt-2 text-center">
      <button
        className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </div>
  )
}

function ProviderRow({ onSelect, provider }: { onSelect: (provider: OAuthProvider) => void; provider: OAuthProvider }) {
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
          <span className="text-sm font-semibold">{providerTitle(provider)}</span>
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

function ApiKeyForm({ canGoBack, ctx }: { canGoBack: boolean; ctx: OnboardingContext }) {
  const [option, setOption] = useState<ApiKeyOption>(API_KEY_OPTIONS[0])
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const isLocal = option.envKey === 'OPENAI_BASE_URL'
  const canSave = value.trim().length >= (isLocal ? 1 : MIN_KEY_LENGTH)

  const submit = async () => {
    if (!canSave || saving) {
      return
    }

    setSaving(true)
    setError(null)
    const result = await saveOnboardingApiKey(option.envKey, value, option.name, ctx)

    if (result.ok) {
      setValue('')
    } else {
      setError(result.message ?? 'Could not save credential.')
    }

    setSaving(false)
  }

  return (
    <div className="grid gap-4">
      {canGoBack ? (
        <button
          className="-mt-1 flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setOnboardingMode('oauth')}
          type="button"
        >
          <ChevronLeft className="size-3" />
          Back to sign in
        </button>
      ) : null}

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
          {option.docsUrl ? <DocsLink href={option.docsUrl}>Get a key</DocsLink> : null}
        </div>
        <Input
          autoComplete="off"
          autoFocus
          className="font-mono"
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
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
    return <Status>Starting sign-in for {title}...</Status>
  }

  if (flow.status === 'submitting') {
    return <Status>Verifying your code with {title}...</Status>
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
      <Step title={`Sign in with ${title}`}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>We opened {title} in your browser.</li>
          <li>Authorize Hermes there.</li>
          <li>Copy the authorization code and paste it below.</li>
        </ol>
        <Input
          autoFocus
          onChange={e => setOnboardingCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submitOnboardingCode(ctx)}
          placeholder="Paste authorization code"
          value={flow.code}
        />
        <FlowFooter left={<DocsLink href={flow.start.auth_url}>Re-open authorization page</DocsLink>}>
          <CancelBtn />
          <Button disabled={!flow.code.trim()} onClick={() => void submitOnboardingCode(ctx)}>
            Continue
          </Button>
        </FlowFooter>
      </Step>
    )
  }

  if (flow.status === 'external_pending') {
    return (
      <Step title={`Sign in with ${title}`}>
        <p className="text-sm text-muted-foreground">
          {title} signs in through its own CLI. Run this command in a terminal, then come back and pick "I've signed
          in":
        </p>
        <CodeBlock copied={flow.copied} onCopy={() => void copyExternalCommand()} text={flow.provider.cli_command} />
        <FlowFooter left={flow.provider.docs_url ? <DocsLink href={flow.provider.docs_url}>{title} docs</DocsLink> : null}>
          <CancelBtn />
          <Button onClick={() => void recheckExternalSignin(ctx)}>
            <Check className="size-4" />
            I've signed in
          </Button>
        </FlowFooter>
      </Step>
    )
  }

  if (flow.status !== 'polling') {
    return null
  }

  return (
    <Step title={`Sign in with ${title}`}>
      <p className="text-sm text-muted-foreground">We opened {title} in your browser. Enter this code there:</p>
      <CodeBlock copied={flow.copied} large onCopy={() => void copyDeviceCode()} text={flow.start.user_code} />
      <FlowFooter left={<DocsLink href={flow.start.verification_url}>Re-open verification page</DocsLink>}>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Waiting for you to authorize...
        </span>
        <CancelBtn size="sm" />
      </FlowFooter>
    </Step>
  )
}

function Step({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="grid gap-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function CodeBlock({
  copied,
  large,
  onCopy,
  text
}: {
  copied: boolean
  large?: boolean
  onCopy: () => void
  text: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 px-4 py-3">
      <code className={cn('font-mono', large ? 'text-2xl tracking-[0.4em]' : 'text-sm')}>{text}</code>
      <Button onClick={onCopy} size="sm" variant="outline">
        {copied ? <Check className="size-4" /> : 'Copy'}
      </Button>
    </div>
  )
}

function FlowFooter({ children, left }: { children: React.ReactNode; left?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">{left}</div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  )
}

function CancelBtn({ size = 'default' }: { size?: 'default' | 'sm' }) {
  return (
    <Button onClick={cancelOnboardingFlow} size={size} variant="ghost">
      Cancel
    </Button>
  )
}

function DocsLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Button asChild size="xs" variant="ghost">
      <a href={href} rel="noreferrer" target="_blank">
        <ExternalLink className="size-3" />
        {children}
      </a>
    </Button>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {children}
    </div>
  )
}
