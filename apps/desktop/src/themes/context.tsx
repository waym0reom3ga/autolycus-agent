/**
 * Desktop theme context.
 *
 * Applies the active theme as CSS custom properties on :root, making every
 * Tailwind utility that references a `--color-*` / `--radius` / `--font-*`
 * variable pick up the change automatically.
 *
 * Persists mode (light/dark/system) and skin separately. Mode controls
 * brightness; skin controls accent family.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  BUILTIN_THEME_LIST,
  BUILTIN_THEMES,
  DEFAULT_LAYOUT,
  DEFAULT_TYPOGRAPHY,
  defaultTheme,
  nousLightTheme
} from './presets'
import type { DesktopTheme, DesktopThemeColors, ThemeDensity } from './types'

const STORAGE_KEY = 'hermes-desktop-theme-v2' // Stores skin name.
const MODE_KEY = 'hermes-desktop-mode-v1'
const DEFAULT_SKIN = 'default'

export type ThemeMode = 'light' | 'dark' | 'system'

const DENSITY_MULTIPLIERS: Record<ThemeDensity, string> = {
  compact: '0.85',
  comfortable: '1',
  spacious: '1.2'
}

const INJECTED_FONT_URLS = new Set<string>()
const SKIN_THEME_LIST = BUILTIN_THEME_LIST.filter(t => t.name !== 'nous-light')

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function effectiveMode(mode: ThemeMode, systemDark = systemPrefersDark()): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

function normalizeSkin(name: string | null | undefined): string {
  if (!name || name === 'nous-light') {
    return DEFAULT_SKIN
  }

  return BUILTIN_THEMES[name] && name !== 'nous-light' ? name : DEFAULT_SKIN
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')

  if (!/^[0-9a-f]{6}$/i.test(clean)) {
    return null
  }

  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}

function mix(a: string, b: string, amount: number): string {
  const ar = hexToRgb(a)
  const br = hexToRgb(b)

  if (!ar || !br) {
    return a
  }

  return rgbToHex([
    ar[0] + (br[0] - ar[0]) * amount,
    ar[1] + (br[1] - ar[1]) * amount,
    ar[2] + (br[2] - ar[2]) * amount
  ])
}

function readableOn(hex: string): string {
  const rgb = hexToRgb(hex)

  if (!rgb) {
    return '#ffffff'
  }

  const [r, g, b] = rgb.map(v => {
    const c = v / 255

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.58 ? '#161616' : '#ffffff'
}

function fontOnly(theme: DesktopTheme): DesktopTheme['typography'] {
  if (!theme.typography) {
    return undefined
  }

  const { fontSans, fontMono, fontUrl } = theme.typography

  return { fontSans, fontMono, fontUrl }
}

function lightColors(seed: DesktopTheme, skinName: string): DesktopThemeColors {
  if (skinName === DEFAULT_SKIN) {
    return nousLightTheme.colors
  }

  if (skinName === 'nous') {
    return seed.colors
  }

  const accent = seed.colors.ring || seed.colors.primary
  const soft = mix('#ffffff', accent, 0.1)
  const softer = mix('#ffffff', accent, 0.06)
  const border = mix('#ececef', accent, 0.14)

  return {
    background: '#ffffff',
    foreground: '#161616',
    card: '#ffffff',
    cardForeground: '#161616',
    muted: softer,
    mutedForeground: mix('#6b6b70', accent, 0.16),
    popover: '#ffffff',
    popoverForeground: '#161616',
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: soft,
    secondaryForeground: mix('#2a2a2a', accent, 0.34),
    accent: soft,
    accentForeground: mix('#2a2a2a', accent, 0.34),
    border,
    input: mix('#e2e2e6', accent, 0.18),
    ring: accent,
    destructive: '#b94a3a',
    destructiveForeground: '#ffffff',
    sidebarBackground: mix('#fafafa', accent, 0.05),
    sidebarBorder: border,
    userBubble: soft,
    userBubbleBorder: border
  }
}

function darkColors(seed: DesktopTheme, skinName: string): DesktopThemeColors {
  return skinName === DEFAULT_SKIN ? defaultTheme.colors : seed.colors
}

function deriveTheme(skinName: string, mode: 'light' | 'dark'): DesktopTheme {
  const seed = BUILTIN_THEMES[skinName] ?? defaultTheme
  const isDefault = skinName === DEFAULT_SKIN
  const base = mode === 'light' ? nousLightTheme : defaultTheme

  return {
    ...base,
    name: `${skinName}-${mode}`,
    label: `${isDefault ? 'Hermes' : seed.label} ${mode === 'light' ? 'Light' : 'Dark'}`,
    description: `${seed.label} ${mode} palette`,
    colors: mode === 'light' ? lightColors(seed, skinName) : darkColors(seed, skinName),
    typography: fontOnly(seed),
    layout: undefined
  }
}

function skinNameFromTheme(theme: DesktopTheme, mode: 'light' | 'dark'): string {
  const suffix = `-${mode}`

  return theme.name.endsWith(suffix) ? theme.name.slice(0, -suffix.length) : theme.name
}

/**
 * Returns the *rendered* mode for a theme, regardless of what the user has
 * toggled. A skin like Nous keeps a white background even when `mode === 'dark'`,
 * so we shouldn't apply the `.dark` class (which assumes a dark surface and
 * triggers shadow/scrollbar/form-control rules tuned for one). Decide from the
 * actual background luminance.
 */
function renderedModeFor(colors: DesktopThemeColors, mode: 'light' | 'dark'): 'light' | 'dark' {
  const rgb = hexToRgb(colors.background)

  if (!rgb) {
    return mode
  }

  const [r, g, b] = rgb.map(v => v / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

  return luminance > 0.5 ? 'light' : 'dark'
}

// ─── CSS application ────────────────────────────────────────────────────────

function applyTheme(theme: DesktopTheme, mode: 'light' | 'dark') {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const typo = { ...DEFAULT_TYPOGRAPHY, ...theme.typography }
  const layout = { ...DEFAULT_LAYOUT, ...theme.layout }
  const c = theme.colors

  const rendered = renderedModeFor(theme.colors, mode)

  root.style.setProperty('color-scheme', rendered)
  root.dataset.hermesTheme = skinNameFromTheme(theme, mode)
  root.classList.toggle('dark', rendered === 'dark')

  const vars: Record<string, string> = {
    '--dt-background': c.background,
    '--dt-foreground': c.foreground,
    '--dt-card': c.card,
    '--dt-card-foreground': c.cardForeground,
    '--dt-muted': c.muted,
    '--dt-muted-foreground': c.mutedForeground,
    '--dt-popover': c.popover,
    '--dt-popover-foreground': c.popoverForeground,
    '--dt-primary': c.primary,
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary': c.secondary,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent': c.accent,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-bg': c.sidebarBackground ?? c.background,
    '--dt-sidebar-border': c.sidebarBorder ?? c.border,
    '--dt-user-bubble': c.userBubble ?? c.muted,
    '--dt-user-bubble-border': c.userBubbleBorder ?? c.border,
    '--radius': layout.radius,
    '--dt-spacing-mul': DENSITY_MULTIPLIERS[layout.density] ?? '1',
    '--dt-font-sans': typo.fontSans,
    '--dt-font-mono': typo.fontMono,
    '--dt-base-size': typo.baseSize,
    '--dt-line-height': typo.lineHeight,
    '--dt-letter-spacing': typo.letterSpacing
  }

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }

  root.style.setProperty('font-size', 'var(--dt-base-size)')

  if (typo.fontUrl && !INJECTED_FONT_URLS.has(typo.fontUrl)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = typo.fontUrl
    link.setAttribute('data-hermes-theme-font', 'true')
    document.head.appendChild(link)
    INJECTED_FONT_URLS.add(typo.fontUrl)
  }
}

if (typeof window !== 'undefined') {
  const skin = normalizeSkin(window.localStorage.getItem(STORAGE_KEY))
  const mode = (window.localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'light'
  const resolved = effectiveMode(mode)
  applyTheme(deriveTheme(skin, resolved), resolved)
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: DesktopTheme
  themeName: string
  mode: ThemeMode
  availableThemes: Array<{ name: string; label: string; description: string }>
  setTheme: (name: string) => void
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: nousLightTheme,
  themeName: DEFAULT_SKIN,
  mode: 'light',
  availableThemes: SKIN_THEME_LIST.map(({ name, label, description }) => ({
    name,
    label: name === DEFAULT_SKIN ? 'Hermes' : label,
    description
  })),
  setTheme: () => {},
  setMode: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_SKIN
    }

    return normalizeSkin(window.localStorage.getItem(STORAGE_KEY))
  })

  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    return (window.localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'light'
  })

  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', listener)

    return () => mql.removeEventListener('change', listener)
  }, [])

  const resolvedMode = effectiveMode(mode, systemDark)

  const activeTheme = useMemo(() => deriveTheme(themeName, resolvedMode), [themeName, resolvedMode])

  useEffect(() => applyTheme(activeTheme, resolvedMode), [activeTheme, resolvedMode])

  const setTheme = useCallback((name: string) => {
    const next = normalizeSkin(name)
    setThemeNameState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    window.localStorage.setItem(MODE_KEY, next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: activeTheme,
      themeName,
      mode,
      availableThemes: SKIN_THEME_LIST.map(({ name, label, description }) => ({
        name,
        label: name === DEFAULT_SKIN ? 'Hermes' : label,
        description
      })),
      setTheme,
      setMode
    }),
    [activeTheme, themeName, mode, setTheme, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/** Sync the desktop skin with the active Hermes backend theme on connect. */
export function useSyncThemeFromBackend(backendThemeName: string | undefined, setTheme: (name: string) => void) {
  useEffect(() => {
    if (backendThemeName && BUILTIN_THEMES[backendThemeName]) {
      setTheme(backendThemeName)
    }
  }, [backendThemeName, setTheme])
}
