import { JsonRpcGatewayClient } from '@hermes/shared'

import type {
  ActionResponse,
  ActionStatusResponse,
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  AuxiliaryModelsResponse,
  ConfigSchemaResponse,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  HermesConfig,
  HermesConfigRecord,
  LogsResponse,
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
  ModelAssignmentRequest,
  ModelAssignmentResponse,
  ModelInfoResponse,
  ModelOptionsResponse,
  OAuthPollResponse,
  OAuthProvidersResponse,
  OAuthStartResponse,
  OAuthSubmitResponse,
  PaginatedSessions,
  SessionMessagesResponse,
  SessionSearchResponse,
  SkillInfo,
  StatusResponse,
  ToolsetInfo
} from '@/types/hermes'

export type {
  ActionResponse,
  ActionStatusResponse,
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  AuxiliaryModelsResponse,
  ConfigFieldSchema,
  ConfigSchemaResponse,
  ElevenLabsVoice,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  GatewayReadyPayload,
  HermesConfig,
  HermesConfigRecord,
  LogsResponse,
  MessagingEnvVarInfo,
  MessagingHomeChannel,
  MessagingPlatformInfo,
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
  ModelAssignmentRequest,
  ModelAssignmentResponse,
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
  SessionSearchResponse,
  SessionSearchResult,
  SkillInfo,
  StatusResponse,
  ToolsetInfo
} from '@/types/hermes'

export class HermesGateway extends JsonRpcGatewayClient {
  constructor() {
    super({
      closedErrorMessage: 'Hermes gateway connection closed',
      connectErrorMessage: 'Could not connect to Hermes gateway',
      createRequestId: nextId => nextId,
      notConnectedErrorMessage: 'Hermes gateway is not connected',
      requestTimeoutMs: 0
    })
  }
}

export async function listSessions(limit = 40, minMessages = 0): Promise<PaginatedSessions> {
  const result = await window.hermesDesktop.api<PaginatedSessions>({
    path: `/api/sessions?limit=${limit}&offset=0&min_messages=${Math.max(0, minMessages)}`
  })

  return {
    ...result,
    sessions: result.sessions.slice(0, limit),
    offset: 0
  }
}

export function searchSessions(query: string): Promise<SessionSearchResponse> {
  return window.hermesDesktop.api<SessionSearchResponse>({
    path: `/api/sessions/search?q=${encodeURIComponent(query)}`
  })
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

export function renameSession(id: string, title: string): Promise<{ ok: boolean; title: string }> {
  return window.hermesDesktop.api<{ ok: boolean; title: string }>({
    path: `/api/sessions/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { title }
  })
}

export function getGlobalModelInfo(): Promise<ModelInfoResponse> {
  return window.hermesDesktop.api<ModelInfoResponse>({
    path: '/api/model/info'
  })
}

export function getStatus(): Promise<StatusResponse> {
  return window.hermesDesktop.api<StatusResponse>({
    path: '/api/status'
  })
}

export function getLogs(params: {
  component?: string
  file?: string
  level?: string
  lines?: number
}): Promise<LogsResponse> {
  const query = new URLSearchParams()

  if (params.file) {
    query.set('file', params.file)
  }

  if (typeof params.lines === 'number') {
    query.set('lines', String(params.lines))
  }

  if (params.level && params.level !== 'ALL') {
    query.set('level', params.level)
  }

  if (params.component && params.component !== 'all') {
    query.set('component', params.component)
  }

  const suffix = query.toString()

  return window.hermesDesktop.api<LogsResponse>({
    path: suffix ? `/api/logs?${suffix}` : '/api/logs'
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

export function listOAuthProviders(): Promise<OAuthProvidersResponse> {
  return window.hermesDesktop.api<OAuthProvidersResponse>({
    path: '/api/providers/oauth'
  })
}

export function startOAuthLogin(providerId: string): Promise<OAuthStartResponse> {
  return window.hermesDesktop.api<OAuthStartResponse>({
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/start`,
    method: 'POST',
    body: {}
  })
}

export function submitOAuthCode(
  providerId: string,
  sessionId: string,
  code: string
): Promise<OAuthSubmitResponse> {
  return window.hermesDesktop.api<OAuthSubmitResponse>({
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`,
    method: 'POST',
    body: { session_id: sessionId, code }
  })
}

export function pollOAuthSession(providerId: string, sessionId: string): Promise<OAuthPollResponse> {
  return window.hermesDesktop.api<OAuthPollResponse>({
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`
  })
}

export function cancelOAuthSession(sessionId: string): Promise<{ ok: boolean }> {
  return window.hermesDesktop.api<{ ok: boolean }>({
    path: `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
    method: 'DELETE'
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

export function getMessagingPlatforms(): Promise<MessagingPlatformsResponse> {
  return window.hermesDesktop.api<MessagingPlatformsResponse>({
    path: '/api/messaging/platforms'
  })
}

export function updateMessagingPlatform(
  platformId: string,
  body: MessagingPlatformUpdate
): Promise<{ ok: boolean; platform: string }> {
  return window.hermesDesktop.api<{ ok: boolean; platform: string }>({
    path: `/api/messaging/platforms/${encodeURIComponent(platformId)}`,
    method: 'PUT',
    body
  })
}

export function testMessagingPlatform(platformId: string): Promise<MessagingPlatformTestResponse> {
  return window.hermesDesktop.api<MessagingPlatformTestResponse>({
    path: `/api/messaging/platforms/${encodeURIComponent(platformId)}/test`,
    method: 'POST'
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

export function getAuxiliaryModels(): Promise<AuxiliaryModelsResponse> {
  return window.hermesDesktop.api<AuxiliaryModelsResponse>({
    path: '/api/model/auxiliary'
  })
}

export function setModelAssignment(body: ModelAssignmentRequest): Promise<ModelAssignmentResponse> {
  return window.hermesDesktop.api<ModelAssignmentResponse>({
    path: '/api/model/set',
    method: 'POST',
    body
  })
}

export function restartGateway(): Promise<ActionResponse> {
  return window.hermesDesktop.api<ActionResponse>({
    path: '/api/gateway/restart',
    method: 'POST'
  })
}

export function updateHermes(): Promise<ActionResponse> {
  return window.hermesDesktop.api<ActionResponse>({
    path: '/api/hermes/update',
    method: 'POST'
  })
}

export function getActionStatus(name: string, lines = 200): Promise<ActionStatusResponse> {
  return window.hermesDesktop.api<ActionStatusResponse>({
    path: `/api/actions/${encodeURIComponent(name)}/status?lines=${Math.max(1, lines)}`
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
