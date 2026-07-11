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
  return format(new Date(value), pattern);
}

export function relativeDate(value: string): string {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function inferDirection(text: string): 'rtl' | 'ltr' {
  return /[\u0590-\u05FF]/.test(text) ? 'rtl' : 'ltr';
}
