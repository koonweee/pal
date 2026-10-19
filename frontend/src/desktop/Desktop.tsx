import { Button, Drawer } from '@mantine/core';
import { ClipboardPaste, Keyboard, Maximize, Minimize, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';
import { useInputCapabilities } from '../layout/use-responsive';
import { IconAction } from '../ui/IconAction';

interface DesktopBridge {
  readonly connected: boolean;
  paste(text: string): void;
}

const viewerPage = '/desktop/v2/vnc.html';
const viewer = `${viewerPage}?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&shared=true&trackpad_mode=true&path=/desktop/websockify`;

export function Desktop({ open, onClose }: { open: boolean; onClose(): void }) {
  const { settings } = useInstanceSettings();
  const frame = useRef<HTMLIFrameElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const hideKeyboardOnClick = useRef<boolean | undefined>(undefined);
  const connectionObserver = useRef<MutationObserver | undefined>(undefined);
  const { coarsePointer, touch } = useInputCapabilities();
  const { update: updateReloadSafety } = useReloadSafety();
  const [frameVisible, setFrameVisible] = useState(false);
  const [retryVisible, setRetryVisible] = useState(false);
  const [status, setStatus] = useState('Connecting to desktop…');
  const [statusVisible, setStatusVisible] = useState(true);
  const [keyboardDisabled, setKeyboardDisabled] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [pasteDisabled, setPasteDisabled] = useState(true);
  const [pasting, setPasting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const bridge = useCallback(
    () =>
      (
        frame.current?.contentWindow as
          | (Window & { palDesktop?: DesktopBridge })
          | null
      )?.palDesktop,
    [],
  );

  const updateConnection = useCallback(() => {
    const root = frame.current?.contentDocument?.documentElement;
    const nativeKeyboard = frame.current?.contentDocument?.getElementById(
      'noVNC_keyboard_button',
    );
    if (!root) return;
    setPasteDisabled(
      pasting || !bridge()?.connected || !navigator.clipboard?.readText,
    );
    frame.current?.contentDocument
      ?.querySelector<HTMLElement>('#noVNC_container > div')
      ?.style.setProperty('background', '#000000');
    setKeyboardDisabled(
      !root.classList.contains('noVNC_connected') ||
        !nativeKeyboard ||
        !(touch || coarsePointer),
    );
    setKeyboardVisible(
      nativeKeyboard?.classList.contains('noVNC_selected') ?? false,
    );
    setRetryVisible(
      !['loading', 'connecting', 'connected', 'reconnecting'].some((state) =>
        root.classList.contains(`noVNC_${state}`),
      ),
    );
  }, [bridge, coarsePointer, pasting, touch]);

  const connect = useCallback(async () => {
    connectionObserver.current?.disconnect();
    setRetryVisible(false);
    setKeyboardDisabled(true);
    setPasteDisabled(true);
    setKeyboardVisible(false);
    setStatusVisible(true);
    setStatus('Connecting to desktop…');
    setFrameVisible(false);
    try {
      const response = await fetch(viewerPage, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Desktop unavailable');
      if (frame.current) frame.current.src = viewer;
      setFrameVisible(true);
      setStatusVisible(false);
    } catch {
      setStatus('Desktop unavailable. Chat is still available.');
      setRetryVisible(true);
    }
  }, []);

  useEffect(() => {
    void connect();
    return () => connectionObserver.current?.disconnect();
  }, [connect]);

  useLayoutEffect(() => {
    updateReloadSafety({ desktopOpen: open });
    const root = frame.current?.contentDocument?.documentElement;
    if (root) root.inert = !open;
  }, [open, updateReloadSafety]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement === sheet.current)
      void document.exitFullscreen();
  }, []);

  const close = useCallback(() => {
    exitFullscreen();
    onClose();
  }, [exitFullscreen, onClose]);

  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === sheet.current && !open) {
        exitFullscreen();
        return;
      }
      setFullscreen(document.fullscreenElement === sheet.current);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      if (fullscreen) exitFullscreen();
      else close();
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('keydown', keydown);
    };
  }, [close, exitFullscreen, fullscreen, open]);

  async function pasteClipboard() {
    setPasting(true);
    setPasteDisabled(true);
    setStatusVisible(false);
    try {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        throw new Error(
          'Could not read clipboard. Allow clipboard access and try again.',
        );
      }
      if (!text) throw new Error('Your clipboard contains no text.');
      const desktop = bridge();
      if (!desktop?.connected)
        throw new Error('Desktop disconnected. Reconnect and try again.');
      desktop.paste(text);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Could not paste into desktop.',
      );
      setStatusVisible(true);
    } finally {
      setPasting(false);
      setPasteDisabled(!bridge()?.connected || !navigator.clipboard?.readText);
    }
  }

  return (
    <Drawer.Root
      opened={open}
      onClose={close}
      keepMounted
      position="top"
      size="auto"
      closeOnEscape={false}
      data-open={open}
      classNames={{
        root: 'desktop-drawer-root',
        inner: 'desktop-drawer-inner',
        content: 'panel-surface pal-raised-glass desktop-sheet',
        header: 'desktop-heading',
        body: 'desktop-body',
      }}
    >
      <Drawer.Overlay id="desktop-backdrop" className="pal-overlay-backdrop" />
      <Drawer.Content
        ref={sheet}
        id="desktop-sheet"
        data-open={open}
        data-fullscreen={fullscreen}
        aria-hidden={!open}
        inert={!open}
      >
        <Drawer.Header>
          <Drawer.Title id="desktop-title">Desktop</Drawer.Title>
          <div className="desktop-actions">
            {retryVisible && (
              <Button
                id="desktop-retry"
                type="button"
                variant="transparent"
                size="compact-sm"
                aria-label="Reconnect desktop"
                onClick={() => void connect()}
              >
                Reconnect
              </Button>
            )}
            <IconAction
              id="desktop-paste"
              className="desktop-toggle"
              type="button"
              label="Paste clipboard into desktop"
              disabled={pasteDisabled || pasting}
              onClick={() => void pasteClipboard()}
            >
              <ClipboardPaste aria-hidden="true" size={20} strokeWidth={1.75} />
            </IconAction>
            <IconAction
              id="desktop-keyboard"
              className="desktop-toggle"
              type="button"
              label="Toggle desktop keyboard"
              tooltipLabel={keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
              aria-pressed={keyboardVisible}
              disabled={keyboardDisabled}
              onPointerDownCapture={(event) => {
                hideKeyboardOnClick.current = keyboardVisible;
                event.preventDefault();
              }}
              onPointerCancel={() => {
                hideKeyboardOnClick.current = undefined;
              }}
              onClick={() => {
                const hide = hideKeyboardOnClick.current ?? keyboardVisible;
                hideKeyboardOnClick.current = undefined;
                if (hide)
                  frame.current?.contentDocument
                    ?.querySelector<HTMLTextAreaElement>('#noVNC_keyboardinput')
                    ?.blur();
                else
                  frame.current?.contentDocument
                    ?.getElementById('noVNC_keyboard_button')
                    ?.click();
              }}
            >
              <Keyboard aria-hidden="true" size={20} strokeWidth={1.75} />
            </IconAction>
            <IconAction
              id="desktop-fullscreen"
              className="desktop-toggle"
              type="button"
              label={
                fullscreen
                  ? 'Exit desktop fullscreen'
                  : 'Enter desktop fullscreen'
              }
              aria-pressed={fullscreen}
              onClick={() => {
                if (fullscreen) {
                  exitFullscreen();
                  return;
                }
                setFullscreen(true);
                const nativeButton =
                  frame.current?.contentDocument?.getElementById(
                    'noVNC_fullscreen_button',
                  );
                if (
                  document.fullscreenEnabled &&
                  nativeButton &&
                  !nativeButton.classList.contains('noVNC_hidden')
                )
                  void sheet.current
                    ?.requestFullscreen()
                    .catch(() => undefined);
              }}
            >
              {fullscreen ? (
                <Minimize aria-hidden="true" size={20} strokeWidth={1.75} />
              ) : (
                <Maximize aria-hidden="true" size={20} strokeWidth={1.75} />
              )}
            </IconAction>
            <IconAction
              id="desktop-close"
              className="desktop-toggle"
              type="button"
              label="Close desktop"
              data-autofocus
              onClick={close}
            >
              <X aria-hidden="true" size={20} strokeWidth={1.75} />
            </IconAction>
          </div>
        </Drawer.Header>
        <Drawer.Body>
          {statusVisible && (
            <p id="desktop-status" role="status">
              {status}
            </p>
          )}
          <iframe
            ref={frame}
            id="desktop-viewer"
            title={`${settings.agentName} desktop`}
            allow="clipboard-read; clipboard-write"
            hidden={!frameVisible}
            onLoad={() => {
              connectionObserver.current?.disconnect();
              if (!frame.current?.getAttribute('src')) return;
              const root = frame.current.contentDocument?.documentElement;
              if (!root) return;
              root.inert = !open;
              const nativeKeyboard =
                frame.current.contentDocument?.getElementById(
                  'noVNC_keyboard_button',
                );
              const observer = new MutationObserver(updateConnection);
              observer.observe(root, {
                attributes: true,
                attributeFilter: ['class'],
              });
              if (nativeKeyboard)
                observer.observe(nativeKeyboard, {
                  attributes: true,
                  attributeFilter: ['class'],
                });
              connectionObserver.current = observer;
              const bridgeScript =
                frame.current.contentDocument!.createElement('script');
              bridgeScript.type = 'module';
              bridgeScript.src = '/viewer-bridge.js';
              frame.current.contentDocument!.addEventListener(
                'pal-desktop-ready',
                updateConnection,
                { once: true },
              );
              frame.current.contentDocument!.head.append(bridgeScript);
              updateConnection();
            }}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
