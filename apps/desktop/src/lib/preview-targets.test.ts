import { describe, expect, it } from 'vitest'

import {
  extractPreviewCandidates,
  extractPreviewTargets,
  isLikelyPreviewCandidate,
  previewTargetFromMarkdownHref,
  renderPreviewTargets,
  stripPreviewTargets
} from './preview-targets'

describe('preview target detection', () => {
  it('extracts local server URLs and html files', () => {
    expect(
      extractPreviewCandidates(
        'Open http://localhost:5173/ and /tmp/mycelium-bunnies/index.html, not https://example.com/app.'
      )
    ).toEqual(['http://localhost:5173/', '/tmp/mycelium-bunnies/index.html'])
  })

  it('accepts relative html files and file URLs', () => {
    expect(extractPreviewCandidates('Wrote ./dist/index.html and file:///tmp/demo.html.')).toEqual([
      './dist/index.html',
      'file:///tmp/demo.html'
    ])
  })

  it('ignores remote web URLs', () => {
    expect(isLikelyPreviewCandidate('https://example.com/demo')).toBe(false)
    expect(isLikelyPreviewCandidate('http://127.0.0.1:3000')).toBe(true)
  })

  it('renders previewable paths as markdown links', () => {
    expect(renderPreviewTargets('ready\n/tmp/mycelium-bunnies.html\nopen it')).toBe(
      'ready\n[Preview: mycelium-bunnies.html](#preview/%2Ftmp%2Fmycelium-bunnies.html)\nopen it'
    )
  })

  it('decodes preview markdown hrefs', () => {
    expect(previewTargetFromMarkdownHref('#preview/%2Ftmp%2Fdemo.html')).toBe('/tmp/demo.html')
    expect(previewTargetFromMarkdownHref('#preview:%2Ftmp%2Fdemo.html')).toBe('/tmp/demo.html')
    expect(previewTargetFromMarkdownHref('#media:%2Ftmp%2Fdemo.mp4')).toBeNull()
  })

  it('extracts preview targets from already-rendered preview markers', () => {
    expect(extractPreviewTargets('[Preview: demo.html](#preview:%2Ftmp%2Fdemo.html)')).toEqual(['/tmp/demo.html'])
  })

  it('strips preview targets from visible assistant text', () => {
    expect(stripPreviewTargets('ready\n/tmp/mycelium-bunnies.html\nopen it')).toBe('ready\nopen it')
    expect(stripPreviewTargets('[Preview: demo.html](#preview:%2Ftmp%2Fdemo.html)\nopen it')).toBe('open it')
  })
})
