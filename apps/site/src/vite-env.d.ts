/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INDEX_URL?: string;
  readonly VITE_REGISTRAR_URL?: string;
  readonly VITE_CHAIN?: string;
  readonly VITE_DATA_SOURCE?: string;
}
