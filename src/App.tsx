import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PageSkeleton } from './components/ui';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const NewTranscriptionPage = lazy(() => import('./pages/NewTranscriptionPage').then((m) => ({ default: m.NewTranscriptionPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TranscriptionDetailPage = lazy(() => import('./pages/TranscriptionDetailPage').then((m) => ({ default: m.TranscriptionDetailPage })));

export default function App() {
  return <Suspense fallback={<PageSkeleton />}>
    <Routes><Route element={<AppShell />}>
      <Route index element={<HomePage />} />
      <Route path="new" element={<NewTranscriptionPage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="transcriptions/:id" element={<TranscriptionDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route></Routes>
  </Suspense>;
}
