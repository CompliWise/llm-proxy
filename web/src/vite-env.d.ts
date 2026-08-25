/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly STATSIG_CLIENT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
