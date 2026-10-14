import { useEffect, useRef } from 'react';

interface Turnstile {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: Turnstile } }

export function AuthChallenge({ onToken }: { onToken: (token: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useEffect(() => {
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!sitekey) return;
    let widget: string | undefined;
    let active = true;
    const render = () => {
      if (!active || !element.current || !window.turnstile || widget) return;
      widget = window.turnstile.render(element.current, { sitekey, theme: 'auto', callback: (token: string) => callback.current(token), 'expired-callback': () => callback.current(''), 'error-callback': () => callback.current('') });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-auth-challenge]');
    if (!script) {
      script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.dataset.authChallenge = 'true'; document.head.appendChild(script);
    }
    script.addEventListener('load', render); render();
    return () => { active = false; script?.removeEventListener('load', render); if (widget) window.turnstile?.remove(widget); };
  }, []);
  return import.meta.env.VITE_TURNSTILE_SITE_KEY ? <div ref={element} className="auth-challenge" aria-label="Sign-in verification" /> : null;
}
