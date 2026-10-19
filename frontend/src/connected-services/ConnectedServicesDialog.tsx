import {
  Alert,
  Button,
  Checkbox,
  Menu,
  NativeSelect,
  PasswordInput,
  TextInput,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import {
  applyMcpServers,
  createMcpServer,
  forgetMcpLogin,
  getMcpServers,
  removeMcpServer,
  startMcpLogin,
  updateMcpServer,
  type McpServer,
  type McpSnapshot,
  type SaveMcpServer,
} from '../api/client';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';

type View = 'overview' | 'form' | 'signin' | 'confirm';
type AuthType = 'none' | 'oauth' | 'bearer' | 'headers';

interface HeaderRow {
  id: string;
  name: string;
  value: string;
  stored: boolean;
}

interface FormState {
  name: string;
  url: string;
  enabled: boolean;
  authType: AuthType;
  oauthIdentity: 'id' | 'metadata';
  clientId: string;
  clientMetadataUrl: string;
  clientSecret: string;
  clearSecret: boolean;
  scope: string;
  bearer: string;
  headers: HeaderRow[];
}

const emptyForm: FormState = {
  name: '',
  url: '',
  enabled: true,
  authType: 'none',
  oauthIdentity: 'id',
  clientId: '',
  clientMetadataUrl: '',
  clientSecret: '',
  clearSecret: false,
  scope: '',
  bearer: '',
  headers: [],
};

function formFor(server?: McpServer): FormState {
  return {
    ...emptyForm,
    name: server?.name ?? '',
    url: server?.url ?? '',
    enabled: server?.enabled ?? true,
    authType: server?.auth.type ?? 'none',
    oauthIdentity: server?.auth.clientMetadataUrl ? 'metadata' : 'id',
    clientId: server?.auth.clientId ?? '',
    clientMetadataUrl: server?.auth.clientMetadataUrl ?? '',
    scope: server?.auth.scope ?? '',
    headers: (server?.auth.headerNames ?? []).map((name) => ({
      id: crypto.randomUUID(),
      name,
      value: '',
      stored: true,
    })),
  };
}

function presentation(server: McpServer) {
  if (server.loginPending)
    return [
      'Waiting for sign-in',
      'Finish signing in in the authorization tab.',
    ];
  if (server.loginError) return ['Sign-in failed', server.loginError];
  if (
    server.enabled &&
    server.auth.type === 'oauth' &&
    (!server.hasLogin || server.status.state === 'needs-auth')
  )
    return [
      'Sign-in required',
      server.hasLogin
        ? 'Saved login was rejected.'
        : 'Sign in, then apply changes to connect.',
    ];
  if (server.applyNeeded)
    return [
      'Changes to apply',
      'Saved settings will take effect when you apply changes.',
    ];
  if (!server.enabled) return ['Disabled', ''];
  if (server.status.state === 'connected')
    return ['Connected', `${server.status.toolCount} tools`];
  if (server.status.state === 'error')
    return [
      'Connection failed',
      server.status.error ?? 'Retry applying connections.',
    ];
  return ['Not connected', server.status.error ?? 'Apply changes to connect.'];
}

export function ConnectedServicesPanel({
  open,
  preview,
}: {
  open: boolean;
  preview?: McpSnapshot;
}) {
  const { settings } = useInstanceSettings();
  const panel = useRef<HTMLDivElement>(null);
  const { update: updateReloadSafety } = useReloadSafety();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestId = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('overview');
  const [snapshot, setSnapshot] = useState<McpSnapshot>();
  const [editing, setEditing] = useState<McpServer>();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState<string>();
  const [confirmation, setConfirmation] = useState<{
    label: string;
    description: string;
    work(): Promise<void>;
  }>();
  const [feedback, setFeedback] = useState<{
    message: string;
    error?: boolean;
  }>({ message: '' });

  function show(next: View) {
    setView(next);
    panel.current?.scrollTo(0, 0);
    if (next !== 'form') updateReloadSafety({ dirtyForms: false });
  }

  function focusView(next = view) {
    requestAnimationFrame(() => {
      if (next === 'overview')
        panel.current?.querySelector<HTMLButtonElement>('#mcp-new')?.focus();
      else if (next === 'form') nameInput.current?.focus();
      else
        panel.current
          ?.querySelector<HTMLElement>(`#mcp-${next} :is(input, button, a)`)
          ?.focus();
    });
  }

  async function refresh() {
    const id = ++requestId.current;
    const data = preview ?? (await getMcpServers());
    if (id !== requestId.current) return;
    setSnapshot(data);
    if (signingIn) {
      const server = data.servers.find(
        (candidate) => candidate.id === signingIn,
      );
      if (!server?.loginPending) {
        setSigningIn(undefined);
        if (view === 'signin') show('overview');
        setFeedback(
          server?.loginError
            ? { message: server.loginError, error: true }
            : server?.hasLogin
              ? { message: 'Login saved. Apply changes to connect.' }
              : {
                  message:
                    'Sign-in ended without a saved login. Start sign-in again.',
                  error: true,
                },
        );
        focusView('overview');
      }
    }
  }

  async function action(work: () => Promise<void> | void) {
    if (busy) return;
    const previous = view;
    ++requestId.current;
    clearTimeout(timer.current);
    setBusy(true);
    setFeedback({ message: '' });
    try {
      await work();
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : 'Request failed',
      });
    } finally {
      setBusy(false);
      if (view !== previous) focusView();
    }
  }

  useEffect(() => {
    if (!open) {
      clearTimeout(timer.current);
      updateReloadSafety({ dirtyForms: false });
      setView('overview');
      return;
    }
    setView('overview');
    void action(refresh);
    // Opening starts a fresh overview while retaining no unsaved form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!open || !snapshot?.servers.some((server) => server.loginPending))
      return;
    timer.current = setTimeout(() => {
      if (busy || document.hidden) return;
      void refresh().catch(() =>
        setFeedback({
          message:
            'Could not check sign-in status. Use Refresh to check again.',
          error: true,
        }),
      );
    }, 2000);
    return () => clearTimeout(timer.current);
  }, [busy, open, snapshot, signingIn, view]);

  useEffect(() => {
    const onFocus = () => {
      if (open && !busy) void action(refresh);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });

  function edit(server?: McpServer) {
    setEditing(server);
    setForm(formFor(server));
    setFeedback({ message: '' });
    show('form');
    updateReloadSafety({ dirtyForms: false });
    focusView('form');
  }

  function updateForm(update: Partial<FormState>) {
    setForm((current) => ({ ...current, ...update }));
    updateReloadSafety({ dirtyForms: true });
  }

  function headersAuth(): NonNullable<SaveMcpServer['auth']> {
    if (
      form.headers.some((row) => !row.name.trim()) ||
      new Set(form.headers.map((row) => row.name.trim().toLowerCase())).size !==
        form.headers.length
    )
      throw new Error('Enter a unique name for every header.');
    const original =
      editing?.auth.type === 'headers' ? (editing.auth.headerNames ?? []) : [];
    const names = form.headers
      .map((row) => row.name.trim().toLowerCase())
      .sort();
    if (
      original.length &&
      form.headers.every((row) => !row.value) &&
      JSON.stringify(names) ===
        JSON.stringify(original.map((name) => name.toLowerCase()).sort())
    )
      return { type: 'headers' };
    if (form.headers.some((row) => !row.value))
      throw new Error(
        'Enter a value for every header to replace saved headers.',
      );
    return {
      type: 'headers',
      headers: Object.fromEntries(
        form.headers.map((row) => [row.name.trim(), row.value]),
      ),
    };
  }

  async function save() {
    let auth: SaveMcpServer['auth'] = { type: 'none' };
    if (form.authType === 'oauth') {
      const metadata = form.oauthIdentity === 'metadata';
      auth = {
        type: 'oauth',
        clientId: metadata ? '' : form.clientId.trim(),
        clientMetadataUrl: metadata ? form.clientMetadataUrl.trim() : '',
        scope: form.scope.trim(),
        ...(form.clearSecret
          ? { clientSecret: null }
          : form.clientSecret
            ? { clientSecret: form.clientSecret }
            : {}),
      };
    }
    if (form.authType === 'bearer')
      auth = {
        type: 'headers',
        headers: { Authorization: `Bearer ${form.bearer.trim()}` },
      };
    if (form.authType === 'headers') auth = headersAuth();
    const body: SaveMcpServer = {
      name: form.name.trim(),
      url: form.url.trim(),
      enabled: form.enabled,
      auth,
    };
    if (preview) {
      show('overview');
      await refresh();
      setFeedback({ message: 'Preview only. No server was saved.' });
      return;
    }
    if (editing) await updateMcpServer(editing.id, body);
    else await createMcpServer(body);
    show('overview');
    await refresh();
    setFeedback({
      message:
        form.authType === 'oauth'
          ? 'Saved. Sign in if needed, then apply changes to connect.'
          : 'Saved. Apply changes to connect.',
    });
  }

  async function signIn(server: McpServer) {
    if (preview) {
      setFeedback({ message: 'Preview only. No sign-in was started.' });
      return;
    }
    const popup = window.open('about:blank', '_blank');
    try {
      const { authorizationUrl } = await startMcpLogin(server.id);
      setSigningIn(server.id);
      show('signin');
      if (popup) {
        popup.opener = null;
        popup.location.href = authorizationUrl;
      }
      await refresh();
    } catch (error) {
      popup?.close();
      throw error;
    }
  }

  const applyVisible =
    snapshot?.applyNeeded ||
    snapshot?.servers.some(
      (server) => server.enabled && server.status.state !== 'connected',
    );

  return (
    <div
      ref={panel}
      id="mcp-settings-content"
      className="mcp-settings"
      aria-busy={busy || undefined}
    >
      <h3>Connected services</h3>
      {feedback.message && (
        <Alert
          id="mcp-result"
          role="status"
          color={feedback.error ? 'red' : 'pal'}
        >
          {feedback.message}
        </Alert>
      )}

      {view === 'overview' && (
        <section id="mcp-overview">
          <div className="mcp-toolbar">
            <span id="mcp-changes">
              {snapshot?.applyNeeded
                ? 'Changes to apply'
                : snapshot?.servers.length
                  ? 'All changes applied'
                  : 'No servers configured'}
            </span>
            <div className="settings-actions">
              <Button
                id="mcp-refresh"
                type="button"
                variant="default"
                disabled={busy}
                onClick={() => void action(refresh)}
              >
                Refresh
              </Button>
              <Button
                id="mcp-new"
                type="button"
                disabled={busy}
                onClick={() => edit()}
              >
                Add server
              </Button>
            </div>
          </div>
          <div id="mcp-servers">
            {snapshot?.servers.map((server) => {
              const [label, detail] = presentation(server);
              const canSignIn =
                server.auth.type === 'oauth' &&
                server.enabled &&
                (!server.hasLogin ||
                  server.status.state === 'needs-auth' ||
                  server.loginPending);
              return (
                <section
                  key={server.id}
                  className="mcp-server"
                  aria-label={server.name}
                >
                  <div>
                    <strong>{server.name}</strong>
                    <p className="mcp-url">{server.url}</p>
                    <p
                      className="mcp-server-status"
                      data-connected={label === 'Connected'}
                    >
                      {label}
                    </p>
                    <p>{detail}</p>
                  </div>
                  <div className="settings-actions">
                    {canSignIn && (
                      <Button
                        type="button"
                        variant="default"
                        disabled={busy || server.loginPending}
                        onClick={() => void action(() => signIn(server))}
                      >
                        {server.loginPending
                          ? 'Waiting for sign-in'
                          : server.hasLogin
                            ? 'Sign in again'
                            : 'Sign in'}
                      </Button>
                    )}
                    <Menu withinPortal={false} position="bottom-end">
                      <Menu.Target>
                        <Button type="button" variant="default">
                          Manage
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item disabled={busy} onClick={() => edit(server)}>
                          Edit
                        </Menu.Item>
                        {server.auth.type === 'oauth' &&
                          server.hasLogin &&
                          server.status.state !== 'needs-auth' && (
                            <Menu.Item
                              disabled={busy || server.loginPending}
                              onClick={() => void action(() => signIn(server))}
                            >
                              Sign in again
                            </Menu.Item>
                          )}
                        {server.auth.type === 'oauth' && server.hasLogin && (
                          <Menu.Item
                            disabled={busy || server.loginPending}
                            onClick={() => {
                              setConfirmation({
                                label: 'Forget login',
                                description: `Remove the saved login for ${server.name}? Apply changes to disconnect the loaded connection.`,
                                async work() {
                                  if (!preview) await forgetMcpLogin(server.id);
                                  show('overview');
                                  await refresh();
                                  setFeedback({
                                    message:
                                      'Login removed. Apply changes to disconnect.',
                                  });
                                },
                              });
                              show('confirm');
                            }}
                          >
                            Forget login
                          </Menu.Item>
                        )}
                        <Menu.Item
                          color="red"
                          disabled={busy}
                          onClick={() => {
                            setConfirmation({
                              label: 'Remove server',
                              description: `Remove ${server.name}? Its loaded connection remains until you apply changes.`,
                              async work() {
                                if (!preview) await removeMcpServer(server.id);
                                show('overview');
                                await refresh();
                                setFeedback({
                                  message:
                                    'Server removed. Apply changes to disconnect.',
                                });
                              },
                            });
                            show('confirm');
                          }}
                        >
                          Remove server
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                </section>
              );
            })}
          </div>
          {applyVisible && (
            <div id="mcp-apply-bar" className="mcp-apply-bar">
              <span>
                Apply refreshes all connections when {settings.agentName} is
                idle.
              </span>
              <Button
                id="mcp-apply"
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (!preview) await applyMcpServers();
                    await refresh();
                    setFeedback({
                      message: snapshot?.servers.some(
                        (server) =>
                          server.enabled && server.status.state !== 'connected',
                      )
                        ? 'Changes applied. Check the connection status below.'
                        : 'Connections updated.',
                    });
                  })
                }
              >
                {snapshot?.applyNeeded ? 'Apply changes' : 'Retry connections'}
              </Button>
            </div>
          )}
        </section>
      )}

      {view === 'form' && (
        <form
          id="mcp-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(save);
          }}
        >
          <h3 id="mcp-form-title">
            {editing ? `Edit ${editing.name}` : 'Add server'}
          </h3>
          <TextInput
            ref={nameInput}
            label="Name"
            name="name"
            required
            pattern="[a-z][a-z0-9_]{0,47}"
            maxLength={48}
            placeholder="research"
            disabled={busy || !!editing}
            value={form.name}
            onChange={(event) => updateForm({ name: event.target.value })}
          />
          <TextInput
            label="Server URL"
            name="url"
            type="url"
            required
            placeholder="https://example.com/mcp"
            disabled={busy}
            value={form.url}
            onChange={(event) => updateForm({ url: event.target.value })}
          />
          <Checkbox
            label="Enabled"
            name="enabled"
            disabled={busy}
            checked={form.enabled}
            onChange={(event) => updateForm({ enabled: event.target.checked })}
          />
          <NativeSelect
            label="Authentication"
            name="authType"
            disabled={busy}
            value={form.authType}
            onChange={(event) =>
              updateForm({ authType: event.target.value as AuthType })
            }
            data={[
              { value: 'none', label: 'No authentication' },
              { value: 'oauth', label: 'OAuth' },
              { value: 'bearer', label: 'Bearer token' },
              { value: 'headers', label: 'Custom headers' },
            ]}
          />
          {form.authType === 'oauth' && (
            <fieldset id="mcp-oauth">
              <NativeSelect
                label="Client identity"
                name="oauthIdentity"
                disabled={busy}
                value={form.oauthIdentity}
                onChange={(event) =>
                  updateForm({
                    oauthIdentity: event.target
                      .value as FormState['oauthIdentity'],
                  })
                }
                data={[
                  { value: 'id', label: 'Client ID' },
                  { value: 'metadata', label: 'Client metadata URL' },
                ]}
              />
              {form.oauthIdentity === 'id' ? (
                <TextInput
                  id="mcp-client-id"
                  label="Client ID"
                  name="clientId"
                  required
                  autoComplete="off"
                  disabled={busy}
                  value={form.clientId}
                  onChange={(event) =>
                    updateForm({ clientId: event.target.value })
                  }
                />
              ) : (
                <TextInput
                  id="mcp-client-metadata"
                  label="Client metadata URL"
                  name="clientMetadataUrl"
                  type="url"
                  required
                  autoComplete="off"
                  disabled={busy}
                  value={form.clientMetadataUrl}
                  onChange={(event) =>
                    updateForm({ clientMetadataUrl: event.target.value })
                  }
                />
              )}
              <PasswordInput
                label="Client secret"
                name="clientSecret"
                autoComplete="new-password"
                placeholder={
                  editing?.auth.hasClientSecret
                    ? 'Stored — leave blank to keep'
                    : 'Optional'
                }
                disabled={busy || form.clearSecret}
                value={form.clientSecret}
                onChange={(event) =>
                  updateForm({ clientSecret: event.target.value })
                }
              />
              {editing?.auth.hasClientSecret && (
                <Checkbox
                  id="mcp-clear-secret"
                  label="Remove saved client secret"
                  name="clearSecret"
                  disabled={busy}
                  checked={form.clearSecret}
                  onChange={(event) =>
                    updateForm({ clearSecret: event.target.checked })
                  }
                />
              )}
              <TextInput
                label="Scopes"
                name="scope"
                disabled={busy}
                value={form.scope}
                onChange={(event) => updateForm({ scope: event.target.value })}
                placeholder="service:read service:write offline_access"
              />
              <small>
                Register your Pal API’s /mcp/oauth/callback URL with the
                provider.
              </small>
            </fieldset>
          )}
          {form.authType === 'bearer' && (
            <fieldset id="mcp-bearer">
              <PasswordInput
                label="Bearer token"
                name="bearer"
                autoComplete="new-password"
                required
                disabled={busy}
                value={form.bearer}
                onChange={(event) => updateForm({ bearer: event.target.value })}
              />
            </fieldset>
          )}
          {form.authType === 'headers' && (
            <fieldset id="mcp-headers">
              <div id="mcp-header-rows">
                {form.headers.map((row) => (
                  <div key={row.id} className="mcp-header-row">
                    <TextInput
                      label="Header name"
                      className="mcp-header-name"
                      autoComplete="off"
                      placeholder="X-API-Key"
                      disabled={busy}
                      value={row.name}
                      onChange={(event) =>
                        updateForm({
                          headers: form.headers.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, name: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                    />
                    <PasswordInput
                      label="Value"
                      className="mcp-header-value"
                      autoComplete="new-password"
                      placeholder={
                        row.stored
                          ? 'Stored — leave blank to keep'
                          : 'Header value'
                      }
                      disabled={busy}
                      value={row.value}
                      onChange={(event) =>
                        updateForm({
                          headers: form.headers.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, value: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="default"
                      disabled={busy}
                      onClick={() =>
                        updateForm({
                          headers: form.headers.filter(
                            (candidate) => candidate.id !== row.id,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                id="mcp-add-header"
                type="button"
                variant="default"
                disabled={busy}
                onClick={() =>
                  updateForm({
                    headers: [
                      ...form.headers,
                      {
                        id: crypto.randomUUID(),
                        name: '',
                        value: '',
                        stored: false,
                      },
                    ],
                  })
                }
              >
                Add header
              </Button>
              <small id="mcp-header-help">
                {editing?.auth.headerNames?.length
                  ? 'Leave all values blank to keep saved headers. To replace them, enter every value; remove all rows to clear them.'
                  : 'Header values are stored privately.'}
              </small>
            </fieldset>
          )}
          <div className="settings-actions settings-form-actions">
            <Button
              id="mcp-cancel"
              type="button"
              variant="default"
              disabled={busy}
              onClick={() => {
                show('overview');
                setFeedback({ message: '' });
                focusView('overview');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save server
            </Button>
          </div>
        </form>
      )}

      {view === 'signin' && (
        <section id="mcp-signin">
          <h3 id="mcp-signin-title">
            Sign in to{' '}
            {snapshot?.servers.find((server) => server.id === signingIn)?.name}
          </h3>
          <p>
            Finish signing in in the new tab. This window updates automatically.
          </p>
          <a
            id="mcp-signin-link"
            target="_blank"
            rel="noopener noreferrer"
            href="#"
          >
            Open sign-in page
          </a>
          <div className="settings-actions settings-form-actions">
            <Button
              id="mcp-signin-back"
              type="button"
              variant="default"
              onClick={() => {
                show('overview');
                focusView('overview');
              }}
            >
              Back to services
            </Button>
          </div>
        </section>
      )}

      {view === 'confirm' && confirmation && (
        <section id="mcp-confirm">
          <h3 id="mcp-confirm-title">{confirmation.label}</h3>
          <p id="mcp-confirm-description">{confirmation.description}</p>
          <div className="settings-actions settings-form-actions">
            <Button
              id="mcp-confirm-cancel"
              type="button"
              variant="default"
              onClick={() => {
                show('overview');
                focusView('overview');
              }}
            >
              Cancel
            </Button>
            <Button
              id="mcp-confirm-submit"
              color="red"
              variant="light"
              type="button"
              onClick={() => void action(confirmation.work)}
            >
              {confirmation.label}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
