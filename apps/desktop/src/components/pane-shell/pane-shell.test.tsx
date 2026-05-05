import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $paneStates, setPaneOpen, setPaneWidthOverride } from '@/store/panes'

import { Pane, PaneMain, PaneShell } from './pane-shell'

function gridContainer(rendered: ReturnType<typeof render>): HTMLElement {
  const root = rendered.container.firstElementChild

  if (!(root instanceof HTMLElement)) {
    throw new Error('PaneShell did not render a root element')
  }

  return root
}

function getColumnTemplate(container: HTMLElement): string[] {
  return (container.style.gridTemplateColumns ?? '').split(/\s+/).filter(Boolean)
}

describe('PaneShell composition', () => {
  beforeEach(() => {
    $paneStates.set({})
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    $paneStates.set({})
    window.localStorage.clear()
  })

  it('builds a 2-column grid for one left pane + main', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    const tracks = getColumnTemplate(gridContainer(rendered))

    expect(tracks).toEqual(['240px', 'minmax(0,1fr)'])
  })

  it('orders panes left-to-right by side, preserving source order within a side', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <Pane id="sessions" side="left" width="200px">
          sessions
        </Pane>
        <PaneMain>main</PaneMain>
        <Pane id="preview" side="right" width="320px">
          preview
        </Pane>
        <Pane id="inspector" side="right" width="280px">
          inspector
        </Pane>
      </PaneShell>
    )

    const tracks = getColumnTemplate(gridContainer(rendered))

    expect(tracks).toEqual(['240px', '200px', 'minmax(0,1fr)', '320px', '280px'])
  })

  it('collapses a closed pane to 0px', () => {
    const rendered = render(
      <PaneShell>
        <Pane defaultOpen={false} id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    const tracks = getColumnTemplate(gridContainer(rendered))

    expect(tracks).toEqual(['0px', 'minmax(0,1fr)'])
  })

  it('reads open state from the panes store', () => {
    setPaneOpen('files', false)

    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    expect(getColumnTemplate(gridContainer(rendered))).toEqual(['0px', 'minmax(0,1fr)'])
  })

  it('disabled forces the track to 0px even when the store says open', () => {
    setPaneOpen('files', true)

    const rendered = render(
      <PaneShell>
        <Pane disabled={true} id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    expect(getColumnTemplate(gridContainer(rendered))).toEqual(['0px', 'minmax(0,1fr)'])
  })

  it('disabled does NOT mutate the store-persisted open state', () => {
    setPaneOpen('files', true)

    render(
      <PaneShell>
        <Pane disabled={true} id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    expect($paneStates.get().files?.open).toBe(true)
  })

  it('uses widthOverride from the store when set', () => {
    setPaneOpen('files', true)
    setPaneWidthOverride('files', 320)

    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    expect(getColumnTemplate(gridContainer(rendered))).toEqual(['320px', 'minmax(0,1fr)'])
  })

  it('preserves CSS-string widths verbatim (clamp, var, etc.)', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="inspector" side="right" width="clamp(13.5rem,21vw,20rem)">
          inspector
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    const template = gridContainer(rendered).style.gridTemplateColumns

    expect(template).toContain('clamp(13.5rem,21vw,20rem)')
  })

  it('coerces numeric widths to px', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width={224}>
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    expect(getColumnTemplate(gridContainer(rendered))).toEqual(['224px', 'minmax(0,1fr)'])
  })

  it('emits per-pane width as a CSS variable', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    const root = gridContainer(rendered)

    expect(root.style.getPropertyValue('--pane-files-width').trim()).toBe('240px')
  })

  it('places a Pane in the correct grid column via inline style', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          <span data-testid="files-content">files</span>
        </Pane>
        <PaneMain>
          <span data-testid="main-content">main</span>
        </PaneMain>
        <Pane id="preview" side="right" width="320px">
          <span data-testid="preview-content">preview</span>
        </Pane>
      </PaneShell>
    )

    const filesCell = rendered.getByTestId('files-content').parentElement!
    const mainCell = rendered.getByTestId('main-content').parentElement!
    const previewCell = rendered.getByTestId('preview-content').parentElement!

    expect(filesCell.style.gridColumn).toBe('1 / 2')
    expect(mainCell.style.gridColumn).toBe('2 / 3')
    expect(previewCell.style.gridColumn).toBe('3 / 4')
  })

  it('marks closed panes aria-hidden', () => {
    const rendered = render(
      <PaneShell>
        <Pane defaultOpen={false} id="files" side="left" width="240px">
          <span data-testid="files-content">files</span>
        </Pane>
        <PaneMain>main</PaneMain>
      </PaneShell>
    )

    const cell = rendered.getByTestId('files-content').parentElement!

    expect(cell.getAttribute('aria-hidden')).toBe('true')
    expect(cell.getAttribute('data-pane-open')).toBe('false')
  })

  it('passes through arbitrary non-Pane children for self-placement', () => {
    const rendered = render(
      <PaneShell>
        <Pane id="files" side="left" width="240px">
          files
        </Pane>
        <PaneMain>main</PaneMain>
        <div data-testid="floating-overlay" style={{ position: 'absolute' }}>
          overlay
        </div>
      </PaneShell>
    )

    expect(rendered.getByTestId('floating-overlay')).toBeDefined()
  })
})
