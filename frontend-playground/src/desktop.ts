export {};
const frame = document.querySelector<HTMLIFrameElement>('#desktop-viewer')!;
const status = document.querySelector<HTMLParagraphElement>('#desktop-status')!;
const retry = document.querySelector<HTMLButtonElement>('#desktop-retry')!;
const sheet = document.querySelector<HTMLElement>('#desktop-sheet')!;
const shell = document.querySelector<HTMLElement>('.shell')!;
const open = document.querySelector<HTMLButtonElement>('#desktop-open')!;
const close = document.querySelector<HTMLButtonElement>('#desktop-close')!;
const backdrop =
  document.querySelector<HTMLButtonElement>('#desktop-backdrop')!;
const paste = document.querySelector<HTMLButtonElement>('#desktop-paste')!;
const keyboard =
  document.querySelector<HTMLButtonElement>('#desktop-keyboard')!;
const fullscreen = document.querySelector<HTMLButtonElement>(
  '#desktop-fullscreen',
)!;

function setFullscreen(enabled: boolean) {
  sheet.dataset.fullscreen = String(enabled);
  fullscreen.setAttribute('aria-pressed', String(enabled));
  fullscreen.setAttribute(
    'aria-label',
    enabled ? 'Exit desktop fullscreen' : 'Enter desktop fullscreen',
  );
  fullscreen.title = enabled ? 'Exit fullscreen' : 'Enter fullscreen';
}

function exitFullscreen() {
  setFullscreen(false);
  if (document.fullscreenElement === sheet) void document.exitFullscreen();
}

fullscreen.addEventListener('click', () => {
  if (sheet.dataset.fullscreen === 'true') {
    exitFullscreen();
    return;
  }
  setFullscreen(true);
  // Respect noVNC's native-fullscreen capability check, including Safari input support.
  const nativeButton = frame.contentDocument?.getElementById(
    'noVNC_fullscreen_button',
  );
  if (
    document.fullscreenEnabled &&
    nativeButton &&
    !nativeButton.classList.contains('noVNC_hidden')
  ) {
    void sheet.requestFullscreen().catch(() => {
      // The expanded viewport remains usable when native fullscreen is unavailable.
    });
  }
});
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === sheet && sheet.dataset.open !== 'true') {
    exitFullscreen();
    return;
  }
  setFullscreen(document.fullscreenElement === sheet);
});

let hideKeyboardOnClick: boolean | undefined;
keyboard.addEventListener('pointerdown', (event) => {
  // A mobile browser can blur the iframe before delivering the click.
  hideKeyboardOnClick = keyboard.getAttribute('aria-pressed') === 'true';
  event.preventDefault();
});
keyboard.addEventListener('pointercancel', () => {
  hideKeyboardOnClick = undefined;
});
keyboard.addEventListener('click', () => {
  const hide =
    hideKeyboardOnClick ?? keyboard.getAttribute('aria-pressed') === 'true';
  hideKeyboardOnClick = undefined;
  if (hide) {
    frame.contentDocument
      ?.querySelector<HTMLTextAreaElement>('#noVNC_keyboardinput')
      ?.blur();
  } else {
    // Keep showing synchronous with the user gesture for mobile keyboard access.
    frame.contentDocument?.getElementById('noVNC_keyboard_button')?.click();
  }
});

interface DesktopBridge {
  readonly connected: boolean;
  paste(text: string): void;
}

function desktopBridge(): DesktopBridge | undefined {
  return (
    frame.contentWindow as (Window & { palDesktop?: DesktopBridge }) | null
  )?.palDesktop;
}

let pasting = false;
function updatePasteButton() {
  paste.disabled =
    pasting || !desktopBridge()?.connected || !navigator.clipboard?.readText;
}

paste.addEventListener('click', async () => {
  pasting = true;
  updatePasteButton();
  status.hidden = true;
  try {
    let text: string;
    try {
      // Read directly in the click gesture so Safari can request paste access.
      text = await navigator.clipboard.readText();
    } catch {
      throw new Error(
        'Could not read clipboard. Allow clipboard access and try again.',
      );
    }
    if (!text) throw new Error('Your clipboard contains no text.');
    const bridge = desktopBridge();
    if (!bridge?.connected) {
      throw new Error('Desktop disconnected. Reconnect and try again.');
    }
    bridge.paste(text);
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : 'Could not paste into desktop.';
    status.hidden = false;
  } finally {
    pasting = false;
    updatePasteButton();
  }
});

function updateViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const top = viewport?.offsetTop ?? 0;
  sheet.style.setProperty('--desktop-viewport-height', `${height}px`);
  sheet.style.setProperty('--desktop-viewport-top', `${top}px`);
  sheet.style.setProperty(
    '--desktop-viewport-bottom',
    `${Math.max(0, window.innerHeight - height - top)}px`,
  );
}
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
updateViewport();

function showDesktop(visible: boolean) {
  sheet.dataset.animated = 'true';
  if (!visible) exitFullscreen();
  sheet.dataset.open = String(visible);
  sheet.inert = !visible;
  if (frame.contentDocument) {
    frame.contentDocument.documentElement.inert = !visible;
  }
  sheet.setAttribute('aria-hidden', String(!visible));
  shell.inert = visible;
  backdrop.hidden = !visible;
  open.setAttribute('aria-expanded', String(visible));
  (visible ? close : open).focus();
}

open.addEventListener('click', () => showDesktop(true));
close.addEventListener('click', () => showDesktop(false));
backdrop.addEventListener('click', () => showDesktop(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sheet.dataset.open === 'true') {
    event.preventDefault();
    if (sheet.dataset.fullscreen === 'true') exitFullscreen();
    else showDesktop(false);
  }
});

const viewerPage = '/desktop/v2/vnc.html';
const viewer = `${viewerPage}?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=scale&shared=true&trackpad_mode=true&path=/desktop/websockify`;

let connectionObserver: MutationObserver | undefined;
frame.addEventListener('load', () => {
  connectionObserver?.disconnect();
  if (!frame.getAttribute('src')) return;
  const root = frame.contentDocument?.documentElement;
  if (!root) return;
  // Parent inert does not propagate into an iframe's document.
  root.inert = sheet.dataset.open !== 'true';
  const nativeKeyboard = frame.contentDocument?.getElementById(
    'noVNC_keyboard_button',
  );
  const updateConnection = () => {
    updatePasteButton();
    frame.contentDocument
      ?.querySelector<HTMLElement>('#noVNC_container > div')
      ?.style.setProperty('background', '#000000');
    keyboard.disabled =
      !root.classList.contains('noVNC_connected') ||
      !nativeKeyboard ||
      !(
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(any-pointer: coarse)').matches
      );
    const keyboardVisible =
      nativeKeyboard?.classList.contains('noVNC_selected') ?? false;
    keyboard.setAttribute('aria-pressed', String(keyboardVisible));
    keyboard.title = keyboardVisible ? 'Hide keyboard' : 'Show keyboard';
    retry.hidden = ['loading', 'connecting', 'connected', 'reconnecting'].some(
      (state) => root.classList.contains(`noVNC_${state}`),
    );
  };
  connectionObserver = new MutationObserver(updateConnection);
  connectionObserver.observe(root, {
    attributes: true,
    attributeFilter: ['class'],
  });
  if (nativeKeyboard) {
    connectionObserver.observe(nativeKeyboard, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  const bridge = frame.contentDocument!.createElement('script');
  bridge.type = 'module';
  bridge.src = '/viewer-bridge.js';
  frame.contentDocument!.addEventListener(
    'pal-desktop-ready',
    updateConnection,
    {
      once: true,
    },
  );
  frame.contentDocument!.head.append(bridge);
  updateConnection();
});

async function connect() {
  connectionObserver?.disconnect();
  retry.hidden = true;
  retry.disabled = true;
  keyboard.disabled = true;
  paste.disabled = true;
  keyboard.setAttribute('aria-pressed', 'false');
  status.hidden = false;
  status.textContent = 'Connecting to desktop…';
  frame.hidden = true;
  try {
    const response = await fetch(viewerPage, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Desktop unavailable');
    frame.src = viewer;
    frame.hidden = false;
    status.hidden = true;
  } catch {
    status.textContent = 'Desktop unavailable. Chat is still available.';
    retry.hidden = false;
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener('click', () => void connect());
void connect();
