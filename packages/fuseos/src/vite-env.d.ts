/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** The deployed room service's origin; unset locally, where `pnpm dev:online` serves the API beside the site. */
  readonly VITE_API_ORIGIN?: string;
}
