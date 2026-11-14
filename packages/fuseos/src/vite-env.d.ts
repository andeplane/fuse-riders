/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The room service's origin when the site is deployed apart from it (GitHub Pages and Cloud Run); unset means the page's own. */
  readonly VITE_API_ORIGIN?: string;
}
