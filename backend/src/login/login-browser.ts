import { randomBytes, randomUUID } from 'node:crypto';
import type { ElementHandle, Frame, Page } from 'playwright-core';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  isEligibleInput,
  fieldKind,
  type SecureValues,
  inputMetadata,
  selectedFields,
  StaleSecureFieldsError,
  type LoginInput,
  type SecureFields,
  type SecureRole,
} from './login-fields.js';

interface BoundInput {
  owner: string;
  inspectionId: string;
  at: number;
  view: LoginInput;
  page: Page;
  frame: Frame;
  url: string;
  document: ElementHandle<HTMLHtmlElement>;
  element: ElementHandle<HTMLInputElement | HTMLSelectElement>;
  topUrl: string;
  topDocument: ElementHandle<HTMLHtmlElement>;
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
        ...new Set(
          removed.flatMap((input) => [
            input.element,
            input.document,
            input.topDocument,
          ]),
        ),
      ].map((handle) => handle.dispose().catch(() => {})),
    );
  }
  async inspect(page: Page, owner: string) {
    await page.bringToFront();
    await this.release(owner);
    const inspectionId = randomUUID();
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
        const topDocument = await page.$('html');
        if (!topDocument) continue;
        inspected.add(topDocument);
        const elements = (await frame.$$('input, select')) as ElementHandle<
          HTMLInputElement | HTMLSelectElement
        >[];
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
            ref: marker + '-' + randomBytes(12).toString('base64url'),
            origin: url.origin,
            ...metadata,
            group:
              'frame' +
              (frameIndex + 1) +
              (form >= 0 ? ':form' + (form + 1) : ''),
          };
          this.inputs.set(view.ref, {
            owner,
            inspectionId,
            at: Date.now(),
            view,
            page,
            frame,
            url: frame.url(),
            document,
            element,
            topUrl: page.url(),
            topDocument,
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
                'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="image"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select, [contenteditable]:not([contenteditable="false"])',
              ),
            ]),
          maskColor: '#334155',
        });
        return { inputs, image, inspectionId };
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
          input.topDocument,
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
      throw new StaleSecureFieldsError();
    return input.url;
  }
  private async current(page: Page, input: BoundInput, role: SecureRole) {
    if (
      input.page !== page ||
      page.url() !== input.topUrl ||
      !(await input.topDocument.evaluate(
        (el) => el === document.documentElement,
      )) ||
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
  live(owner: string, fields: SecureFields | null) {
    if (!fields) return false;
    return selectedFields(fields).every(([, ref]) => {
      const input = this.inputs.get(ref);
      return (
        input?.owner === owner &&
        !input.page.isClosed() &&
        !input.frame.isDetached() &&
        input.frame.url() === input.url &&
        Date.now() - input.at < 10 * 60_000
      );
    });
  }
  async select(page: Page, owner: string, fields: SecureFields) {
    const entries = selectedFields(fields);
    try {
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
        if (
          input.inspectionId !== first.inspectionId ||
          (fieldKind(fields) !== 'card' &&
            (input.frame !== first.frame || input.document !== first.document))
        )
          throw new Error();
        if (
          fieldKind(fields) === 'card' &&
          new URL(input.topUrl).protocol !== 'https:'
        )
          throw new Error();
        await this.current(page, input, role);
      }
      return {
        inspectionId: first.inspectionId,
        origin:
          fieldKind(fields) === 'card'
            ? new URL(first.topUrl).origin
            : first.view.origin,
        url: first.url,
        roles: [...new Set(selected.map((item) => item.role))],
        selected,
      };
    } catch {
      throw new StaleSecureFieldsError();
    }
  }
  async fill(
    page: Page,
    owner: string,
    fields: SecureFields,
    values: SecureValues,
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
          'invalid_input',
          'Enter a complete verification code',
        );
      const prepared = new Map<string, { value: string; select: boolean }>();
      for (const { role, input } of target.selected) {
        let value = role === 'code' ? code : values[role];
        if (!value)
          throw new ApplicationError(
            'invalid_input',
            'Missing secure entry value',
          );
        const max = await input.element.evaluate((el) =>
          'maxLength' in el ? el.maxLength : -1,
        );
        if (role === 'expYear' && max === 2) value = value.slice(-2);
        if (
          max > 0 &&
          (role === 'code' && target.selected.length > 1 ? 1 : value.length) >
            max
        )
          throw new ApplicationError(
            'invalid_input',
            'Secure entry exceeds the selected input length',
          );
        const select = await input.element.evaluate(
          (el) => el instanceof HTMLSelectElement,
        );
        if (select) {
          const option = await input.element.evaluate((el, value) => {
            if (!(el instanceof HTMLSelectElement)) return undefined;
            const matches = [...el.options].filter(
              (o) =>
                !o.disabled &&
                (o.value === value ||
                  o.text.trim() === value ||
                  (/^\d+$/.test(o.value) && Number(o.value) === Number(value))),
            );
            return matches.length === 1 ? matches[0].value : undefined;
          }, value);
          if (option === undefined)
            throw new ApplicationError(
              'invalid_input',
              'Expiry option is unavailable',
            );
          value = option;
        }
        prepared.set(input.view.ref, { value, select });
      }
      // Every destination was checked before any value is written. Recheck each
      // bound element immediately before writing; never resolve a selector/focus.
      for (const [index, { role, input }] of target.selected.entries()) {
        await this.current(page, input, role);
        const preparedValue = prepared.get(input.view.ref)!;
        const value =
          role === 'code' && target.selected.length > 1
            ? code![index]
            : preparedValue.value;
        if (preparedValue.select)
          await input.element.selectOption(value, { timeout: 3000 });
        else await input.element.fill(value, { timeout: 3000 });
      }
      return { status: 'filled' as const, fields: target.roles };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new StaleSecureFieldsError();
    }
  }
}
