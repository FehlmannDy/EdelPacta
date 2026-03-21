/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IPFS_GATEWAY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
