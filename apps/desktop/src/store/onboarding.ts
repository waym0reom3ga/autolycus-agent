import { atom } from 'nanostores'

import {
  cancelOAuthSession,
  listOAuthProviders,
  pollOAuthSession,
  setEnvVar,
  startOAuthLogin,
  submitOAuthCode
} from '@/hermes'
import { notify, notifyError } from '@/store/notifications'
import type { OAuthProvider, OAuthStartResponse } from '@/types/hermes'

export type OnboardingMode = 'apikey' | 'oauth'

export type OnboardingFlow =
  | { status: 'idle' }
  | { provider: OAuthProvider; status: 'starting' }
  | { code: string; provider: OAuthProvider; start: Extract<OAuthStartResponse, { flow: 'pkce' }>; status: 'awaiting_user' }
  | { copied: boolean; provider: OAuthProvider; start: Extract<OAuthStartResponse, { flow: 'device_code' }>; status: 'polling' }
  | { provider: OAuthProvider; start: OAuthStartResponse; status: 'submitting' }
  | { provider: OAuthProvider; status: 'success' }
  | { message: string; provider?: OAuthProvider; start?: OAuthStartResponse; status: 'error' }

export interface DesktopOnboardingState {
  configured: boolean
  flow: OnboardingFlow
  mode: OnboardingMode
  providers: null | OAuthProvider[]
  reason: null | string
  requested: boolean
}

const INITIAL: DesktopOnboardingState = {
  configured: true,
  flow: { status: 'idle' },
  mode: 'oauth',
  providers: null,
  reason: null,
  requested: false
}

export const $desktopOnboarding = atom<DesktopOnboardingState>(INITIAL)

export interface OnboardingContext {
  onCompleted?: () => void
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

const POLL_MS = 2000
const BUSY: ReadonlySet<OnboardingFlow['status']> = new Set(['starting', 'awaiting_user', 'polling', 'submitting'])

let pollTimer: number | null = null

function patch(update: Partial<DesktopOnboardingState>) {
  $desktopOnboarding.set({ ...$desktopOnboarding.get(), ...update })
}

function setFlow(flow: OnboardingFlow) {
  patch({ flow })
}

function clearPoll() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function errMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function checkRuntime(ctx: OnboardingContext) {
  const [status, runtime] = await Promise.all([
    ctx.requestGateway<{ provider_configured?: boolean }>('setup.status').catch(
      () => ({}) as { provider_configured?: boolean }
    ),
    ctx
      .requestGateway<{ error?: string; ok?: boolean }>('setup.runtime_check')
      .catch(() => ({ ok: false }) as { error?: string; ok?: boolean })
  ])

  return runtime.ok !== undefined ? Boolean(runtime.ok) : Boolean(status.provider_configured)
}

export function requestDesktopOnboarding(reason = 'No inference provider is configured.') {
  patch({ reason, requested: true })
}

export function completeDesktopOnboarding() {
  clearPoll()
  $desktopOnboarding.set({ ...INITIAL, configured: true })
}

export function setOnboardingMode(mode: OnboardingMode) {
  patch({ mode })
}

export async function refreshOnboarding(ctx: OnboardingContext) {
  const ok = await checkRuntime(ctx)

  if (ok) {
    completeDesktopOnboarding()
    ctx.onCompleted?.()

    return true
  }

  patch({ configured: false })

  if ($desktopOnboarding.get().providers !== null) {
    return false
  }

  try {
    const { providers } = await listOAuthProviders()
    patch({
      providers,
      mode: providers.length > 0 ? 'oauth' : 'apikey'
    })
  } catch {
    patch({ providers: [], mode: 'apikey' })
  }

  return false
}

async function finalize(provider: OAuthProvider, ctx: OnboardingContext) {
  clearPoll()
  setFlow({ status: 'success', provider })
  notify({ kind: 'success', title: 'Hermes is ready', message: `${provider.name} connected.` })
  await ctx.requestGateway('reload.env').catch(() => undefined)
  const ok = await checkRuntime(ctx)

  if (ok) {
    completeDesktopOnboarding()
    ctx.onCompleted?.()
  } else {
    setFlow({
      status: 'error',
      provider,
      message: 'Connected, but Hermes still cannot resolve a usable provider.'
    })
  }
}

export async function startProviderOAuth(provider: OAuthProvider, ctx: OnboardingContext) {
  if (provider.flow === 'external') {
    notify({
      kind: 'info',
      title: `${provider.name} uses an external CLI`,
      message: `Run \`${provider.cli_command}\` in a terminal, then come back to retry.`
    })

    return
  }

  clearPoll()
  setFlow({ status: 'starting', provider })

  try {
    const start = await startOAuthLogin(provider.id)
    await window.hermesDesktop?.openExternal(start.flow === 'pkce' ? start.auth_url : start.verification_url)

    if (start.flow === 'pkce') {
      setFlow({ status: 'awaiting_user', provider, start, code: '' })

      return
    }

    setFlow({ status: 'polling', provider, start, copied: false })
    pollTimer = window.setInterval(() => void pollDevice(provider, start, ctx), POLL_MS)
  } catch (error) {
    setFlow({ status: 'error', provider, message: `Could not start sign-in: ${errMessage(error)}` })
  }
}

async function pollDevice(
  provider: OAuthProvider,
  start: Extract<OAuthStartResponse, { flow: 'device_code' }>,
  ctx: OnboardingContext
) {
  try {
    const resp = await pollOAuthSession(provider.id, start.session_id)

    if (resp.status === 'approved') {
      await finalize(provider, ctx)
    } else if (resp.status !== 'pending') {
      clearPoll()
      setFlow({
        status: 'error',
        provider,
        start,
        message: resp.error_message || `Sign-in ${resp.status}.`
      })
    }
  } catch (error) {
    clearPoll()
    setFlow({ status: 'error', provider, start, message: `Polling failed: ${errMessage(error)}` })
  }
}

export function setOnboardingCode(code: string) {
  const { flow } = $desktopOnboarding.get()

  if (flow.status === 'awaiting_user') {
    setFlow({ ...flow, code })
  }
}

export async function submitOnboardingCode(ctx: OnboardingContext) {
  const { flow } = $desktopOnboarding.get()

  if (flow.status !== 'awaiting_user' || !flow.code.trim()) {
    return
  }

  const { provider, start, code } = flow
  setFlow({ status: 'submitting', provider, start })

  try {
    const resp = await submitOAuthCode(provider.id, start.session_id, code.trim())

    if (resp.ok && resp.status === 'approved') {
      await finalize(provider, ctx)
    } else {
      setFlow({ status: 'error', provider, start, message: resp.message || 'Token exchange failed.' })
    }
  } catch (error) {
    setFlow({ status: 'error', provider, start, message: errMessage(error) })
  }
}

export function cancelOnboardingFlow() {
  const { flow } = $desktopOnboarding.get()
  clearPoll()

  const sessionId =
    flow.status === 'awaiting_user' || flow.status === 'polling' || flow.status === 'submitting'
      ? flow.start?.session_id
      : flow.status === 'error'
        ? flow.start?.session_id
        : undefined

  if (sessionId) {
    cancelOAuthSession(sessionId).catch(() => undefined)
  }

  setFlow({ status: 'idle' })
}

export async function copyDeviceCode() {
  const { flow } = $desktopOnboarding.get()

  if (flow.status !== 'polling') {
    return
  }

  try {
    await navigator.clipboard.writeText(flow.start.user_code)
    setFlow({ ...flow, copied: true })
    window.setTimeout(() => {
      const current = $desktopOnboarding.get().flow

      if (current.status === 'polling' && current.start.session_id === flow.start.session_id) {
        setFlow({ ...current, copied: false })
      }
    }, 1500)
  } catch {
    // Clipboard write blocked — user can still type the code from the dialog.
  }
}

export async function saveOnboardingApiKey(envKey: string, value: string, label: string, ctx: OnboardingContext) {
  const trimmed = value.trim()

  if (!trimmed) {
    return { ok: false, message: 'Enter a value first.' }
  }

  try {
    await setEnvVar(envKey, trimmed)
    await ctx.requestGateway('reload.env').catch(() => undefined)
    const ok = await checkRuntime(ctx)

    if (ok) {
      notify({ kind: 'success', title: 'Hermes is ready', message: `${label} connected.` })
      completeDesktopOnboarding()
      ctx.onCompleted?.()

      return { ok: true }
    }

    return { ok: false, message: `Saved, but Hermes still cannot reach ${label}. Double-check the value.` }
  } catch (error) {
    notifyError(error, `Could not save ${label}`)

    return { ok: false, message: errMessage(error) }
  }
}

export function isOnboardingBusy(flow: OnboardingFlow) {
  return BUSY.has(flow.status)
}
