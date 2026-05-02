import { type FC, useCallback, useEffect, useState } from 'react'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const HERMES_FRAME_COUNT = 8
const ASSET_BASE_URL = import.meta.env.BASE_URL || '/'

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Hermes look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return (value || '').trim().toLowerCase()
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Hermes need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Hermes tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

function publicAssetPath(path: string): string {
  return `${ASSET_BASE_URL}${path}`.replace(/([^:]\/)\/+/g, '$1')
}

export const Intro: FC<IntroProps> = ({ personality, seed }) => {
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const [frameOffset, setFrameOffset] = useState(0)
  const introSeed = mountSeed + (seed ?? 0)
  const copy = resolveCopy(personality, introSeed)
  const frameIndex = Math.abs(introSeed + frameOffset) % HERMES_FRAME_COUNT

  const advanceFrame = useCallback(() => {
    setFrameOffset(offset => offset + 1 + Math.floor(Math.random() * (HERMES_FRAME_COUNT - 1)))
  }, [])

  useEffect(() => {
    const id = window.setTimeout(advanceFrame, 7000)

    return () => window.clearTimeout(id)
  }, [advanceFrame, frameOffset])

  return (
    <div className="pointer-events-none absolute inset-0 z-1 grid place-items-center content-center px-[calc(var(--vsq)*50)] pb-32 text-center text-muted-foreground">
      <button
        aria-label="Change Hermes pose"
        className="pointer-events-auto mb-5 h-56 w-64 cursor-default border-0 bg-transparent p-0"
        onClick={advanceFrame}
        type="button"
      >
        <img
          alt=""
          aria-hidden="true"
          className="h-full w-full scale-110 object-contain select-none"
          draggable={false}
          src={publicAssetPath(`hermes-frames/hermes-frame-${frameIndex}.png?v=matte-clean-6`)}
        />
      </button>
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/75">Hermes Agent</p>
      <h1 className="mb-2.5 text-xl font-semibold tracking-tight text-foreground">{copy.headline}</h1>
      <p className="m-0 max-w-120 leading-normal">{copy.body}</p>
    </div>
  )
}
