/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_MODE?: 'enabled' | 'disabled'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_GENERATION_MODE?: 'real' | 'mock'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
