/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_PROVIDER?: 'qwen' | 'template'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
