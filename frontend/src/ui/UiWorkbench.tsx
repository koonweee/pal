import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Loader,
  NativeSelect,
  Progress,
  Select,
  Stack,
  TextInput,
  Textarea,
} from '@mantine/core';
import { Info, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { Desktop } from '../desktop/Desktop';
import { PreferencesDialog } from '../preferences/PreferencesDialog';
import { PwaPreferences } from '../pwa/PwaPreferences';
import { PwaUpdateNotice } from '../pwa/PwaUpdateNotice';
import { IconAction } from './IconAction';
import {
  workbenchMcpPreview,
  workbenchPreferencePreview,
} from './workbench-fixtures';
import {
  workbenchDevices,
  type ComposerScene,
  type ConversationScene,
  type TaskScene,
  type WorkbenchDevice,
} from './WorkbenchApplicationPreview';
type UpdateScene = 'ready' | 'deferred' | 'required' | 'error';

function DevicePreview({
  device,
  query,
}: {
  device: WorkbenchDevice;
  query: URLSearchParams;
}) {
  const available = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const preset = workbenchDevices[device];
  const frameWidth = preset.width + 2;
  const frameHeight = preset.height + 2;

  useLayoutEffect(() => {
    const element = available.current;
    if (!element) return;
    const fit = (width: number) => setScale(Math.min(1, width / frameWidth));
    fit(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) fit(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frameWidth]);

  return (
    <div ref={available} className="ui-workbench-preview-space">
      <div
        className="ui-workbench-preview-stage"
        style={{ height: frameHeight * scale, width: frameWidth * scale }}
      >
        <div
          className="ui-workbench-device-preview"
          data-device={device}
          style={{
            height: preset.height,
            transform: `scale(${scale})`,
            width: preset.width,
          }}
        >
          <iframe
            height={preset.height}
            src={`/__ui/preview?${query}`}
            title={`${preset.label} application preview`}
            width={preset.width}
          />
        </div>
      </div>
    </div>
  );
}

export function UiWorkbench() {
  const { settings } = useInstanceSettings();
  const [conversationScene, setConversationScene] =
    useState<ConversationScene>('messages');
  const [composerScene, setComposerScene] = useState<ComposerScene>('ready');
  const [taskScene, setTaskScene] = useState<TaskScene>('populated');
  const [device, setDevice] = useState<WorkbenchDevice>('macbookAir');
  const [updateScene, setUpdateScene] = useState<UpdateScene>('ready');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const foundations = useRef<HTMLElement>(null);
  const application = useRef<HTMLElement>(null);
  const dialogs = useRef<HTMLElement>(null);
  const pwa = useRef<HTMLElement>(null);
  const previewQuery = new URLSearchParams({
    composer: composerScene,
    conversation: conversationScene,
    device,
    tasks: taskScene,
  });

  useEffect(() => {
    const sections = { foundations, application, dialogs, pwa };
    let frame: number | undefined;
    function restoreFragment() {
      const name = location.hash.slice(1) as keyof typeof sections;
      if (!sections[name]) return;
      cancelAnimationFrame(frame ?? 0);
      frame = requestAnimationFrame(() =>
        sections[name].current?.scrollIntoView({ block: 'start' }),
      );
    }
    restoreFragment();
    window.addEventListener('hashchange', restoreFragment);
    return () => {
      cancelAnimationFrame(frame ?? 0);
      window.removeEventListener('hashchange', restoreFragment);
    };
  }, []);

  return (
    <main className="ui-workbench">
      <div className="ui-workbench-heading">
        <div>
          <p>Development component gallery</p>
          <h1>Pal UI</h1>
        </div>
        <a href="/">Open live app</a>
      </div>
      <nav className="ui-workbench-index" aria-label="Component groups">
        <a href="#foundations">Foundations</a>
        <a href="#application">Application</a>
        <a href="#dialogs">Dialogs</a>
        <a href="#pwa">PWA</a>
      </nav>

      <section ref={foundations} id="foundations">
        <div className="ui-workbench-section-heading">
          <div>
            <h2>Foundations</h2>
            <p>Mantine controls rendered with Pal’s global defaults.</p>
          </div>
        </div>
        <h3>Actions</h3>
        <div className="ui-workbench-row">
          <Button>Primary</Button>
          <Button variant="default">Secondary</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button color="red">Destructive</Button>
          <IconAction label="Add item">
            <Plus aria-hidden="true" size={18} />
          </IconAction>
        </div>
        <h3>Fields</h3>
        <Stack maw={420}>
          <TextInput label="Name" placeholder={settings.agentName} />
          <TextInput label="Invalid" error="A value is required" />
          <Textarea
            label="Message"
            placeholder={`message ${settings.agentName}`}
          />
          <Select
            label="Update behavior"
            defaultValue="ask"
            data={[
              { value: 'ask', label: 'Ask before updating' },
              {
                value: 'automatic',
                label: 'Update automatically when safe',
              },
            ]}
          />
          <Checkbox label="Selected option" defaultChecked />
        </Stack>
        <h3>Status</h3>
        <div className="ui-workbench-row">
          <Badge>Ready</Badge>
          <Badge color="yellow">Waiting</Badge>
          <Badge color="red">Failed</Badge>
          <Loader size="sm" />
        </div>
        <Progress value={64} mt="md" />
        <Alert icon={<Info size={18} />} title="Update available" mt="md">
          Pal can update when your current work is safe.
        </Alert>
      </section>

      <section ref={application} id="application" className="ui-workbench-wide">
        <div className="ui-workbench-section-heading">
          <div>
            <h2>Application components</h2>
            <p>
              The real application shell runs in an isolated viewport with local
              fixtures.
            </p>
          </div>
          <div className="ui-workbench-row">
            <NativeSelect
              label="Device"
              value={device}
              onChange={(event) =>
                setDevice(event.target.value as WorkbenchDevice)
              }
              data={Object.entries(workbenchDevices).map(([value, preset]) => ({
                value,
                label: `${preset.label} · ${preset.width} × ${preset.height}`,
              }))}
            />
            <NativeSelect
              label="Conversation"
              value={conversationScene}
              onChange={(event) =>
                setConversationScene(event.target.value as ConversationScene)
              }
              data={[
                { value: 'messages', label: 'Messages' },
                { value: 'empty', label: 'Empty' },
                { value: 'loading', label: 'Loading' },
                { value: 'working', label: 'Working' },
                { value: 'offline', label: 'Offline' },
                { value: 'error', label: 'Error' },
              ]}
            />
            <NativeSelect
              label="Composer"
              value={composerScene}
              onChange={(event) =>
                setComposerScene(event.target.value as ComposerScene)
              }
              data={[
                { value: 'ready', label: 'Ready' },
                { value: 'reply', label: 'Reply' },
                { value: 'files', label: 'Attachments' },
                { value: 'error', label: 'Send error' },
              ]}
            />
            <NativeSelect
              label="Tasks"
              value={taskScene}
              onChange={(event) =>
                setTaskScene(event.target.value as TaskScene)
              }
              data={[
                { value: 'populated', label: 'Populated' },
                { value: 'empty', label: 'Empty' },
                { value: 'error', label: 'Error' },
                { value: 'loading', label: 'Loading more' },
              ]}
            />
          </div>
        </div>
        <div
          className="ui-workbench-preview-wrap"
          role="region"
          aria-label="Application preview canvas"
        >
          <DevicePreview device={device} query={previewQuery} />
        </div>
      </section>

      <section ref={dialogs} id="dialogs">
        <div className="ui-workbench-section-heading">
          <div>
            <h2>Dialogs and overlays</h2>
            <p>
              Preferences uses safe memory and connection previews; desktop uses
              the local development integration.
            </p>
          </div>
        </div>
        <div className="ui-workbench-row">
          <Button onClick={() => setPreferencesOpen(true)}>
            Open preferences
          </Button>
          <Button variant="default" onClick={() => setDesktopOpen(true)}>
            Open desktop
          </Button>
        </div>
      </section>

      <section ref={pwa} id="pwa">
        <div className="ui-workbench-section-heading">
          <div>
            <h2>PWA states</h2>
            <p>Update notices and the browser-local update preference.</p>
          </div>
          <NativeSelect
            label="Notice"
            value={updateScene}
            onChange={(event) =>
              setUpdateScene(event.target.value as UpdateScene)
            }
            data={[
              { value: 'ready', label: 'Ready' },
              { value: 'deferred', label: 'Deferred by active work' },
              { value: 'required', label: 'Required' },
              { value: 'error', label: 'Error' },
            ]}
          />
        </div>
        <PwaUpdateNotice
          deferred={updateScene === 'deferred'}
          error={updateScene === 'error' ? 'Network unavailable.' : undefined}
          required={updateScene === 'required'}
          onActivate={() => undefined}
          onDismiss={() => undefined}
          onRetry={() => undefined}
        />
        <PwaPreferences />
      </section>

      <PreferencesDialog
        open={preferencesOpen}
        preview={workbenchPreferencePreview}
        servicesPreview={workbenchMcpPreview}
        onClose={() => setPreferencesOpen(false)}
        onNavigateMessage={() => setPreferencesOpen(false)}
      />
      {desktopOpen && (
        <Desktop open={desktopOpen} onClose={() => setDesktopOpen(false)} />
      )}
    </main>
  );
}
