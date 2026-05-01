import type {
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  ConfigSchemaResponse,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  HermesConfig,
  HermesConfigRecord,
  ModelInfoResponse,
  ModelOptionsResponse,
  PaginatedSessions,
  RpcEvent,
  SessionMessagesResponse,
  SkillInfo,
  ToolsetInfo
} from '@/types/hermes'

export type {
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  ConfigFieldSchema,
  ConfigSchemaResponse,
  ElevenLabsVoice,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  GatewayReadyPayload,
  HermesConfig,
  HermesConfigRecord,
  ModelInfoResponse,
  ModelOptionProvider,
  ModelOptionsResponse,
  PaginatedSessions,
  RpcEvent,
  SessionCreateResponse,
  SessionInfo,
  SessionMessage,
  SessionMessagesResponse,
  SessionResumeResponse,
  SessionRuntimeInfo,
  SkillInfo,
  ToolsetInfo
} from '@/types/hermes'

type PendingCall = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class HermesGateway {
  private socket: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private eventHandlers = new Set<(event: RpcEvent) => void>()
  private stateHandlers = new Set<(state: string) => void>()

  async connect(wsUrl: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return
    }

    this.setState('connecting')
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.socket = ws

      ws.addEventListener('open', () => {
        this.setState('open')
        resolve()
      })

      ws.addEventListener('error', () => {
        this.setState('error')
        reject(new Error('Could not connect to Hermes gateway'))
      })

      ws.addEventListener('close', () => {
        this.setState('closed')

        for (const call of this.pending.values()) {
          call.reject(new Error('Hermes gateway connection closed'))
        }

        this.pending.clear()
      })

      ws.addEventListener('message', message => {
        this.handleMessage(message.data)
      })
    })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }

  onEvent(handler: (event: RpcEvent) => void): () => void {
    this.eventHandlers.add(handler)

    return () => this.eventHandlers.delete(handler)
  }

  onState(handler: (state: string) => void): () => void {
    this.stateHandlers.add(handler)

    return () => this.stateHandlers.delete(handler)
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Hermes gateway is not connected'))
    }

    const id = this.nextId++

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    })

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject
      })
      socket.send(payload)
    })
  }

  private handleMessage(raw: unknown): void {
    const text = typeof raw === 'string' ? raw : String(raw)

    let frame: {
      id?: number
      result?: unknown
      error?: { message?: string }
      method?: string
      params?: RpcEvent
    }

    try {
      frame = JSON.parse(text)
    } catch {
      return
    }

    if (typeof frame.id === 'number') {
      const call = this.pending.get(frame.id)

      if (!call) {
        return
      }

      this.pending.delete(frame.id)

      if (frame.error) {
        call.reject(new Error(frame.error.message || 'Hermes RPC failed'))
      } else {
        call.resolve(frame.result)
      }

      return
    }

    if (frame.method === 'event' && frame.params) {
      for (const handler of this.eventHandlers) {
        handler(frame.params)
      }
    }
  }

  private setState(state: string): void {
    for (const handler of this.stateHandlers) {
      handler(state)
    }
  }
}

export async function listSessions(limit = 40): Promise<PaginatedSessions> {
  const result = await window.hermesDesktop.api<PaginatedSessions>({
    path: `/api/sessions?limit=${limit}&offset=0&min_messages=1`
  })

  return {
    ...result,
    sessions: result.sessions.slice(0, limit),
    offset: 0
  }
}

export function getSessionMessages(id: string): Promise<SessionMessagesResponse> {
  return window.hermesDesktop.api<SessionMessagesResponse>({
    path: `/api/sessions/${encodeURIComponent(id)}/messages`
  })
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    path: `/api/sessions/${encodeURIComponent(id)}`,
    method: 'DELETE'
  })
}

export function getGlobalModelInfo(): Promise<ModelInfoResponse> {
  return window.hermesDesktop.api<ModelInfoResponse>({
    path: '/api/model/info'
  })
}

export function getHermesConfig(): Promise<HermesConfig> {
  return window.hermesDesktop.api<HermesConfig>({
    path: '/api/config'
  })
}

export function getHermesConfigRecord(): Promise<HermesConfigRecord> {
  return window.hermesDesktop.api<HermesConfigRecord>({
    path: '/api/config'
  })
}

export function getHermesConfigDefaults(): Promise<HermesConfigRecord> {
  return window.hermesDesktop.api<HermesConfigRecord>({
    path: '/api/config/defaults'
  })
}

export function getHermesConfigSchema(): Promise<ConfigSchemaResponse> {
  return window.hermesDesktop.api<ConfigSchemaResponse>({
    path: '/api/config/schema'
  })
}

export function saveHermesConfig(config: HermesConfigRecord): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    path: '/api/config',
    method: 'PUT',
    body: { config }
  })
}

export function getEnvVars(): Promise<Record<string, EnvVarInfo>> {
  return window.hermesDesktop.api<Record<string, EnvVarInfo>>({
    path: '/api/env'
  })
}

export function setEnvVar(key: string, value: string): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    path: '/api/env',
    method: 'PUT',
    body: { key, value }
  })
}

export function deleteEnvVar(key: string): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    path: '/api/env',
    method: 'DELETE',
    body: { key }
  })
}

export function revealEnvVar(key: string): Promise<{ key: string; value: string }> {
  return window.hermesDesktop.api<{ key: string; value: string }>({
    path: '/api/env/reveal',
    method: 'POST',
    body: { key }
  })
}

export function getSkills(): Promise<SkillInfo[]> {
  return window.hermesDesktop.api<SkillInfo[]>({
    path: '/api/skills'
  })
}

export function toggleSkill(name: string, enabled: boolean): Promise<{ ok: boolean; name: string; enabled: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean; name: string; enabled: boolean }>({
    path: '/api/skills/toggle',
    method: 'PUT',
    body: { name, enabled }
  })
}

export function getToolsets(): Promise<ToolsetInfo[]> {
  return window.hermesDesktop.api<ToolsetInfo[]>({
    path: '/api/tools/toolsets'
  })
}

export function getGlobalModelOptions(): Promise<ModelOptionsResponse> {
  return window.hermesDesktop.api<ModelOptionsResponse>({
    path: '/api/model/options'
  })
}

export function setGlobalModel(
  provider: string,
  model: string
): Promise<{ ok: boolean; provider: string; model: string }> {
  return window.hermesDesktop.api<{ ok: boolean; provider: string; model: string }>({
    path: '/api/model/set',
    method: 'POST',
    body: {
      scope: 'main',
      provider,
      model
    }
  })
}

export function transcribeAudio(dataUrl: string, mimeType?: string): Promise<AudioTranscriptionResponse> {
  return window.hermesDesktop.api<AudioTranscriptionResponse>({
    path: '/api/audio/transcribe',
    method: 'POST',
    body: {
      data_url: dataUrl,
      mime_type: mimeType
    }
  })
}

export function speakText(text: string): Promise<AudioSpeakResponse> {
  return window.hermesDesktop.api<AudioSpeakResponse>({
    path: '/api/audio/speak',
    method: 'POST',
    body: { text }
  })
}

export function getElevenLabsVoices(): Promise<ElevenLabsVoicesResponse> {
  return window.hermesDesktop.api<ElevenLabsVoicesResponse>({
    path: '/api/audio/elevenlabs/voices'
  })
}
