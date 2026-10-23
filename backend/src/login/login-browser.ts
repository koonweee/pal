import { randomUUID } from 'node:crypto';
import type { ElementHandle, Frame, Page } from 'playwright-core';
import { ApplicationError } from '../application/contracts/errors.js';

export interface LoginTarget {
  loginRef: string;
  origin: string;
  fields: ('username' | 'password')[];
}
interface BoundTarget {
  view: LoginTarget;
  page: Page;
  frame: Frame;
  url: string;
  document: ElementHandle<HTMLHtmlElement>;
  username?: ElementHandle<HTMLInputElement>;
  password?: ElementHandle<HTMLInputElement>;
}
// These self-contained functions are serialized by Playwright into the page.
function isEligibleInput(
  el: HTMLInputElement,
  role: 'any' | 'username' | 'password',
) {
  if (
    !el.isConnected ||
    el.disabled ||
    el.readOnly ||
    el.type === 'hidden' ||
    !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return false;
  const purposes = el.autocomplete.toLowerCase().split(/\s+/);
  if (
    role === 'password' &&
    (el.type !== 'password' ||
      purposes.some(
        (purpose) =>
          purpose === 'new-password' ||
          purpose === 'one-time-code' ||
          purpose.startsWith('cc-'),
      ))
  )
    return false;
  if (
    role === 'username' &&
    (!['text', 'email', 'tel'].includes(el.type) ||
      purposes.some(
        (purpose) =>
          ['new-password', 'current-password', 'one-time-code'].includes(
            purpose,
          ) || purpose.startsWith('cc-'),
      ))
  )
    return false;
  const rect = el.getBoundingClientRect();
  let left = rect.left,
    right = rect.right,
    top = rect.top,
    bottom = rect.bottom;
  // checkVisibility does not account for an input clipped by a collapsed ancestor.
  let ancestor: Element | null =
    el.parentElement ??
    (el.getRootNode() instanceof ShadowRoot
      ? (el.getRootNode() as ShadowRoot).host
      : null);
  while (ancestor) {
    const style = getComputedStyle(ancestor),
      bounds = ancestor.getBoundingClientRect();
    if (['hidden', 'clip'].includes(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (['hidden', 'clip'].includes(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    ancestor =
      ancestor.parentElement ??
      (ancestor.getRootNode() instanceof ShadowRoot
        ? (ancestor.getRootNode() as ShadowRoot).host
        : null);
  }
  return right > left && bottom > top;
}
function hasUsernameHint(el: HTMLInputElement) {
  if (!['text', 'email', 'tel'].includes(el.type)) return false;
  const purposes = el.autocomplete.toLowerCase().split(/\s+/);
  if (purposes.includes('username')) return true;
  const identifier = [el.name, el.id].some((value) =>
    /(^|[_-])(email|user[_-]?name|account([_-]?(name|id))?|identifier|login|phone)([_-]|$)/i.test(
      value,
    ),
  );
  const root = el.getRootNode() as Document | ShadowRoot;
  const label = [...(el.labels ?? [])]
    .map((label) => label.textContent ?? '')
    .concat(
      el.getAttribute('aria-label') ?? '',
      ...(el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => root.getElementById(id)?.textContent ?? ''),
    )
    .join(' ');
  return (
    identifier &&
    (purposes.includes('webauthn') ||
      /email|user\s*name|account|phone/i.test(label))
  );
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
        if (await input.evaluate(isEligibleInput, 'password' as const))
          passwords.push(input);
      const pairs: {
        username?: ElementHandle<HTMLInputElement>;
        password?: ElementHandle<HTMLInputElement>;
      }[] = [];
      for (const password of passwords) {
        const possible = [];
        for (const input of candidates) {
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
      for (const pair of pairs) {
        const view: LoginTarget = {
          loginRef: randomUUID(),
          origin: url.origin,
          fields: [
            ...(pair.username ? ['username' as const] : []),
            ...(pair.password ? ['password' as const] : []),
          ],
        };
        const html = await frame.$('html');
        if (!html) continue;
        this.targets.set(view.loginRef, {
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
          const element = pair[role]!;
          mask.push(element);
          const box = await element.boundingBox();
          if (box)
            labels.push({
              ...box,
              text: 'Login ' + targets.length + ' · ' + role,
            });
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
    values: { username?: string; password?: string },
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
    } catch {
      throw new ApplicationError(
        'conflict',
        'Login target changed or cannot be filled; inspect again',
      );
    }
  }
}
