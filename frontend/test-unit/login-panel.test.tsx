import { MantineProvider } from '@mantine/core';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { LoginPanel } from '../src/login/LoginPanel';
import { ReloadSafetyProvider } from '../src/pwa/ReloadSafetyProvider';
import { getLoginSnapshot, saveLoginRequest } from '../src/api/client';

vi.mock('../src/api/client', () => ({
  getLoginSnapshot: vi.fn(),
  saveLoginRequest: vi.fn(),
  cancelLoginRequest: vi.fn(),
  loginPreviewUrl: (id: string) => '/api/login/inspections/' + id + '/image',
}));
beforeAll(() => {
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('shows masked preview and sends credentials only through the save API; close clears drafts', async () => {
  const snapshot = {
    configured: true,
    requests: [
      {
        id: 'request',
        origin: 'https://example.com',
        status: 'pending' as const,
        accounts: [],
      },
    ],
    inspections: [
      { id: 'inspection', origin: 'https://example.com', targets: [] },
    ],
  };
  vi.mocked(getLoginSnapshot).mockResolvedValue(snapshot);
  vi.mocked(saveLoginRequest).mockResolvedValue({
    id: 'request',
    status: 'saved',
  });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const view = (revision: number) => (
    <MantineProvider>
      <ReloadSafetyProvider>
        <LoginPanel taskId="task" revision={revision} connected />
      </ReloadSafetyProvider>
    </MantineProvider>
  );
  const { rerender } = render(view(0));
  fireEvent.click(await screen.findByRole('button', { name: 'Logins (1)' }));
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    '/api/login/inspections/inspection/image',
  );
  fireEvent.change(screen.getByLabelText(/^Username/), {
    target: { value: 'dummy-user' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'dummy-password' },
  });
  rerender(view(1));
  await waitFor(() => expect(getLoginSnapshot).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(/^Password/)).toHaveValue('dummy-password');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Logins (1)' }));
  expect(await screen.findByLabelText(/^Password/)).toHaveValue('');
  fireEvent.change(screen.getByLabelText(/^Username/), {
    target: { value: 'dummy-user' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'dummy-password' },
  });
  vi.mocked(getLoginSnapshot).mockResolvedValue({
    ...snapshot,
    requests: [{ ...snapshot.requests[0], status: 'saved' }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(saveLoginRequest).toHaveBeenCalledWith('request', {
      username: 'dummy-user',
      password: 'dummy-password',
      label: 'Personal',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument(),
  );
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});
