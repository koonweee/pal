import { chromium } from 'playwright-core';
const endpoint = process.env.PAL_BROWSER_ENDPOINT;
const version = await (await fetch(endpoint + '/json/version')).json();
const ws = new URL(endpoint);
ws.protocol = 'ws:';
ws.pathname = new URL(version.webSocketDebuggerUrl).pathname;
const browser = await chromium.connectOverCDP(ws.href);
const context = browser.contexts()[0];
const url = 'http://127.0.0.1:18765/';
try {
  if (process.argv[2] === 'create') {
    const page = await context.newPage();
    await page.goto(url);
    console.log(JSON.stringify({ url, title: await page.title() }));
  } else if (process.argv[2] === 'close') {
    for (const page of context.pages())
      if (page.url() === url) await page.close();
  } else if (process.argv[2] === 'state') {
    const page = context.pages().find((p) => p.url() === url);
    if (!page) throw Error('Owned fixture tab missing');
    console.log(
      JSON.stringify(
        await page.evaluate(async () => (await fetch('/state')).json()),
      ),
    );
  }
} finally {
  await browser.close();
}
