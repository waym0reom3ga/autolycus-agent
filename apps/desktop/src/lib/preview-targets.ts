const LOCAL_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::1', '[::1]', 'localhost'])
const HTML_EXT_RE = /\.html?(?:[?#].*)?$/i
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
const FILE_URL_RE = /\bfile:\/\/[^\s<>"'`)\]]+/gi
const POSIX_HTML_PATH_RE = /(?:^|[\s("'`])(?<path>\/[^\s<>"'`]*?\.html?)(?:[),.;:!?]*)(?=$|[\s)"'`])/gi
const RELATIVE_HTML_PATH_RE = /(?:^|[\s("'`])(?<path>\.{1,2}\/[^\s<>"'`]*?\.html?)(?:[),.;:!?]*)(?=$|[\s)"'`])/gi
const PREVIEW_MARKDOWN_RE = /\[Preview:[^\]]+\]\((?<href>#preview[:/][^)]+)\)/gi

interface PreviewCandidateMatch {
  end: number
  index: number
  value: string
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/, '')
}

function isLocalPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return false
    }

    return LOCAL_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isLikelyPreviewCandidate(value: string): boolean {
  const trimmed = stripTrailingPunctuation(value.trim())

  return trimmed.startsWith('file://') || HTML_EXT_RE.test(trimmed) || isLocalPreviewUrl(trimmed)
}

function collectPreviewMatches(text: string): PreviewCandidateMatch[] {
  const matches: PreviewCandidateMatch[] = []

  const collect = (index: number | undefined, raw: string, value = raw) => {
    if (index === undefined) {
      return
    }

    const candidate = stripTrailingPunctuation(value.trim())

    if (!candidate || !isLikelyPreviewCandidate(candidate)) {
      return
    }

    const offset = raw.indexOf(value)
    const start = index + Math.max(0, offset)

    matches.push({
      end: start + candidate.length,
      index: start,
      value: candidate
    })
  }

  for (const match of text.matchAll(URL_RE)) {
    collect(match.index, match[0])
  }

  for (const match of text.matchAll(FILE_URL_RE)) {
    collect(match.index, match[0])
  }

  for (const match of text.matchAll(POSIX_HTML_PATH_RE)) {
    collect(match.index, match[0], match.groups?.path || '')
  }

  for (const match of text.matchAll(RELATIVE_HTML_PATH_RE)) {
    collect(match.index, match[0], match.groups?.path || '')
  }

  return matches.sort((a, b) => a.index - b.index)
}

export function extractPreviewCandidates(text: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  const push = (value: string) => {
    const candidate = stripTrailingPunctuation(value.trim())

    if (!candidate || seen.has(candidate) || !isLikelyPreviewCandidate(candidate)) {
      return
    }

    seen.add(candidate)
    candidates.push(candidate)
  }

  for (const match of collectPreviewMatches(text)) {
    push(match.value)
  }

  return candidates
}

export function stripPreviewTargets(text: string): string {
  const matches = collectPreviewMatches(text)
  let cursor = 0
  let stripped = ''

  for (const match of matches) {
    if (match.index < cursor) {
      continue
    }

    const lineStart = text.lastIndexOf('\n', Math.max(0, match.index - 1)) + 1
    const nextLineBreak = text.indexOf('\n', match.end)
    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak + 1
    const beforeOnLine = text.slice(lineStart, match.index)
    const afterOnLine = text.slice(match.end, nextLineBreak === -1 ? text.length : nextLineBreak)

    if (lineStart >= cursor && !beforeOnLine.trim() && !afterOnLine.trim()) {
      stripped += text.slice(cursor, lineStart)
      cursor = lineEnd

      continue
    }

    stripped += text.slice(cursor, match.index)
    cursor = match.end
  }

  stripped += text.slice(cursor)

  return stripped
    .replace(PREVIEW_MARKDOWN_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractPreviewTargets(text: string): string[] {
  const targets = extractPreviewCandidates(text)
  const seen = new Set(targets)

  for (const match of text.matchAll(PREVIEW_MARKDOWN_RE)) {
    const target = previewTargetFromMarkdownHref(match.groups?.href)

    if (target && !seen.has(target)) {
      seen.add(target)
      targets.push(target)
    }
  }

  return targets
}

export function previewMarkdownHref(target: string): string {
  return `#preview/${encodeURIComponent(target)}`
}

export function previewTargetFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#preview:') && !href?.startsWith('#preview/')) {
    return null
  }

  try {
    return decodeURIComponent(href.slice('#preview'.length + 1))
  } catch {
    return null
  }
}

export function previewName(target: string): string {
  try {
    const url = new URL(target)

    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname).split(/[\\/]/).filter(Boolean).pop() || target
    }

    const file = url.pathname.split('/').filter(Boolean).pop()

    return file || url.host
  } catch {
    return target.split(/[\\/]/).filter(Boolean).pop() || target
  }
}

export function previewDisplayLabel(target: string): string {
  const escaped = previewName(target).replace(/[[\]\\]/g, '\\$&')

  return `Preview: ${escaped}`
}

function previewLink(value: string): string {
  return `[${previewDisplayLabel(value)}](${previewMarkdownHref(value)})`
}

export function renderPreviewTargets(text: string): string {
  const matches = collectPreviewMatches(text)
  let cursor = 0
  let rendered = ''
  const seen = new Set<string>()

  for (const match of matches) {
    if (match.index < cursor || seen.has(match.value)) {
      continue
    }

    rendered += text.slice(cursor, match.index)
    rendered += previewLink(match.value)
    cursor = match.end
    seen.add(match.value)
  }

  return rendered + text.slice(cursor)
}
