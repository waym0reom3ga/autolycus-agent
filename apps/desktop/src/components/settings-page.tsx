import {
  Brain,
  Check,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  type LucideIcon,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Package,
  Palette,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Wrench,
  X,
  Zap
} from 'lucide-react'
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ConfigFieldSchema, EnvVarInfo, HermesConfigRecord, SkillInfo, ToolsetInfo } from '@/types/hermes'

import {
  deleteEnvVar,
  getEnvVars,
  getHermesConfigDefaults,
  getHermesConfigRecord,
  getHermesConfigSchema,
  getSkills,
  getToolsets,
  revealEnvVar,
  saveHermesConfig,
  setEnvVar,
  toggleSkill
} from '../hermes'
import { cn } from '../lib/utils'
import { notify, notifyError } from '../store/notifications'
import { type ThemeMode, useTheme } from '../themes/context'
import { BUILTIN_THEMES } from '../themes/presets'

import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

// ─── Types ──────────────────────────────────────────────────────────────────

type SettingsView = 'keys' | 'tools' | `config:${string}`
type SettingsQueryKey = 'config' | 'keys' | 'tools'

type SettingsPageProps = {
  onClose: () => void
  onConfigSaved?: () => void
}

type SearchProps = { query: string }

type EnvPatch = Partial<Pick<EnvVarInfo, 'is_set' | 'redacted_value'>>

type ProviderGroup = {
  name: string
  priority: number
  entries: [string, EnvVarInfo][]
  hasAnySet: boolean
}

type DesktopConfigSection = {
  id: string
  label: string
  icon: LucideIcon
  keys: string[]
}

// ─── Constants ──────────────────────────────────────────────────────────────

const EMPTY_SELECT_VALUE = '__hermes_empty__'
const CONTROL_TEXT = 'text-[0.8125rem]'

const PROVIDER_GROUPS: { prefix: string; name: string; priority: number }[] = [
  { prefix: 'NOUS_', name: 'Nous Portal', priority: 0 },
  { prefix: 'ANTHROPIC_', name: 'Anthropic', priority: 1 },
  { prefix: 'DASHSCOPE_', name: 'DashScope (Qwen)', priority: 2 },
  { prefix: 'HERMES_QWEN_', name: 'DashScope (Qwen)', priority: 2 },
  { prefix: 'DEEPSEEK_', name: 'DeepSeek', priority: 3 },
  { prefix: 'GOOGLE_', name: 'Gemini', priority: 4 },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  { prefix: 'GLM_', name: 'GLM / Z.AI', priority: 5 },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 5 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 5 },
  { prefix: 'HF_', name: 'Hugging Face', priority: 6 },
  { prefix: 'KIMI_', name: 'Kimi / Moonshot', priority: 7 },
  { prefix: 'MINIMAX_', name: 'MiniMax', priority: 8 },
  { prefix: 'MINIMAX_CN_', name: 'MiniMax (China)', priority: 9 },
  { prefix: 'OPENCODE_GO_', name: 'OpenCode Go', priority: 10 },
  { prefix: 'OPENCODE_ZEN_', name: 'OpenCode Zen', priority: 11 },
  { prefix: 'OPENROUTER_', name: 'OpenRouter', priority: 12 },
  { prefix: 'XIAOMI_', name: 'Xiaomi MiMo', priority: 13 }
]

const BUILTIN_PERSONALITIES = [
  'helpful',
  'concise',
  'technical',
  'creative',
  'teacher',
  'kawaii',
  'catgirl',
  'pirate',
  'shakespeare',
  'surfer',
  'noir',
  'uwu',
  'philosopher',
  'hype'
]

// Schema-side select overrides for desktop-relevant enum fields whose
// backend schema only declares a string type.
const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  'delegation.reasoning_effort': ['', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'memory.provider': ['', 'builtin', 'honcho'],
  'stt.local.model': ['tiny', 'base', 'small', 'medium', 'large-v3'],
  'tts.openai.voice': ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
}

const FIELD_LABELS: Record<string, string> = {
  model: 'Default Model',
  model_context_length: 'Context Window',
  fallback_providers: 'Fallback Models',
  toolsets: 'Enabled Toolsets',
  timezone: 'Timezone',
  'display.personality': 'Personality',
  'display.show_reasoning': 'Reasoning Blocks',
  'agent.max_turns': 'Max Agent Steps',
  'agent.image_input_mode': 'Image Attachments',
  'terminal.cwd': 'Working Directory',
  'terminal.backend': 'Execution Backend',
  'terminal.timeout': 'Command Timeout',
  'terminal.persistent_shell': 'Persistent Shell',
  'terminal.env_passthrough': 'Environment Passthrough',
  file_read_max_chars: 'File Read Limit',
  'tool_output.max_bytes': 'Terminal Output Limit',
  'tool_output.max_lines': 'File Page Limit',
  'tool_output.max_line_length': 'Line Length Limit',
  'code_execution.mode': 'Code Execution Mode',
  'approvals.mode': 'Approval Mode',
  'approvals.timeout': 'Approval Timeout',
  'approvals.mcp_reload_confirm': 'Confirm MCP Reloads',
  command_allowlist: 'Command Allowlist',
  'security.redact_secrets': 'Redact Secrets',
  'security.allow_private_urls': 'Allow Private URLs',
  'browser.allow_private_urls': 'Browser Private URLs',
  'browser.auto_local_for_private_urls': 'Local Browser For Private URLs',
  'checkpoints.enabled': 'File Checkpoints',
  'checkpoints.max_snapshots': 'Checkpoint Limit',
  'voice.record_key': 'Voice Shortcut',
  'voice.max_recording_seconds': 'Max Recording Length',
  'voice.auto_tts': 'Read Responses Aloud',
  'stt.enabled': 'Speech To Text',
  'stt.provider': 'Speech-To-Text Provider',
  'stt.local.model': 'Local Transcription Model',
  'stt.local.language': 'Transcription Language',
  'tts.provider': 'Text-To-Speech Provider',
  'tts.edge.voice': 'Edge Voice',
  'tts.openai.model': 'OpenAI TTS Model',
  'tts.openai.voice': 'OpenAI Voice',
  'tts.elevenlabs.voice_id': 'ElevenLabs Voice',
  'tts.elevenlabs.model_id': 'ElevenLabs Model',
  'memory.memory_enabled': 'Persistent Memory',
  'memory.user_profile_enabled': 'User Profile',
  'memory.memory_char_limit': 'Memory Budget',
  'memory.user_char_limit': 'Profile Budget',
  'memory.provider': 'Memory Provider',
  'context.engine': 'Context Engine',
  'compression.enabled': 'Auto-Compression',
  'compression.threshold': 'Compression Threshold',
  'compression.target_ratio': 'Compression Target',
  'compression.protect_last_n': 'Protected Recent Messages',
  'agent.api_max_retries': 'API Retries',
  'agent.service_tier': 'Service Tier',
  'agent.tool_use_enforcement': 'Tool-Use Enforcement',
  'delegation.model': 'Subagent Model',
  'delegation.provider': 'Subagent Provider',
  'delegation.max_iterations': 'Subagent Turn Limit',
  'delegation.max_concurrent_children': 'Parallel Subagents',
  'delegation.child_timeout_seconds': 'Subagent Timeout',
  'delegation.reasoning_effort': 'Subagent Reasoning Effort',
  'auxiliary.vision.provider': 'Vision Provider',
  'auxiliary.vision.model': 'Vision Model',
  'auxiliary.compression.provider': 'Compression Provider',
  'auxiliary.compression.model': 'Compression Model',
  'auxiliary.title_generation.provider': 'Title Provider',
  'auxiliary.title_generation.model': 'Title Model'
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
  model: 'Used for new chats unless you pick a different model in the composer.',
  model_context_length: "Leave at 0 to use the selected model's detected context window.",
  fallback_providers: 'Backup provider:model entries to try if the default model fails.',
  'display.personality': 'Default assistant style for new sessions.',
  timezone: 'Used when Hermes needs local time context. Blank uses the system timezone.',
  'display.show_reasoning': 'Show reasoning sections when the backend provides them.',
  'agent.image_input_mode': 'Controls how image attachments are sent to the model.',
  'terminal.cwd': 'Default project folder for tool and terminal work.',
  'code_execution.mode': 'How strictly code execution is scoped to the current project.',
  'terminal.persistent_shell': 'Keep shell state between commands when the backend supports it.',
  'terminal.env_passthrough': 'Environment variables to pass into tool execution.',
  file_read_max_chars: 'Maximum characters Hermes can read from one file request.',
  'approvals.mode': 'How Hermes handles commands that need explicit approval.',
  'approvals.timeout': 'How long approval prompts wait before timing out.',
  'security.redact_secrets': 'Hide detected secrets from model-visible content when possible.',
  'checkpoints.enabled': 'Create rollback snapshots before file edits.',
  'memory.memory_enabled': 'Save durable memories that can help future sessions.',
  'memory.user_profile_enabled': 'Maintain a compact profile of user preferences.',
  'context.engine': 'Strategy for managing long conversations near the context limit.',
  'compression.enabled': 'Summarize older context when conversations get large.',
  'voice.auto_tts': 'Automatically speak assistant responses.',
  'stt.enabled': 'Enable local or provider-backed speech transcription.',
  'agent.max_turns': 'Upper bound for tool-calling turns before Hermes stops a run.'
}

// Curated desktop config surface: only fields a user might tune from the app.
const SECTIONS: DesktopConfigSection[] = [
  {
    id: 'model',
    label: 'Model',
    icon: Sparkles,
    keys: ['model', 'model_context_length', 'fallback_providers']
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    keys: []
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: Monitor,
    keys: [
      'terminal.cwd',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ]
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: Lock,
    keys: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'browser.allow_private_urls',
      'browser.auto_local_for_private_urls',
      'checkpoints.enabled'
    ]
  },
  {
    id: 'memory',
    label: 'Memory & Context',
    icon: Brain,
    keys: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.target_ratio',
      'compression.protect_last_n'
    ]
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    keys: [
      'voice.record_key',
      'voice.max_recording_seconds',
      'voice.auto_tts',
      'stt.enabled',
      'stt.provider',
      'stt.local.model',
      'stt.local.language',
      'tts.provider',
      'tts.edge.voice',
      'tts.openai.model',
      'tts.openai.voice',
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id'
    ]
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    keys: [
      'toolsets',
      'terminal.backend',
      'terminal.timeout',
      'tool_output.max_bytes',
      'tool_output.max_lines',
      'tool_output.max_line_length',
      'checkpoints.max_snapshots',
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'delegation.model',
      'delegation.provider',
      'delegation.max_iterations',
      'delegation.max_concurrent_children',
      'delegation.child_timeout_seconds',
      'delegation.reasoning_effort',
      'auxiliary.vision.provider',
      'auxiliary.vision.model',
      'auxiliary.compression.provider',
      'auxiliary.compression.model',
      'auxiliary.title_generation.provider',
      'auxiliary.title_generation.model'
    ]
  }
]

// ─── Helpers ────────────────────────────────────────────────────────────────

const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

const includesQuery = (v: unknown, q: string) => asText(v).toLowerCase().includes(q)

const prettyName = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const toolNames = (t: ToolsetInfo) => (Array.isArray(t.tools) ? t.tools.map(asText).filter(Boolean) : [])

const withoutKey = <T,>(record: Record<string, T>, key: string) => {
  const next = { ...record }
  delete next[key]

  return next
}

const redactedValue = (v: string) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}...${v.slice(-4)}`)

const providerGroup = (key: string) => PROVIDER_GROUPS.find(g => key.startsWith(g.prefix))?.name ?? 'Other'

const providerPriority = (name: string) => PROVIDER_GROUPS.find(g => g.name === name)?.priority ?? 99

function getNested(obj: HermesConfigRecord, path: string): unknown {
  let cur: unknown = obj

  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') {
      return undefined
    }

    cur = (cur as Record<string, unknown>)[part]
  }

  return cur
}

function setNested(obj: HermesConfigRecord, path: string, value: unknown): HermesConfigRecord {
  const clone = structuredClone(obj)
  const parts = path.split('.')
  let cur: Record<string, unknown> = clone

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]

    if (cur[part] == null || typeof cur[part] !== 'object') {
      cur[part] = {}
    }

    cur = cur[part] as Record<string, unknown>
  }

  cur[parts[parts.length - 1]] = value

  return clone
}

function personalityOptions(config: HermesConfigRecord): string[] {
  const custom = getNested(config, 'agent.personalities')

  const customNames =
    custom && typeof custom === 'object' && !Array.isArray(custom) ? Object.keys(custom as Record<string, unknown>) : []

  return [...new Set(['', 'none', ...BUILTIN_PERSONALITIES, ...customNames])]
}

function enumOptionsFor(key: string, value: unknown, config: HermesConfigRecord): string[] | undefined {
  const opts = key === 'display.personality' ? personalityOptions(config) : ENUM_OPTIONS[key]

  if (!opts) {
    return undefined
  }

  const current = asText(value)

  return current && !opts.includes(current) ? [...opts, current] : opts
}

// ─── Layout primitives ──────────────────────────────────────────────────────

function SettingsContent({ children }: { children: ReactNode }) {
  return (
    <section className="min-h-0 overflow-hidden">
      <div className="h-full min-h-0 overflow-y-auto px-8 py-6 pb-24">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </div>
    </section>
  )
}

function Pill({ tone = 'muted', children }: { tone?: 'muted' | 'primary'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.66rem]',
        tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function SectionHeading({ icon: Icon, title, meta }: { icon: LucideIcon; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 pt-3.5 text-sm font-medium">
      <Icon className="size-4 text-muted-foreground" />
      <span>{title}</span>
      {meta && <Pill>{meta}</Pill>}
    </div>
  )
}

function NavLink({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      className={cn(
        'flex min-h-8 w-full justify-start gap-2 rounded-lg px-2.5 text-left text-sm transition',
        active ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-muted/70'
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Button>
  )
}

function ListRow({
  title,
  description,
  hint,
  action,
  below,
  wide = false
}: {
  title: ReactNode
  description?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  below?: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        'grid gap-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] sm:items-center',
        wide && 'sm:grid-cols-1 sm:items-start'
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>}
        {hint && <div className="mt-1 block font-mono text-[0.68rem] text-muted-foreground/45">{hint}</div>}
        {below}
      </div>
      {action && <div className={cn('min-w-0', !wide && 'sm:justify-self-end')}>{action}</div>}
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
      {label}
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-48 place-items-center text-center">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}

// ─── Config view ────────────────────────────────────────────────────────────

function ConfigField({
  schemaKey,
  schema,
  value,
  enumOptions,
  onChange
}: {
  schemaKey: string
  schema: ConfigFieldSchema
  value: unknown
  enumOptions?: string[]
  onChange: (value: unknown) => void
}) {
  const label = FIELD_LABELS[schemaKey] ?? prettyName(schemaKey.split('.').pop() ?? schemaKey)
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const rawDescription = (FIELD_DESCRIPTIONS[schemaKey] ?? schema.description ?? '').trim()
  const normalizedDesc = normalize(rawDescription)

  const description =
    rawDescription && normalizedDesc !== normalize(label) && normalizedDesc !== normalize(schemaKey)
      ? rawDescription
      : undefined

  const row = (action: ReactNode, wide = false) => (
    <ListRow action={action} description={description} title={label} wide={wide} />
  )

  if (schema.type === 'boolean') {
    return row(
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">{value ? 'On' : 'Off'}</span>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    )
  }

  const selectOptions = enumOptions ?? (schema.type === 'select' ? (schema.options ?? []).map(String) : undefined)

  if (selectOptions) {
    return row(
      <Select
        onValueChange={next => onChange(next === EMPTY_SELECT_VALUE ? '' : next)}
        value={String(value ?? '') || EMPTY_SELECT_VALUE}
      >
        <SelectTrigger className={CONTROL_TEXT}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map(option => (
            <SelectItem key={option || EMPTY_SELECT_VALUE} value={option || EMPTY_SELECT_VALUE}>
              {option ? prettyName(option) : '(none)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (schema.type === 'number') {
    return row(
      <Input
        className={cn('h-8', CONTROL_TEXT)}
        onChange={e => {
          const raw = e.target.value
          const n = raw === '' ? 0 : Number(raw)

          if (!Number.isNaN(n)) {
            onChange(n)
          }
        }}
        placeholder="Not set"
        type="number"
        value={value === undefined || value === null ? '' : String(value)}
      />
    )
  }

  if (schema.type === 'list') {
    return row(
      <Input
        className={cn('h-8', CONTROL_TEXT)}
        onChange={e =>
          onChange(
            e.target.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          )
        }
        placeholder="comma-separated values"
        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
      />
    )
  }

  if (typeof value === 'object' && value !== null) {
    return row(
      <Textarea
        className={cn('min-h-28 resize-y bg-background font-mono', CONTROL_TEXT)}
        onChange={e => {
          try {
            onChange(JSON.parse(e.target.value))
          } catch {
            /* keep last valid */
          }
        }}
        placeholder="Not set"
        spellCheck={false}
        value={JSON.stringify(value, null, 2)}
      />,
      true
    )
  }

  const isLong = schema.type === 'text' || String(value ?? '').length > 100

  return row(
    isLong ? (
      <Textarea
        className={cn('min-h-24 resize-y bg-background', CONTROL_TEXT)}
        onChange={e => onChange(e.target.value)}
        placeholder="Not set"
        value={String(value ?? '')}
      />
    ) : (
      <Input
        className={cn('h-8', CONTROL_TEXT)}
        onChange={e => onChange(e.target.value)}
        placeholder="Not set"
        value={String(value ?? '')}
      />
    ),
    isLong
  )
}

function ConfigSettings({
  query,
  activeSectionId,
  onConfigSaved,
  importInputRef
}: SearchProps & {
  activeSectionId: string
  onConfigSaved?: () => void
  importInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)
  const [_defaults, setDefaults] = useState<HermesConfigRecord | null>(null)
  const [schema, setSchema] = useState<Record<string, ConfigFieldSchema> | null>(null)
  const saveVersionRef = useRef(0)
  const [saveVersion, setSaveVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([getHermesConfigRecord(), getHermesConfigDefaults(), getHermesConfigSchema()])
      .then(([c, d, s]) => {
        if (cancelled) {
          return
        }

        setConfig(c)
        setDefaults(d)
        setSchema(s.fields)
      })
      .catch(err => notifyError(err, 'Settings failed to load'))

    return () => void (cancelled = true)
  }, [])

  useEffect(() => {
    if (!config || saveVersion === 0) {
      return
    }

    const v = saveVersion

    const t = window.setTimeout(() => {
      void saveHermesConfig(config)
        .then(() => {
          if (saveVersionRef.current === v) {
            onConfigSaved?.()
          }
        })
        .catch(err => {
          if (saveVersionRef.current === v) {
            notifyError(err, 'Autosave failed')
          }
        })
    }, 550)

    return () => window.clearTimeout(t)
  }, [config, onConfigSaved, saveVersion])

  const updateConfig = (next: HermesConfigRecord) => {
    saveVersionRef.current += 1
    setConfig(next)
    setSaveVersion(saveVersionRef.current)
  }

  const sectionFields = useMemo(() => {
    if (!schema) {
      return new Map<string, [string, ConfigFieldSchema][]>()
    }

    return new Map(
      SECTIONS.map(s => [s.id, s.keys.flatMap(k => (schema[k] ? [[k, schema[k]] as [string, ConfigFieldSchema]] : []))])
    )
  }, [schema])

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()

    if (!schema || !q) {
      return []
    }

    const seen = new Set<string>()

    return SECTIONS.flatMap(s =>
      s.keys.flatMap(k => {
        if (seen.has(k) || !schema[k]) {
          return []
        }

        seen.add(k)
        const label = prettyName(k.split('.').pop() ?? k)
        const item = schema[k]

        const hit =
          k.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q) ||
          includesQuery(item.category, q) ||
          includesQuery(item.description, q)

        return hit ? [[k, item] as [string, ConfigFieldSchema]] : []
      })
    )
  }, [schema, query])

  const fields = query.trim() ? matched : (sectionFields.get(activeSectionId) ?? [])

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()

    reader.onload = () => {
      try {
        updateConfig(JSON.parse(String(reader.result)))
        notify({ kind: 'success', title: 'Config imported', message: 'Saving…' })
      } catch (err) {
        notifyError(err, 'Invalid config JSON')
      }
    }

    reader.readAsText(file)
    e.target.value = ''
  }

  if (!config || !schema) {
    return <LoadingState label="Loading Hermes configuration..." />
  }

  return (
    <SettingsContent>
      {query.trim() && (
        <div className="mb-4 text-xs text-muted-foreground">
          {fields.length} result{fields.length === 1 ? '' : 's'}
        </div>
      )}
      {fields.length === 0 ? (
        <EmptyState description="Try a different search term or choose another section." title="No matching settings" />
      ) : (
        <div className="divide-y divide-border/40">
          {fields.map(([key, field]) => (
            <ConfigField
              enumOptions={enumOptionsFor(key, getNested(config, key), config)}
              key={key}
              onChange={value => updateConfig(setNested(config, key, value))}
              schema={field}
              schemaKey={key}
              value={getNested(config, key)}
            />
          ))}
        </div>
      )}
      <input
        accept=".json,application/json"
        className="hidden"
        onChange={handleImport}
        ref={importInputRef}
        type="file"
      />
    </SettingsContent>
  )
}

// ─── Keys view ──────────────────────────────────────────────────────────────

function EnvActions({
  varKey,
  info,
  saving,
  onEdit,
  onClear,
  onReveal,
  isRevealed,
  showReveal = true
}: {
  varKey: string
  info: EnvVarInfo
  saving: string | null
  onEdit: () => void
  onClear: (key: string) => void
  onReveal: (key: string) => void
  isRevealed: boolean
  showReveal?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {info.url && (
        <Button asChild size="xs" title="Open provider docs" variant="ghost">
          <a href={info.url} rel="noreferrer" target="_blank">
            Docs
          </a>
        </Button>
      )}
      {info.is_set && showReveal && (
        <Button
          onClick={() => onReveal(varKey)}
          size="icon-xs"
          title={isRevealed ? 'Hide value' : 'Reveal value'}
          variant="ghost"
        >
          {isRevealed ? <EyeOff /> : <Eye />}
        </Button>
      )}
      <Button onClick={onEdit} size="xs" variant="outline">
        {info.is_set ? 'Replace' : 'Set'}
      </Button>
      {info.is_set && (
        <Button
          disabled={saving === varKey}
          onClick={() => onClear(varKey)}
          size="icon-xs"
          title="Clear value"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}

type EnvRowProps = {
  varKey: string
  info: EnvVarInfo
  edits: Record<string, string>
  revealed: Record<string, string>
  saving: string | null
  setEdits: Dispatch<SetStateAction<Record<string, string>>>
  onSave: (key: string) => void
  onClear: (key: string) => void
  onReveal: (key: string) => void
  compact?: boolean
}

function EnvVarRow({
  varKey,
  info,
  edits,
  revealed,
  saving,
  setEdits,
  onSave,
  onClear,
  onReveal,
  compact = false
}: EnvRowProps) {
  const isEditing = edits[varKey] !== undefined
  const isRevealed = revealed[varKey] !== undefined
  const value = isRevealed ? revealed[varKey] : info.redacted_value
  const startEdit = () => setEdits(c => ({ ...c, [varKey]: '' }))

  if (compact && !isEditing) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-[0.72rem] text-muted-foreground">{varKey}</div>
          <div className="truncate text-[0.68rem] text-muted-foreground/70">{info.description}</div>
        </div>
        <EnvActions
          info={info}
          isRevealed={isRevealed}
          onClear={onClear}
          onEdit={startEdit}
          onReveal={onReveal}
          saving={saving}
          showReveal={false}
          varKey={varKey}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-2 rounded-xl bg-background/55 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">{varKey}</span>
            <Pill tone={info.is_set ? 'primary' : 'muted'}>
              {info.is_set && <Check className="size-3" />}
              {info.is_set ? 'Set' : 'Not set'}
            </Pill>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{info.description}</p>
        </div>
        <EnvActions
          info={info}
          isRevealed={isRevealed}
          onClear={onClear}
          onEdit={startEdit}
          onReveal={onReveal}
          saving={saving}
          varKey={varKey}
        />
      </div>

      {!isEditing && info.is_set && (
        <div
          className={cn(
            'rounded-md px-3 py-2 font-mono text-xs',
            isRevealed ? 'bg-background text-foreground' : 'bg-muted/30 text-muted-foreground'
          )}
        >
          {value || '---'}
        </div>
      )}

      {isEditing && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            className={cn('min-w-56 flex-1 font-mono', CONTROL_TEXT)}
            onChange={e => setEdits(c => ({ ...c, [varKey]: e.target.value }))}
            placeholder={info.is_set ? 'Replace current value' : 'Enter value'}
            type={info.is_password ? 'password' : 'text'}
            value={edits[varKey]}
          />
          <Button disabled={saving === varKey || !edits[varKey]} onClick={() => onSave(varKey)} size="sm">
            <Save />
            {saving === varKey ? 'Saving' : 'Save'}
          </Button>
          <Button onClick={() => setEdits(c => withoutKey(c, varKey))} size="sm" variant="outline">
            <X />
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function EnvProviderGroup({
  group,
  rowProps
}: {
  group: ProviderGroup
  rowProps: Omit<EnvRowProps, 'varKey' | 'info'>
}) {
  const [expanded, setExpanded] = useState(false)
  const setCount = group.entries.filter(([, info]) => info.is_set).length

  return (
    <div className="overflow-hidden rounded-xl bg-background/60">
      <button
        className="flex w-full items-center justify-between gap-3 bg-transparent px-3 py-2.5 text-left hover:bg-accent/50"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Zap className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {group.name === 'Other' ? 'Other providers' : group.name}
          </span>
          {setCount > 0 && <Pill tone="primary">{setCount} set</Pill>}
        </span>
        <span className="text-xs text-muted-foreground">{group.entries.length} keys</span>
      </button>
      {expanded && (
        <div className="grid gap-2 bg-muted/20 p-3">
          {group.entries.map(([key, info]) => (
            <EnvVarRow compact={!info.is_set} info={info} key={key} varKey={key} {...rowProps} />
          ))}
        </div>
      )}
    </div>
  )
}

function KeysSettings({ query }: SearchProps) {
  const [vars, setVars] = useState<Record<string, EnvVarInfo> | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(true)

  useEffect(() => {
    let cancelled = false
    getEnvVars()
      .then(next => {
        if (!cancelled) {
          setVars(next)
        }
      })
      .catch(err => notifyError(err, 'API keys failed to load'))

    return () => void (cancelled = true)
  }, [])

  const filterEnv = useCallback(
    (info: EnvVarInfo, key: string, q: string, cat: string, extra?: string) => {
      if (asText(info.category) !== cat) {
        return false
      }

      if (!showAdvanced && Boolean(info.advanced)) {
        return false
      }

      if (!q) {
        return true
      }

      return (
        key.toLowerCase().includes(q) ||
        includesQuery(info.description, q) ||
        Boolean(extra && extra.toLowerCase().includes(q))
      )
    },
    [showAdvanced]
  )

  const providerGroups = useMemo<ProviderGroup[]>(() => {
    if (!vars) {
      return []
    }

    const q = query.trim().toLowerCase()

    const entries = Object.entries(vars).filter(([key, info]) =>
      filterEnv(info, key, q, 'provider', providerGroup(key))
    )

    const groups = new Map<string, [string, EnvVarInfo][]>()

    for (const entry of entries) {
      const name = providerGroup(entry[0])
      groups.set(name, [...(groups.get(name) ?? []), entry])
    }

    return Array.from(groups, ([name, entries]) => ({
      name,
      priority: providerPriority(name),
      entries: entries.sort(([a], [b]) => a.localeCompare(b)),
      hasAnySet: entries.some(([, info]) => info.is_set)
    })).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }, [filterEnv, query, vars])

  const otherGroups = useMemo(() => {
    if (!vars) {
      return []
    }

    const q = query.trim().toLowerCase()

    const labels: Record<string, string> = {
      tool: 'Tools',
      messaging: 'Messaging',
      setting: 'Settings'
    }

    return ['tool', 'messaging', 'setting'].flatMap(cat => {
      const entries = Object.entries(vars)
        .filter(([key, info]) => filterEnv(info, key, q, cat))
        .sort(([a], [b]) => a.localeCompare(b))

      return entries.length === 0 ? [] : [{ category: cat, label: labels[cat] ?? prettyName(cat), entries }]
    })
  }, [filterEnv, query, vars])

  function patchVar(key: string, patch: EnvPatch) {
    setVars(c => (c ? { ...c, [key]: { ...c[key], ...patch } } : c))
  }

  function clearLocalState(key: string) {
    setEdits(c => withoutKey(c, key))
    setRevealed(c => withoutKey(c, key))
  }

  async function handleSave(key: string) {
    const value = edits[key]

    if (!value) {
      return
    }

    setSaving(key)

    try {
      await setEnvVar(key, value)
      patchVar(key, { is_set: true, redacted_value: redactedValue(value) })
      clearLocalState(key)
      notify({ kind: 'success', title: 'Credential saved', message: `${key} updated.` })
    } catch (err) {
      notifyError(err, `Failed to save ${key}`)
    } finally {
      setSaving(null)
    }
  }

  async function handleClear(key: string) {
    if (!window.confirm(`Remove ${key} from .env?`)) {
      return
    }

    setSaving(key)

    try {
      await deleteEnvVar(key)
      patchVar(key, { is_set: false, redacted_value: null })
      clearLocalState(key)
      notify({ kind: 'success', title: 'Credential removed', message: `${key} removed.` })
    } catch (err) {
      notifyError(err, `Failed to remove ${key}`)
    } finally {
      setSaving(null)
    }
  }

  async function handleReveal(key: string) {
    if (revealed[key]) {
      setRevealed(c => withoutKey(c, key))

      return
    }

    try {
      const result = await revealEnvVar(key)
      setRevealed(c => ({ ...c, [key]: result.value }))
    } catch (err) {
      notifyError(err, `Failed to reveal ${key}`)
    }
  }

  if (!vars) {
    return <LoadingState label="Loading API keys and credentials..." />
  }

  const rowProps = {
    edits,
    revealed,
    saving,
    setEdits,
    onSave: handleSave,
    onClear: handleClear,
    onReveal: handleReveal
  }

  const configuredCount = providerGroups.filter(g => g.hasAnySet).length

  return (
    <SettingsContent>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowAdvanced(s => !s)} size="sm" variant="outline">
          {showAdvanced ? 'Hide advanced' : 'Show advanced'}
        </Button>
      </div>

      <div className="mb-6">
        <SectionHeading
          icon={Zap}
          meta={`${configuredCount} of ${providerGroups.length} configured`}
          title="LLM providers"
        />
        <div className="grid gap-2">
          {providerGroups.map(group => (
            <EnvProviderGroup group={group} key={group.name} rowProps={rowProps} />
          ))}
        </div>
      </div>

      {otherGroups.map(group => (
        <div className="mb-6" key={group.category}>
          <SectionHeading
            icon={Settings2}
            meta={`${group.entries.filter(([, i]) => i.is_set).length} of ${group.entries.length} set`}
            title={group.label}
          />
          <div className="grid gap-2">
            {group.entries.map(([key, info]) => (
              <EnvVarRow info={info} key={key} varKey={key} {...rowProps} />
            ))}
          </div>
        </div>
      ))}
    </SettingsContent>
  )
}

// ─── Appearance view ────────────────────────────────────────────────────────

const MODE_OPTIONS: Array<{
  id: ThemeMode
  label: string
  description: string
  icon: LucideIcon
}> = [
  { id: 'light', label: 'Light', description: 'Bright desktop surfaces', icon: Sun },
  { id: 'dark', label: 'Dark', description: 'Low-glare workspace', icon: Moon },
  { id: 'system', label: 'System', description: 'Follow macOS appearance', icon: Monitor }
]

function ThemePreview({ name }: { name: string }) {
  const t = BUILTIN_THEMES[name]

  if (!t) {
    return null
  }

  const c = t.colors

  return (
    <div
      className="h-20 overflow-hidden rounded-xl border shadow-xs"
      style={{ backgroundColor: c.background, borderColor: c.border }}
    >
      <div className="flex h-full">
        <div
          className="w-12 border-r"
          style={{
            backgroundColor: c.sidebarBackground ?? c.muted,
            borderColor: c.sidebarBorder ?? c.border
          }}
        />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="h-2.5 w-16 rounded-full" style={{ backgroundColor: c.foreground }} />
          <div className="h-2 w-24 rounded-full" style={{ backgroundColor: c.mutedForeground }} />
          <div className="mt-auto flex justify-end">
            <div
              className="h-5 w-16 rounded-full border"
              style={{
                backgroundColor: c.userBubble ?? c.muted,
                borderColor: c.userBubbleBorder ?? c.border
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const { themeName, mode, availableThemes, setTheme, setMode } = useTheme()
  const activeTheme = availableThemes.find(t => t.name === themeName)

  return (
    <SettingsContent>
      <div className="space-y-7">
        <div>
          <SectionHeading icon={Palette} title="Appearance" />
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These are desktop-only display preferences. Mode controls brightness; theme controls the accent palette and
            chat surface styling.
          </p>
        </div>

        <section className="rounded-2xl border border-border/50 bg-card/55 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Color Mode</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Pick a fixed mode or let Hermes follow your system setting.
              </div>
            </div>
            <Pill>{prettyName(mode)}</Pill>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map(({ id, label, description, icon: Icon }) => {
              const active = mode === id

              return (
                <button
                  className={cn(
                    'group rounded-xl border border-border/45 bg-background/55 p-3 text-left transition hover:border-primary/35 hover:bg-accent/45',
                    active && 'border-primary/65 bg-primary/8 ring-2 ring-primary/25'
                  )}
                  key={id}
                  onClick={() => setMode(id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground transition group-hover:bg-background">
                      <Icon className="size-4" />
                    </span>
                    {active && (
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-3 text-sm font-medium">{label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border/50 bg-card/55 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Desktop palettes only. The selected mode is applied on top.
              </div>
            </div>
            {activeTheme && <Pill>{activeTheme.label}</Pill>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {availableThemes.map(theme => {
              const active = themeName === theme.name

              return (
                <button
                  className={cn(
                    'rounded-2xl border border-border/45 bg-background/50 p-2.5 text-left transition hover:border-primary/35 hover:bg-accent/35',
                    active && 'border-primary/65 bg-primary/8 ring-2 ring-primary/25'
                  )}
                  key={theme.name}
                  onClick={() => setTheme(theme.name)}
                  type="button"
                >
                  <ThemePreview name={theme.name} />
                  <div className="mt-3 flex items-start justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{theme.label}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {theme.description}
                      </div>
                    </div>
                    {active && (
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </SettingsContent>
  )
}

// ─── Tools view ─────────────────────────────────────────────────────────────

function ToolsSettings({ query }: SearchProps) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [toolsets, setToolsets] = useState<ToolsetInfo[] | null>(null)
  const [savingSkill, setSavingSkill] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSkills(), getToolsets()])
      .then(([s, t]) => {
        if (cancelled) {
          return
        }

        setSkills(s)
        setToolsets(t)
      })
      .catch(err => notifyError(err, 'Capabilities failed to load'))

    return () => void (cancelled = true)
  }, [])

  const filteredSkills = useMemo(() => {
    if (!skills) {
      return []
    }

    const q = query.trim().toLowerCase()

    return skills
      .filter(s => !q || includesQuery(s.name, q) || includesQuery(s.description, q) || includesQuery(s.category, q))
      .sort(
        (a, b) => asText(a.category).localeCompare(asText(b.category)) || asText(a.name).localeCompare(asText(b.name))
      )
  }, [query, skills])

  const filteredToolsets = useMemo(() => {
    if (!toolsets) {
      return []
    }

    const q = query.trim().toLowerCase()

    return toolsets
      .filter(t => {
        if (!q) {
          return true
        }

        return (
          includesQuery(t.name, q) ||
          includesQuery(t.label, q) ||
          includesQuery(t.description, q) ||
          toolNames(t).some(n => includesQuery(n, q))
        )
      })
      .sort((a, b) => asText(a.label || a.name).localeCompare(asText(b.label || b.name)))
  }, [query, toolsets])

  const skillGroups = useMemo(() => {
    const groups = new Map<string, SkillInfo[]>()

    for (const skill of filteredSkills) {
      const cat = asText(skill.category) || 'other'
      groups.set(cat, [...(groups.get(cat) ?? []), skill])
    }

    return Array.from(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredSkills])

  async function handleToggleSkill(skill: SkillInfo, enabled: boolean) {
    setSavingSkill(skill.name)

    try {
      await toggleSkill(skill.name, enabled)
      setSkills(c => c?.map(s => (s.name === skill.name ? { ...s, enabled } : s)) ?? c)
      notify({
        kind: 'success',
        title: enabled ? 'Skill enabled' : 'Skill disabled',
        message: `${skill.name} applies to new sessions.`
      })
    } catch (err) {
      notifyError(err, `Failed to update ${skill.name}`)
    } finally {
      setSavingSkill(null)
    }
  }

  if (!skills || !toolsets) {
    return <LoadingState label="Loading skills and toolsets..." />
  }

  return (
    <SettingsContent>
      <div className="mb-6">
        <SectionHeading icon={Brain} meta={`${filteredSkills.filter(s => s.enabled).length} enabled`} title="Skills" />
        {skillGroups.map(([category, list]) => (
          <div className="mt-4 first:mt-0" key={category}>
            <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {prettyName(category)}
            </div>
            <div className="divide-y divide-border/40">
              {list.map(skill => (
                <ListRow
                  action={
                    <Switch
                      checked={skill.enabled}
                      disabled={savingSkill === skill.name}
                      onCheckedChange={c => void handleToggleSkill(skill, c)}
                    />
                  }
                  description={asText(skill.description)}
                  key={asText(skill.name)}
                  title={asText(skill.name)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <SectionHeading
          icon={Wrench}
          meta={`${filteredToolsets.filter(t => t.enabled).length} enabled`}
          title="Toolsets"
        />
        <div className="divide-y divide-border/40">
          {filteredToolsets.map(toolset => {
            const tools = toolNames(toolset)
            const label = asText(toolset.label || toolset.name)

            return (
              <ListRow
                action={
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Pill tone={toolset.enabled ? 'primary' : 'muted'}>{toolset.enabled ? 'Enabled' : 'Disabled'}</Pill>
                    <Pill tone={toolset.configured ? 'primary' : 'muted'}>
                      {toolset.configured ? 'Configured' : 'Needs keys'}
                    </Pill>
                  </div>
                }
                below={
                  tools.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {tools.slice(0, 10).map(t => (
                        <span
                          className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.64rem] text-muted-foreground"
                          key={t}
                        >
                          {t}
                        </span>
                      ))}
                      {tools.length > 10 && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.64rem] text-muted-foreground">
                          +{tools.length - 10} more
                        </span>
                      )}
                    </div>
                  )
                }
                description={asText(toolset.description)}
                key={asText(toolset.name) || label}
                title={label}
              />
            )
          })}
        </div>
      </div>
    </SettingsContent>
  )
}

// ─── Page shell ─────────────────────────────────────────────────────────────

const SEARCH_PLACEHOLDER: Record<SettingsQueryKey, string> = {
  config: 'Search settings...',
  keys: 'Search API keys...',
  tools: 'Search skills and tools...'
}

export function SettingsPage({ onClose, onConfigSaved }: SettingsPageProps) {
  const [activeView, setActiveView] = useState<SettingsView>('config:model')

  const [queries, setQueries] = useState<Record<SettingsQueryKey, string>>({
    config: '',
    keys: '',
    tools: ''
  })

  const searchInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const queryKey: SettingsQueryKey = activeView.startsWith('config:') ? 'config' : (activeView as SettingsQueryKey)
  const query = queries[queryKey]
  const setQuery = (next: string) => setQueries(c => ({ ...c, [queryKey]: next }))

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="fixed inset-0 z-60 flex min-h-0 flex-col bg-background/98 p-0.75 backdrop-blur-xl">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-10 h-[calc(var(--titlebar-height)+0.1875rem)] [-webkit-app-region:drag]">
        <div className="pointer-events-auto absolute left-1/2 top-[calc(1rem+var(--titlebar-height)/2)] w-[min(36rem,calc(100vw-32rem))] min-w-80 -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <Input
            className="h-9 rounded-full border-transparent bg-background py-2 pl-8 pr-20 text-sm shadow-header focus-visible:bg-background"
            onChange={e => setQuery(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[queryKey]}
            ref={searchInputRef}
            value={query}
          />
          {query ? (
            <Button
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
              size="icon-xs"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          ) : (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-background/80 px-1.5 py-0.5 text-[0.62rem] leading-none text-muted-foreground shadow-xs">
              Cmd P
            </span>
          )}
        </div>

        <Button
          aria-label="Close settings"
          className="pointer-events-auto absolute right-3.75 top-[calc(0.1875rem+var(--titlebar-height)/2)] h-7 w-7 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-accent/70 hover:text-foreground [-webkit-app-region:no-drag]"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] rounded-[1.0625rem] bg-background/90 pt-(--titlebar-height) max-[760px]:grid-cols-1">
        <aside className="flex min-h-0 flex-col gap-0.5 overflow-y-auto bg-muted/20 px-4 py-5">
          {SECTIONS.map(s => {
            const view = `config:${s.id}` as SettingsView

            return (
              <NavLink
                active={activeView === view && !queries.config.trim()}
                icon={s.icon}
                key={s.id}
                label={s.label}
                onClick={() => setActiveView(view)}
              />
            )
          })}
          <div className="my-2 h-px bg-border/30" />
          <NavLink
            active={activeView === 'keys'}
            icon={KeyRound}
            label="API Keys"
            onClick={() => setActiveView('keys')}
          />
          <NavLink
            active={activeView === 'tools'}
            icon={Package}
            label="Skills & Tools"
            onClick={() => setActiveView('tools')}
          />
          <div className="mt-auto flex items-center gap-1 pt-2">
            <Button
              className="text-muted-foreground"
              onClick={() => {
                // Trigger export by reading current config from disk; lightweight enough.
                getHermesConfigRecord()
                  .then(cfg => {
                    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'hermes-config.json'
                    a.click()
                    URL.revokeObjectURL(url)
                  })
                  .catch(err => notifyError(err, 'Export failed'))
              }}
              size="icon-xs"
              title="Export config"
              variant="ghost"
            >
              <Download />
            </Button>
            <Button
              className="text-muted-foreground"
              onClick={() => importInputRef.current?.click()}
              size="icon-xs"
              title="Import config"
              variant="ghost"
            >
              <Upload />
            </Button>
            <Button
              className="text-muted-foreground"
              onClick={() => {
                if (!window.confirm('Reset all settings to Hermes defaults?')) {
                  return
                }

                Promise.all([getHermesConfigDefaults()])
                  .then(([d]) => saveHermesConfig(d).then(() => onConfigSaved?.()))
                  .catch(err => notifyError(err, 'Reset failed'))
              }}
              size="icon-xs"
              title="Reset to defaults"
              variant="ghost"
            >
              <RotateCcw />
            </Button>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeView === 'config:appearance' ? (
            <AppearanceSettings />
          ) : activeView.startsWith('config:') ? (
            <ConfigSettings
              activeSectionId={activeView.slice('config:'.length)}
              importInputRef={importInputRef}
              onConfigSaved={onConfigSaved}
              query={queries.config}
            />
          ) : activeView === 'keys' ? (
            <KeysSettings query={queries.keys} />
          ) : (
            <ToolsSettings query={queries.tools} />
          )}
        </main>
      </div>
    </div>
  )
}
