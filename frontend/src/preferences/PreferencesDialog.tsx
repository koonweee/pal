import {
  Alert,
  Button,
  Modal,
  NativeSelect,
  Tabs,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import {
  createPreference,
  getPreference,
  getPreferenceHistory,
  getPreferences,
  RequestError,
  updatePreference,
  type Preference,
  type PreferenceRevision,
  type PreferenceSnapshot,
  type PreferenceStatus,
  type McpSnapshot,
} from '../api/client';
import { ConnectedServicesPanel } from '../connected-services/ConnectedServicesDialog';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';
import { PwaPreferences } from '../pwa/PwaPreferences';
import { InstanceSettingsForm } from '../instance-settings/InstanceSettingsForm';

type View = 'overview' | 'form' | 'detail';
type SettingsTab = 'memory' | 'connections' | 'agent' | 'appearance' | 'app';

export interface PreferencesPreview {
  preferences: Preference[];
  revisions: PreferenceRevision[];
}

interface PreferencesDialogProps {
  open: boolean;
  onClose(): void;
  onNavigateMessage(id: string, taskId?: string): void;
  preview?: PreferencesPreview;
  servicesPreview?: McpSnapshot;
}

function conflictFrom(error: unknown) {
  if (!(error instanceof RequestError) || error.status !== 409) return;
  const body = error.body;
  if (!body || typeof body !== 'object' || !('current' in body)) return;
  return body.current as Preference;
}

export function PreferencesDialog({
  open,
  onClose,
  onNavigateMessage,
  preview,
  servicesPreview,
}: PreferencesDialogProps) {
  const content = useRef<HTMLDivElement>(null);
  const { update: updateReloadSafety } = useReloadSafety();
  const [view, setView] = useState<View>('overview');
  const [tab, setTab] = useState<SettingsTab>('memory');
  const [rows, setRows] = useState<PreferenceSnapshot[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PreferenceStatus>('active');
  const [selected, setSelected] = useState<Preference>();
  const [editing, setEditing] = useState<Preference>();
  const [formDefaults, setFormDefaults] = useState({
    topic: '',
    statement: '',
    appliesWhen: '',
    reason: '',
  });
  const [revisions, setRevisions] = useState<PreferenceRevision[]>([]);
  const [historyAfter, setHistoryAfter] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Preference>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    error?: boolean;
  }>({ message: '' });

  function close() {
    updateReloadSafety({ dirtyForms: false });
    setView('overview');
    setTab('memory');
    onClose();
  }

  function show(next: View) {
    setView(next);
    content.current?.scrollTo(0, 0);
    if (next !== 'form') updateReloadSafety({ dirtyForms: false });
  }

  async function action(work: () => Promise<void>) {
    if (busy) return;
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
    }
  }

  async function refresh(append = false) {
    if (preview) {
      const normalized = query.trim().toLowerCase();
      setRows(
        preview.preferences.filter(
          (preference) =>
            preference.status === status &&
            (!normalized ||
              `${preference.topic} ${preference.statement} ${preference.appliesWhen ?? ''}`
                .toLowerCase()
                .includes(normalized)),
        ),
      );
      setAfter(null);
      return;
    }
    const page = await getPreferences({
      query,
      status,
      after: append ? (after ?? undefined) : undefined,
    });
    setRows((current) =>
      append ? [...current, ...page.preferences] : page.preferences,
    );
    setAfter(page.after);
  }

  async function loadHistory(preference: Preference, append = false) {
    if (preview) {
      setRevisions(
        preview.revisions.filter(
          (revision) => revision.preferenceId === preference.id,
        ),
      );
      setHistoryAfter(null);
      return;
    }
    const page = await getPreferenceHistory(
      preference.id,
      append ? (historyAfter ?? undefined) : undefined,
    );
    setRevisions((current) =>
      append ? [...current, ...page.revisions] : page.revisions,
    );
    setHistoryAfter(page.after);
  }

  async function openDetail(id: string) {
    await action(async () => {
      const preference = preview
        ? preview.preferences.find((candidate) => candidate.id === id)
        : await getPreference(id);
      if (!preference) throw new Error('Preference not found');
      setSelected(preference);
      await loadHistory(preference);
      show('detail');
    });
  }

  function openForm(preference?: Preference) {
    setEditing(preference);
    setFormDefaults({
      topic: preference?.topic ?? '',
      statement: preference?.statement ?? '',
      appliesWhen: preference?.appliesWhen ?? '',
      reason: preference ? 'Corrected by the user.' : '',
    });
    setConflict(undefined);
    setFeedback({ message: '' });
    show('form');
    updateReloadSafety({ dirtyForms: false });
  }

  useEffect(() => {
    if (!open) return;
    setView('overview');
    void action(() => refresh());
    // Opening always starts a new interaction; query and status intentionally persist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      id="preferences-dialog"
      opened={open}
      onClose={close}
      title="Preferences"
      size={720}
      closeButtonProps={{
        id: 'preferences-close',
        'aria-label': 'Close preferences',
      }}
      classNames={{
        inner: 'preferences-dialog-inner',
        content: 'settings-dialog preferences-dialog',
        header: 'preferences-dialog-header',
        title: 'preferences-dialog-title',
        body: 'preferences-dialog-body',
      }}
    >
      <div
        ref={content}
        className="preferences-dialog-scroll"
        aria-busy={busy || undefined}
      >
        <Tabs
          className="preferences-tabs"
          value={tab}
          onChange={(value) => {
            show('overview');
            setTab((value as SettingsTab | null) ?? 'memory');
          }}
          keepMounted
        >
          <Tabs.List aria-label="Preference sections">
            <Tabs.Tab value="memory">Memory</Tabs.Tab>
            <Tabs.Tab value="connections" aria-label="Connections">
              Services
            </Tabs.Tab>
            <Tabs.Tab value="agent">Agent</Tabs.Tab>
            <Tabs.Tab value="appearance" aria-label="Appearance">
              Theme
            </Tabs.Tab>
            <Tabs.Tab value="app">App</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="memory">
            {feedback.message && (
              <Alert
                id="preferences-result"
                role="status"
                color={feedback.error ? 'red' : 'pal'}
              >
                {feedback.message}
              </Alert>
            )}

            {view === 'overview' && (
              <section id="preferences-overview">
                <form
                  id="preferences-search"
                  className="preferences-toolbar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(() => refresh());
                  }}
                >
                  <TextInput
                    className="preferences-query"
                    id="preferences-query"
                    name="query"
                    type="search"
                    aria-label="Search preferences"
                    maxLength={200}
                    placeholder="Search preferences"
                    value={query}
                    disabled={busy}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <NativeSelect
                    className="preferences-status"
                    id="preferences-status"
                    name="status"
                    aria-label="Status"
                    value={status}
                    disabled={busy}
                    onChange={(event) =>
                      setStatus(event.target.value as PreferenceStatus)
                    }
                    data={[
                      { value: 'active', label: 'Active' },
                      { value: 'retired', label: 'Retired' },
                    ]}
                  />
                  <Button type="submit" variant="default" disabled={busy}>
                    Search
                  </Button>
                  <Button
                    id="preferences-refresh"
                    type="button"
                    variant="default"
                    disabled={busy}
                    onClick={() => void action(() => refresh())}
                  >
                    Refresh
                  </Button>
                  <Button
                    id="preferences-new"
                    type="button"
                    disabled={busy}
                    onClick={() => openForm()}
                  >
                    Add preference
                  </Button>
                </form>
                <div id="preferences-list">
                  {rows.map((preference) => (
                    <UnstyledButton
                      key={preference.id}
                      type="button"
                      className="preference-card"
                      disabled={busy}
                      onClick={() => void openDetail(preference.id)}
                    >
                      <span className="preferences-topic">
                        {preference.topic}
                      </span>
                      <strong>{preference.statement}</strong>
                      <small>
                        {preference.basis === 'user-stated'
                          ? 'User stated'
                          : 'Model inferred'}{' '}
                        · v{preference.version}
                        {preference.appliesWhen
                          ? ` · ${preference.appliesWhen}`
                          : ''}
                      </small>
                    </UnstyledButton>
                  ))}
                </div>
                {!rows.length && (
                  <p id="preferences-empty" className="preferences-empty">
                    No matching preferences.
                  </p>
                )}
                {after !== null && (
                  <Button
                    id="preferences-more"
                    type="button"
                    variant="default"
                    disabled={busy}
                    onClick={() => void action(() => refresh(true))}
                  >
                    Load more
                  </Button>
                )}
              </section>
            )}

            {view === 'form' && (
              <form
                id="preference-form"
                onInput={() => updateReloadSafety({ dirtyForms: true })}
                onSubmit={(event) => {
                  event.preventDefault();
                  const node = event.currentTarget;
                  void action(async () => {
                    const field = (name: string) =>
                      node.elements.namedItem(name) as
                        | HTMLInputElement
                        | HTMLTextAreaElement;
                    const values = {
                      topic: field('topic').value.trim(),
                      statement: field('statement').value.trim(),
                      appliesWhen: field('appliesWhen').value.trim() || null,
                      reason: field('reason').value.trim(),
                    };
                    if (preview) {
                      setFeedback({
                        message: 'Preview only. No preference was saved.',
                      });
                      return;
                    }
                    try {
                      const preference = editing
                        ? await updatePreference(editing.id, {
                            expectedVersion: editing.version,
                            ...values,
                          })
                        : await createPreference(values);
                      setSelected(preference);
                      setEditing(undefined);
                      await loadHistory(preference);
                      show('detail');
                      setFeedback({ message: 'Preference saved.' });
                    } catch (error) {
                      const latest = conflictFrom(error);
                      if (!latest) throw error;
                      setConflict(latest);
                    }
                  });
                }}
              >
                <h3 id="preference-form-title">
                  {editing ? 'Edit preference' : 'Add preference'}
                </h3>
                <TextInput
                  label="Topic"
                  name="topic"
                  required
                  maxLength={80}
                  placeholder="travel.flights"
                  disabled={busy}
                  defaultValue={formDefaults.topic}
                  autoFocus
                />
                <Textarea
                  label="Preference"
                  name="statement"
                  required
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                  defaultValue={formDefaults.statement}
                />
                <Textarea
                  label="Applies when"
                  name="appliesWhen"
                  maxLength={1000}
                  rows={2}
                  placeholder="Optional scope or exception"
                  disabled={busy}
                  defaultValue={formDefaults.appliesWhen}
                />
                <TextInput
                  label="Reason for change"
                  name="reason"
                  required
                  maxLength={500}
                  placeholder="Corrected by the user"
                  disabled={busy}
                  defaultValue={formDefaults.reason}
                />
                {conflict && (
                  <Alert id="preference-conflict" role="alert" color="red">
                    <span id="preference-conflict-text">
                      This preference changed to version {conflict.version}{' '}
                      while you were editing. Your draft is preserved.
                    </span>
                    <Button
                      id="preference-conflict-retry"
                      type="button"
                      variant="default"
                      disabled={busy}
                      onClick={() => {
                        setEditing(conflict);
                        setConflict(undefined);
                        setFeedback({
                          message:
                            'Draft preserved. Review it, then save against the current version.',
                        });
                      }}
                    >
                      Use current version
                    </Button>
                  </Alert>
                )}
                <div className="settings-actions settings-form-actions">
                  <Button
                    id="preference-form-cancel"
                    type="button"
                    variant="default"
                    disabled={busy}
                    onClick={() =>
                      show(editing && selected ? 'detail' : 'overview')
                    }
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    Save preference
                  </Button>
                </div>
              </form>
            )}

            {view === 'detail' && selected && (
              <section id="preference-detail">
                <div className="preferences-detail-heading">
                  <Button
                    id="preference-back"
                    type="button"
                    variant="default"
                    disabled={busy}
                    onClick={() => {
                      show('overview');
                      void action(() => refresh());
                    }}
                  >
                    Back
                  </Button>
                  <div className="settings-actions">
                    <Button
                      id="preference-edit"
                      type="button"
                      variant="default"
                      disabled={busy}
                      onClick={() => openForm(selected)}
                    >
                      Edit
                    </Button>
                    <Button
                      id="preference-status-action"
                      type="button"
                      variant="default"
                      disabled={busy || !!preview}
                      onClick={() =>
                        void action(async () => {
                          const next =
                            selected.status === 'active' ? 'retired' : 'active';
                          const updated = await updatePreference(selected.id, {
                            expectedVersion: selected.version,
                            status: next,
                            reason:
                              next === 'retired'
                                ? 'Retired by the user.'
                                : 'Reactivated by the user.',
                          });
                          setSelected(updated);
                          await loadHistory(updated);
                          setFeedback({
                            message:
                              next === 'retired'
                                ? 'Retired. It is excluded from normal preference lookup.'
                                : 'Preference reactivated.',
                          });
                        })
                      }
                    >
                      {selected.status === 'active' ? 'Retire' : 'Reactivate'}
                    </Button>
                  </div>
                </div>
                <p id="preference-topic" className="preferences-topic">
                  {selected.topic}
                </p>
                <h3 id="preference-statement">{selected.statement}</h3>
                <p id="preference-applies">
                  {selected.appliesWhen
                    ? `Applies when: ${selected.appliesWhen}`
                    : 'Applies generally.'}
                </p>
                <p id="preference-meta" className="preferences-meta">
                  {selected.basis === 'user-stated'
                    ? 'User stated'
                    : 'Model inferred'}{' '}
                  · {selected.status} · version {selected.version} · updated{' '}
                  {new Date(selected.updatedAt).toLocaleString()}
                </p>
                <h3>Evidence</h3>
                <div id="preference-sources">
                  {!selected.sources.length && (
                    <p className="preferences-empty">
                      No linked source message. This record was entered by a
                      human.
                    </p>
                  )}
                  {selected.sources.map((source) => (
                    <UnstyledButton
                      key={source.id}
                      type="button"
                      className="preference-source"
                      onClick={() => {
                        setView('overview');
                        close();
                        onNavigateMessage(
                          source.id,
                          source.taskId ?? undefined,
                        );
                      }}
                    >
                      <span>{source.textPreview || 'User message'}</span>
                      <small>
                        Message {source.sequence} ·{' '}
                        {new Date(source.createdAt).toLocaleString()}
                      </small>
                    </UnstyledButton>
                  ))}
                </div>
                <h3>Revision history</h3>
                <div id="preference-history">
                  {revisions.map((revision) => (
                    <article
                      key={revision.version}
                      className="preference-revision"
                    >
                      <div>
                        <strong>Version {revision.version}</strong>
                        <small>
                          {revision.actor}
                          {revision.taskId ? ' task' : ''} ·{' '}
                          {new Date(revision.createdAt).toLocaleString()}
                        </small>
                      </div>
                      <p>{revision.snapshot.statement}</p>
                      <small>{revision.reason}</small>
                      {revision.version !== selected.version && (
                        <Button
                          type="button"
                          variant="default"
                          disabled={busy || !!preview}
                          onClick={() =>
                            void action(async () => {
                              const restored = await updatePreference(
                                selected.id,
                                {
                                  expectedVersion: selected.version,
                                  topic: revision.snapshot.topic,
                                  statement: revision.snapshot.statement,
                                  appliesWhen: revision.snapshot.appliesWhen,
                                  sourceMessageIds:
                                    revision.snapshot.sourceMessageIds,
                                  status: revision.snapshot.status,
                                  reason: `Restored version ${revision.version}.`,
                                },
                              );
                              setSelected(restored);
                              await loadHistory(restored);
                              setFeedback({
                                message: `Restored version ${revision.version} as version ${restored.version}.`,
                              });
                            })
                          }
                        >
                          Restore as new version
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
                {historyAfter !== null && (
                  <Button
                    id="preference-history-more"
                    type="button"
                    variant="default"
                    disabled={busy}
                    onClick={() =>
                      void action(() => loadHistory(selected, true))
                    }
                  >
                    Load older revisions
                  </Button>
                )}
              </section>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="connections">
            <ConnectedServicesPanel
              open={open && tab === 'connections'}
              preview={servicesPreview}
            />
          </Tabs.Panel>
          <Tabs.Panel value="agent">
            {tab === 'agent' && <InstanceSettingsForm section="agent" />}
          </Tabs.Panel>
          <Tabs.Panel value="appearance">
            {tab === 'appearance' && (
              <InstanceSettingsForm section="appearance" />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="app">
            <PwaPreferences />
          </Tabs.Panel>
        </Tabs>
      </div>
    </Modal>
  );
}
