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

  it('accepts bare html files and common preview directories', () => {
    expect(extractPreviewCandidates('Open index.html, nested/demo.html, ./dist, and /tmp/site/.')).toEqual([
      'index.html',
      'nested/demo.html',
      './dist',
      '/tmp/site/'
    ])
  })

  it('rejects non-html file URLs and obvious local API or asset URLs', () => {
    expect(isLikelyPreviewCandidate('file:///tmp/demo.png')).toBe(false)
    expect(isLikelyPreviewCandidate('http://localhost:3000/api/users')).toBe(false)
    expect(isLikelyPreviewCandidate('http://localhost:3000/src/main.tsx')).toBe(false)
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
