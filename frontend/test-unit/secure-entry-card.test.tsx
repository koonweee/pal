import { MantineProvider } from '@mantine/core';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  SecureEntryCard,
  SecureEntryUpdates,
} from '../src/login/SecureEntryCard';
import {
  ReloadSafetyProvider,
  useReloadSafety,
} from '../src/pwa/ReloadSafetyProvider';
import { canActivateUpdate } from '../src/pwa/reload-safety';
import {
  cancelLoginRequest,
  getLoginRequest,
  retryLoginRequest,
  saveLoginRequest,
  selectLoginAccount,
  submitLoginCode,
  submitPaymentCard,
  type LoginRequest,
} from '../src/api/client';
vi.mock('../src/api/client', () => ({
  getLoginRequest: vi.fn(),
  retryLoginRequest: vi.fn(),
  saveLoginRequest: vi.fn(),
  selectLoginAccount: vi.fn(),
  submitLoginCode: vi.fn(),
  submitPaymentCard: vi.fn(),
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
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const pending: LoginRequest = {
  id: 'request',
  origin: 'https://example.com',
  kind: 'credentials',
  status: 'pending',
  inspectionId: 'bound-preview',
  configured: true,
  chooseAccount: false,
  keepMeSignedIn: true,
  accounts: [],
};
function Safety() {
  const { safety } = useReloadSafety();
  return (
    <output>
      {canActivateUpdate(safety) ? 'Reload safe' : 'Reload blocked'}
    </output>
  );
}
function view(revision = 0, ids = ['request'], connected = true) {
  return (
    <MantineProvider>
      <ReloadSafetyProvider>
        <SecureEntryUpdates.Provider value={{ revision, connected }}>
          {ids.map((id) => (
            <SecureEntryCard key={id} requestId={id} />
          ))}
          <Safety />
        </SecureEntryUpdates.Provider>
      </ReloadSafetyProvider>
    </MantineProvider>
  );
}

test('submits credentials privately, preserves drafts on updates and reconnect, and shows only its bound preview on the active form', async () => {
  vi.mocked(getLoginRequest).mockResolvedValue(pending);
  vi.mocked(saveLoginRequest).mockResolvedValue({
    id: 'request',
    status: 'saved',
  });
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const { rerender } = render(view());
  expect(await screen.findByLabelText(/^Password/)).toHaveValue('');
  expect(screen.getByText('Reload blocked')).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', { name: 'Keep me signed in' }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep me signed in' }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show browser preview' }));
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    '/api/login/inspections/bound-preview/image',
  );
  fireEvent.change(screen.getByLabelText(/^Username/), {
    target: { value: 'dummy-user' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'dummy-password' },
  });
  rerender(view(1, ['request'], false));
  await waitFor(() => expect(getLoginRequest).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText(/^Password/)).toHaveValue('dummy-password');
  expect(
    screen.getByRole('checkbox', { name: 'Keep me signed in' }),
  ).not.toBeChecked();
  rerender(view(1, ['request'], true));
  await waitFor(() => expect(getLoginRequest).toHaveBeenCalledTimes(3));
  vi.mocked(getLoginRequest).mockResolvedValue({
    ...pending,
    status: 'saved',
    inspectionId: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save login' }));
  await waitFor(() =>
    expect(saveLoginRequest).toHaveBeenCalledWith('request', {
      username: 'dummy-user',
      password: 'dummy-password',
      label: 'Personal',
      keepMeSignedIn: false,
    }),
  );
  expect(await screen.findByText('Login saved')).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /browser preview/ }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText('Reload safe')).toBeInTheDocument();
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

test('replaces stale code forms, discards codes, and offers retry only after automatic recovery fails', async () => {
  let current: LoginRequest = { ...pending, kind: 'code', configured: false };
  vi.mocked(getLoginRequest).mockImplementation(async () => current);
  vi.mocked(submitLoginCode).mockImplementation(async () => {
    current = { ...current, status: 'updating', inspectionId: null };
    return { id: 'request', status: 'updating' };
  });
  const { rerender } = render(view());
  await screen.findByLabelText(/^Code/);
  expect(
    screen.queryByRole('checkbox', { name: 'Keep me signed in' }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Code/), {
    target: { value: '731946' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fill code' }));
  expect(await screen.findByText('Updating request…')).toBeInTheDocument();
  expect(submitLoginCode).toHaveBeenCalledWith('request', '731946');
  expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Try again' }),
  ).not.toBeInTheDocument();
  current = {
    ...current,
    id: 'replacement',
    status: 'pending',
    inspectionId: 'new-preview',
  };
  rerender(view(1));
  expect(await screen.findByLabelText(/^Code/)).toHaveValue('');
  fireEvent.change(screen.getByLabelText(/^Code/), {
    target: { value: '123456' },
  });
  current = { ...current, status: 'failed', inspectionId: null };
  rerender(view(2));
  expect(
    await screen.findByRole('button', { name: 'Try again' }),
  ).toBeInTheDocument();
  vi.mocked(retryLoginRequest).mockImplementation(async () => {
    current = { ...current, status: 'updating' };
    return { id: 'replacement', status: 'updating' };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Updating request…')).toBeInTheDocument();
  expect(retryLoginRequest).toHaveBeenCalledWith('replacement');
  vi.mocked(cancelLoginRequest).mockImplementation(async () => {
    current = { ...current, status: 'cancelled' };
    return { id: 'replacement', status: 'cancelled' };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Request cancelled')).toBeInTheDocument();
  expect(saveLoginRequest).not.toHaveBeenCalled();
});

test('keeps reload blocked until every active form closes, and cancellation removes the form and preview', async () => {
  const rows = new Map(['a', 'b'].map((id) => [id, { ...pending, id }]));
  vi.mocked(getLoginRequest).mockImplementation(async (id) => rows.get(id)!);
  vi.mocked(cancelLoginRequest).mockImplementation(async (id) => {
    rows.set(id, { ...pending, id, status: 'cancelled', inspectionId: null });
    return { id, status: 'cancelled' };
  });
  const { rerender } = render(view(0, ['a', 'b']));
  await waitFor(() =>
    expect(screen.getAllByLabelText(/^Password/)).toHaveLength(2),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
  await waitFor(() =>
    expect(screen.getAllByLabelText(/^Password/)).toHaveLength(1),
  );
  expect(screen.getByText('Reload blocked')).toBeInTheDocument();
  rerender(view(0, ['b']));
  expect(screen.getByText('Reload blocked')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Reload safe')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /browser preview/ }),
  ).not.toBeInTheDocument();
});

test('offers saved accounts and new entry, keeps checkbox drafts local, and selects privately without requesting credentials', async () => {
  let current: LoginRequest = {
    ...pending,
    chooseAccount: true,
    accounts: [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
    ],
  };
  vi.mocked(getLoginRequest).mockImplementation(async () => current);
  vi.mocked(selectLoginAccount).mockImplementation(async () => {
    current = { ...current, status: 'filled', inspectionId: null };
    return { id: 'request', status: 'filled' };
  });
  const { rerender } = render(view());
  expect(await screen.findByText('Choose an account')).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /browser preview/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use a new account' }));
  expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  expect(screen.queryByLabelText('Save to')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: 'discarded-dummy' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use a new account' }));
  expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Work' }));
  current = { ...current, keepMeSignedIn: false };
  rerender(view(1));
  await waitFor(() => expect(getLoginRequest).toHaveBeenCalledTimes(2));
  expect(
    screen.getByRole('checkbox', { name: 'Keep me signed in' }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep me signed in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(selectLoginAccount).toHaveBeenCalledWith('request', {
      accountId: 'work',
      keepMeSignedIn: false,
    }),
  );
  expect(await screen.findByText('Login filled')).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(saveLoginRequest).not.toHaveBeenCalled();
  expect(await screen.findByText('Reload safe')).toBeInTheDocument();
});

test('selects a masked saved card and submits only missing payment details without login preferences', async () => {
  const cardRequest: LoginRequest = {
    ...pending,
    kind: 'card',
    chooseAccount: true,
    cards: [
      { id: 'synthetic', label: 'Personal', brand: 'Visa', lastFour: '4242' },
    ],
    fields: ['expiry', 'securityCode'],
  };
  vi.mocked(getLoginRequest).mockResolvedValue(cardRequest);
  vi.mocked(submitPaymentCard).mockResolvedValue({
    id: 'request',
    status: 'filled',
  });
  render(view());
  expect(await screen.findByText('Choose a card')).toBeInTheDocument();
  expect(screen.getByLabelText(/Personal.*4242/)).toBeInTheDocument();
  expect(screen.queryByText('Keep me signed in')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use card' }));
  await waitFor(() =>
    expect(submitPaymentCard).toHaveBeenCalledWith('request', {
      accountId: 'synthetic',
    }),
  );
  cleanup();
  vi.mocked(submitPaymentCard).mockClear();
  vi.mocked(getLoginRequest).mockResolvedValue({
    ...cardRequest,
    chooseAccount: false,
    configured: false,
  });
  render(view());
  fireEvent.change(await screen.findByLabelText(/^Month/), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText(/^Year/), { target: { value: '29' } });
  fireEvent.change(screen.getByLabelText(/^CVV/), { target: { value: '123' } });
  expect(screen.queryByLabelText(/^Number/)).not.toBeInTheDocument();
  expect(screen.queryByText('Save to Bitwarden')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fill details' }));
  await waitFor(() =>
    expect(submitPaymentCard).toHaveBeenCalledWith('request', {
      expMonth: '12',
      expYear: '29',
      securityCode: '123',
    }),
  );
});

test('requires only requested card fields until the user opts into saving a complete card', async () => {
  vi.mocked(getLoginRequest).mockResolvedValue({
    ...pending,
    kind: 'card',
    fields: ['number', 'expiry', 'securityCode'],
    cards: [],
  });
  render(view());
  expect(await screen.findByLabelText(/^Name/)).not.toBeRequired();
  expect(screen.getByLabelText(/^Month/)).toBeRequired();
  expect(screen.getByLabelText(/^Year/)).toBeRequired();
  fireEvent.click(screen.getByLabelText('Save to Bitwarden'));
  expect(screen.getByLabelText(/^Name/)).toBeRequired();
});
