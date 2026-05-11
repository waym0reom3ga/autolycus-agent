import { useGpuTier } from '@nous-research/ui/hooks/use-gpu-tier'
import { Leva, useControls } from 'leva'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity'
] as const

type BlendMode = (typeof BLEND_MODES)[number]

function binaryNoiseDataUrl(tile: number, density: number, size: number, color: string): string {
  if (typeof document === 'undefined') return ''

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const physTile = Math.round(tile * dpr)
  const block = Math.max(1, Math.round(size * dpr))

  const canvas = document.createElement('canvas')
  canvas.width = physTile
  canvas.height = physTile

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = color

  for (let y = 0; y < physTile; y += block) {
    for (let x = 0; x < physTile; x += block) {
      if (Math.random() < density) {
        ctx.fillRect(x, y, block, block)
      }
    }
  }

  return `url("${canvas.toDataURL('image/png')}")`
}

export function Backdrop() {
  const gpuTier = useGpuTier()
  const [controlsOpen, setControlsOpen] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement

      if (editing || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.shiftKey && event.code === 'KeyY') setControlsOpen(open => !open)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const shape = useControls(
    'UI / Shape',
    {
      radiusScalar: { value: 0.2, min: 0, max: 2, step: 0.1, label: 'radius scalar' }
    },
    { collapsed: true }
  )

  useEffect(() => {
    document.documentElement.style.setProperty('--radius-scalar', String(shape.radiusScalar))
  }, [shape.radiusScalar])

  const statue = useControls(
    'Backdrop / Statue',
    {
      enabled: { value: true, label: 'on' },
      opacity: { value: 0.04, min: 0, max: 1, step: 0.005 },
      blendMode: { value: 'difference' as BlendMode, options: BLEND_MODES, label: 'blend' },
      invert: { value: true, label: 'invert color' },
      saturate: { value: 1, min: 0, max: 3, step: 0.05, label: 'saturate' },
      brightness: { value: 1, min: 0, max: 2, step: 0.05, label: 'brightness' },
      objectPosition: {
        value: 'top left',
        options: ['top left', 'top right', 'bottom left', 'bottom right', 'center', 'top', 'bottom', 'left', 'right'],
        label: 'position'
      },
      scale: { value: 160, min: 100, max: 300, step: 5, label: 'height (dvh)' }
    },
    { collapsed: true }
  )

  const vignette = useControls(
    'Backdrop / Vignette',
    {
      enabled: { value: true, label: 'on' },
      opacity: { value: 0.22, min: 0, max: 1, step: 0.01 },
      blendMode: { value: 'lighten' as BlendMode, options: BLEND_MODES, label: 'blend' },
      useTheme: { value: true, label: 'use --warm-glow' },
      color: { value: '#ffbd38', label: 'color (override)' },
      origin: {
        value: '0% 0%',
        options: ['0% 0%', '100% 0%', '50% 0%', '0% 100%', '100% 100%', '50% 50%'],
        label: 'corner'
      },
      transparentStop: { value: 60, min: 0, max: 100, step: 1, label: 'fade start %' }
    },
    { collapsed: true }
  )

  const noise = useControls(
    'Backdrop / Noise',
    {
      enabled: { value: true, label: 'on' },
      opacity: { value: 0.21, min: 0, max: 1.5, step: 0.01, label: 'opacity (× mul)' },
      blendMode: { value: 'color-dodge' as BlendMode, options: BLEND_MODES, label: 'blend' },
      color: { value: '#eaeaea', label: 'dot color' },
      density: { value: 0.11, min: 0, max: 1, step: 0.005, label: 'density' },
      size: { value: 1, min: 1, max: 10, step: 1, label: 'block px' },
      tile: { value: 256, min: 64, max: 1024, step: 32, label: 'tile px' },
      reroll: { value: 0, min: 0, max: 100, step: 1, label: 'reroll' }
    },
    { collapsed: true }
  )

  const noiseUrl = useMemo(
    () => binaryNoiseDataUrl(noise.tile, noise.density, noise.size, noise.color),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noise.tile, noise.density, noise.size, noise.color, noise.reroll]
  )

  return (
    <>
      <Leva hidden={!import.meta.env.DEV || !controlsOpen} collapsed titleBar={{ title: 'backdrop', drag: true }} />

      {statue.enabled && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-2"
          style={{
            mixBlendMode: statue.blendMode as CSSProperties['mixBlendMode'],
            opacity: statue.opacity
          }}
        >
          <img
            alt=""
            className="w-auto min-w-dvw object-cover"
            fetchPriority="low"
            src="/ds-assets/filler-bg0.jpg"
            style={{
              height: `${statue.scale}dvh`,
              objectPosition: statue.objectPosition,
              filter: `${statue.invert ? 'invert(1) ' : ''}saturate(${statue.saturate}) brightness(${statue.brightness})`
            }}
          />
        </div>
      )}

      {vignette.enabled && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-99"
          style={{
            background: `radial-gradient(ellipse at ${vignette.origin}, transparent ${vignette.transparentStop}%, ${vignette.useTheme ? 'var(--warm-glow)' : vignette.color} 100%)`,
            mixBlendMode: vignette.blendMode as CSSProperties['mixBlendMode'],
            opacity: vignette.opacity
          }}
        />
      )}

      {noise.enabled && gpuTier > 0 && noiseUrl && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-101"
          style={{
            backgroundImage: noiseUrl,
            backgroundSize: `${noise.tile}px ${noise.tile}px`,
            backgroundRepeat: 'repeat',
            imageRendering: 'pixelated',
            mixBlendMode: noise.blendMode as CSSProperties['mixBlendMode'],
            opacity: `calc(${noise.opacity} * var(--noise-opacity-mul, 1))`
          }}
        />
      )}
    </>
  )
}
