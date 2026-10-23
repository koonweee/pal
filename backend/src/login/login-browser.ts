import { randomUUID } from 'node:crypto';
import type { ElementHandle, Frame, Page } from 'playwright-core';
import { ApplicationError } from '../application/contracts/errors.js';
import {
  isEligibleInput,
  hasUsernameHint,
  codeInput,
  codeDigit,
} from './login-fields.js';

export interface LoginTarget {
  targetRef: string;
  origin: string;
  fields: ('username' | 'password' | 'code')[];
}
interface BoundTarget {
  view: LoginTarget;
  page: Page;
  frame: Frame;
  url: string;
  document: ElementHandle<HTMLHtmlElement>;
  username?: ElementHandle<HTMLInputElement>;
  password?: ElementHandle<HTMLInputElement>;
  code?: ElementHandle<HTMLInputElement>[];
}
/** Short-lived DOM references never contain input values. */
export class LoginBrowser {
  private readonly targets = new Map<
    string,
    { owner: string; at: number; target: BoundTarget }
  >();
  private bound(owner: string, ref: string) {
    const value = this.targets.get(ref);
    if (!value || value.owner !== owner || Date.now() - value.at > 10 * 60_000)
      throw new ApplicationError(
        'conflict',
        'Login target expired; inspect again',
      );
    return value.target;
  }
  async inspect(page: Page, owner: string) {
    // Headful Chromium needs the inspected tab foregrounded for reliable capture.
    await page.bringToFront();
    for (const [ref, value] of this.targets)
      if (value.owner === owner || Date.now() - value.at > 10 * 60_000) {
        await Promise.all([
          value.target.document.dispose(),
          value.target.username?.dispose(),
          value.target.password?.dispose(),
          ...(value.target.code ?? []).map((input) => input.dispose()),
        ]);
        this.targets.delete(ref);
      }
    const targets: LoginTarget[] = [];
    const mask: ElementHandle<HTMLInputElement>[] = [];
    const inspected: ElementHandle<HTMLInputElement>[] = [];
    const labels: {
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
    }[] = [];
    for (const frame of page.frames()) {
      let url: URL;
      try {
        url = new URL(frame.url());
      } catch {
        continue;
      }
      if (url.protocol !== 'https:') continue;
      const document = await frame.$('html');
      if (!document) continue;
      const allInputs = await frame.$$('input');
      const inputs = allInputs.slice(0, 200);
      inspected.push(...allInputs);
      const candidates: ElementHandle<HTMLInputElement>[] = [];
      const usernameHints = new Set<ElementHandle<HTMLInputElement>>();
      for (const input of inputs) {
        if (await input.evaluate(hasUsernameHint)) {
          usernameHints.add(input);
          mask.push(input);
        }
        if (await input.evaluate(isEligibleInput, 'any' as const))
          candidates.push(input);
      }
      const passwords: ElementHandle<HTMLInputElement>[] = [];
      for (const input of candidates)
        if (
          !(await input.evaluate(codeInput)) &&
          (await input.evaluate(isEligibleInput, 'password' as const))
        )
          passwords.push(input);
      const pairs: {
        username?: ElementHandle<HTMLInputElement>;
        password?: ElementHandle<HTMLInputElement>;
        code?: ElementHandle<HTMLInputElement>[];
      }[] = [];
      for (const password of passwords) {
        const possible = [];
        for (const input of candidates) {
          if (await input.evaluate(codeInput)) continue;
          if (
            await input.evaluate(
              (el, { pw, hinted }) =>
                ['text', 'email', 'tel'].includes(el.type) &&
                !el.autocomplete
                  .toLowerCase()
                  .split(/\s+/)
                  .some(
                    (purpose) =>
                      [
                        'one-time-code',
                        'current-password',
                        'new-password',
                      ].includes(purpose) || purpose.startsWith('cc-'),
                  ) &&
                el.form === pw.form &&
                (el.form !== null || hinted) &&
                el.getRootNode() === pw.getRootNode() &&
                !!(
                  el.compareDocumentPosition(pw) &
                  Node.DOCUMENT_POSITION_FOLLOWING
                ),
              { pw: password, hinted: usernameHints.has(input) },
            )
          )
            possible.push(input);
        }
        const explicit = possible.filter((input) => usernameHints.has(input));
        const username =
          explicit.length === 1
            ? explicit[0]
            : possible.length === 1
              ? possible[0]
              : undefined;
        // Multiple password inputs in one form indicate signup/change-password or ambiguity.
        let siblings = 0;
        for (const other of candidates)
          if (
            await other.evaluate(
              (el, pw) => el.type === 'password' && el.form === pw.form,
              password,
            )
          )
            siblings++;
        if (siblings === 1) pairs.push({ username, password });
      }
      if (!passwords.length) {
        for (const username of candidates) {
          if (await username.evaluate(codeInput)) continue;
          if (
            !usernameHints.has(username) ||
            !(await username.evaluate(isEligibleInput, 'username' as const))
          )
            continue;
          let peers = 0;
          for (const other of candidates)
            if (
              await other.evaluate(
                (el, user) =>
                  ['text', 'email', 'tel'].includes(el.type) &&
                  el.form === user.form &&
                  el.getRootNode() === user.getRootNode(),
                username,
              )
            )
              peers++;
          if (
            await username.evaluate((el, peers) => {
              const root = el.getRootNode() as Document | ShadowRoot;
              const fields = Array.from(
                el.form?.elements ?? root.querySelectorAll('input'),
              );
              if (
                fields.some(
                  (field) =>
                    field instanceof HTMLInputElement &&
                    field.form === el.form &&
                    field.type === 'password' &&
                    field.autocomplete
                      .toLowerCase()
                      .split(/\s+/)
                      .includes('new-password'),
                )
              )
                return false;
              const purposes = el.autocomplete.toLowerCase().split(/\s+/);
              if (purposes.includes('username')) return true;
              const path = el.form
                ? new URL(el.form.action, location.href).pathname
                : location.pathname;
              return (
                peers === 1 &&
                (purposes.includes('webauthn') ||
                  /sign[-_]?in|login|log[-_]?in/i.test(path))
              );
            }, peers)
          )
            pairs.push({ username });
        }
      }
      const declaredCodes: ElementHandle<HTMLInputElement>[] = [];
      for (const input of candidates)
        if (await input.evaluate(codeInput)) declaredCodes.push(input);
      // Split inputs may declare one-time-code only on the first digit. Require
      // single-digit semantics and the same form/root as the declared anchor.
      if (declaredCodes.length) {
        const anchor = declaredCodes[0];
        const codes: ElementHandle<HTMLInputElement>[] = [];
        for (const input of candidates) {
          if (
            declaredCodes.includes(input) ||
            ((await input.evaluate(codeDigit)) &&
              (await input.evaluate(
                (el, first) =>
                  el.form === first.form &&
                  el.getRootNode() === first.getRootNode(),
                anchor,
              )))
          )
            codes.push(input);
        }
        if (codes.length === 1 && !(await codes[0].evaluate(codeDigit)))
          pairs.push({ code: codes });
        else if (codes.length >= 4 && codes.length <= 10) {
          const valid = await Promise.all(
            codes.map((input, index) =>
              input.evaluate(
                (el, { first, index }) => {
                  const digit = (el.getAttribute('aria-label') ?? '').match(
                    /digit\s*(\d+)/i,
                  );
                  return (
                    el.form === first.form &&
                    el.getRootNode() === first.getRootNode() &&
                    (digit
                      ? Number(digit[1]) === index + 1
                      : el.maxLength === 1)
                  );
                },
                { first: anchor, index },
              ),
            ),
          );
          if (valid.every(Boolean)) pairs.push({ code: codes });
        }
        // Mask semantic candidates even when grouping is unsupported.
        mask.push(...codes);
      }
      for (const pair of pairs) {
        const view: LoginTarget = {
          targetRef: randomUUID(),
          origin: url.origin,
          fields: [
            ...(pair.username ? ['username' as const] : []),
            ...(pair.password ? ['password' as const] : []),
            ...(pair.code ? ['code' as const] : []),
          ],
        };
        const html = await frame.$('html');
        if (!html) continue;
        this.targets.set(view.targetRef, {
          owner,
          at: Date.now(),
          target: {
            view,
            page,
            frame,
            url: frame.url(),
            document: html,
            ...pair,
          },
        });
        targets.push(view);
        for (const role of view.fields) {
          const elements = role === 'code' ? pair.code! : [pair[role]!];
          for (const element of elements) {
            mask.push(element);
            const box = await element.boundingBox();
            if (box)
              labels.push({
                ...box,
                text: 'Target ' + targets.length + ' · ' + role,
              });
          }
        }
      }
      await document.dispose();
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
            box.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;outline:3px solid #2563eb;box-sizing:border-box`;
            const label = document.createElement('span');
            label.textContent = b.text;
            label.style.cssText =
              'position:absolute;bottom:100%;left:0;background:#1e3a8a;color:white;font:14px sans-serif;padding:3px;white-space:nowrap';
            box.append(label);
            shadow.append(box);
          }
          document.documentElement.append(host);
        },
        { token, labels },
      );
      // Element selectors come from bound DOM elements; mask their boxes without reading values.
      const styles = [];
      for (const element of new Set(mask)) {
        await element.evaluate(
          (el, token) => el.setAttribute('data-pal-login-mask', token),
          token,
        );
        styles.push(element);
      }
      try {
        const image = await page.screenshot({
          type: 'png',
          scale: 'css',
          mask: page
            .frames()
            .flatMap((frame) => [
              frame.locator(
                'input[type="password"], input[autocomplete~="username" i], input[autocomplete~="current-password" i], input[autocomplete~="new-password" i], input[autocomplete~="one-time-code" i], input[name*="password" i]',
              ),
              frame.locator(`[data-pal-login-mask="${token}"]`),
            ]),
          maskColor: '#334155',
        });
        return { targets, image };
      } finally {
        for (const element of styles)
          await element
            .evaluate((el) => el.removeAttribute('data-pal-login-mask'))
            .catch(() => {});
      }
    } finally {
      await page
        .evaluate((token) => document.getElementById(token)?.remove(), token)
        .catch(() => {});
      const retained = new Set(
        [...this.targets.values()].flatMap(({ target }) => [
          target.username,
          target.password,
          ...(target.code ?? []),
        ]),
      );
      await Promise.all(
        inspected
          .filter((input) => !retained.has(input))
          .map((input) => input.dispose()),
      );
    }
  }
  url(owner: string, ref: string) {
    return this.bound(owner, ref).frame.url();
  }
  target(owner: string, ref: string) {
    return this.bound(owner, ref).view;
  }
  async assertCurrent(page: Page, owner: string, ref: string) {
    const target = this.bound(owner, ref);
    try {
      if (
        target.page !== page ||
        target.frame.isDetached() ||
        target.frame.url() !== target.url ||
        new URL(target.frame.url()).origin !== target.view.origin ||
        !(await target.document.evaluate(
          (el) => el === document.documentElement,
        ))
      )
        throw new Error();
    } catch {
      throw new ApplicationError(
        'conflict',
        'Login target changed; inspect again',
      );
    }
  }
  async fill(
    page: Page,
    owner: string,
    ref: string,
    values: { username?: string; password?: string; code?: string },
  ) {
    const target = this.bound(owner, ref);
    const validate = async () => {
      if (
        target.page !== page ||
        target.frame.isDetached() ||
        target.frame.url() !== target.url ||
        new URL(target.frame.url()).origin !== target.view.origin ||
        !(await target.document.evaluate(
          (el) => el === document.documentElement,
        ))
      )
        throw new Error();
    };
    try {
      await validate();
      if (target.code) {
        const code = values.code?.trim() ?? '';
        if (
          !code ||
          code.length > 64 ||
          /\s/.test(code) ||
          (target.code.length > 1 &&
            !new RegExp('^\\d{' + target.code.length + '}$').test(code))
        )
          throw new ApplicationError(
            'conflict',
            'Enter a complete verification code',
          );
        if (
          !(
            await Promise.all(
              target.code.map((input) => input.evaluate(codeInput)),
            )
          ).some(Boolean)
        )
          throw new Error();
        // Validate every handle before writing any digit; never follow focus.
        for (const [index, input] of target.code.entries()) {
          if (
            !(await input.evaluate(
              (el, { first, index }) => {
                const digit = (el.getAttribute('aria-label') ?? '').match(
                  /digit\s*(\d+)/i,
                );
                return (
                  el.form === first.form &&
                  el.getRootNode() === first.getRootNode() &&
                  (!digit || Number(digit[1]) === index + 1)
                );
              },
              { first: target.code[0], index },
            ))
          )
            throw new Error();
          if (
            !(await input.evaluate(isEligibleInput, 'any' as const)) ||
            (!(await input.evaluate(codeInput)) &&
              !(target.code.length > 1 && (await input.evaluate(codeDigit))))
          )
            throw new Error();
          if (target.code.length > 1 && !(await input.evaluate(codeDigit)))
            throw new Error();
          if (target.code.length === 1) {
            const max = await input.evaluate((el) => el.maxLength);
            if (max > 0 && code.length > max)
              throw new ApplicationError(
                'conflict',
                'Enter a complete verification code',
              );
          }
        }
        for (const [index, input] of target.code.entries()) {
          await validate();
          if (
            !(await input.evaluate(
              (el, first) =>
                el.form === first.form &&
                el.getRootNode() === first.getRootNode(),
              target.code[0],
            ))
          )
            throw new Error();
          if (
            !(await input.evaluate(isEligibleInput, 'any' as const)) ||
            (!(await input.evaluate(codeInput)) &&
              !(target.code.length > 1 && (await input.evaluate(codeDigit))))
          )
            throw new Error();
          await input.fill(target.code.length === 1 ? code : code[index], {
            timeout: 3000,
          });
        }
        return { status: 'filled' as const, fields: target.view.fields };
      }
      if (
        target.password &&
        !(await target.password.evaluate(isEligibleInput, 'password' as const))
      )
        throw new Error();
      // Never re-resolve a stale selector or fill a text input with a password.
      if (target.username) {
        if (
          !(await target.username.evaluate(
            isEligibleInput,
            'username' as const,
          ))
        )
          throw new Error();
        await target.username.fill(values.username ?? '', { timeout: 3000 });
      }
      await validate();
      if (target.password) {
        if (
          !(await target.password.evaluate(
            isEligibleInput,
            'password' as const,
          ))
        )
          throw new Error();
        await target.password.fill(values.password ?? '', { timeout: 3000 });
      }
      return { status: 'filled' as const, fields: target.view.fields };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        'conflict',
        'Secure entry target changed or cannot be filled; inspect again',
      );
    }
  }
}
