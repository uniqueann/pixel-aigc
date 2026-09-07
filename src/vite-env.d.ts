/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GENERATION_MODE?: 'real' | 'mock'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
