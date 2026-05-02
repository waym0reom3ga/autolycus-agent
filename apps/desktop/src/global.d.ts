export {}

declare global {
  interface Window {
    hermesDesktop: {
      getConnection: () => Promise<HermesConnection>
      api: <T>(request: HermesApiRequest) => Promise<T>
      notify: (payload: HermesNotification) => Promise<boolean>
      requestMicrophoneAccess: () => Promise<boolean>
      readFileDataUrl: (filePath: string) => Promise<string>
      selectPaths: (options?: HermesSelectPathsOptions) => Promise<string[]>
      writeClipboard: (text: string) => Promise<boolean>
      saveImageFromUrl: (url: string) => Promise<boolean>
      saveImageBuffer: (data: ArrayBuffer | Uint8Array, ext: string) => Promise<string>
      saveClipboardImage: () => Promise<string>
      getPathForFile: (file: File) => string
      normalizePreviewTarget: (target: string, baseDir?: string) => Promise<HermesPreviewTarget | null>
      watchPreviewFile: (url: string) => Promise<HermesPreviewWatch>
      stopPreviewFileWatch: (id: string) => Promise<boolean>
      openExternal: (url: string) => Promise<void>
      onPreviewFileChanged: (callback: (payload: HermesPreviewFileChanged) => void) => () => void
      onBackendExit: (callback: (payload: BackendExit) => void) => () => void
    }
  }
}

export interface HermesConnection {
  baseUrl: string
  token: string
  wsUrl: string
  logs: string[]
  windowButtonPosition: { x: number; y: number } | null
}

export interface HermesApiRequest {
  path: string
  method?: string
  body?: unknown
}

export interface HermesNotification {
  title?: string
  body?: string
  silent?: boolean
}

export interface HermesPreviewTarget {
  kind: 'file' | 'url'
  label: string
  source: string
  url: string
}

export interface HermesPreviewWatch {
  id: string
  path: string
}

export interface HermesPreviewFileChanged {
  id: string
  path: string
  url: string
}

export interface HermesSelectPathsOptions {
  title?: string
  defaultPath?: string
  directories?: boolean
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface BackendExit {
  code: number | null
  signal: string | null
}
