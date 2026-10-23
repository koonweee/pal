import { expect, test } from '@playwright/test';
import type { LoginRequest, Message, TaskDetails } from '../src/api/client';
import { backend, usePalBackend } from './support/pal-backend';

usePalBackend(test);
for (const width of [900, 390]) {
  test(`inline secure entry and recovery at ${width}px`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    const page = await context.newPage();
    await page.route('**/vnc.html', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const task: TaskDetails = {
      id: 'login-task',
      title: 'Store sign-in',
      goal: 'Sign in',
      description: '',
      status: 'needs-input',
      archived: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    backend.taskRows.push(task);
    const rows = new Map<string, LoginRequest>();
    rows.set('login-root', {
      id: 'login-root',
      origin: 'https://accounts.example.test',
      kind: 'credentials',
      status: 'pending',
      inspectionId: 'login-preview',
      configured: true,
      chooseAccount: true,
      keepMeSignedIn: true,
      accounts: [
        { id: 'personal', label: 'Personal' },
        { id: 'work', label: 'Work' },
      ],
    });
    const card = (id: string): Message => ({
      ...backend.message('Enter securely.'),
      taskId: task.id,
      mainVisible: true,
      phase: 'commentary',
      metadata: { secureEntryRequestId: id },
    });
    const loginCard = card('login-root');
    const reference = {
      ...backend.message(
        'Reference message with enough text to fill the normal message width. '.repeat(
          12,
        ),
      ),
      taskId: task.id,
      mainVisible: true,
    };
    backend.rows.push(reference, loginCard);
    backend.holdNextHistory = true;
    let credentialSubmissions = 0,
      codeSubmissions = 0,
      requestLoads = 0,
      accountSelections = 0;
    const update = () =>
      backend.emit('login.updated', {
        event: 'login.updated',
        taskId: task.id,
      });
    await page.route('**/api/login/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/image'))
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="white"/><text x="20" y="35">Synthetic masked preview · i1</text></svg>',
        });
      const match = path.match(/\/requests\/([^/]+)(?:\/([^/]+))?$/)!;
      const [id, action] = match.slice(1);
      if (!action) {
        requestLoads++;
        return route.fulfill({ json: rows.get(id!) });
      }
      const root = [...rows.keys()].find((key) => rows.get(key)!.id === id)!;
      const current = rows.get(root)!;
      if (action === 'save') {
        expect(route.request().postDataJSON()).toEqual({
          username: 'dummy-user',
          password: 'dummy-password',
          label: 'Personal',
          keepMeSignedIn: true,
        });
        credentialSubmissions++;
        rows.set(root, { ...current, status: 'saved', inspectionId: null });
      } else if (action === 'select') {
        expect(route.request().postDataJSON()).toEqual({
          accountId: 'work',
          keepMeSignedIn: true,
        });
        accountSelections++;
        rows.set(root, { ...current, status: 'selected', inspectionId: null });
      } else if (action === 'code') {
        expect(route.request().postDataJSON()).toEqual({ code: '731946' });
        codeSubmissions++;
        expect(id).toBe(codeSubmissions === 1 ? 'code-root' : 'new-code');
        rows.set(root, {
          ...current,
          status: codeSubmissions === 1 ? 'updating' : 'filled',
          inspectionId: null,
        });
      }
      update();
      return route.fulfill({
        status: 201,
        json: { id, status: rows.get(root)!.status },
      });
    });
    try {
      await page.addInitScript((message) => {
        localStorage.setItem(
          'pal-main-history-v1',
          JSON.stringify({
            schema: 1,
            savedAt: new Date().toISOString(),
            messages: [message],
          }),
        );
      }, loginCard);
      await page.goto(baseURL!);
      await expect(
        page.getByText('Enter securely.', { exact: true }),
      ).toBeVisible();
      await expect.poll(() => Boolean(backend.releaseHistory)).toBe(true);
      expect(requestLoads).toBe(0);
      await expect(page.getByLabel(/^Password/)).toHaveCount(0);
      backend.releaseHistory!();
      const assertCardLayout = async () => {
        await expect(
          page.getByRole('button', { name: /^Open task:/ }),
        ).toHaveCount(0);
        // Exercise a narrow conversation pane at desktop size as well as the mobile viewport.
        if (width === 900)
          await page.locator('.chat-pane').evaluate((node) => {
            node.style.flex = '0 1 400px';
          });
        const referenceMessage = page.locator(
          `[data-message-id="${reference.id}"]`,
        );
        await expect(referenceMessage).toBeVisible();
        const referenceWidth = (await referenceMessage.boundingBox())!.width;
        for (const card of await page
          .getByRole('region', { name: 'Secure entry' })
          .all()) {
          const box = (await card.boundingBox())!;
          expect(box.width).toBeLessThanOrEqual(referenceWidth + 1);
        }
        if (width === 900)
          await page
            .locator('.chat-pane')
            .evaluate((node) => node.style.removeProperty('flex'));
      };
      const openTask = async () => {
        await page.locator('#thread-open').click();
        await page
          .locator('#task-list')
          .getByRole('button', { name: /Store sign-in/ })
          .click();
      };
      await expect(
        page.getByText('Choose an account', { exact: true }),
      ).toBeVisible();
      await assertCardLayout();
      await openTask();
      await expect(
        page.getByRole('radio', { name: 'Work', exact: true }),
      ).toBeVisible();
      await assertCardLayout();
      await page.locator('#thread-open').click();
      await page.locator('#main-chat').click();
      await page.getByRole('button', { name: 'Use a new account' }).click();
      const password = page.getByLabel(/^Password/);
      await expect(password).toBeVisible();
      await expect(page.getByLabel('Save to', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('checkbox', { name: 'Keep me signed in' }),
      ).toBeChecked();
      await assertCardLayout();
      await expect(page.getByRole('button', { name: /Logins/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Show browser preview' }).click();
      await expect(
        page.getByRole('img', { name: /Selected fields/ }),
      ).toBeVisible();
      await expect(
        page.getByRole('img', { name: /Selected fields/ }),
      ).toHaveAttribute('src', /login-preview\/image$/);
      await page.getByRole('button', { name: 'Hide browser preview' }).click();
      await page.getByLabel(/^Username/).fill('dummy-user');
      await password.fill('dummy-password');
      if (width === 390) {
        expect(
          (await page
            .getByRole('button', { name: 'Save login' })
            .boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
        await page.setViewportSize({ width: 600, height: 900 });
        await expect(password).toHaveValue('dummy-password');
        await expect(
          page.getByRole('checkbox', { name: 'Keep me signed in' }),
        ).toBeChecked();
        await page.setViewportSize({ width, height: 900 });
      }
      await page.getByRole('button', { name: 'Save login' }).click();
      await expect(
        page.getByText('Login saved', { exact: true }),
      ).toBeVisible();
      await expect(password).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /browser preview/ }),
      ).toHaveCount(0);
      // The Task shows the same canonical card and status after completion in Main.
      await openTask();
      await expect(
        page
          .locator(`[data-message-id="${loginCard.id}"]`)
          .getByText('Login saved', { exact: true }),
      ).toBeVisible();
      await assertCardLayout();
      await page.locator('#thread-open').click();
      await page.locator('#main-chat').click();
      await expect(
        page.getByText('Login saved', { exact: true }),
      ).toBeVisible();
      rows.set('picker-root', {
        ...rows.get('login-root')!,
        id: 'picker-root',
        status: 'pending',
      });
      backend.publish(card('picker-root'));
      await expect(
        page.getByText('Choose an account', { exact: true }),
      ).toBeVisible();
      await page.getByRole('radio', { name: 'Work', exact: true }).check();
      if (width === 390)
        expect(
          (await page.getByText('Work', { exact: true }).boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(
        page.getByText('Account selected', { exact: true }),
      ).toBeVisible();
      await openTask();
      await expect(
        page.getByText('Account selected', { exact: true }),
      ).toBeVisible();
      await assertCardLayout();
      await page.locator('#thread-open').click();
      await page.locator('#main-chat').click();
      rows.set('code-root', {
        ...rows.get('login-root')!,
        id: 'code-root',
        kind: 'code',
        chooseAccount: false,
        status: 'pending',
        inspectionId: 'code-preview',
        configured: false,
      });
      backend.publish(card('code-root'));
      const code = page.getByLabel(/^Code/);
      await expect(code).toBeVisible();
      await expect(
        page.getByRole('checkbox', { name: 'Keep me signed in' }),
      ).toHaveCount(0);
      await assertCardLayout();
      await code.fill('731946');
      await page.getByRole('button', { name: 'Fill code' }).click();
      await expect(page.getByText('Updating request…')).toBeVisible();
      await expect(code).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /browser preview/ }),
      ).toHaveCount(0);
      rows.set('code-root', {
        ...rows.get('code-root')!,
        id: 'new-code',
        status: 'pending',
        inspectionId: 'new-code-preview',
      });
      update();
      await expect(code).toHaveValue('');
      await openTask();
      await expect(code).toHaveValue('');
      await assertCardLayout();
      await code.fill('731946');
      await page.getByRole('button', { name: 'Fill code' }).click();
      await expect(
        page.getByText('Code filled', { exact: true }),
      ).toBeVisible();
      await page.locator('#thread-open').click();
      await page.locator('#main-chat').click();
      await expect(
        page.getByText('Code filled', { exact: true }),
      ).toBeVisible();
      expect(credentialSubmissions).toBe(1);
      expect(accountSelections).toBe(1);
      expect(codeSubmissions).toBe(2);
      expect(backend.submissions).toHaveLength(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      expect(
        await page.evaluate(() => JSON.stringify({ ...localStorage })),
      ).not.toMatch(/dummy-user|dummy-password|731946/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
