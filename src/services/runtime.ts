// One frontend: production on a remote origin never probes a user's localhost.
export function isLocalOrigin(hostname: string = window.location.hostname): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ||
    /^192\.168\./.test(hostname) || /^10\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

export const hostedRuntime = import.meta.env.VITE_RUNTIME_MODE === 'hosted' || !isLocalOrigin();
export const cloudTranscription = Boolean(import.meta.env.VITE_CLOUD_TRANSCRIBE_URL?.trim());

export function requireLocalWorker(): void {
  if (hostedRuntime || cloudTranscription) throw new Error('This action uses the desktop engine. Open the local application, or use the ChatGPT export and import tools here.');
}
