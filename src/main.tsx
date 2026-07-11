import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppStoreProvider } from './state/AppStore';
import './styles.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <StrictMode><BrowserRouter><AppStoreProvider><App /></AppStoreProvider></BrowserRouter></StrictMode>
  </AppErrorBoundary>
);
