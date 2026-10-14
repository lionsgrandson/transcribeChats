import { useEffect, useState } from 'react';
import { configureAccountDatabase } from '../data/db';
import { hostedRuntime } from '../services/runtime';
import { supabase } from '../services/supabase';
import { AppStoreProvider } from '../state/AppStore';
import App from '../App';

export function WorkspaceRoot() {
  const [ready, setReady] = useState(!hostedRuntime || !supabase);
  useEffect(() => {
    if (!hostedRuntime || !supabase) return;
    let active = true;
    let initialAccount: string | null | undefined;
    // An unreachable optional account service must never keep guests at a loading gate.
    const timeout = window.setTimeout(() => {
      if (active && initialAccount === undefined) { initialAccount = null; setReady(true); }
    }, 3000);
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      const nextAccount = error ? null : data.session?.user.id ?? null;
      if (initialAccount !== undefined) {
        if (initialAccount !== nextAccount) window.location.reload();
        return;
      }
      initialAccount = nextAccount;
      if (initialAccount) configureAccountDatabase(initialAccount);
      setReady(true);
    }).catch(() => { if (active) { initialAccount = null; setReady(true); } });
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      if (initialAccount !== undefined && initialAccount !== (session?.user.id ?? null)) window.location.reload();
    });
    return () => { active = false; window.clearTimeout(timeout); listener.data.subscription.unsubscribe(); };
  }, []);
  if (!ready) return <main className="auth-screen" role="status">Opening your browser workspace…</main>;
  return <AppStoreProvider><App /></AppStoreProvider>;
}
