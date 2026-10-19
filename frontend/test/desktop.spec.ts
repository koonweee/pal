import { expect, test } from '@playwright/test';
import { createServer, request as httpRequest } from 'node:http';
import { usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('opens the desktop from the header as a top drawer without remounting the viewer', async ({
  page,
}) => {
  await page.route('**/viewer-bridge.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: '<html class="noVNC_connected"><title>Desktop fixture</title><label>Desktop input<input></label></html>',
    });
  });
  await page.addInitScript(() => localStorage.setItem('pal-theme', 'dark'));
  await page.goto('/');
  await expect(page.locator('.header')).toHaveCSS('display', 'grid');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await expect(page.locator('#desktop-sheet')).not.toBeInViewport();
  await expect(page.locator('.desktop-drawer-root')).toHaveCSS(
    'clip-path',
    'inset(100%)',
  );
  await expect(page.locator('#desktop-sheet')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  const sheet = page.locator('#desktop-sheet');
  const trigger = page.getByRole('button', { name: 'Open desktop' });
  const preferences = page.getByRole('button', {
    name: 'Preferences',
    exact: true,
  });
  const triggerBounds = (await trigger.boundingBox())!;
  const preferencesBounds = (await preferences.boundingBox())!;
  expect(triggerBounds.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  expect(triggerBounds.x + triggerBounds.width).toBeLessThanOrEqual(
    preferencesBounds.x,
  );
  expect(triggerBounds.y).toBeCloseTo(preferencesBounds.y, 0);
  expect(triggerBounds.height).toBe(preferencesBounds.height);
  expect((await sheet.boundingBox())!.y).toBeLessThan(0);
  const frame = page.locator('#desktop-viewer');
  const input = page
    .frameLocator('#desktop-viewer')
    .getByRole('textbox', { name: 'Desktop input' });
  const preloadedInput = page.frameLocator('#desktop-viewer').locator('input');
  await expect.poll(() => viewerLoads).toBe(1);
  await expect(preloadedInput).toHaveCount(1);
  await expect(sheet).not.toBeInViewport();
  await expect(sheet).toHaveAttribute('inert', '');
  expect(
    await frame.evaluate(
      (node) => node.clientWidth > 0 && node.clientHeight > 0,
    ),
  ).toBe(true);

  await trigger.click();
  await expect(page.locator('.desktop-drawer-root')).toHaveCSS(
    'clip-path',
    'none',
  );
  await expect(
    page.getByRole('dialog', { name: 'Desktop', exact: true }),
  ).toBeInViewport();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBe(0);
  await expect(page.locator('#desktop-retry')).toBeHidden();
  const viewerDocument = page
    .frames()
    .find((current) => current.url().includes('/vnc.html?'))!;
  await viewerDocument.evaluate(() =>
    document.documentElement.classList.remove('noVNC_connected'),
  );
  await expect(page.locator('#desktop-retry')).toBeVisible();
  await viewerDocument.evaluate(() =>
    document.documentElement.classList.add('noVNC_connected'),
  );
  await expect(page.locator('#desktop-retry')).toBeHidden();
  await input.fill('Keep viewer state');
  await page.locator('#desktop-close').click();
  await expect(trigger).toBeFocused();
  await expect(page.locator('.desktop-drawer-root')).toHaveCSS(
    'clip-path',
    'inset(100%)',
  );
  await expect(sheet).not.toBeInViewport();
  expect(
    await frame.evaluate(
      (node) => node.clientWidth > 0 && node.clientHeight > 0,
    ),
  ).toBe(true);

  await trigger.click();
  await expect(input).toHaveValue('Keep viewer state');
  await page.locator('#desktop-close').press('Escape');
  await expect(trigger).toBeFocused();
  await expect(sheet).toHaveAttribute('data-open', 'false');

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(sheet).toBeInViewport();
  const dimensions = await frame.evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }));
  expect(Math.abs(dimensions.width / dimensions.height - 4 / 3)).toBeLessThan(
    0.01,
  );
  expect((await sheet.boundingBox())!.height).toBeLessThan(420);
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/desktop-sheet-mobile.png' });
  await page.locator('#desktop-backdrop').click({ position: { x: 5, y: 800 } });
  await expect(trigger).toBeFocused();
  await expect(sheet).not.toBeInViewport();
  expect(viewerLoads).toBe(1);
  await expect(input).toHaveValue('Keep viewer state');
});

for (const width of [1280, 390]) {
  test(`keeps composer focus when the hidden desktop initializes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/viewer-bridge.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    );
    await page.route('**/vnc.html**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html class="noVNC_connected"><canvas tabindex="0"></canvas></html>',
      }),
    );
    await page.goto('/');
    const canvas = page.frameLocator('#desktop-viewer').locator('canvas');
    await expect(canvas).toHaveCount(1);
    const composer = page.getByRole('textbox', { name: 'Message pal' });
    await composer.click();
    // noVNC focuses its canvas after asynchronously connecting or reconnecting.
    await canvas.evaluate((node) => node.focus());
    await expect(composer).toBeFocused();
    await page.keyboard.type('Keep typing');
    await expect(composer).toHaveValue('Keep typing');
    await page.getByRole('button', { name: 'Open desktop' }).click();
    await expect(page.locator('#desktop-close')).toBeFocused();
    await canvas.evaluate((node) => node.focus());
    await expect(canvas).toBeFocused();
    await page.locator('#desktop-close').click();
    await composer.click();
    await canvas.evaluate((node) => node.focus());
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue('Keep typing');
  });
}

test('loads current desktop modules when the original viewer is cached', async ({
  page,
  baseURL,
}) => {
  const fixture = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const legacy =
      path.startsWith('/desktop/') && !/^\/desktop\/v\d+\//.test(path);
    const asset = legacy ? path.slice('/desktop'.length) : path;
    const version = legacy ? 'cached' : 'current';
    const assets: Record<string, string> = {
      '/vnc.html':
        '<html class="noVNC_connected"><script type="module" src="./app/ui.js"></script></html>',
      '/app/ui.js':
        'import { version } from "../core/version.js"; document.documentElement.dataset.version = version; export default { connected: false };',
      '/core/version.js': `export const version = '${version}';`,
      '/core/input/keysym.js': 'export default {};',
    };
    if (asset in assets) {
      response.writeHead(200, {
        'Content-Type': asset.endsWith('.html')
          ? 'text/html'
          : 'text/javascript',
        'Cache-Control': asset.endsWith('.html')
          ? 'no-cache'
          : 'public, max-age=86400',
      });
      response.end(assets[asset]);
      return;
    }
    const forwarded = httpRequest(
      `${baseURL}${request.url}`,
      {
        method: request.method,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(response);
      },
    );
    response.on('close', () => forwarded.destroy());
    forwarded.on('error', () => response.destroy());
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve) =>
    fixture.listen(16993, '127.0.0.1', resolve),
  );
  try {
    // Populate this origin's cache with the original module URLs before visiting Pal.
    await page.goto('http://127.0.0.1:16993/desktop/vnc.html');
    await expect(page.locator('html')).toHaveAttribute(
      'data-version',
      'cached',
    );
    await page.goto('http://127.0.0.1:16993/');
    const viewer = page.frameLocator('#desktop-viewer');
    await expect(viewer.locator('html')).toHaveAttribute(
      'data-version',
      'current',
    );
    await page.reload();
    await expect(viewer.locator('html')).toHaveAttribute(
      'data-version',
      'current',
    );
    const source = await page.locator('#desktop-viewer').getAttribute('src');
    const moduleURL = new URL('./app/ui.js', new URL(source!, page.url()));
    const moduleResponse = await page.request.get(moduleURL.href);
    expect(moduleResponse.headers()['cache-control']).toBe('no-cache');
  } finally {
    await page.goto('about:blank');
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test('desktop header toggles keyboard and fullscreen without remounting the viewer', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: false,
      configurable: true,
    });
    const visualViewport = new EventTarget();
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 844 },
      offsetLeft: { configurable: true, value: 0 },
      offsetTop: { configurable: true, value: 0 },
      pageLeft: { configurable: true, value: 0 },
      pageTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
      width: { configurable: true, value: 390 },
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });
  });
  await page.route('**/viewer-bridge.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: `<html class="noVNC_connected">
      <button id="noVNC_keyboard_button">Keyboard</button>
      <button id="noVNC_fullscreen_button">Fullscreen</button>
      <textarea id="noVNC_keyboardinput"></textarea>
      <script>
        const input = document.querySelector('textarea');
        const button = document.querySelector('#noVNC_keyboard_button');
        button.onclick = () => document.activeElement === input ? input.blur() : input.focus();
        input.onfocus = () => button.classList.add('noVNC_selected');
        input.onblur = () => button.classList.remove('noVNC_selected');
      </script></html>`,
    });
  });
  try {
    await page.goto(baseURL!);
    const root = page.locator('html');
    await root.evaluate((node) =>
      (node as HTMLElement).style.setProperty('--pal-safe-area-bottom', '34px'),
    );
    await page.getByRole('button', { name: 'Open desktop' }).tap();
    const keyboard = page.getByRole('button', {
      name: 'Toggle desktop keyboard',
    });
    const input = page
      .frameLocator('#desktop-viewer')
      .locator('#noVNC_keyboardinput');
    await expect(keyboard).toBeEnabled();
    await keyboard.tap();
    await expect(input).toBeFocused();
    await expect(keyboard).toHaveAttribute('aria-pressed', 'true');
    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 500,
      });
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        value: 500,
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });
    await expect(root).toHaveAttribute('data-keyboard-open', '');
    await expect(page.locator('#desktop-sheet')).toHaveCSS(
      'max-height',
      '500px',
    );
    await expect(page.locator('.desktop-body')).toHaveCSS(
      'padding-bottom',
      '16px',
    );
    // Mobile browsers can blur the iframe before delivering the header click.
    await page.evaluate(() => {
      document.querySelector('#desktop-keyboard')!.addEventListener(
        'pointerdown',
        () => {
          document
            .querySelector<HTMLIFrameElement>('#desktop-viewer')!
            .contentDocument!.querySelector<HTMLTextAreaElement>(
              '#noVNC_keyboardinput',
            )!
            .blur();
        },
        { once: true },
      );
    });
    await keyboard.tap();
    await expect(input).not.toBeFocused();
    await expect(keyboard).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 844,
      });
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        value: 844,
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });
    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await expect(page.locator('.desktop-body')).toHaveCSS(
      'padding-bottom',
      '34px',
    );

    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    const sheet = page.locator('#desktop-sheet');
    await expect(sheet).toHaveAttribute('data-fullscreen', 'true');
    await expect(
      page.getByRole('button', { name: 'Exit desktop fullscreen' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const bounds = (await sheet.boundingBox())!;
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(390);
    expect(bounds.height).toBe(844);
    await keyboard.tap();
    await expect(input).toBeFocused();
    await keyboard.tap();
    await page
      .getByRole('button', { name: 'Exit desktop fullscreen' })
      .press('Escape');
    await expect(sheet).toHaveAttribute('data-fullscreen', 'false');
    await expect(sheet).toHaveAttribute('data-open', 'true');

    // Exercise the native API separately from the phone viewport fallback.
    await page.evaluate(() =>
      Reflect.deleteProperty(document, 'fullscreenEnabled'),
    );
    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('desktop-sheet');
    await page.getByRole('button', { name: 'Exit desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement))
      .toBeNull();
    await expect(sheet).toHaveAttribute('data-fullscreen', 'false');
    await page.getByRole('button', { name: 'Enter desktop fullscreen' }).tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('desktop-sheet');
    await page.locator('#desktop-close').tap();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement))
      .toBeNull();
    await expect(sheet).toHaveAttribute('data-open', 'false');
    expect(viewerLoads).toBe(1);
  } finally {
    await context.close();
  }
});

test('desktop paste sends Unicode clipboard text before the shortcut and handles access failures', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        readText: async () => {
          if (document.body.dataset.clipboardDenied === 'true') {
            throw new DOMException('Denied', 'NotAllowedError');
          }
          return document.body.dataset.clipboardText ?? '';
        },
      },
    });
  });
  let viewerLoads = 0;
  await page.route('**/vnc.html**', (route) => {
    if (route.request().isNavigationRequest()) viewerLoads += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: '<html class="noVNC_connected"><title>Desktop paste fixture</title></html>',
    });
  });
  await page.route('**/app/ui.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `const calls = [];
        const record = (...args) => {
          calls.push(args);
          document.documentElement.dataset.calls = JSON.stringify(calls);
        };
        export default {
          get connected() { return document.documentElement.classList.contains('noVNC_connected'); },
          rfb: {
            viewOnly: false,
            clipboardPasteFrom: text => record('clipboard', text),
            sendKey: (...args) => record('key', ...args),
            focus: () => record('focus'),
          },
        };`,
    }),
  );
  await page.route('**/core/input/keysym.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export default { XK_Shift_L: 0xffe1, XK_Insert: 0xff63 };',
    }),
  );
  try {
    await page.goto(baseURL!);
    await page.getByRole('button', { name: /Open conversations/ }).tap();
    await expect(
      page.getByRole('dialog', { name: 'Conversations' }),
    ).toBeVisible();
    await expect(page.locator('#main-chat')).toBeFocused();
    await page.screenshot({ path: 'test-results/thread-sidebar-touch.png' });
    await page.getByRole('button', { name: 'Close thread sidebar' }).tap();
    await page.getByRole('button', { name: 'Open desktop' }).tap();
    const paste = page.getByRole('button', {
      name: 'Paste clipboard into desktop',
    });
    const viewer = page.frameLocator('#desktop-viewer').locator('html');
    const text = 'Clipboard 中文 😀\nsecond line';
    await page.evaluate((value) => {
      document.body.dataset.clipboardText = value;
    }, text);
    await expect(paste).toBeEnabled();
    await paste.tap();
    const expectedCalls = JSON.stringify([
      ['clipboard', text],
      ['key', 0xffe1, 'ShiftLeft', true],
      ['key', 0xff63, 'Insert'],
      ['key', 0xffe1, 'ShiftLeft', false],
      ['focus'],
    ]);
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);
    await expect(page.locator('#desktop-status')).toBeHidden();

    await page.evaluate(() => {
      document.body.dataset.clipboardDenied = 'true';
    });
    await paste.tap();
    await expect(page.locator('#desktop-status')).toHaveText(
      'Could not read clipboard. Allow clipboard access and try again.',
    );
    await expect(paste).toBeEnabled();
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);

    await page.evaluate(() => {
      document.body.dataset.clipboardDenied = 'false';
      document.body.dataset.clipboardText = '';
    });
    await paste.tap();
    await expect(page.locator('#desktop-status')).toHaveText(
      'Your clipboard contains no text.',
    );
    await expect(viewer).toHaveAttribute('data-calls', expectedCalls);

    await viewer.evaluate((root) => root.classList.remove('noVNC_connected'));
    await expect(paste).toBeDisabled();
    expect(viewerLoads).toBe(1);
  } finally {
    await context.close();
  }
});
