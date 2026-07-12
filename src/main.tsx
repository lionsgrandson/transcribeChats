import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppStoreProvider } from './state/AppStore';
import './styles.css';

if (import.meta.env.DEV) {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
  }
  if ('caches' in window) {
    void window.caches.keys().then((keys) => Promise.all(keys.filter((key) => /workbox|transcribe/i.test(key)).map((key) => window.caches.delete(key))));
  }
} else {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <StrictMode><BrowserRouter><AppStoreProvider><App /></AppStoreProvider></BrowserRouter></StrictMode>
  </AppErrorBoundary>
);
