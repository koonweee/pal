import { expect, test } from '@playwright/test';

for (const device of [
  { name: 'iPhone', width: 402, height: 874 },
  { name: 'iPad', width: 820, height: 1180 },
]) {
  test(`keeps an opaque top edge above overlays for standalone ${device.name}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      colorScheme: 'dark',
      viewport: { width: device.width, height: device.height },
    });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { value: true });
      });
      await page.goto(baseURL!);

      await expect(page.locator('html')).toHaveClass(/pal-standalone/);
      const surface = page.locator('.pwa-safe-area');
      expect(
        await surface.evaluate(
          (node) =>
            node.parentElement === document.body &&
            node.nextElementSibling?.id === 'root',
        ),
      ).toBe(true);
      const bounds = (await surface.boundingBox())!;
      expect(bounds).toMatchObject({
        x: 0,
        y: 0,
        width: device.width,
        height: 12,
      });
      await expect(page.locator('.header')).toHaveCSS('padding-top', '12px');
      const appBackground = await page
        .locator('html')
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      await expect(surface).toHaveCSS('background-color', appBackground);
      expect(
        (await page.locator('#thread-open').boundingBox())!.y,
      ).toBeGreaterThanOrEqual(bounds.height);
      const profile = page.getByRole('button', { name: /Open conversations/ });
      const profileBounds = (await profile.boundingBox())!;
      const avatarBounds = (await profile
        .locator('.agent-avatar')
        .boundingBox())!;
      const nameBounds = (await page.locator('.agent-label').boundingBox())!;
      const desktopBounds = (await page
        .getByRole('button', { name: 'Open desktop' })
        .boundingBox())!;
      expect(profileBounds.width).toBeGreaterThanOrEqual(44);
      expect(profileBounds.height).toBeGreaterThanOrEqual(44);
      expect(avatarBounds.x + avatarBounds.width).toBeLessThan(nameBounds.x);
      expect(nameBounds.x + nameBounds.width).toBeLessThan(desktopBounds.x);
      expect(avatarBounds.y + avatarBounds.height / 2).toBeCloseTo(
        nameBounds.y + nameBounds.height / 2,
        0,
      );

      async function expectTopEdgeAboveContent() {
        // Include the decorative surface in hit testing to check painted stacking.
        expect(
          await surface.evaluate((node: HTMLElement) => {
            node.style.pointerEvents = 'auto';
            const bounds = node.getBoundingClientRect();
            const top = document.elementFromPoint(bounds.width / 2, 4);
            node.style.removeProperty('pointer-events');
            return top === node;
          }),
        ).toBe(true);
      }

      await expectTopEdgeAboveContent();
      await page
        .getByRole('button', { name: 'Preferences', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Preferences' });
      await expect(dialog).toBeVisible();
      const settingsBackground = await dialog.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await expect(surface).toHaveCSS(
        'background-color',
        device.width <= 600 ? settingsBackground : appBackground,
      );
      await expectTopEdgeAboveContent();
      await dialog.getByRole('button', { name: 'Close preferences' }).click();
      await expect(dialog).not.toBeVisible();
      await expect(surface).toHaveCSS('background-color', appBackground);
      await expectTopEdgeAboveContent();

      await page.locator('#thread-open').click();
      await expect(page.locator('#thread-sidebar')).toBeVisible();
      await expectTopEdgeAboveContent();
      await page.getByRole('button', { name: 'Close thread sidebar' }).click();
      await expect(page.locator('#thread-sidebar')).not.toBeVisible();
      await expectTopEdgeAboveContent();

      await page.emulateMedia({ colorScheme: 'light' });
      await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await page
        .getByRole('button', { name: 'Preferences', exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await expect(surface).toHaveCSS(
        'background-color',
        device.width <= 600
          ? await dialog.evaluate(
              (node) => getComputedStyle(node).backgroundColor,
            )
          : 'rgb(255, 255, 255)',
      );
      await dialog.getByRole('button', { name: 'Close preferences' }).click();
      await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    } finally {
      await context.close();
    }
  });
}

test('keeps the same composer mounted through narrow layout changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Message pal' });
  await draft.fill('Keep this draft');
  await draft.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(5, 9);
    node.dataset.identity = crypto.randomUUID();
  });
  const identity = await draft.getAttribute('data-identity');
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(draft).toHaveValue('Keep this draft');
  await expect(draft).toBeFocused();
  expect(await draft.getAttribute('data-identity')).toBe(identity);
  expect(
    await draft.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([5, 9]);
  const composerGeometry = await page.locator('#composer').evaluate((node) => ({
    draft: node.querySelector('#draft')!.getBoundingClientRect().height,
    send: node.querySelector('#send')!.getBoundingClientRect().height,
  }));
  expect(composerGeometry.draft).toBeCloseTo(composerGeometry.send, 0);
});

test('focuses the standalone composer without resetting selection and fits it above the keyboard', async ({
  browser,
  baseURL,
}) => {
  const viewport = { width: 402, height: 874 };
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport,
  });
  const page = await context.newPage();
  try {
    await page.addInitScript(({ height, width }) => {
      Object.defineProperty(navigator, 'standalone', { value: true });
      const visualViewport = new EventTarget();
      Object.defineProperties(visualViewport, {
        height: { configurable: true, value: height },
        offsetLeft: { configurable: true, value: 0 },
        offsetTop: { configurable: true, value: 0 },
        pageLeft: { configurable: true, value: 0 },
        pageTop: { configurable: true, value: 0 },
        scale: { configurable: true, value: 1 },
        width: { configurable: true, value: width },
      });
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: visualViewport,
      });
    }, viewport);
    await page.goto(baseURL!);
    const shell = page.locator('.shell');
    const root = page.locator('html');
    const footer = page.locator('.footer');
    const draft = page.getByRole('textbox', { name: 'Message pal' });
    await expect(root).toHaveCSS('overscroll-behavior-y', 'none');
    await expect(page.locator('#history')).toHaveCSS(
      'overscroll-behavior-y',
      'contain',
    );
    await expect(footer).toHaveCSS('overflow-y', 'hidden');
    await expect(footer).toHaveCSS('overscroll-behavior-y', 'none');
    await expect(draft).toHaveCSS('overscroll-behavior-y', 'contain');
    await root.evaluate((node) =>
      (node as HTMLElement).style.setProperty('--pal-safe-area-bottom', '34px'),
    );
    await expect(footer).toHaveCSS('padding-bottom', '34px');

    await draft.fill('Keep this draft');
    await draft.evaluate((node: HTMLTextAreaElement) => {
      node.setSelectionRange(5, 9);
      node.blur();
    });
    await draft.dispatchEvent('pointerdown', { pointerType: 'touch' });
    await expect(draft).toBeFocused();
    expect(
      await draft.evaluate((node: HTMLTextAreaElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([5, 9]);
    await draft.tap({ position: { x: 3, y: 20 } });
    const selection = await draft.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]);
    expect(selection[0]).toBe(selection[1]);
    await expect(draft).toHaveValue('Keep this draft');
    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await expect(footer).toHaveCSS('padding-bottom', '34px');
    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 500,
      });
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 500 },
        offsetTop: { configurable: true, value: 24 },
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });

    await expect(shell).toHaveCSS('top', '24px');
    await expect(root).toHaveAttribute('data-keyboard-open', '');
    await expect(shell).toHaveCSS('height', '500px');
    await expect(footer).toHaveCSS('padding-bottom', '12px');
    await expect(page.locator('.desktop-drawer-root')).toHaveCSS(
      'clip-path',
      'inset(100%)',
    );
    await expect(draft).toBeFocused();
    expect(
      (await footer.boundingBox())!.y + (await footer.boundingBox())!.height,
    ).toBeCloseTo(524, 0);

    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 874,
      });
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 874 },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });

    await expect(shell).toHaveCSS('top', '0px');
    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await expect(shell).toHaveCSS('height', '874px');
    await expect(footer).toHaveCSS('padding-bottom', '34px');
    await expect(draft).toBeFocused();
  } finally {
    await context.close();
  }
});

test('fits a portaled preference form to the keyboard viewport', async ({
  browser,
  baseURL,
}) => {
  const viewport = { width: 402, height: 874 };
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport,
  });
  const page = await context.newPage();
  try {
    await page.addInitScript(({ height, width }) => {
      const visualViewport = new EventTarget();
      Object.defineProperties(visualViewport, {
        height: { configurable: true, value: height },
        offsetLeft: { configurable: true, value: 0 },
        offsetTop: { configurable: true, value: 0 },
        pageLeft: { configurable: true, value: 0 },
        pageTop: { configurable: true, value: 0 },
        scale: { configurable: true, value: 1 },
        width: { configurable: true, value: width },
      });
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: visualViewport,
      });
    }, viewport);
    await page.goto(`${baseURL}/__ui#dialogs`);
    const root = page.locator('html');
    await root.evaluate((node) =>
      (node as HTMLElement).style.setProperty('--pal-safe-area-bottom', '34px'),
    );
    await page.getByRole('button', { name: 'Open preferences' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    const dialogInner = page.locator('.preferences-dialog-inner');
    const scroll = dialog.locator('.preferences-dialog-scroll');
    const query = dialog.getByRole('searchbox', {
      name: 'Search preferences',
    });

    await query.focus();
    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await expect(scroll).toHaveCSS('padding-bottom', '34px');

    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 500,
      });
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 500 },
        offsetTop: { configurable: true, value: 24 },
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });

    await expect(root).toHaveAttribute('data-keyboard-open', '');
    await expect(dialogInner).toHaveCSS('top', '24px');
    await expect(dialogInner).toHaveCSS('height', '500px');
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(scroll).toHaveCSS('padding-bottom', '20px');
    await expect(query).toBeFocused();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.y).toBeCloseTo(24, 0);
    expect(bounds.y + bounds.height).toBeCloseTo(524, 0);

    await page.evaluate(() => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 874,
      });
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 874 },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport?.dispatchEvent(new Event('resize'));
    });

    await expect(root).not.toHaveAttribute('data-keyboard-open');
    await expect(dialogInner).toHaveCSS('top', '0px');
    await expect(dialogInner).toHaveCSS('height', '874px');
    await expect(scroll).toHaveCSS('padding-bottom', '34px');
    await expect(query).toBeFocused();
  } finally {
    await context.close();
  }
});

test('keeps narrow fine-pointer navigation keyboard accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const selector = page.getByRole('button', { name: /Open conversations/ });
  await expect(selector).toBeVisible();
  await selector.focus();
  expect(
    await selector.evaluate((node) => getComputedStyle(node).outlineStyle),
  ).not.toBe('none');
  await selector.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Conversations' }),
  ).toBeVisible();
});

test('reflows without horizontal overflow at 320 CSS pixels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /Open conversations/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('keeps the touch composer controls square and contained', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 402, height: 874 },
  });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    const geometry = await page.locator('#composer').evaluate((node) => {
      const form = node.getBoundingClientRect();
      const row = node.parentElement!.getBoundingClientRect();
      const attach = node
        .querySelector('#attach-files')!
        .getBoundingClientRect();
      const draft = node.querySelector('#draft')!.getBoundingClientRect();
      const send = node.querySelector('#send')!.getBoundingClientRect();
      const footerStyle = getComputedStyle(node.parentElement!);
      return {
        attach,
        draft,
        form,
        row,
        send,
        leftGutter: Number.parseFloat(footerStyle.paddingLeft),
        rightGutter: Number.parseFloat(footerStyle.paddingRight),
      };
    });

    expect(geometry.form.height).toBe(46);
    expect(geometry.send.width).toBeGreaterThanOrEqual(44);
    expect(geometry.send.width).toBeCloseTo(geometry.send.height, 0);
    expect(geometry.attach.width).toBeGreaterThanOrEqual(44);
    expect(geometry.attach.height).toBeGreaterThanOrEqual(44);
    expect(geometry.draft.width).toBeGreaterThanOrEqual(120);
    expect(geometry.draft.height).toBeCloseTo(geometry.send.height, 0);
    expect(geometry.form.left).toBeCloseTo(
      geometry.row.left + geometry.leftGutter,
      0,
    );
    expect(geometry.form.right).toBeCloseTo(
      geometry.row.right - geometry.rightGutter,
      0,
    );
    await expect(page.locator('.footer')).toHaveCSS('padding-bottom', '12px');
    const rails = await page.evaluate(() => {
      const history = document
        .querySelector('#history')!
        .getBoundingClientRect();
      const footer = document.querySelector('.footer')!.getBoundingClientRect();
      return {
        footer: { left: footer.left, right: footer.right },
        history: { left: history.left, right: history.right },
      };
    });
    expect(rails.history.left).toBeCloseTo(rails.footer.left, 0);
    expect(rails.history.right).toBeCloseTo(rails.footer.right, 0);
  } finally {
    await context.close();
  }
});

test('provides coarse-pointer targets without changing the wide layout', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 900, height: 700 },
  });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    await expect(page.getByRole('navigation', { name: 'Chats' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: /Open conversations/ }),
    ).toBeVisible();
    const box = await page.locator('#thread-open').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#draft')).toHaveCSS('font-size', '16px');
    await expect(page.locator('#history')).toHaveCSS('scrollbar-width', 'none');
    expect(
      await page
        .locator('#history')
        .evaluate(
          (node) => getComputedStyle(node, '::-webkit-scrollbar').display,
        ),
    ).toBe('none');
  } finally {
    await context.close();
  }
});

for (const device of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 744, height: 1133 },
]) {
  test(`fits preference controls in the ${device.name} touch viewport`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: device.width, height: device.height },
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/__ui#dialogs`);
      await page.getByRole('button', { name: 'Open preferences' }).click();
      const dialog = page.getByRole('dialog', { name: 'Preferences' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS('opacity', '1');

      const fit = await dialog.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const tabs = node.querySelector('[role="tablist"]')!;
        const query = node.querySelector<HTMLInputElement>(
          '[aria-label="Search preferences"]',
        )!;
        const status = node.querySelector<HTMLSelectElement>(
          '[aria-label="Status"]',
        )!;
        return {
          controls: [query, status].map((control) => ({
            fontSize: Number.parseFloat(getComputedStyle(control).fontSize),
            height: control.getBoundingClientRect().height,
          })),
          dialog: {
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
          },
          tabsFit: tabs.scrollWidth <= tabs.clientWidth,
        };
      });
      expect(fit.dialog.left).toBeGreaterThanOrEqual(0);
      expect(fit.dialog.top).toBeGreaterThanOrEqual(0);
      expect(fit.dialog.right).toBeLessThanOrEqual(device.width);
      expect(fit.dialog.bottom).toBeLessThanOrEqual(device.height);
      expect(fit.tabsFit).toBe(true);
      for (const control of fit.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.fontSize).toBeGreaterThanOrEqual(16);
      }

      await dialog.getByRole('tab', { name: 'App', exact: true }).click();
      const updateChoice = dialog.getByRole('radio', {
        name: 'Update automatically when safe',
      });
      await expect(updateChoice).toBeVisible();
      const [dialogBox, choiceBox] = await Promise.all([
        dialog.boundingBox(),
        dialog
          .getByText('Update automatically when safe', { exact: true })
          .boundingBox(),
      ]);
      expect(choiceBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
      expect(choiceBox!.x + choiceBox!.width).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width,
      );
    } finally {
      await context.close();
    }
  });
}

test('keeps the preference header fixed over independently scrolling content', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 700 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/__ui#dialogs`);
    await page.getByRole('button', { name: 'Open preferences' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    await dialog.getByRole('tab', { name: 'Connections' }).click();
    await dialog.getByRole('button', { name: 'Add server' }).click();
    await expect(dialog.getByLabel(/^Name/)).toBeFocused();
    await dialog.getByLabel('Authentication').selectOption('oauth');

    const header = dialog.getByText('Preferences', { exact: true });
    const before = (await header.boundingBox())!.y;
    const scroll = dialog.locator('.preferences-dialog-scroll');
    expect(
      await scroll.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    expect((await header.boundingBox())!.y).toBeCloseTo(before, 0);
  } finally {
    await context.close();
  }
});

test('does not retain touch hover styling after preferences closes', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    const trigger = page.getByRole('button', {
      name: 'Preferences',
      exact: true,
    });
    const restingStyle = await trigger.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    });

    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    await dialog.getByRole('button', { name: 'Close preferences' }).click();
    await expect(dialog).toBeHidden();

    expect(
      await trigger.evaluate((node) => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, color: style.color };
      }),
    ).toEqual(restingStyle);
  } finally {
    await context.close();
  }
});

test('honors reduced motion', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    await page.getByRole('button', { name: 'Open desktop' }).click();
    await expect(page.locator('#desktop-sheet')).toHaveCSS(
      'transition-duration',
      '0s',
    );
  } finally {
    await context.close();
  }
});
