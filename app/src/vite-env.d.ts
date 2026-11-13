/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse der Schnittstelle, Standard: ./api/index.php */
  readonly VITE_API?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
