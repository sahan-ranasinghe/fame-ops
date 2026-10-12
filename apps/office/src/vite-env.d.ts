/// <reference types="vite/client" />

/** Set by vite.config.ts: "web" (Cloudflare Pages, office-api) or "artifact" (one file, the Claude connector). */
declare const __BUILD__: "web" | "artifact";
declare const __VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_OFFICE_API_URL?: string;
}

interface Window {
  /** The Claude artifact runtime (artifact build only). */
  claude?: { use?: (capability: string) => Promise<unknown> };
}
