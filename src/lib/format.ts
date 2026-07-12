import { format, formatDistanceToNow } from 'date-fns';

export function formatDuration(ms?: number): string {
  if (!ms) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDate(value: string, pattern = 'MMM d, yyyy'): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, pattern) : 'Date unavailable';
}

export function relativeDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : 'Date unavailable';
}

export function isValidDateValue(value?: string): value is string {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

export function inferDirection(text: string): 'rtl' | 'ltr' {
  return /[\u0590-\u05FF]/.test(text) ? 'rtl' : 'ltr';
}
