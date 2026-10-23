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
import {
  getLoginSnapshot,
  saveLoginRequest,
  submitLoginCode,
} from '../src/api/client';

vi.mock('../src/api/client', () => ({
  getLoginSnapshot: vi.fn(),
  saveLoginRequest: vi.fn(),
  submitLoginCode: vi.fn(),
  cancelLoginRequest: vi.fn(),
  loginPreviewUrl: (id: string) => '/api/login/inspections/' + id + '/image',
}));
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
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
        kind: 'credentials' as const,
        accounts: [],
      },
    ],
    inspections: [
      { id: 'inspection', origin: 'https://example.com' },
      { id: 'older', origin: 'https://example.com' },
      { id: 'oldest', origin: 'https://example.com' },
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
  expect(screen.getAllByRole('img')).toHaveLength(1);
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

test('collects only a verification code, fills through the direct API without vault setup, and clears it on close or success', async () => {
  const snapshot = {
    configured: false,
    requests: [
      {
        id: 'code-request',
        origin: 'https://example.com',
        status: 'pending' as const,
        kind: 'code' as const,
        accounts: [],
      },
    ],
    inspections: [],
  };
  vi.mocked(getLoginSnapshot).mockResolvedValue(snapshot);
  vi.mocked(submitLoginCode)
    .mockRejectedValueOnce(new Error('stale'))
    .mockResolvedValue({ id: 'code-request', status: 'filled' });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(
    <MantineProvider>
      <ReloadSafetyProvider>
        <LoginPanel taskId="task" revision={0} connected />
      </ReloadSafetyProvider>
    </MantineProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Logins (1)' }));
  expect(screen.queryByLabelText(/^Username/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^Account label/)).not.toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText(/^Verification code/), {
    target: { value: '731946' },
  });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() =>
    expect(
      screen.queryByLabelText(/^Verification code/),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Logins (1)' }));
  expect(await screen.findByLabelText(/^Verification code/)).toHaveValue('');
  fireEvent.change(screen.getByLabelText(/^Verification code/), {
    target: { value: '731946' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fill code' }));
  expect(
    await screen.findByText(/Could not fill the code/),
  ).toBeInTheDocument();
  vi.mocked(getLoginSnapshot).mockResolvedValue({
    ...snapshot,
    requests: [{ ...snapshot.requests[0], status: 'filled' }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fill code' }));
  await waitFor(() =>
    expect(submitLoginCode).toHaveBeenCalledWith('code-request', '731946'),
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText(/^Verification code/),
    ).not.toBeInTheDocument(),
  );
  expect(saveLoginRequest).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});
