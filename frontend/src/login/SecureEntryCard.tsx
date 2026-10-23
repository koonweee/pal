import {
  Alert,
  Button,
  Collapse,
  Group,
  Loader,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  LockKeyhole,
  X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  cancelLoginRequest,
  getLoginRequest,
  loginPreviewUrl,
  retryLoginRequest,
  saveLoginRequest,
  submitLoginCode,
  type LoginRequest,
} from '../api/client';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';

// Canonical messages carry the request ID. The login API owns mutable state.
export const SecureEntryUpdates = createContext({
  revision: 0,
  connected: false,
});

export function SecureEntryCard({ requestId }: { requestId: string }) {
  const updates = useContext(SecureEntryUpdates);
  const [request, setRequest] = useState<LoginRequest>();
  const [loadedFor, setLoadedFor] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void getLoginRequest(requestId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) {
          setRequest(next);
          setLoadedFor(requestId);
          setError('');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError('Could not load secure entry.');
      });
    return () => abort.abort();
  }, [requestId, updates.revision, updates.connected, refresh]);
  const current = loadedFor === requestId ? request : undefined;
  const pending = current?.status === 'pending';
  const complete = current?.status === 'saved' || current?.status === 'filled';
  const cancelled = current?.status === 'cancelled';
  const title = complete
    ? current.status === 'saved'
      ? 'Login saved'
      : 'Code filled'
    : cancelled
      ? 'Request cancelled'
      : current?.kind === 'code'
        ? 'Verification code'
        : 'Sign-in details';
  async function changeRecovery(cancel = false) {
    setActionBusy(true);
    setError('');
    try {
      if (!current) return;
      const result = cancel
        ? await cancelLoginRequest(current.id)
        : await retryLoginRequest(current.id);
      setRequest((value) =>
        value?.id === current.id ? { ...value, status: result.status } : value,
      );
      setRefresh((value) => value + 1);
    } catch {
      setError(cancel ? 'Could not cancel the request.' : 'Could not retry.');
    } finally {
      setActionBusy(false);
    }
  }
  return (
    <section className="secure-entry-card" aria-label="Secure entry">
      <div className="secure-entry-heading">
        <span
          className="secure-entry-icon"
          data-complete={complete || undefined}
        >
          {complete ? (
            <Check size={16} />
          ) : cancelled ? (
            <X size={16} />
          ) : (
            <LockKeyhole size={16} />
          )}
        </span>
        <div>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          {current && (
            <Text size="xs" c="dimmed">
              {new URL(current.origin).hostname}
            </Text>
          )}
        </div>
      </div>
      {pending && (
        <SecureEntryForm
          key={current.id}
          request={current}
          onFinished={(status) => {
            setRequest((value) =>
              value?.id === current.id ? { ...value, status } : value,
            );
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {!current && !error && (
        <Loader size="sm" aria-label="Loading secure entry" />
      )}
      {current?.status === 'updating' && (
        <Group gap={8} wrap="nowrap" role="status">
          <Loader size={14} />
          <Text size="sm" c="dimmed">
            Updating request…
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={actionBusy}
            onClick={() => void changeRecovery(true)}
          >
            Cancel
          </Button>
        </Group>
      )}
      {current?.status === 'failed' && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Pal couldn’t update the request.
          </Text>
          <Button
            size="sm"
            variant="light"
            loading={actionBusy}
            onClick={() => void changeRecovery()}
          >
            Try again
          </Button>
          <Button
            size="sm"
            variant="subtle"
            disabled={actionBusy}
            onClick={() => void changeRecovery(true)}
          >
            Cancel
          </Button>
        </Stack>
      )}
      {error && (
        <Alert color="red">
          {error}
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry loading
          </Button>
        </Alert>
      )}
    </section>
  );
}

function SecureEntryForm({
  request,
  onFinished,
}: {
  request: LoginRequest;
  onFinished(status: LoginRequest['status']): void;
}) {
  const codeEntry = request.kind === 'code';
  const [preview, setPreview] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('Personal');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { beginCredentialEditing } = useReloadSafety();
  useEffect(() => beginCredentialEditing(), [beginCredentialEditing]);
  async function finish(cancel: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = cancel
        ? await cancelLoginRequest(request.id)
        : codeEntry
          ? await submitLoginCode(request.id, code)
          : await saveLoginRequest(request.id, {
              username,
              password,
              label,
              ...(accountId ? { accountId } : {}),
            });
      setUsername('');
      setPassword('');
      setCode('');
      onFinished(result.status);
    } catch {
      setError(
        cancel
          ? 'Could not cancel the request.'
          : codeEntry
            ? 'Could not fill the code. Check it and try again.'
            : 'Could not save credentials. Check vault setup and try again.',
      );
    } finally {
      setCode('');
      setBusy(false);
    }
  }
  return (
    <>
      {request.inspectionId && (
        <div className="secure-entry-preview">
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<Eye size={14} />}
            rightSection={
              preview ? <ChevronUp size={14} /> : <ChevronDown size={14} />
            }
            aria-expanded={preview}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? 'Hide' : 'Show'} browser preview
          </Button>
          <Collapse in={preview}>
            {preview && (
              <img
                src={loginPreviewUrl(request.inspectionId)}
                alt={`Selected fields on ${new URL(request.origin).hostname}`}
              />
            )}
          </Collapse>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void finish(false);
        }}
      >
        <Stack gap={8}>
          {!codeEntry && !request.configured && (
            <Alert color="yellow">
              Bitwarden needs setup before credentials can be saved.
            </Alert>
          )}
          {codeEntry ? (
            <TextInput
              className="secure-entry-field"
              label="Code"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              required
              maxLength={64}
              disabled={busy}
            />
          ) : (
            <>
              {!!request.accounts.length && (
                <Select
                  className="secure-entry-field"
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
                  disabled={busy}
                />
              )}
              <TextInput
                className="secure-entry-field"
                label="Label"
                value={label}
                onChange={(event) => setLabel(event.currentTarget.value)}
                required
                maxLength={80}
                autoComplete="off"
                disabled={busy}
              />
              <TextInput
                className="secure-entry-field"
                label="Username"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                required
                maxLength={1024}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={busy}
              />
              <PasswordInput
                className="secure-entry-field"
                label="Password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                maxLength={4096}
                autoComplete="new-password"
                disabled={busy}
              />
            </>
          )}
          {codeEntry && (
            <Text size="xs" c="dimmed" className="secure-entry-note">
              Used once. Not saved.
            </Text>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Group gap={4}>
            <Button
              size="sm"
              type="submit"
              loading={busy}
              disabled={!codeEntry && !request.configured}
            >
              {codeEntry ? 'Fill code' : 'Save login'}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              color="gray"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </Group>
        </Stack>
      </form>
    </>
  );
}
