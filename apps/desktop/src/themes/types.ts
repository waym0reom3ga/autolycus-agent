/**
 * Desktop app theme model.
 *
 * Three orthogonal layers:
 *   1. `colors`     — all Tailwind token values written directly to CSS vars.
 *   2. `typography` — font families, base size, line-height, letter-spacing.
 *   3. `layout`     — corner radius, spacing density.
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
  /** Root font size: `"0.875rem"`, `"0.9375rem"`, `"1rem"`. */
  baseSize: string
  /** Default line height: `"1.5"`, `"1.6"`. */
  lineHeight: string
  /** Default letter spacing: `"0"`, `"-0.01em"`. */
  letterSpacing: string
}

export type ThemeDensity = 'compact' | 'comfortable' | 'spacious'

export interface DesktopThemeLayout {
  /** Corner-radius token: `"0"`, `"0.5rem"`, `"1rem"`. */
  radius: string
  /** Spacing multiplier. */
  density: ThemeDensity
}

export interface DesktopTheme {
  name: string
  label: string
  description: string
  colors: DesktopThemeColors
  typography?: Partial<DesktopThemeTypography>
  layout?: Partial<DesktopThemeLayout>
}
