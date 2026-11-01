import { Drawer } from '@mantine/core';
import {
  ArrowLeft,
  Circle,
  ClipboardPaste,
  Square,
  Maximize,
  Minimize,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import {
  ScrcpyControlMessageWriter,
  ScrcpyOptions3_3_3,
  type AndroidKeyCode,
  type ScrcpyVideoCodecId,
} from '@yume-chan/scrcpy';
import {
  WebCodecsVideoDecoder,
  BitmapVideoFrameRenderer,
} from '@yume-chan/scrcpy-decoder-webcodecs';
import { Consumable, WritableStream } from '@yume-chan/stream-extra';
import { IconAction } from '../ui/IconAction';
import { useReloadSafety } from '../pwa/ReloadSafetyProvider';
import './phone.css';

export function Phone({ onClose }: { onClose(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ScrcpyControlMessageWriter | undefined>(undefined);
  const [previewWidth, setPreviewWidth] = useState<number>();
  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const [retry, setRetry] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState('Connecting to phone…');
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 360, height: 800 });
  const { update } = useReloadSafety();
  useEffect(() => {
    update({ phoneOpen: true });
    return () => update({ phoneOpen: false });
  }, [update]);
  useEffect(() => {
    setReady(false);
    setPasteError('');
    setStatus('Connecting to phone…');
    if (!WebCodecsVideoDecoder.isSupported) {
      setStatus('This browser does not support live phone video.');
      return;
    }
    let disposed = false;
    let decoder: WebCodecsVideoDecoder | undefined;
    let writer:
      | ReturnType<WebCodecsVideoDecoder['writable']['getWriter']>
      | undefined;
    const url = new URL('/api/android/viewer', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const fail = () => {
      if (disposed) return;
      setReady(false);
      setStatus('Phone unavailable. Reconnect to try again.');
      controller.current = undefined;
      ws.close();
    };
    const timeout = window.setTimeout(fail, 15000);
    const control = new ScrcpyControlMessageWriter(
      new WritableStream<Consumable<Uint8Array>>({
        write(chunk) {
          return chunk.tryConsume((bytes) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(bytes as Uint8Array<ArrayBuffer>);
          });
        },
      }).getWriter(),
      new ScrcpyOptions3_3_3({}),
    );
    ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (disposed) return;
      try {
        if (typeof event.data === 'string') {
          const metadata = JSON.parse(event.data) as {
            codec: ScrcpyVideoCodecId;
          };
          decoder = new WebCodecsVideoDecoder({
            codec: metadata.codec,
            renderer: new BitmapVideoFrameRenderer(canvas.current!),
          });
          decoder.sizeChanged(({ width, height }) => {
            if (!disposed) {
              setSize({ width, height });
              setReady(true);
              setStatus('');
              clearTimeout(timeout);
              controller.current = control;
            }
          });
          writer = decoder.writable.getWriter();
          void writer.closed.catch(fail);
        } else if (writer) {
          const bytes = new Uint8Array(event.data);
          const data = bytes.subarray(9);
          void writer
            .write(
              bytes[0] === 0
                ? { type: 'configuration', data }
                : {
                    type: 'data',
                    keyframe: bytes[0] === 2,
                    pts: new DataView(event.data).getBigUint64(1),
                    data,
                  },
            )
            .catch(fail);
        }
      } catch {
        fail();
      }
    };
    ws.onerror = fail;
    ws.onclose = fail;
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.current = undefined;
      ws.close();
      decoder?.dispose();
    };
  }, [retry]);
  async function pasteClipboard() {
    const target = controller.current;
    if (!target || pasting) return;
    setPasting(true);
    setPasteError('');
    try {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        throw new Error(
          'Could not read clipboard. Allow clipboard access and try again.',
        );
      }
      if (controller.current !== target) return;
      if (!text) throw new Error('Your clipboard contains no text.');
      await target.injectText(text);
    } catch (error) {
      if (controller.current === target)
        setPasteError(
          error instanceof Error
            ? error.message
            : 'Could not paste into phone.',
        );
    } finally {
      setPasting(false);
    }
  }
  useLayoutEffect(() => {
    const screen = canvas.current;
    if (!screen) return;
    const observer = new ResizeObserver(() => {
      setPreviewWidth(screen.getBoundingClientRect().width);
    });
    observer.observe(screen);
    return () => observer.disconnect();
  }, [retry, ready]);
  function key(keyCode: AndroidKeyCode) {
    const c = controller.current;
    if (c)
      void c
        .injectKeyCode({ action: 0, keyCode, repeat: 0, metaState: 0 })
        .then(() =>
          c.injectKeyCode({ action: 1, keyCode, repeat: 0, metaState: 0 }),
        )
        .catch(() => {});
  }
  function pointer(event: PointerEvent<HTMLCanvasElement>, action: 0 | 1 | 2) {
    if (
      !ready ||
      (action !== 0 && !event.currentTarget.hasPointerCapture(event.pointerId))
    )
      return;
    event.preventDefault();
    if (action === 0) {
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const rect = event.currentTarget.getBoundingClientRect();
    void controller.current
      ?.injectTouch({
        action,
        pointerId: BigInt(event.pointerId),
        pointerX: Math.max(
          0,
          Math.min(
            size.width - 1,
            Math.round(((event.clientX - rect.left) * size.width) / rect.width),
          ),
        ),
        pointerY: Math.max(
          0,
          Math.min(
            size.height - 1,
            Math.round(
              ((event.clientY - rect.top) * size.height) / rect.height,
            ),
          ),
        ),
        videoWidth: size.width,
        videoHeight: size.height,
        pressure: action === 1 ? 0 : 1,
        actionButton: 0,
        buttons: 0,
      })
      .catch(() => {});
    if (action === 1)
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <Drawer.Root
      opened
      onClose={onClose}
      position="top"
      size="auto"
      closeOnEscape={false}
      classNames={{
        inner: 'desktop-drawer-inner',
        content: 'panel-surface pal-raised-glass desktop-sheet phone-sheet',
        header: 'desktop-heading',
        body: 'desktop-body phone-body',
      }}
    >
      <Drawer.Overlay className="pal-overlay-backdrop" />
      <Drawer.Content id="phone-sheet" data-fullscreen={fullscreen}>
        <Drawer.Header>
          <Drawer.Title>Phone</Drawer.Title>
          <div className="desktop-actions">
            <IconAction
              label="Paste clipboard into phone"
              disabled={!ready || pasting || !navigator.clipboard?.readText}
              onClick={() => void pasteClipboard()}
            >
              <ClipboardPaste aria-hidden="true" size={19} />
            </IconAction>
            <IconAction
              label="Reconnect phone"
              onClick={() => setRetry((r) => r + 1)}
            >
              <RefreshCw size={19} />
            </IconAction>
            <IconAction
              label={fullscreen ? 'Exit phone fullscreen' : 'Fullscreen phone'}
              onClick={() => setFullscreen((v) => !v)}
            >
              {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </IconAction>
            <IconAction label="Close phone" onClick={onClose}>
              <X size={19} />
            </IconAction>
          </div>
        </Drawer.Header>
        <Drawer.Body>
          {pasteError && <div role="alert">{pasteError}</div>}
          {status && (
            <div className="phone-status" role="status">
              {status}
            </div>
          )}
          <div className="phone-screen">
            <canvas
              key={retry}
              ref={canvas}
              aria-label="Phone screen"
              tabIndex={ready ? 0 : -1}
              style={{
                aspectRatio: `${size.width} / ${size.height}`,
                visibility: ready ? 'visible' : 'hidden',
              }}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => pointer(e, 0)}
              onPointerMove={(e) => pointer(e, 2)}
              onPointerUp={(e) => pointer(e, 1)}
              onPointerCancel={(e) => pointer(e, 1)}
              onKeyDown={(e) => {
                const codes: Record<string, AndroidKeyCode> = {
                  Enter: 66,
                  Backspace: 67,
                  Delete: 112,
                  Tab: 61,
                  Escape: 4,
                  ArrowUp: 19,
                  ArrowDown: 20,
                  ArrowLeft: 21,
                  ArrowRight: 22,
                };
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (codes[e.key]) {
                  e.preventDefault();
                  key(codes[e.key]!);
                } else if (e.key.length === 1) {
                  e.preventDefault();
                  void controller.current?.injectText(e.key).catch(() => {});
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                void controller.current
                  ?.injectText(e.clipboardData.getData('text'))
                  .catch(() => {});
              }}
            />
          </div>
          <div className="phone-navigation" style={{ width: previewWidth }}>
            <IconAction
              label="Phone back"
              disabled={!ready}
              onClick={() => key(4)}
            >
              <ArrowLeft size={19} />
            </IconAction>
            <IconAction
              label="Phone home"
              disabled={!ready}
              onClick={() => key(3)}
            >
              <Circle size={18} />
            </IconAction>
            <IconAction
              label="Phone recent apps"
              disabled={!ready}
              onClick={() => key(187)}
            >
              <Square size={17} />
            </IconAction>
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
