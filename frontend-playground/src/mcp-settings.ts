import { mcpRequest, type McpServer, type McpSnapshot } from './api';

const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`)!;
const dialog = element<HTMLDialogElement>('mcp-settings');
const form = element<HTMLFormElement>('mcp-form');
const result = element('mcp-result');
const list = element('mcp-servers');
const input = (name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
type View = 'overview' | 'form' | 'signin' | 'confirm';
let view: View = 'overview';
let editing: McpServer | undefined;
let snapshot: McpSnapshot | undefined;
let busy = false;
let requestId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let signingIn: string | undefined;
let confirmation: (() => Promise<void>) | undefined;

function showView(next: View) {
  view = next;
  for (const name of ['overview', 'form', 'signin', 'confirm'])
    element(`mcp-${name}`).hidden = name !== next;
  for (const menu of dialog.querySelectorAll<HTMLDetailsElement>(
    '.mcp-manage[open]',
  ))
    menu.open = false;
  dialog.scrollTop = 0;
}
function focusView() {
  if (!dialog.open) return;
  const target =
    view === 'overview'
      ? element('mcp-new')
      : element(`mcp-${view}`).querySelector<HTMLElement>(
          'input:not(:disabled), button, a',
        );
  target?.focus();
}
function feedback(message: string, error = false) {
  result.textContent = message;
  result.dataset.error = String(error);
}
function setBusy(value: boolean) {
  busy = value;
  form.inert = value;
  if (value) dialog.setAttribute('aria-busy', 'true');
  else dialog.removeAttribute('aria-busy');
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('button'))
    if (button.id !== 'mcp-close')
      button.disabled = value || button.dataset.blocked === 'true';
}
async function action(work: () => Promise<void> | void) {
  if (busy) return;
  const previousView = view;
  ++requestId; // Ignore a poll that started before this mutation.
  clearTimeout(timer);
  setBusy(true);
  feedback('');
  try {
    await work();
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'Request failed', true);
  } finally {
    setBusy(false);
    if (view !== previousView) focusView();
    schedulePoll();
  }
}
function button(
  label: string,
  work: () => Promise<void> | void,
  blocked = false,
) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.dataset.blocked = String(blocked);
  node.disabled = blocked || busy;
  node.addEventListener('click', () => void action(work));
  return node;
}
function authFields() {
  const oauth = input('authType').value === 'oauth';
  const metadata = input('oauthIdentity').value === 'metadata';
  element('mcp-oauth').hidden = !oauth;
  element('mcp-bearer').hidden = input('authType').value !== 'bearer';
  element('mcp-headers').hidden = input('authType').value !== 'headers';
  element('mcp-client-id').hidden = metadata;
  element('mcp-client-metadata').hidden = !metadata;
  input('clientId').required = oauth && !metadata;
  input('clientId').disabled = !oauth || metadata;
  input('clientMetadataUrl').required = oauth && metadata;
  input('clientMetadataUrl').disabled = !oauth || !metadata;
  input('bearer').required = input('authType').value === 'bearer';
  input('bearer').disabled = input('authType').value !== 'bearer';
  input('clientSecret').disabled = !oauth || input('clearSecret').checked;
}
function addHeader(name = '', stored = false) {
  const row = document.createElement('div');
  row.className = 'mcp-header-row';
  // Static markup; saved header names are assigned as input values.
  row.innerHTML =
    '<label>Header name<input class="mcp-header-name" autocomplete="off" placeholder="X-API-Key"></label><label>Value<input class="mcp-header-value" type="password" autocomplete="new-password"></label>';
  row.querySelector<HTMLInputElement>('.mcp-header-name')!.value = name;
  row.querySelector<HTMLInputElement>('.mcp-header-value')!.placeholder = stored
    ? 'Stored — leave blank to keep'
    : 'Header value';
  row.append(button('Remove', () => row.remove()));
  element('mcp-header-rows').append(row);
}
function edit(server?: McpServer) {
  editing = server;
  form.reset();
  feedback('');
  input('name').value = server?.name ?? '';
  input('name').disabled = !!server;
  input('url').value = server?.url ?? '';
  input('enabled').checked = server?.enabled ?? true;
  input('authType').value = server?.auth.type ?? 'none';
  input('oauthIdentity').value = server?.auth.clientMetadataUrl
    ? 'metadata'
    : 'id';
  input('clientId').value = server?.auth.clientId ?? '';
  input('clientMetadataUrl').value = server?.auth.clientMetadataUrl ?? '';
  input('scope').value = server?.auth.scope ?? '';
  input('clientSecret').placeholder = server?.auth.hasClientSecret
    ? 'Stored — leave blank to keep'
    : 'Optional';
  element('mcp-clear-secret').hidden = !server?.auth.hasClientSecret;
  element('mcp-header-rows').replaceChildren();
  for (const name of server?.auth.headerNames ?? []) addHeader(name, true);
  element('mcp-header-help').textContent = server?.auth.headerNames?.length
    ? 'Leave all values blank to keep saved headers. To replace them, enter every value; remove all rows to clear them.'
    : 'Header values are stored privately.';
  element('mcp-form-title').textContent = server
    ? `Edit ${server.name}`
    : 'Add server';
  authFields();
  showView('form');
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
function confirm(
  label: string,
  description: string,
  work: () => Promise<void>,
) {
  confirmation = work;
  element('mcp-confirm-title').textContent = label;
  element('mcp-confirm-description').textContent = description;
  element('mcp-confirm-submit').textContent = label;
  showView('confirm');
}
async function signIn(server: McpServer) {
  const popup = window.open('about:blank', '_blank');
  try {
    const { authorizationUrl } = await mcpRequest<{ authorizationUrl: string }>(
      `/servers/${server.id}/login`,
      'POST',
    );
    signingIn = server.id;
    element('mcp-signin-title').textContent = `Sign in to ${server.name}`;
    element<HTMLAnchorElement>('mcp-signin-link').href = authorizationUrl;
    showView('signin');
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
function render(data: McpSnapshot) {
  snapshot = data;
  element('mcp-changes').textContent = data.applyNeeded
    ? 'Changes to apply'
    : data.servers.length
      ? 'All changes applied'
      : 'No servers configured';
  element('mcp-apply-bar').hidden =
    !data.applyNeeded &&
    !data.servers.some(
      (server) => server.enabled && server.status.state !== 'connected',
    );
  element('mcp-apply').textContent = data.applyNeeded
    ? 'Apply changes'
    : 'Retry connections';
  list.replaceChildren();
  for (const server of data.servers) {
    const row = document.createElement('section');
    row.className = 'mcp-server';
    row.setAttribute('aria-label', server.name);
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = server.name;
    const url = document.createElement('p');
    url.className = 'mcp-url';
    url.textContent = server.url;
    const [label, detail] = presentation(server);
    const status = document.createElement('p');
    status.className = 'mcp-server-status';
    status.dataset.connected = String(label === 'Connected');
    status.textContent = label!;
    const description = document.createElement('p');
    description.textContent = detail!;
    info.append(title, url, status, description);
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    if (
      server.auth.type === 'oauth' &&
      server.enabled &&
      (!server.hasLogin ||
        server.status.state === 'needs-auth' ||
        server.loginPending)
    )
      actions.append(
        button(
          server.loginPending
            ? 'Waiting for sign-in'
            : server.hasLogin
              ? 'Sign in again'
              : 'Sign in',
          () => signIn(server),
          server.loginPending,
        ),
      );
    const manage = document.createElement('details');
    manage.className = 'mcp-manage';
    const toggle = document.createElement('summary');
    toggle.textContent = 'Manage';
    const menu = document.createElement('div');
    menu.append(button('Edit', () => edit(server)));
    if (server.auth.type === 'oauth') {
      if (server.hasLogin && server.status.state !== 'needs-auth')
        menu.append(
          button('Sign in again', () => signIn(server), server.loginPending),
        );
      if (server.hasLogin)
        menu.append(
          button(
            'Forget login',
            () =>
              confirm(
                'Forget login',
                `Remove the saved login for ${server.name}? Apply changes to disconnect the loaded connection.`,
                async () => {
                  await mcpRequest(`/servers/${server.id}/login`, 'DELETE');
                  showView('overview');
                  await refresh();
                  feedback('Login removed. Apply changes to disconnect.');
                },
              ),
            server.loginPending,
          ),
        );
    }
    const remove = button('Remove server', () =>
      confirm(
        'Remove server',
        `Remove ${server.name}? Its loaded connection remains until you apply changes.`,
        async () => {
          await mcpRequest(`/servers/${server.id}`, 'DELETE');
          showView('overview');
          await refresh();
          feedback('Server removed. Apply changes to disconnect.');
        },
      ),
    );
    remove.className = 'settings-danger';
    menu.append(remove);
    manage.append(toggle, menu);
    actions.append(manage);
    row.append(info, actions);
    list.append(row);
  }
  if (signingIn) {
    const server = data.servers.find((server) => server.id === signingIn);
    if (!server?.loginPending) {
      signingIn = undefined;
      if (view === 'signin') showView('overview');
      if (server?.loginError) feedback(server.loginError, true);
      else if (server?.hasLogin)
        feedback('Login saved. Apply changes to connect.');
      else
        feedback(
          'Sign-in ended without a saved login. Start sign-in again.',
          true,
        );
      focusView();
    }
  }
  setBusy(busy);
}
async function refresh() {
  const id = ++requestId;
  const data = await mcpRequest<McpSnapshot>('/servers');
  if (id !== requestId) return;
  render(data);
  schedulePoll();
}
function schedulePoll() {
  clearTimeout(timer);
  if (!dialog.open || !snapshot?.servers.some((server) => server.loginPending))
    return;
  timer = setTimeout(() => {
    if (busy || document.hidden) {
      schedulePoll();
      return;
    }
    void refresh().catch(() => {
      feedback(
        'Could not check sign-in status. Use Refresh to check again.',
        true,
      );
      schedulePoll();
    });
  }, 2000);
}
function headersAuth() {
  const rows = Array.from(
    element('mcp-header-rows').querySelectorAll('.mcp-header-row'),
  ).map((row) => ({
    name: row.querySelector<HTMLInputElement>('.mcp-header-name')!.value.trim(),
    value: row.querySelector<HTMLInputElement>('.mcp-header-value')!.value,
  }));
  if (
    rows.some((row) => !row.name) ||
    new Set(rows.map((row) => row.name.toLowerCase())).size !== rows.length
  )
    throw new Error('Enter a unique name for every header.');
  const original =
    editing?.auth.type === 'headers' ? (editing.auth.headerNames ?? []) : [];
  const names = rows.map((row) => row.name.toLowerCase()).sort();
  if (
    original.length &&
    rows.every((row) => !row.value) &&
    JSON.stringify(names) ===
      JSON.stringify(original.map((name) => name.toLowerCase()).sort())
  )
    return { type: 'headers' };
  if (rows.some((row) => !row.value))
    throw new Error('Enter a value for every header to replace saved headers.');
  return {
    type: 'headers',
    headers: Object.fromEntries(rows.map((row) => [row.name, row.value])),
  };
}
element('mcp-open').addEventListener('click', () => {
  showView('overview');
  dialog.showModal();
  void action(refresh);
});
element('mcp-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  clearTimeout(timer);
  form.reset();
});
element('mcp-refresh').addEventListener('click', () => void action(refresh));
element('mcp-apply').addEventListener(
  'click',
  () =>
    void action(async () => {
      await mcpRequest('/apply', 'POST');
      await refresh();
      feedback(
        snapshot?.servers.some(
          (server) => server.enabled && server.status.state !== 'connected',
        )
          ? 'Changes applied. Check the connection status below.'
          : 'Connections updated.',
      );
    }),
);
element('mcp-new').addEventListener('click', () => {
  edit();
  focusView();
});
for (const id of ['mcp-cancel', 'mcp-signin-back', 'mcp-confirm-cancel'])
  element(id).addEventListener('click', () => {
    form.reset();
    feedback('');
    showView('overview');
    focusView();
  });
element('mcp-confirm-submit').addEventListener(
  'click',
  () => void action(() => confirmation?.()),
);
element('mcp-add-header').addEventListener('click', () => {
  addHeader();
  element('mcp-header-rows')
    .lastElementChild?.querySelector<HTMLInputElement>('input')
    ?.focus();
});
for (const name of ['authType', 'oauthIdentity', 'clearSecret'])
  input(name).addEventListener('change', authFields);
window.addEventListener('focus', () => {
  if (dialog.open && !busy) void action(refresh);
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void action(async () => {
    const type = input('authType').value;
    let auth: object = { type };
    if (type === 'oauth') {
      const metadata = input('oauthIdentity').value === 'metadata';
      auth = {
        type,
        clientId: metadata ? '' : input('clientId').value.trim(),
        clientMetadataUrl: metadata
          ? input('clientMetadataUrl').value.trim()
          : '',
        scope: input('scope').value.trim(),
        ...(input('clearSecret').checked
          ? { clientSecret: null }
          : input('clientSecret').value
            ? { clientSecret: input('clientSecret').value }
            : {}),
      };
    }
    if (type === 'bearer')
      auth = {
        type: 'headers',
        headers: { Authorization: `Bearer ${input('bearer').value.trim()}` },
      };
    if (type === 'headers') auth = headersAuth();
    await mcpRequest(
      editing ? `/servers/${editing.id}` : '/servers',
      editing ? 'PATCH' : 'POST',
      {
        name: input('name').value.trim(),
        url: input('url').value.trim(),
        enabled: input('enabled').checked,
        auth,
      },
    );
    form.reset();
    showView('overview');
    await refresh();
    feedback(
      type === 'oauth'
        ? 'Saved. Sign in if needed, then apply changes to connect.'
        : 'Saved. Apply changes to connect.',
    );
  });
});
