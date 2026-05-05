'use client'

import type { SyntaxHighlighterProps } from '@assistant-ui/react-streamdown'
import type { FC } from 'react'
import ShikiHighlighter from 'react-shiki'

import { isLikelyProseCodeBlock } from '@/lib/markdown-code'

/**
 * assistant-ui's recommended `SyntaxHighlighter` slot.
 *
 * Uses the full `react-shiki` bundle so all `bundledLanguages` work
 * (rust, go, swift, kotlin, sql, etc.) — the `/web` subpath only ships
 * common web languages and silently falls back to plain text otherwise.
 *
 * Theme switching is automatic via the CSS `color-scheme` on `:root`
 * (set from the desktop theme provider).
 *
 * `showLanguage` is disabled because we render our own `CodeHeader`;
 * leaving it on causes the language to appear twice.
 */
interface HermesSyntaxHighlighterProps extends SyntaxHighlighterProps {
  defer?: boolean
}

export const SyntaxHighlighter: FC<HermesSyntaxHighlighterProps> = ({
  components: { Pre, Code: _UnusedCode },
  language,
  code,
  defer = false
}) => {
  // Streamdown may hand us fence contents with edge newlines. Strip blank
  // fence padding without touching indentation on the first real line.
  const trimmed = (code ?? '').replace(/^\n+/, '').trimEnd()

  // Avoid rendering an empty code card while Streamdown is still deciding
  // whether a transient/incomplete fence is real markdown.
  if (!trimmed.trim()) {
    return null
  }

  if (isLikelyProseCodeBlock(language, trimmed)) {
    return <div className="whitespace-pre-wrap wrap-anywhere text-foreground">{trimmed}</div>
  }

  if (defer) {
    return (
      <Pre className="aui-shiki m-0 overflow-hidden rounded-b-md border border-t-0 border-border bg-card font-mono text-sm leading-relaxed [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:leading-relaxed">
        <code className="block whitespace-pre">{trimmed}</code>
      </Pre>
    )
  }

  return (
    <Pre className="aui-shiki m-0 overflow-hidden rounded-b-md border border-t-0 border-border bg-card font-mono text-sm leading-relaxed [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:leading-relaxed">
      <ShikiHighlighter
        addDefaultStyles={false}
        as="div"
        defaultColor="light-dark()"
        delay={120}
        language={language || 'text'}
        showLanguage={false}
        theme={{
          light: 'github-light-default',
          dark: 'github-dark-default'
        }}
      >
        {trimmed}
      </ShikiHighlighter>
    </Pre>
  )
}
