import { BrainCircuit, CalendarDays, CheckSquare2, CirclePlus, Clock3, Home, Languages, Menu, MessageCircleMore, Search, Settings, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n/useTranslation';
import { useAppStore } from '../state/AppStore';
import { Button } from './ui';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { t, locale } = useTranslation();
  const { online, updateSettings, toast } = useAppStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!mobileOpen && !searchOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen, searchOpen]);
  const nav = [
    { to: '/', label: t('home'), icon: Home },
    { to: '/new', label: t('newTranscript'), icon: CirclePlus },
    { to: '/study', label: 'Study Library', icon: BrainCircuit },
    { to: '/social-audit', label: 'Conversation Audit', icon: MessageCircleMore },
    { to: '/tasks', label: t('tasks'), icon: CheckSquare2 },
    { to: '/calendar', label: t('calendar'), icon: CalendarDays },
    { to: '/history', label: t('history'), icon: Clock3 },
    { to: '/settings', label: t('settings'), icon: Settings }
  ];
  const doSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(`/history?q=${encodeURIComponent(query)}`);
    setSearchOpen(false);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{locale === 'he' ? 'דלג לתוכן' : 'Skip to content'}</a>
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label={t('appName')}>
        <div className="brand"><span className="brand-mark">T</span><span>{t('appName')}</span><button type="button" className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button></div>
        <nav className="main-nav" aria-label="Primary">
          {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar-footer">
          <div className={`connectivity ${online ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite">{online ? <Wifi size={16} /> : <WifiOff size={16} />}{online ? t('online') : t('offline')}</div>
          <button type="button" className="language-toggle" onClick={() => void updateSettings({ locale: locale === 'en' ? 'he' : 'en' })}><Languages size={18} />{locale === 'en' ? 'עברית' : 'English'}</button>
        </div>
      </aside>
      {mobileOpen && <button type="button" className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <header className="topbar">
          <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
          <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-haspopup="dialog" aria-expanded={searchOpen}><Search size={18} /><span>{t('search')}</span><kbd>Ctrl K</kbd></button>
          <div className="topbar-actions"><span className={`sync-dot ${online ? 'online' : ''}`} title={online ? t('online') : t('offline')} aria-hidden="true" /><Button variant="primary" onClick={() => navigate('/new')}><CirclePlus size={18} /><span>{t('newTranscript')}</span></Button></div>
        </header>
        <main id="main-content" tabIndex={-1}><Outlet /></main>
      </div>
      {searchOpen && <div className="search-overlay" role="dialog" aria-modal="true" aria-label={t('search')} onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}><form className="global-search" role="search" onSubmit={doSearch}><Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} /><button type="button" className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X /></button></form></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
