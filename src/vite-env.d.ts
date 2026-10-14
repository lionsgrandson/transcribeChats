/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_WORKER_URL?: string;
  readonly VITE_CLOUD_TRANSCRIBE_URL?: string;
  readonly VITE_AI_API_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_RUNTIME_MODE?: 'local' | 'hosted';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
