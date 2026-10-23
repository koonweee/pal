import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)(
  process.cwd() + '/backend/node_modules/playwright-core',
);
const dir = process.cwd() + '/.local/login-latency-detailed';
const tag = randomUUID().slice(0, 8);
const events = [];
function emit(event, data = {}) {
  const row = { at: Date.now(), event, ...data };
  events.push(row);
  appendFileSync(dir + '/driver.jsonl', JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
}
const daemon = spawn(
  'docker',
  [
    'exec',
    '-i',
    'pal-dev-split-agent-service-1',
    'node',
    '/tmp/pal-login-latency-fixtures.mjs',
    tag,
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
daemon.stderr.on('data', (x) => appendFileSync(dir + '/fixture-errors.log', x));
const fixtureEvents = [];
createInterface({ input: daemon.stdout }).on('line', (line) => {
  try {
    const e = JSON.parse(line);
    fixtureEvents.push(e);
    appendFileSync(dir + '/fixtures.jsonl', line + '\n');
    if (
      [
        'fixture.signed_in',
        'fixture.password_submitted',
        'fixture.code_submitted',
        'fixture.trust_selected',
        'fixture.control_error',
      ].includes(e.event)
    )
      console.log(line);
  } catch {}
});
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Condition timed out');
}
const ready = await until(() =>
  fixtureEvents.find((e) => e.event === 'fixtures.ready'),
);
writeFileSync(
  dir + '/run-config.json',
  JSON.stringify({ tag, hosts: ready.hosts }),
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1050, height: 1000 } });
const requestViews = new Map(),
  submittedIds = new Set();
page.on('response', async (r) => {
  const path = new URL(r.url()).pathname;
  if (
    r.request().method() === 'GET' &&
    /\/api\/login\/requests\/[^/]+$/.test(path)
  ) {
    try {
      const v = await r.json();
      requestViews.set(v.id, {
        id: v.id,
        origin: v.origin,
        kind: v.kind,
        status: v.status,
        chooseAccount: v.chooseAccount,
      });
    } catch {}
  }
});
page.on('request', (r) => {
  const path = new URL(r.url()).pathname;
  if (/\/api\/login\/requests\/[^/]+\/(save|select|code)$/.test(path))
    (submittedIds.add(path.split('/').at(-2)), emit('ui.submit', { path }));
});
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (/\/api\/login\/requests\/[^/]+\/(save|select|code)$/.test(path))
    emit('ui.response', { path, status: r.status() });
});
await page.goto('http://127.0.0.1:14173');
await page.locator('.composer-input textarea').waitFor();
let active;
async function prompt(name, text) {
  active = name;
  emit('scenario.start', { name, prompt: text });
  await page.locator('.composer-input textarea').fill(text);
  await page.locator('.composer-input textarea').press('Enter');
}
async function run(name, text, { rejectFirst = false, picker = false } = {}) {
  const start = Date.now();
  await prompt(name, text);
  let credentialCount = 0,
    codeCount = 0,
    pickerCount = 0;
  const handled = new Set();
  let done = false;
  while (Date.now() - start < 240000) {
    const signed = fixtureEvents.find(
      (e) => e.event === 'fixture.signed_in' && e.name === name && e.at > start,
    );
    if (signed) {
      emit('scenario.website_complete', { name, ms: signed.at - start });
      done = true;
      break;
    }
    for (const req of requestViews.values()) {
      if (
        req.origin !== 'https://' + ready.hosts[name] ||
        req.status !== 'pending' ||
        handled.has(req.id)
      )
        continue;
      const card = page
        .getByRole('region', { name: 'Secure entry' })
        .filter({ hasText: ready.hosts[name] })
        .filter({ has: page.locator('form') })
        .last();
      if (!(await card.count())) continue;
      try {
        if (req.chooseAccount) {
          if (
            !picker ||
            !(await card
              .getByRole('button', { name: 'Continue', exact: true })
              .isVisible())
          )
            continue;
          await card
            .getByRole('radio', { name: 'Latency Work', exact: true })
            .check();
          handled.add(req.id);
          emit('ui.picker_ready', { name });
          await card
            .getByRole('button', { name: 'Continue', exact: true })
            .click({ timeout: 3000 });
          await until(() => submittedIds.has(req.id), 3000);
          pickerCount++;
        } else if (req.kind === 'code') {
          if (!(await card.getByLabel(/^Code/).isVisible())) continue;
          await card.getByLabel(/^Code/).fill('731946');
          handled.add(req.id);
          emit('ui.code_ready', { name, codeCount: codeCount + 1 });
          await card
            .getByRole('button', { name: 'Fill code', exact: true })
            .click({ timeout: 3000 });
          await until(() => submittedIds.has(req.id), 3000);
          codeCount++;
        } else {
          if (!(await card.getByLabel(/^Username/).isVisible())) continue;
          const next = credentialCount + 1;
          await card.getByLabel(/^Username/).fill(name + '@example.invalid');
          await card
            .getByLabel(/^Password/)
            .fill(
              rejectFirst && next === 1
                ? 'Intentionally-wrong-dummy-password'
                : 'Latency-only-dummy-password!',
            );
          await card
            .getByLabel(/^Label/)
            .fill('Latency ' + name + (next > 1 ? ' corrected' : ''));
          if (
            next > 1 &&
            (await card.getByLabel('Save to', { exact: true }).count())
          ) {
            await card.getByLabel('Save to', { exact: true }).click();
            await page
              .getByRole('option', { name: 'Latency ' + name, exact: true })
              .click();
          }
          await card
            .getByRole('checkbox', { name: 'Keep me signed in' })
            .check();
          handled.add(req.id);
          emit('ui.credentials_ready', { name, credentialCount: next });
          await card
            .getByRole('button', { name: 'Save login', exact: true })
            .click({ timeout: 3000 });
          await until(() => submittedIds.has(req.id), 3000);
          credentialCount++;
        }
      } catch (e) {
        if (!submittedIds.has(req.id)) handled.delete(req.id);
        emit('driver.retry', { name, error: e.message.split('\n')[0] });
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  emit('scenario.end', {
    name,
    ok: done,
    ms: Date.now() - start,
    credentialCount,
    codeCount,
    pickerCount,
  });
  // Give the agent time to verify success and report completion before the next Main request.
  if (!done)
    throw new Error('Synthetic login did not reach its authenticated page');
  if (
    (name === 'apple' && (credentialCount !== 1 || codeCount !== 1)) ||
    (rejectFirst && credentialCount !== 2) ||
    (picker && pickerCount !== 1)
  )
    throw new Error('Synthetic login skipped an expected private interaction');
  await new Promise((r) => setTimeout(r, 10000));
  return done;
}
try {
  await run(
    'apple',
    `Let’s login to the Apple-style test store https://${ready.hosts.apple}/login`,
  );
  await run(
    'amazon',
    `Try signing into the Amazon-style test store https://${ready.hosts.amazon}/login`,
    { rejectFirst: true },
  );
  daemon.stdin.write(JSON.stringify({ action: 'seed' }) + '\n');
  const seeded = await until(() =>
    fixtureEvents.find((e) => e.event === 'fixture.seed_complete'),
  );
  if (seeded.matchingAccounts !== 2)
    throw new Error('Fixture accounts were not both visible');
  await run(
    'futbin',
    `Try signing into the football test site https://${ready.hosts.futbin}/login`,
    { picker: true },
  );
  emit('run.complete');
} catch (e) {
  emit('run.error', { name: active, error: e.message });
  process.exitCode = 1;
} finally {
  writeFileSync(
    dir + '/driver-summary.json',
    JSON.stringify({ tag, hosts: ready.hosts, events }, null, 2),
  );
  for (const req of requestViews.values()) {
    if (
      !Object.values(ready.hosts).some(
        (host) => req.origin === 'https://' + host,
      )
    )
      continue;
    const response = await page.request
      .get('http://127.0.0.1:14173/api/login/requests/' + req.id)
      .catch(() => null);
    const current = await response?.json().catch(() => null);
    if (current && ['pending', 'updating', 'failed'].includes(current.status))
      await page.request
        .post('http://127.0.0.1:14173/api/login/requests/' + req.id + '/cancel')
        .catch(() => {});
  }
  await browser.close();
  // Remove exact-host fixtures after all cases, including failed runs.
  emit('run.cleanup');
  daemon.stdin.write(JSON.stringify({ action: 'cleanup' }) + '\n');
  await until(
    () => fixtureEvents.some((e) => e.event === 'fixtures.closed'),
    30000,
  ).catch(() => {});
  daemon.kill();
}
