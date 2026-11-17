/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_URL: string
  readonly VITE_SITE_URL: string
  readonly VITE_API_MOCK?: 'true' | 'false'
  readonly VITE_AUTH_MOCK?: 'true' | 'false'
  readonly VITE_GROUPS_MOCK?: 'true' | 'false'
  readonly VITE_API_PROXY_TARGET?: string
  readonly VITE_FLAGS_SOURCE?: 'local' | 'remote'
  readonly VITE_FLAGS_STREAM?: 'true' | 'false'
  readonly VITE_FLAGS_POLL_MS?: string
  readonly VITE_SOLANA_CLUSTER?: 'devnet' | 'testnet' | 'mainnet-beta'
  readonly VITE_SOLANA_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
