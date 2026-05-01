export type ComposerLiquidGlassMode = 'polar' | 'prominent' | 'shader' | 'standard'

export interface ComposerGlassTweakOutputs {
  fadeBackground: string
  liquid: {
    aberrationIntensity: number
    blurAmount: number
    cornerRadius: number
    displacementScale: number
    elasticity: number
    mode: ComposerLiquidGlassMode
    saturation: number
  }
  liquidKey: string
  showLibraryRims: boolean
}

const COMPOSER_GLASS_TWEAKS: ComposerGlassTweakOutputs = {
  fadeBackground: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--dt-background) 10%, transparent))',
  liquid: {
    aberrationIntensity: 0.95,
    blurAmount: 0.072,
    cornerRadius: 20,
    displacementScale: 46,
    elasticity: 0,
    mode: 'standard',
    saturation: 128
  },
  liquidKey: ['standard', '0.950', '0.072', '20', '46', '0.00', '128'].join(':'),
  showLibraryRims: false
}

export function useComposerGlassTweaks(): ComposerGlassTweakOutputs {
  return COMPOSER_GLASS_TWEAKS
}
