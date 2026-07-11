import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';

export function Button({ children, className = '', variant = 'primary', busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>
      {busy && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon || <Inbox size={26} />}</div>
      <h3>{title}</h3><p>{body}</p>{action}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state error-state">
      <div className="empty-icon" aria-hidden="true"><AlertCircle size={26} /></div>
      <h3>{title}</h3>{body && <p>{body}</p>}{action}
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return <div className="banner banner-success"><CheckCircle2 size={18} />{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function PageSkeleton() {
  return <div className="page"><Skeleton className="skeleton-title" /><div className="metric-grid"><Skeleton className="skeleton-card" /><Skeleton className="skeleton-card" /><Skeleton className="skeleton-card" /></div><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" /></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const keys: Record<string, TranslationKey> = { ready: 'ready', processing: 'processing', queued: 'queued', failed: 'failed', draft: 'draft', needs_review: 'needsReview', open: 'open', completed: 'completed', success: 'success', failure: 'failure' };
  return <span className={`status-badge status-${status.replaceAll('_', '-')}`}>{keys[status] ? t(keys[status]) : status.replaceAll('_', ' ')}</span>;
}

export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
