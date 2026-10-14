import { BookOpen, CalendarDays, CirclePlus, Clock3, Home, Languages, ListChecks, Menu, Search, Settings, TrendingUp, Users, Wifi, WifiOff, X } from 'lucide-react';
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
    const down = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') { setMobileOpen(false); setSearchOpen(false); }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);
  useEffect(() => {
    if (!mobileOpen && !searchOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen, searchOpen]);
  const nav = [
    { to: '/', label: t('home'), icon: Home },
    { to: '/new', label: t('newTranscript'), icon: CirclePlus },
    { to: '/history', label: t('history'), icon: Clock3 },
    { to: '/tasks', label: t('tasks'), icon: ListChecks },
    { to: '/calendar', label: t('calendar'), icon: CalendarDays },
    { to: '/study', label: locale === 'he' ? 'לימוד וקורסים' : 'Study & courses', icon: BookOpen, specialized: true },
    { to: '/social-audit', label: locale === 'he' ? 'ניתוח שיחות' : 'Conversation insights', icon: Users },
    { to: '/sales', label: locale === 'he' ? 'תובנות מכירה' : 'Sales intelligence', icon: TrendingUp },
    { to: '/settings', label: t('settings'), icon: Settings }
  ];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{locale === 'he' ? 'דלג לתוכן' : 'Skip to content'}</a>
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label={t('appName')}>
      <div className="brand"><span className="brand-mark">T</span><span>{t('appName')}</span><button type="button" className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button></div>
      <nav className="main-nav" aria-label="Primary">
        {nav.map(({ to, label, icon: Icon, specialized }) => <div key={to}>{specialized && <p className="nav-section-label">{locale === 'he' ? 'סביבות עבודה' : 'Workspaces'}</p>}<NavLink to={to} end={to === '/'} onClick={() => setMobileOpen(false)}><Icon size={20} /><span>{label}</span></NavLink></div>)}
      </nav>
      <div className="sidebar-footer">
        <div className={`connectivity ${online ? 'is-online' : 'is-offline'}`} role="status"><span>{online ? <Wifi size={16} /> : <WifiOff size={16} />}</span>{online ? t('online') : t('offline')}</div>
        <button type="button" className="language-toggle" onClick={() => void updateSettings({ locale: locale === 'en' ? 'he' : 'en' })}><Languages size={18} />{locale === 'en' ? 'עברית' : 'English'}</button>
      </div>
    </aside>
    {mobileOpen && <button type="button" className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <div className="app-main">
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
        <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)} aria-haspopup="dialog"><Search size={18} /><span>{t('search')}</span><kbd>Ctrl K</kbd></button>
        <div className="topbar-actions"><Button variant="primary" onClick={() => navigate('/new')}><CirclePlus size={18} /><span>{t('newTranscript')}</span></Button></div>
      </header>
      <main id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
    {searchOpen && <div className="search-overlay" role="dialog" aria-modal="true" aria-label={t('search')} onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <form className="global-search" role="search" onSubmit={(event) => { event.preventDefault(); navigate(`/history?q=${encodeURIComponent(query)}`); setSearchOpen(false); }}>
        <Search aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
        <button type="button" className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X /></button>
      </form>
    </div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
