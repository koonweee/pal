import {
  Alert,
  Button,
  ColorInput,
  FileInput,
  Stack,
  TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
  uploadFile,
  type InstanceSettings,
  type SaveInstanceSettings,
} from '../api/client';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';
import { ThemePreferences } from '../theme/ThemeProvider';
import { AgentAvatar } from './AgentAvatar';
import { AvatarAccentChoices } from './AvatarAccentChoices';
import {
  defaultInstanceSettings,
  useInstanceSettings,
} from './InstanceSettingsProvider';

function draftFrom(settings: InstanceSettings) {
  return {
    base: settings,
    agentName: settings.agentName,
    accentColor: settings.accentColor,
    agentAvatarAttachmentId: settings.agentAvatarAttachmentId,
  };
}

export function InstanceSettingsForm({
  section,
}: {
  section: 'agent' | 'appearance';
}) {
  const agent = section === 'agent';
  const { settings, ready, error, refresh, save } = useInstanceSettings();
  const { update: updateSafety } = useReloadSafety();
  const [draft, setDraft] = useState(() => draftFrom(settings));
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const dirty =
    !!file ||
    draft.agentName !== draft.base.agentName ||
    draft.accentColor !== draft.base.accentColor ||
    draft.agentAvatarAttachmentId !== draft.base.agentAvatarAttachmentId;
  useEffect(() => {
    if (!dirty) {
      setDraft(draftFrom(settings));
      setFile(null);
      setFeedback(undefined);
    }
  }, [settings, dirty]);
  useEffect(() => {
    updateSafety({ dirtyForms: dirty || busy });
  }, [dirty, busy, updateSafety]);
  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    if (busy || !ready) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const patch: SaveInstanceSettings = {};
      if (draft.agentName !== draft.base.agentName)
        patch.agentName = draft.agentName.trim();
      if (draft.accentColor !== draft.base.accentColor)
        patch.accentColor = draft.accentColor;
      if (file && file.size > 2_000_000)
        throw new Error('Agent image must be 2 MB or smaller');
      if (file)
        patch.agentAvatarAttachmentId = (await uploadFile(file)).attachment.id;
      else if (
        draft.agentAvatarAttachmentId !== draft.base.agentAvatarAttachmentId
      )
        patch.agentAvatarAttachmentId = draft.agentAvatarAttachmentId;
      const saved = await save(patch);
      setFile(null);
      setDraft(draftFrom(saved));
    } catch (failure) {
      setFeedback(
        failure instanceof Error
          ? failure.message
          : 'Could not save instance settings',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Stack gap="md">
        {agent ? (
          <>
            <h3>Agent</h3>
            <div className="agent-info instance-profile-preview">
              <AgentAvatar
                attachmentId={draft.agentAvatarAttachmentId}
                previewUrl={previewUrl}
              />
              <span className="agent-name">
                <span className="agent-label">
                  {draft.agentName || defaultInstanceSettings.agentName}
                </span>
              </span>
            </div>
            <TextInput
              label="Name"
              value={draft.agentName}
              maxLength={60}
              required
              disabled={busy || !ready}
              onChange={(event) =>
                setDraft({ ...draft, agentName: event.currentTarget.value })
              }
            />
            <FileInput
              label="Image"
              placeholder="Choose a PNG"
              description="Up to 2 MB and 2048 × 2048 px."
              accept="image/png"
              clearable
              value={file}
              disabled={busy || !ready}
              onChange={setFile}
            />
            {(file || draft.agentAvatarAttachmentId) && (
              <Button
                variant="subtle"
                type="button"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setDraft({ ...draft, agentAvatarAttachmentId: null });
                }}
              >
                Remove image
              </Button>
            )}
          </>
        ) : (
          <>
            <h3>Appearance</h3>
            <ColorInput
              id="accent-color"
              label="Accent color"
              format="hex"
              value={draft.accentColor}
              onChange={(accentColor) => setDraft({ ...draft, accentColor })}
              disabled={busy || !ready}
            />
            <AvatarAccentChoices
              attachmentId={settings.agentAvatarAttachmentId}
              value={draft.accentColor}
              disabled={busy || !ready}
              onChange={(accentColor) => setDraft({ ...draft, accentColor })}
            />
            <ThemePreferences />
          </>
        )}
        {(feedback || error) && (
          <Alert color="red" role="alert">
            {feedback ?? error}
            {error && (
              <Button
                variant="subtle"
                type="button"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            )}
          </Alert>
        )}
        <div className="settings-actions">
          <Button
            type="submit"
            loading={busy}
            disabled={
              !ready ||
              !dirty ||
              (agent
                ? !draft.agentName.trim()
                : !/^#[0-9a-f]{6}$/i.test(draft.accentColor))
            }
          >
            {agent ? 'Save agent' : 'Save appearance'}
          </Button>
          <Button
            type="button"
            variant="subtle"
            disabled={!ready || busy}
            onClick={() => {
              setFile(null);
              setDraft(
                agent
                  ? {
                      ...draft,
                      agentName: defaultInstanceSettings.agentName,
                      agentAvatarAttachmentId: null,
                    }
                  : {
                      ...draft,
                      accentColor: defaultInstanceSettings.accentColor,
                    },
              );
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </Stack>
    </form>
  );
}
