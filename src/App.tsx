import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PageSkeleton } from './components/ui';

const CalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const NewTranscriptionPage = lazy(() => import('./pages/NewTranscriptionPage').then((module) => ({ default: module.NewTranscriptionPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const TranscriptionDetailPage = lazy(() => import('./pages/TranscriptionDetailPage').then((module) => ({ default: module.TranscriptionDetailPage })));

export default function App() {
  return <Suspense fallback={<PageSkeleton />}><Routes><Route element={<AppShell />}><Route index element={<HomePage />} /><Route path="new" element={<NewTranscriptionPage />} /><Route path="tasks" element={<TasksPage />} /><Route path="calendar" element={<CalendarPage />} /><Route path="history" element={<HistoryPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="transcriptions/:id" element={<TranscriptionDetailPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes></Suspense>;
}
