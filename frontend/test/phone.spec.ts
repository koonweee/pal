import { expect, test } from '@playwright/test';
import { usePalBackend } from './support/pal-backend';

usePalBackend(test);

test('phone preview keeps its size when the client keyboard reduces the visual viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.routeWebSocket('**/api/android/viewer', (socket) => socket.close());
  await page.goto('/');
  await page.getByRole('button', { name: 'Open phone', exact: true }).click();
  const sheet = page.locator('#phone-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('margin-top', '0px');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--pal-safe-area-bottom', '34px');
  });

  for (const fullscreen of [false, true]) {
    if (fullscreen) {
      await page.getByRole('button', { name: 'Fullscreen phone', exact: true }).click();
    }
    await expect(sheet).toHaveAttribute('data-fullscreen', String(fullscreen));
    const bounds = await sheet.boundingBox();
    const preview = await page.locator('.phone-screen').boundingBox();
    // Safari reduces the visual viewport while leaving the layout viewport intact.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--pal-viewport-height', '430px');
      root.style.setProperty('--pal-viewport-top', '20px');
      root.setAttribute('data-keyboard-open', '');
    });
    expect(await sheet.boundingBox()).toEqual(bounds);
    expect(await page.locator('.phone-screen').boundingBox()).toEqual(preview);
    const input = await page.locator('.phone-keyboard-input').boundingBox();
    expect(input!.y).toBeLessThan(bounds!.y + 100);
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--pal-viewport-height', '844px');
      root.style.setProperty('--pal-viewport-top', '0px');
      root.removeAttribute('data-keyboard-open');
    });
  }
});
