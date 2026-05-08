import { atom } from 'nanostores'

interface DesktopOnboardingState {
  reason: null | string
  requested: boolean
}

export const $desktopOnboarding = atom<DesktopOnboardingState>({
  reason: null,
  requested: false
})

export function requestDesktopOnboarding(reason = 'No inference provider is configured.') {
  $desktopOnboarding.set({
    reason,
    requested: true
  })
}

export function completeDesktopOnboarding() {
  $desktopOnboarding.set({
    reason: null,
    requested: false
  })
}
