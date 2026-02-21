/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL: string;
  readonly VITE_SOLANA_NETWORK: string;
  readonly VITE_AGENC_PROGRAM_ID: string;
  readonly VITE_ENABLE_LOCAL_WHISPER: string;
  readonly VITE_DEBUG: string;
  readonly VITE_PLATFORM: 'desktop' | 'mobile';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
