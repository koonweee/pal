import { randomUUID } from 'node:crypto';
import type { ElementHandle, Frame, Page } from 'playwright-core';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  isEligibleInput,
  inputMetadata,
  selectedFields,
  type LoginInput,
  type SecureFields,
  type SecureRole,
} from './login-fields.js';

interface BoundInput {
  owner: string;
  at: number;
  view: LoginInput;
  page: Page;
  frame: Frame;
  url: string;
  document: ElementHandle<HTMLHtmlElement>;
  element: ElementHandle<HTMLInputElement>;
}
export class LoginBrowser {
  private readonly inputs = new Map<string, BoundInput>();
  private async release(owner?: string) {
    const removed: BoundInput[] = [];
    for (const [ref, input] of this.inputs)
      if (input.owner === owner || Date.now() - input.at > 10 * 60_000) {
        this.inputs.delete(ref);
        removed.push(input);
      }
    await Promise.all(
      [
        ...new Set(removed.flatMap((input) => [input.element, input.document])),
      ].map((handle) => handle.dispose().catch(() => {})),
    );
  }
  async inspect(page: Page, owner: string) {
    await page.bringToFront();
    await this.release(owner);
    const inputs: LoginInput[] = [];
    const inspected = new Set<ElementHandle>();
    const labels: {
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
    }[] = [];
    try {
      for (const [frameIndex, frame] of page.frames().entries()) {
        let url: URL;
        try {
          url = new URL(frame.url());
        } catch {
          continue;
        }
        if (url.protocol !== 'https:') continue;
        const document = await frame.$('html');
        if (!document) continue;
        inspected.add(document);
        const elements = await frame.$$('input');
        for (const element of elements) inspected.add(element);
        for (const element of elements) {
          if (
            inputs.length >= 200 ||
            !(await element.evaluate(isEligibleInput, 'any' as const))
          ) {
            continue;
          }
          const { form, ...metadata } = await element.evaluate(inputMetadata);
          const marker = 'i' + (inputs.length + 1);
          const view = {
            ref: marker + '-' + randomUUID(),
            origin: url.origin,
            ...metadata,
            group:
              'frame' +
              (frameIndex + 1) +
              (form >= 0 ? ':form' + (form + 1) : ''),
          };
          this.inputs.set(view.ref, {
            owner,
            at: Date.now(),
            view,
            page,
            frame,
            url: frame.url(),
            document,
            element,
          });
          inputs.push(view);
          const box = await element.boundingBox();
          if (box) labels.push({ ...box, text: marker });
        }
      }
      const token = 'pal-login-' + randomUUID();
      try {
        await page.evaluate(
          ({ token, labels }) => {
            const host = document.createElement('div');
            host.id = token;
            host.style.cssText =
              'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
            const shadow = host.attachShadow({ mode: 'closed' });
            for (const b of labels) {
              const box = document.createElement('div');
              box.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;outline:2px solid #2563eb;box-sizing:border-box`;
              const label = document.createElement('span');
              label.textContent = b.text;
              label.style.cssText =
                'position:absolute;bottom:100%;left:0;background:#1e3a8a;color:white;font:14px sans-serif;padding:2px 4px;white-space:nowrap';
              box.append(label);
              shadow.append(box);
            }
            document.documentElement.append(host);
          },
          { token, labels },
        );
        // Mask every text-like input, including unclassified, readonly and disabled
        // controls and inputs beyond the metadata limit. No input values are read.
        const image = await page.screenshot({
          type: 'png',
          scale: 'css',
          mask: page
            .frames()
            .flatMap((frame) => [
              frame.locator(
                'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="image"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, [contenteditable]:not([contenteditable="false"])',
              ),
            ]),
          maskColor: '#334155',
        });
        return { inputs, image };
      } finally {
        await page
          .evaluate((token) => document.getElementById(token)?.remove(), token)
          .catch(() => {});
      }
    } catch {
      await this.release(owner);
      throw new ApplicationError(
        'unavailable',
        'Browser input inspection failed',
      );
    } finally {
      const retained = new Set<ElementHandle>(
        [...this.inputs.values()].flatMap((input) => [
          input.element,
          input.document,
        ]),
      );
      await Promise.all(
        [...inspected]
          .filter((handle) => !retained.has(handle))
          .map((handle) => handle.dispose().catch(() => {})),
      );
    }
  }
  url(owner: string, ref: string) {
    const input = this.inputs.get(ref);
    if (!input || input.owner !== owner || Date.now() - input.at > 10 * 60_000)
      throw new ApplicationError(
        'conflict',
        'Input reference expired; inspect again',
      );
    return input.url;
  }
  private async current(page: Page, input: BoundInput, role: SecureRole) {
    if (
      input.page !== page ||
      input.frame.isDetached() ||
      input.frame.url() !== input.url ||
      new URL(input.frame.url()).origin !== input.view.origin ||
      !(await input.document.evaluate(
        (el) => el === document.documentElement,
      )) ||
      !(await input.element.evaluate(isEligibleInput, role))
    )
      throw new Error();
  }
  async select(page: Page, owner: string, fields: SecureFields) {
    try {
      const entries = selectedFields(fields);
      if (new Set(entries.map(([, ref]) => ref)).size !== entries.length)
        throw new Error();
      const selected = entries.map(([role, ref]) => {
        const input = this.inputs.get(ref);
        if (
          !input ||
          input.owner !== owner ||
          Date.now() - input.at > 10 * 60_000
        )
          throw new Error();
        return { role, input };
      });
      const first = selected[0].input;
      for (const { role, input } of selected) {
        if (input.frame !== first.frame || input.document !== first.document)
          throw new Error();
        await this.current(page, input, role);
      }
      return {
        origin: first.view.origin,
        url: first.url,
        roles: [...new Set(selected.map((item) => item.role))],
        selected,
      };
    } catch {
      throw new ApplicationError(
        'conflict',
        'Secure field selection is invalid or changed; inspect again',
      );
    }
  }
  async fill(
    page: Page,
    owner: string,
    fields: SecureFields,
    values: { username?: string; password?: string; code?: string },
  ) {
    const target = await this.select(page, owner, fields);
    try {
      const code = values.code?.trim();
      if (
        target.roles.includes('code') &&
        (!code ||
          code.length > 64 ||
          /\s/.test(code) ||
          (target.selected.length > 1 &&
            code.length !== target.selected.length))
      )
        throw new ApplicationError(
          'conflict',
          'Enter a complete verification code',
        );
      for (const { role, input } of target.selected) {
        const value = role === 'code' ? code : values[role];
        if (!value)
          throw new ApplicationError('conflict', 'Missing secure entry value');
        const max = await input.element.evaluate((el) => el.maxLength);
        if (
          max > 0 &&
          (role === 'code' && target.selected.length > 1 ? 1 : value.length) >
            max
        )
          throw new ApplicationError(
            'conflict',
            'Secure entry exceeds the selected input length',
          );
      }
      // Every destination was checked before any value is written. Recheck each
      // bound element immediately before writing; never resolve a selector/focus.
      for (const [index, { role, input }] of target.selected.entries()) {
        await this.current(page, input, role);
        const value =
          role === 'code'
            ? target.selected.length === 1
              ? code!
              : code![index]
            : values[role]!;
        await input.element.fill(value, { timeout: 3000 });
      }
      return { status: 'filled' as const, fields: target.roles };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        'conflict',
        'Secure field selection changed or cannot be filled; inspect again',
      );
    }
  }
}
