/**
 * Desktop app theme model.
 *
 * Two theme layers:
 *   1. `colors`     — Tailwind color token values written directly to CSS vars.
 *   2. `typography` — font families and optional font stylesheet URL.
 *
 * Layout, sizing, spacing, radius, line-height, and letter-spacing live in
 * `styles.css` so CSS remains the source of truth for app geometry.
 *
 * Every field except `name`, `label`, and `description` is optional —
 * missing values fall back to the `default` theme.
 *
 * New themes need no code changes — add an entry to `presets.ts`.
 */

export interface DesktopThemeColors {
  /** Deepest canvas — maps to `bg-background`. */
  background: string
  /** Primary text — maps to `text-foreground`. */
  foreground: string
  /** Elevated card/panel surface. */
  card: string
  /** Text on card surfaces. */
  cardForeground: string
  /** Muted background (hover, subtle fills). */
  muted: string
  /** Muted foreground text. */
  mutedForeground: string
  /** Popover/dropdown surface. */
  popover: string
  /** Popover foreground text. */
  popoverForeground: string
  /** Primary action background. */
  primary: string
  /** Text on primary action. */
  primaryForeground: string
  /** Secondary/subtle action background. */
  secondary: string
  /** Text on secondary action. */
  secondaryForeground: string
  /** Hover/selected accent fill. */
  accent: string
  /** Text on accent fill. */
  accentForeground: string
  /** Borders and separators. */
  border: string
  /** Form input border. */
  input: string
  /** Focus ring / primary accent tint. Also `text-ring` in action bars etc. */
  ring: string
  /**
   * Brand-accent stroke layer. Distinct from `primary` (CTA fill) — this is
   * the "this thing is alive / live / signal" color used on focus rings,
   * streaming cursors, the active session pill, branded scrollbars, and text
   * selection. Falls back to `ring` when omitted. Aliased to the DS
   * `--midground` token so `@nous-research/ui` components inherit the
   * desktop's active theme without further wiring.
   */
  midground?: string
  /** Text on `midground` fills (badges etc). Auto-derived from luminance when omitted. */
  midgroundForeground?: string
  /** Destructive action (delete, error). */
  destructive: string
  /** Text on destructive. */
  destructiveForeground: string
  /** Sidebar-specific overrides (optional). */
  sidebarBackground?: string
  sidebarBorder?: string
  /** User message bubble. */
  userBubble?: string
  userBubbleBorder?: string
}

export interface DesktopThemeTypography {
  /** CSS font-family for body copy. */
  fontSans: string
  /** CSS font-family for code/mono. */
  fontMono: string
  /** Optional Google/Bunny/self-hosted font stylesheet URL. */
  fontUrl?: string
}

export interface DesktopTheme {
  name: string
  label: string
  description: string
  colors: DesktopThemeColors
  typography?: Partial<DesktopThemeTypography>
}
