import {
  RequestError,
  createPreference,
  getPreference,
  getPreferenceHistory,
  getPreferences,
  updatePreference,
  type Preference,
  type PreferenceRevision,
  type PreferenceSnapshot,
  type PreferenceStatus,
} from './api';

let navigateToMessage: (
  id: string,
  taskId?: string,
) => void | Promise<void> = () => {};

export function configurePreferences(options: {
  navigateToMessage: typeof navigateToMessage;
}) {
  navigateToMessage = options.navigateToMessage;
}

const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`)!;
const dialog = element<HTMLDialogElement>('preferences-dialog');
const overview = element('preferences-overview');
const form = element<HTMLFormElement>('preference-form');
const detail = element('preference-detail');
const result = element('preferences-result');
const list = element('preferences-list');
const input = (name: string) =>
  form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;

let rows: PreferenceSnapshot[] = [];
let after: string | null = null;
let selected: Preference | undefined;
let editing: Preference | undefined;
let revisions: PreferenceRevision[] = [];
let historyAfter: string | null = null;
let conflictCurrent: Preference | undefined;
let busy = false;

function feedback(message: string, error = false) {
  result.textContent = message;
  result.dataset.error = String(error);
}

function setBusy(value: boolean) {
  busy = value;
  dialog.toggleAttribute('aria-busy', value);
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('button'))
    if (button.id !== 'preferences-close') button.disabled = value;
  for (const control of dialog.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input, textarea, select'))
    control.disabled = value;
}

async function action(work: () => Promise<void>) {
  if (busy) return;
  setBusy(true);
  feedback('');
  try {
    await work();
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'Request failed', true);
  } finally {
    setBusy(false);
  }
}

function show(view: 'overview' | 'form' | 'detail') {
  overview.hidden = view !== 'overview';
  form.hidden = view !== 'form';
  detail.hidden = view !== 'detail';
  dialog.scrollTop = 0;
}

function statusFilter() {
  return element<HTMLSelectElement>('preferences-status')
    .value as PreferenceStatus;
}

function renderList() {
  const fragment = document.createDocumentFragment();
  for (const preference of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preference-card';
    const topic = document.createElement('span');
    topic.className = 'preferences-topic';
    topic.textContent = preference.topic;
    const statement = document.createElement('strong');
    statement.textContent = preference.statement;
    const meta = document.createElement('small');
    meta.textContent = `${preference.basis === 'user-stated' ? 'User stated' : 'Model inferred'} · v${preference.version}${preference.appliesWhen ? ` · ${preference.appliesWhen}` : ''}`;
    button.append(topic, statement, meta);
    button.addEventListener('click', () => void openDetail(preference.id));
    fragment.append(button);
  }
  list.replaceChildren(fragment);
  element('preferences-empty').hidden = rows.length > 0;
  element('preferences-more').hidden = after === null;
}

async function refresh(append = false) {
  const query = element<HTMLInputElement>('preferences-query').value;
  const page = await getPreferences({
    query,
    status: statusFilter(),
    after: append ? (after ?? undefined) : undefined,
  });
  rows = append ? [...rows, ...page.preferences] : page.preferences;
  after = page.after;
  renderList();
}

function renderSources() {
  const sources = element('preference-sources');
  if (!selected?.sources.length) {
    const empty = document.createElement('p');
    empty.className = 'preferences-empty';
    empty.textContent =
      'No linked source message. This record was entered by a human.';
    sources.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const source of selected.sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preference-source';
    const text = document.createElement('span');
    text.textContent = source.textPreview || 'User message';
    const meta = document.createElement('small');
    meta.textContent = `Message ${source.sequence} · ${new Date(source.createdAt).toLocaleString()}`;
    button.append(text, meta);
    button.addEventListener('click', () => {
      dialog.close();
      void navigateToMessage(source.id, source.taskId ?? undefined);
    });
    fragment.append(button);
  }
  sources.replaceChildren(fragment);
}

function renderHistory() {
  const container = element('preference-history');
  const fragment = document.createDocumentFragment();
  for (const revision of revisions) {
    const row = document.createElement('article');
    row.className = 'preference-revision';
    const heading = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `Version ${revision.version}`;
    const actor = document.createElement('small');
    actor.textContent = `${revision.actor}${revision.taskId ? ' task' : ''} · ${new Date(revision.createdAt).toLocaleString()}`;
    heading.append(title, actor);
    const statement = document.createElement('p');
    statement.textContent = revision.snapshot.statement;
    const reason = document.createElement('small');
    reason.textContent = revision.reason;
    row.append(heading, statement, reason);
    if (selected && revision.version !== selected.version) {
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = 'Restore as new version';
      restore.addEventListener(
        'click',
        () =>
          void action(async () => {
            if (!selected) return;
            selected = await updatePreference(selected.id, {
              expectedVersion: selected.version,
              topic: revision.snapshot.topic,
              statement: revision.snapshot.statement,
              appliesWhen: revision.snapshot.appliesWhen,
              sourceMessageIds: revision.snapshot.sourceMessageIds,
              status: revision.snapshot.status,
              reason: `Restored version ${revision.version}.`,
            });
            await loadHistory();
            renderDetail();
            feedback(
              `Restored version ${revision.version} as version ${selected.version}.`,
            );
          }),
      );
      row.append(restore);
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  element('preference-history-more').hidden = historyAfter === null;
}

function renderDetail() {
  if (!selected) return;
  element('preference-topic').textContent = selected.topic;
  element('preference-statement').textContent = selected.statement;
  element('preference-applies').textContent = selected.appliesWhen
    ? `Applies when: ${selected.appliesWhen}`
    : 'Applies generally.';
  element('preference-meta').textContent =
    `${selected.basis === 'user-stated' ? 'User stated' : 'Model inferred'} · ${selected.status} · version ${selected.version} · updated ${new Date(selected.updatedAt).toLocaleString()}`;
  element('preference-status-action').textContent =
    selected.status === 'active' ? 'Retire' : 'Reactivate';
  renderSources();
  renderHistory();
}

async function loadHistory(append = false) {
  if (!selected) return;
  const page = await getPreferenceHistory(
    selected.id,
    append ? (historyAfter ?? undefined) : undefined,
  );
  revisions = append ? [...revisions, ...page.revisions] : page.revisions;
  historyAfter = page.after;
}

async function openDetail(id: string) {
  await action(async () => {
    selected = await getPreference(id);
    await loadHistory();
    renderDetail();
    show('detail');
  });
}

function openForm(preference?: Preference) {
  editing = preference;
  conflictCurrent = undefined;
  form.reset();
  input('topic').value = preference?.topic ?? '';
  input('statement').value = preference?.statement ?? '';
  input('appliesWhen').value = preference?.appliesWhen ?? '';
  input('reason').value = preference ? 'Corrected by the user.' : '';
  element('preference-form-title').textContent = preference
    ? 'Edit preference'
    : 'Add preference';
  element('preference-conflict').hidden = true;
  show('form');
  input('topic').focus();
}

function conflictFrom(error: unknown) {
  if (!(error instanceof RequestError) || error.status !== 409)
    return undefined;
  const body = error.body;
  if (!body || typeof body !== 'object' || !('current' in body))
    return undefined;
  return body.current as Preference;
}

element('preferences-open').addEventListener('click', () => {
  show('overview');
  dialog.showModal();
  void action(() => refresh());
});
element('preferences-close').addEventListener('click', () => dialog.close());
element('preferences-refresh').addEventListener(
  'click',
  () => void action(() => refresh()),
);
element('preferences-new').addEventListener('click', () => openForm());
element('preferences-more').addEventListener(
  'click',
  () => void action(() => refresh(true)),
);
element<HTMLFormElement>('preferences-search').addEventListener(
  'submit',
  (event) => {
    event.preventDefault();
    void action(() => refresh());
  },
);
element('preference-back').addEventListener('click', () => {
  show('overview');
  void action(() => refresh());
});
element('preference-edit').addEventListener('click', () => {
  if (selected) openForm(selected);
});
element('preference-form-cancel').addEventListener('click', () => {
  if (editing && selected) {
    renderDetail();
    show('detail');
  } else show('overview');
});
element('preference-conflict-retry').addEventListener('click', () => {
  if (!conflictCurrent) return;
  editing = conflictCurrent;
  element('preference-conflict').hidden = true;
  feedback(
    'Draft preserved. Review it, then save against the current version.',
  );
});
element('preference-status-action').addEventListener(
  'click',
  () =>
    void action(async () => {
      if (!selected) return;
      const status = selected.status === 'active' ? 'retired' : 'active';
      selected = await updatePreference(selected.id, {
        expectedVersion: selected.version,
        status,
        reason:
          status === 'retired'
            ? 'Retired by the user.'
            : 'Reactivated by the user.',
      });
      await loadHistory();
      renderDetail();
      feedback(
        status === 'retired'
          ? 'Retired. It is excluded from normal preference lookup.'
          : 'Preference reactivated.',
      );
    }),
);
element('preference-history-more').addEventListener(
  'click',
  () =>
    void action(async () => {
      await loadHistory(true);
      renderHistory();
    }),
);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void action(async () => {
    try {
      const values = {
        topic: input('topic').value.trim(),
        statement: input('statement').value.trim(),
        appliesWhen: input('appliesWhen').value.trim() || null,
        reason: input('reason').value.trim(),
      };
      selected = editing
        ? await updatePreference(editing.id, {
            expectedVersion: editing.version,
            ...values,
          })
        : await createPreference(values);
      editing = undefined;
      await loadHistory();
      renderDetail();
      show('detail');
      feedback('Preference saved.');
    } catch (error) {
      const current = conflictFrom(error);
      if (!current) throw error;
      conflictCurrent = current;
      element('preference-conflict-text').textContent =
        `This preference changed to version ${current.version} while you were editing. Your draft is preserved.`;
      element('preference-conflict').hidden = false;
    }
  });
});
