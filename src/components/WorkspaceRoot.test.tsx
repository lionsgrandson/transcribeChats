import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
const { getSession, configureAccountDatabase, onAuthStateChange } = vi.hoisted(() => ({ getSession: vi.fn(), configureAccountDatabase: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../services/runtime', () => ({ hostedRuntime: true }));
vi.mock('../services/supabase', () => ({ supabase: { auth: { getSession, onAuthStateChange } } }));
vi.mock('../data/db', () => ({ configureAccountDatabase }));
vi.mock('../state/AppStore', () => ({ AppStoreProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../App', () => ({ default: () => <h1>Browser workspace ready</h1> }));
import { WorkspaceRoot } from './WorkspaceRoot';

beforeEach(() => {
  getSession.mockReset(); configureAccountDatabase.mockReset();
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('an empty session opens the workspace without showing a login form', async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  render(<WorkspaceRoot />);
  expect(await screen.findByRole('heading', { name: 'Browser workspace ready' })).toBeVisible();
  expect(configureAccountDatabase).not.toHaveBeenCalled();
});

test('optional authentication failure does not block guest access', async () => {
  getSession.mockRejectedValue(new Error('Unavailable'));
  render(<WorkspaceRoot />);
  expect(await screen.findByRole('heading', { name: 'Browser workspace ready' })).toBeVisible();
});

test('a stalled optional account lookup times out into the guest workspace', async () => {
  vi.useFakeTimers();
  getSession.mockReturnValue(new Promise(() => {}));
  render(<WorkspaceRoot />);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(screen.getByRole('heading', { name: 'Browser workspace ready' })).toBeVisible();
  expect(configureAccountDatabase).not.toHaveBeenCalled();
});

test('existing accounts still select their private database before opening the store', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-account' } } } });
  render(<WorkspaceRoot />);
  expect(await screen.findByRole('heading', { name: 'Browser workspace ready' })).toBeVisible();
  expect(configureAccountDatabase).toHaveBeenCalledWith('existing-account');
});
