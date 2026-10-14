import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PageSkeleton } from './components/ui';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const NewTranscriptionPage = lazy(() => import('./pages/NewTranscriptionPage').then((m) => ({ default: m.NewTranscriptionPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const TranscriptionDetailPage = lazy(() => import('./pages/TranscriptionDetailPage').then((m) => ({ default: m.TranscriptionDetailPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const StudyLibraryPage = lazy(() => import('./pages/StudyLibraryPage').then((m) => ({ default: m.StudyLibraryPage })));
const SocialAuditPage = lazy(() => import('./pages/SocialAuditPage').then((m) => ({ default: m.SocialAuditPage })));
const SalesPage = lazy(() => import('./pages/SalesPage').then((m) => ({ default: m.SalesPage })));

export default function App() {
  return <Suspense fallback={<PageSkeleton />}>
    <Routes><Route element={<AppShell />}>
      <Route index element={<HomePage />} />
      <Route path="new" element={<NewTranscriptionPage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="tasks" element={<TasksPage />} />
      <Route path="calendar" element={<CalendarPage />} />
      <Route path="study" element={<StudyLibraryPage />} />
      <Route path="social-audit" element={<SocialAuditPage />} />
      <Route path="sales" element={<SalesPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="transcriptions/:id" element={<TranscriptionDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route></Routes>
  </Suspense>;
}
