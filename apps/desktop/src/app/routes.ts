export const SESSION_ROUTE_PREFIX = '#/sessions/'
export const NEW_CHAT_ROUTE = '#/new'
export const SETTINGS_ROUTE = '#/settings'
export const SKILLS_ROUTE = '#/skills'
export const ARTIFACTS_ROUTE = '#/artifacts'

export type AppView = 'chat' | 'settings' | 'skills' | 'artifacts'

export type AppRouteId = 'new' | 'settings' | 'skills' | 'artifacts'

export interface AppRoute {
  id: AppRouteId
  hash: string
  view: AppView
}

export const APP_ROUTES = [
  { id: 'new', hash: NEW_CHAT_ROUTE, view: 'chat' },
  { id: 'settings', hash: SETTINGS_ROUTE, view: 'settings' },
  { id: 'skills', hash: SKILLS_ROUTE, view: 'skills' },
  { id: 'artifacts', hash: ARTIFACTS_ROUTE, view: 'artifacts' }
] as const satisfies readonly AppRoute[]

const APP_VIEW_BY_HASH = new Map<string, AppView>(APP_ROUTES.map(route => [route.hash, route.view]))

export function currentRouteHash(): string {
  return window.location.hash || NEW_CHAT_ROUTE
}

export function routeSessionId(hash = currentRouteHash()): string | null {
  if (!hash.startsWith(SESSION_ROUTE_PREFIX)) {
    return null
  }

  const id = hash.slice(SESSION_ROUTE_PREFIX.length)

  return id ? decodeURIComponent(id) : null
}

export function writeRoute(hash: string, replace = false) {
  if (window.location.hash === hash) {
    return
  }

  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`

  if (replace) {
    window.history.replaceState(null, '', nextUrl)
  } else {
    window.history.pushState(null, '', nextUrl)
  }
}

export function writeSessionRoute(sessionId: string, replace = false) {
  writeRoute(`${SESSION_ROUTE_PREFIX}${encodeURIComponent(sessionId)}`, replace)
}

export function appViewForHash(hash = currentRouteHash()): AppView {
  return APP_VIEW_BY_HASH.get(hash) ?? 'chat'
}

export const currentAppView = appViewForHash
