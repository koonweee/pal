import {
  Alert,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
  cancelLoginRequest,
  getLoginSnapshot,
  loginPreviewUrl,
  saveLoginRequest,
  submitLoginCode,
  type LoginSnapshot,
} from '../api/client';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';

export function LoginPanel({
  taskId,
  revision,
  connected,
}: {
  taskId?: string;
  revision: number;
  connected: boolean;
}) {
  const [snapshot, setSnapshot] = useState<LoginSnapshot>();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setError('');
    if (!taskId) return;
    const abort = new AbortController();
    void getLoginSnapshot(taskId, abort.signal)
      .then(setSnapshot)
      .catch(() => {
        if (!abort.signal.aborted) setError('Could not load login requests.');
      });
    return () => abort.abort();
  }, [taskId, revision, connected, refresh]);
  useEffect(() => {
    setOpened(false);
  }, [taskId]);
  if (
    !taskId ||
    (!snapshot?.requests.length && !snapshot?.inspections.length && !error)
  )
    return null;
  const pending =
    snapshot?.requests.filter((request) => request.status === 'pending') ?? [];
  return (
    <>
      <Button variant="subtle" onClick={() => setOpened(true)}>
        Logins{pending.length ? ` (${pending.length})` : ''}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Browser logins"
        size="lg"
        closeButtonProps={{ 'aria-label': 'Close logins' }}
      >
        <Stack>
          {error && (
            <Alert color="red">
              {error}
              <Button onClick={() => setRefresh((n) => n + 1)}>Retry</Button>
            </Alert>
          )}
          {snapshot &&
            !snapshot.configured &&
            pending.some((request) => request.kind === 'credentials') && (
              <Alert color="yellow">
                Bitwarden needs setup before credentials can be saved or filled.
              </Alert>
            )}
          {opened && pending[0] && (
            <SecureEntryForm
              key={pending[0].id}
              request={pending[0]}
              configured={snapshot?.configured ?? false}
              onSaved={() => setRefresh((n) => n + 1)}
            />
          )}
          {snapshot?.inspections.slice(0, 1).map((inspection) => (
            <Stack key={inspection.id} gap="xs">
              <Text fw={600}>{inspection.origin}</Text>
              <img
                src={loginPreviewUrl(inspection.id)}
                alt={`Inspected inputs on ${inspection.origin}`}
                style={{ width: '100%', height: 'auto' }}
              />
            </Stack>
          ))}
        </Stack>
      </Modal>
    </>
  );
}

function SecureEntryForm({
  request,
  configured,
  onSaved,
}: {
  request: LoginSnapshot['requests'][number];
  configured: boolean;
  onSaved(): void;
}) {
  const isCode = request.kind === 'code';
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('Personal');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { update } = useReloadSafety();
  useEffect(() => {
    update({ credentialEditing: true });
    return () => update({ credentialEditing: false });
  }, [update]);
  async function finish(cancel: boolean) {
    setBusy(true);
    setError('');
    try {
      if (cancel) await cancelLoginRequest(request.id);
      else if (isCode) await submitLoginCode(request.id, code);
      else
        await saveLoginRequest(request.id, {
          username,
          password,
          label,
          ...(accountId ? { accountId } : {}),
        });
      setCode('');
      setUsername('');
      setPassword('');
      onSaved();
    } catch {
      setError(
        cancel
          ? 'Could not cancel the request.'
          : isCode
            ? 'Could not fill the code. Check it or ask Pal to inspect the page again.'
            : 'Could not save credentials. Check vault setup and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void finish(false);
      }}
    >
      <Stack>
        <Text fw={600}>{request.origin}</Text>
        {isCode ? (
          <TextInput
            label="Verification code"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            required
            maxLength={64}
          />
        ) : (
          <>
            {!!request.accounts.length && (
              <Select
                label="Save to"
                value={accountId ?? 'new'}
                onChange={(value) =>
                  setAccountId(value === 'new' ? null : value)
                }
                data={[
                  { value: 'new', label: 'New account' },
                  ...request.accounts.map((account) => ({
                    value: account.id,
                    label: account.label,
                  })),
                ]}
              />
            )}
            <TextInput
              label="Account label"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
              required
              maxLength={80}
            />
            <TextInput
              label="Username"
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              required
              maxLength={1024}
            />
            <PasswordInput
              label="Password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              maxLength={4096}
            />
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
        <Group>
          <Button
            type="submit"
            loading={busy}
            disabled={!isCode && !configured}
          >
            {isCode ? 'Fill code' : 'Save'}
          </Button>
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => void finish(true)}
          >
            Cancel request
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
