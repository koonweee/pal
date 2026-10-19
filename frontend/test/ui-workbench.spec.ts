import { expect, test, type Page } from '@playwright/test';

async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(
    (value) => localStorage.setItem('pal-theme', value),
    theme,
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function contrastRatio(page: Page) {
  return page.getByRole('button', { name: 'Primary' }).evaluate((node) => {
    function rgb(value: string) {
      const channels = value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels || channels.length !== 3)
        throw new Error(`Invalid color: ${value}`);
      return channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
    }
    function luminance(value: string) {
      const [red, green, blue] = rgb(value) as [number, number, number];
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }
    const style = getComputedStyle(node);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
}

test('renders accessible core controls in both themes', async ({ page }) => {
  await page.goto('/__ui');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    expect(
      await contrastRatio(page),
      `${theme} primary contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    const iconAction = page.getByRole('button', { name: 'Add item' });
    await iconAction.focus();
    await expect(iconAction).toBeFocused();
    expect(
      await iconAction.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).not.toBe('none');
  }
});

test('keeps workbench actions touch sized', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/__ui`);
    const target = await page
      .getByRole('button', { name: 'Add item' })
      .boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test('keeps the PWA update notice in the compact one-row layout', async ({
  page,
}) => {
  await page.goto('/__ui#pwa');
  const notice = page.locator('#pwa-update');
  const label = notice.getByText('Update available', { exact: true });
  const update = notice.getByRole('button', { name: 'Update', exact: true });
  const dismiss = notice.getByRole('button', {
    name: 'Dismiss update notice',
  });
  const [box, labelBox, updateBox, dismissBox] = await Promise.all([
    notice.boundingBox(),
    label.boundingBox(),
    update.boundingBox(),
    dismiss.boundingBox(),
  ]);

  expect(box!.width).toBeLessThanOrEqual(360);
  expect(box!.height).toBeLessThanOrEqual(
    Math.max(labelBox!.height, updateBox!.height, dismissBox!.height) + 20,
  );
  expect(
    Math.abs(
      labelBox!.y +
        labelBox!.height / 2 -
        (updateBox!.y + updateBox!.height / 2),
    ),
  ).toBeLessThan(2);
});

test('keeps shared icon actions circular with uniform hover feedback', async ({
  page,
}) => {
  await page.goto('/__ui/preview?device=macbookAir');
  const preferences = page.getByRole('button', { name: 'Preferences' });
  const attach = page.getByRole('button', { name: 'Attach files' });

  for (const action of [preferences, attach]) {
    const box = await action.boundingBox();
    expect(box!.width).toBe(36);
    expect(box!.height).toBe(36);
    await action.hover();
  }
  await preferences.hover();
  const preferencesHover = await preferences.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, radius: style.borderRadius };
  });
  await attach.hover();
  const attachHover = await attach.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, radius: style.borderRadius };
  });
  expect(attachHover).toEqual(preferencesHover);
  expect(attachHover.radius).toBe('50%');
  const center = await preferences.boundingBox();
  await page.mouse.move(
    center!.x + center!.width / 2,
    center!.y + center!.height / 2,
  );
  await page.mouse.down();
  await expect(preferences).toHaveCSS('transform', 'none');
  await page.mouse.up();
});

test('uses semantic surfaces for shell panels in both themes', async ({
  page,
}) => {
  await page.goto('/__ui/preview?device=macbookAir');

  for (const theme of [
    {
      name: 'light' as const,
      border: 'rgb(209, 209, 214)',
      overlay: 'rgba(0, 0, 0, 0.28)',
      surface: 'rgb(243, 243, 245)',
    },
    {
      name: 'dark' as const,
      border: 'rgb(72, 72, 74)',
      overlay: 'rgba(0, 0, 0, 0.42)',
      surface: 'rgba(27, 27, 29, 0.8)',
    },
  ]) {
    await useTheme(page, theme.name);
    await page.getByRole('button', { name: /Open conversations/ }).click();
    const sidebar = page.locator('#thread-sidebar');
    await expect(sidebar).toHaveCSS('background-color', theme.surface);
    await expect(sidebar).toHaveCSS('border-right-color', theme.border);
    await expect(sidebar).toHaveCSS('border-radius', '0px 14px 14px 0px');
    expect(
      await sidebar.evaluate((node) => getComputedStyle(node).boxShadow),
    ).not.toBe('none');
    const sideOverlay = page.locator('.pal-overlay-backdrop:visible');
    await expect(sideOverlay).toHaveCSS('background-color', theme.overlay);
    await expect(sideOverlay).toHaveCSS('backdrop-filter', 'blur(1px)');
    await page.getByRole('button', { name: 'Close thread sidebar' }).click();

    await page.getByRole('button', { name: 'Open desktop' }).click();
    const desktop = page.locator('#desktop-sheet');
    await expect(desktop).toHaveCSS('background-color', theme.surface);
    await expect(desktop).toHaveCSS('border-bottom-color', theme.border);
    await expect(desktop).toHaveCSS('border-radius', '0px 0px 14px 14px');
    expect(
      await desktop.evaluate((node) => getComputedStyle(node).boxShadow),
    ).not.toBe('none');
    const desktopOverlay = page.locator('.pal-overlay-backdrop:visible');
    await expect(desktopOverlay).toHaveCSS('background-color', theme.overlay);
    await expect(desktopOverlay).toHaveCSS('backdrop-filter', 'blur(1px)');
    await page.getByRole('button', { name: 'Close desktop' }).click();
  }
});

test('keeps conversation clearance 12px below the rendered header', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/__ui/preview?conversation=offline`);
    const clearance = () =>
      page.locator('.header').evaluate((header) => {
        const content = document.querySelector('.history-content')!;
        const history = document.querySelector('.history')!;
        return (
          history.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(content).paddingTop) -
          header.getBoundingClientRect().bottom
        );
      });
    for (const width of [1280, 390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      for (const inset of [0, 12, 59]) {
        await page.evaluate((value) => {
          document.documentElement.style.setProperty(
            '--pal-pwa-header-height',
            `${value}px`,
          );
        }, inset);
        await expect.poll(clearance).toBeCloseTo(12, 1);
      }
    }
    // Content growth also resizes the header without a viewport change.
    await page.locator('.agent-name').evaluate((node: HTMLElement) => {
      node.style.fontSize = '64px';
    });
    await expect.poll(clearance).toBeCloseTo(12, 1);
  } finally {
    await context.close();
  }
});

test('shows connection and working activity independently', async ({
  page,
}) => {
  await page.goto('/__ui/preview?conversation=offline');
  await useTheme(page, 'light');
  const connection = page.locator('#connection');
  const avatar = page.locator('.agent-avatar');
  const agentName = page.locator('.agent-name');

  await expect(page.locator('#composer-status')).toHaveCount(0);
  await expect(page.locator('#history')).toHaveCSS('scrollbar-width', 'thin');
  await expect(agentName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(agentName).toHaveCSS('color', 'rgb(28, 28, 30)');
  expect(
    await page.locator('.footer').evaluate((footer) => {
      const composer = footer.querySelector('#composer')!;
      return (
        footer.getBoundingClientRect().bottom -
        composer.getBoundingClientRect().bottom
      );
    }),
  ).toBe(16);
  const layers = await page.locator('#history').evaluate((history) => {
    const header = document.querySelector('.header')!;
    const content = history.querySelector('.history-content')!;
    const footer = document.querySelector('.footer')!;
    const historyStyle = getComputedStyle(history);
    const contentStyle = getComputedStyle(content);
    const paneStyle = getComputedStyle(footer.parentElement!);
    return {
      contentLeft: content.getBoundingClientRect().left,
      contentRight: content.getBoundingClientRect().right,
      footerLeft: footer.getBoundingClientRect().left,
      footerRight: footer.getBoundingClientRect().right,
      footerHeight: footer.getBoundingClientRect().height,
      headerHeight: header.getBoundingClientRect().height,
      headerTop: header.getBoundingClientRect().top,
      historyBottom: history.getBoundingClientRect().bottom,
      historyPaddingBottom: Number.parseFloat(contentStyle.paddingBottom),
      historyPaddingTop: Number.parseFloat(contentStyle.paddingTop),
      historyRight: history.getBoundingClientRect().right,
      historyTop: history.getBoundingClientRect().top,
      mask: historyStyle.maskImage,
      overlayHeight: Number.parseFloat(
        paneStyle.getPropertyValue('--pal-composer-overlay-height'),
      ),
      viewportBottom: document.documentElement.clientHeight,
      viewportRight: document.documentElement.clientWidth,
    };
  });
  expect(layers.historyRight).toBe(layers.viewportRight);
  expect(layers.contentLeft).toBe(layers.footerLeft);
  expect(layers.contentRight).toBe(layers.footerRight);
  expect(layers.historyTop).toBe(layers.headerTop);
  expect(layers.historyBottom).toBe(layers.viewportBottom);
  expect(layers.historyPaddingTop).toBeGreaterThan(layers.headerHeight);
  expect(layers.overlayHeight).toBeCloseTo(layers.footerHeight, 1);
  expect(layers.historyPaddingBottom).toBeCloseTo(layers.footerHeight + 12, 1);
  expect(layers.mask).not.toBe('none');
  await expect(connection).toHaveAttribute('data-offline', 'true');
  await expect(connection).toHaveCSS('background-color', 'rgb(215, 0, 21)');

  await page.goto('/__ui/preview?conversation=loading');
  await expect(connection).toHaveAttribute('data-syncing', 'true');
  await expect(connection).toHaveCSS('background-color', 'rgb(36, 138, 61)');
  await expect(connection).toHaveCSS('animation-name', 'pulse');

  await page.goto('/__ui/preview?conversation=working');
  await expect(connection).toHaveCSS('animation-name', 'none');
  await expect(avatar).toHaveCSS('animation-name', 'avatar-working');

  await useTheme(page, 'dark');
  await expect(agentName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(agentName).toHaveCSS('color', 'rgb(242, 242, 247)');
});

test('catalogs feature states in its own scroll container', async ({
  page,
}) => {
  await page.goto('/__ui');

  await expect(
    page.getByRole('heading', { name: 'Application components' }),
  ).toBeVisible();
  const preview = page.getByTitle('MacBook Air application preview');
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())!.height).toBeGreaterThanOrEqual(
    page.viewportSize()!.height - 80,
  );
  const workbench = page.getByRole('main').first();
  expect(
    await workbench.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await workbench.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  expect(await workbench.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  await page.getByRole('combobox', { name: 'Composer' }).selectOption('files');
  const application = page.frameLocator(
    'iframe[title="MacBook Air application preview"]',
  );
  await expect(application.getByText('Upload failed')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Conversation' })
    .selectOption('empty');
  await expect(application.getByText('A little space to think.')).toBeVisible();

  await page.getByRole('button', { name: 'Open preferences' }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await expect(
    page.getByText('Prefer morning flights and aisle seats.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close preferences' }).click();

  await page.getByRole('button', { name: 'Open preferences' }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: 'Connections' }).click();
  await expect(
    preferences.getByRole('heading', { name: 'Connected services' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'workspace' })).toBeVisible();
});

test('renders the real shell at the named device viewports', async ({
  page,
}) => {
  await page.goto('/__ui#application');
  await page.setViewportSize({ height: 800, width: 360 });

  const canvas = page.getByRole('region', {
    name: 'Application preview canvas',
  });
  async function expectPreview(title: string, width: number, height: number) {
    const element = page.getByTitle(`${title} application preview`);
    await expect(element).toBeVisible();
    await expect
      .poll(async () => {
        const [canvasBox, frameBox] = await Promise.all([
          canvas.boundingBox(),
          element.boundingBox(),
        ]);
        return frameBox!.width <= canvasBox!.width;
      })
      .toBe(true);
    expect(
      await page
        .frameLocator(`iframe[title="${title} application preview"]`)
        .locator('html')
        .evaluate((node) => ({
          height: node.ownerDocument.defaultView!.innerHeight,
          width: node.ownerDocument.defaultView!.innerWidth,
        })),
    ).toEqual({ height, width });
    expect(
      await canvas.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }

  await expectPreview('MacBook Air', 1280, 832);

  const device = page.getByRole('combobox', { name: 'Device' });
  await device.selectOption('iphone17');
  await expectPreview('iPhone 17', 402, 874);
  const phone = page.frameLocator(
    'iframe[title="iPhone 17 application preview"]',
  );
  await expect(
    phone.getByRole('button', { name: /Open conversations/ }),
  ).toBeVisible();
  await expect(phone.getByRole('navigation', { name: 'Chats' })).toBeHidden();
  await device.selectOption('ipadMini');
  await expectPreview('iPad mini', 744, 1133);
  const tablet = page.frameLocator(
    'iframe[title="iPad mini application preview"]',
  );
  await expect(tablet.getByRole('navigation', { name: 'Chats' })).toBeHidden();
  await expect(
    tablet.getByRole('button', { name: /Open conversations/ }),
  ).toBeVisible();
});

test('restores a component-group fragment after React mounts', async ({
  page,
}) => {
  await page.goto('/__ui#dialogs');
  await expect(
    page.getByRole('heading', { name: 'Dialogs and overlays' }),
  ).toBeInViewport();
  expect(
    await page
      .getByRole('main')
      .first()
      .evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
});
