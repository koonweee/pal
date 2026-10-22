import assert from 'node:assert/strict';
import { smokeExecution, fixtureServer } from './smoke-execution.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const { X11Computer } = await import('../dist/agent/x11-computer.js');
const remote = await smokeExecution();
const { execution, exec: execFileSync } = remote;
const computer = new X11Computer(execution);
const directory = '/home/pal/tmp/desktop-smoke-' + randomUUID();
await execution.filesystem.mkdir(directory, { recursive: true });
let browser, main, pool, schema;
let browserErrors = '';
const events = [];
let ready = false;
const token = 'PAL-' + randomUUID().slice(0, 8);
const html = `<!doctype html><title>PAL desktop smoke</title>
<style>body{margin:0;background:#fff;color:#111;font:24px sans-serif}
button{position:absolute;left:100px;top:80px;width:250px;height:80px;font:24px sans-serif}
textarea{position:absolute;left:100px;top:200px;width:600px;height:130px;font:24px sans-serif}
#drag{position:absolute;left:100px;top:400px;width:500px;height:100px;background:#aef}
#scroll{position:absolute;left:800px;top:100px;width:250px;height:350px;overflow:auto;background:#eee}
</style><h1 style="margin:0;font-size:28px">Visible code: REPLACE_TOKEN</h1>
<button id="button">Confirm</button><textarea id="text" aria-label="Message"></textarea>
<div id="drag">Drag here</div><div id="scroll"><div style="height:2000px">Scroll here</div></div>
<script>
const send=(type,data={})=>fetch('/event',{method:'POST',body:JSON.stringify({type,...data})});
const text=document.querySelector('#text'), button=document.querySelector('#button');
button.onclick=()=>send('click',{value:text.value});
button.ondblclick=()=>send('double');
button.oncontextmenu=e=>{e.preventDefault();send('right')};
text.oninput=()=>send('text',{value:text.value});
text.onkeydown=e=>{if(e.ctrlKey && e.key==='s'){e.preventDefault();send('chord')}};
let down=false;
document.querySelector('#drag').onpointerdown=()=>{down=true};
document.onpointerup=()=>{if(down){down=false;send('drag')}};
document.querySelector('#scroll').onscroll=e=>send('scroll',{top:e.target.scrollTop});
send('ready');
</script>`;
const fixture = await fixtureServer(
  remote,
  async (request, response) => {
    if (request.url === '/event') {
      let input = '';
      for await (const chunk of request) input += chunk;
      const event = JSON.parse(input);
      events.push(event);
      if (event.type === 'ready') ready = true;
      response.end('ok');
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html.replace('REPLACE_TOKEN', token));
    }
  },
  { html, token },
  (kind, event) => {
    events.push(event);
    if (event.type === 'ready') ready = true;
  },
);
const until = async (fn, message, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(message);
    await delay(50);
  }
};
const count = (type) => events.filter((event) => event.type === type).length;
const deadline = setTimeout(() => {
  console.error('Desktop smoke exceeded 180 seconds');
  process.exit(1);
}, 180000);
try {
  const port = new URL(fixture.origin).port;
  await until(async () => {
    try {
      await computer.getScreenSize();
      return (
        await execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'])
      )
        .toString()
        .includes('window id');
    } catch {
      return false;
    }
  }, 'Desktop did not become ready');
  browser = await remote.start(
    'chromium',
    [
      '--no-first-run',
      '--disable-session-crashed-bubble',
      '--user-data-dir=' + directory,
      '--start-fullscreen',
      'http://127.0.0.1:' + port,
    ],
    {
      onStderr(chunk) {
        browserErrors = (browserErrors + chunk).slice(-5000);
      },
    },
  );
  await until(() => {
    return ready;
  }, 'Chromium did not load the desktop fixture: ' + browserErrors);
  await until(async () => {
    try {
      const win = (
        await execFileSync(
          'xdotool',
          ['search', '--onlyvisible', '--name', '^PAL desktop smoke'],
          { timeout: 1000 },
        )
      )
        .toString()
        .trim()
        .split('\n')
        .at(-1);
      if (!win) return false;
      await execFileSync('xdotool', ['windowactivate', '--sync', win], {
        timeout: 1000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }, 'Chromium fixture window did not become available');
  await delay(500);
  assert.deepEqual(await computer.getScreenSize(), {
    width: 1200,
    height: 900,
  });
  const screenshot = await computer.screenshot();
  assert.equal(screenshot.mediaType, 'image/png');
  assert.equal(screenshot.data.subarray(1, 4).toString(), 'PNG');
  assert.equal(screenshot.data.readUInt32BE(16), 1200);
  assert.equal(screenshot.data.readUInt32BE(20), 900);
  assert.equal(await computer.streamUrl(), null);
  await computer.moveMouse(350, 350);
  assert.deepEqual(await computer.getCursorPosition(), { x: 350, y: 350 });
  await computer.leftClick(200, 120);
  await until(() => count('click') >= 1, 'Left click failed');
  await computer.doubleClick(200, 120);
  await until(() => count('double') >= 1, 'Double click failed');
  await computer.rightClick(200, 120);
  await until(() => count('right') >= 1, 'Right click failed');
  await computer.drag({ x: 150, y: 440 }, { x: 550, y: 440 });
  await until(() => count('drag') >= 1, 'Drag failed');
  await computer.moveMouse(900, 250);
  await computer.scroll('down', 4);
  await until(
    () => events.some((event) => event.type === 'scroll' && event.top > 0),
    'Scroll down failed',
  );
  await computer.scroll('up', 4);
  await until(
    () => events.filter((event) => event.type === 'scroll').at(-1)?.top === 0,
    'Scroll up failed',
  );
  await computer.leftClick(200, 240);
  const literal =
    'café 中文 😀 \' " $(false) ' +
    String.fromCharCode(96) +
    'false' +
    String.fromCharCode(96) +
    '\nsecond line';
  await computer.type(literal);
  await until(
    () =>
      events.filter((event) => event.type === 'text').at(-1)?.value === literal,
    'Literal/Unicode typing failed',
  );
  await computer.press(['ctrl', 's']);
  await until(() => count('chord') > 0, 'Modifier chord failed');
  await computer.press(['ctrl', 'a']);
  await computer.press('BackSpace');
  await until(
    () => events.filter((event) => event.type === 'text').at(-1)?.value === '',
    'Selection/delete failed',
  );
  await assert.rejects(
    new X11Computer({
      output: (command, args, options) =>
        execution.output('env', ['DISPLAY=:99', command, ...args], options),
    }).screenshot(),
  );
  assert.deepEqual(await computer.getScreenSize(), {
    width: 1200,
    height: 900,
  });
  console.log(
    'PASS: all computer methods, PNG, literal/Unicode typing, chords, and unavailable-display error',
  );

  if (process.argv.includes('--agent')) {
    const { default: pg } = await import('pg');
    const { Pool } = pg;
    const { createMainSession } = await import('../dist/agent/main-session.js');
    const { chatgptModel } = await import('../dist/agent/chatgpt-model.js');
    const url = new URL(process.env.TEST_DATABASE_URL);
    pool = new Pool({ connectionString: url.toString() });
    schema = 'pal_desktop_' + randomUUID().replaceAll('-', '');
    const publications = [],
      toolNames = [];
    main = await createMainSession({
      connectionString: url.toString(),
      schemaName: schema,
      workingDirectory: directory,
      sandbox: execution.sandbox,
      filesystem: execution.filesystem,
      computer,
      model: chatgptModel(
        process.env.PAL_AGENT_MODEL ?? 'gpt-6.1-sol',
        process.env.PAL_AGENT_AUTH_PATH,
        process.env.PAL_AGENT_THINKING_EFFORT ?? 'medium',
      ),
      memoryOptions: {
        lastMessages: 20,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      publish: async (text) => {
        publications.push(text);
      },
      onEvent: (event) => {
        if (event.type === 'tool_start') toolNames.push(event.toolName);
      },
    });
    const before = events.length;
    await main.session.sendMessage({
      content:
        'Use only computer tools for this validation. Take a screenshot of the open Chromium page, read the visible code, type that exact code into the Message text box, click Confirm, then report the code. Do not read files, run shell commands, or inspect page source.',
    });
    assert.ok(
      events
        .slice(before)
        .some((event) => event.type === 'click' && event.value === token),
      'Model did not complete the visual task',
    );
    assert.ok(
      publications.join(' ').includes(token),
      'Model did not report the observed code',
    );
    assert.ok(toolNames.includes('mastra_workspace_computer_screenshot'));
    assert.ok(
      toolNames.every((name) => name.startsWith('mastra_workspace_computer_')),
      'Model used a non-computer tool',
    );
    console.log(
      'PASS: real model observed a random code in a screenshot and used native computer tools to submit it',
    );
  }
} finally {
  await main?.close();
  if (pool) {
    await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await pool.end();
  }
  await execution
    .output('pkill', ['-f', '--', '--user-data-dir=' + directory])
    .catch(() => {});
  await browser?.wait();
  await fixture.close();
  await execution.filesystem.rmdir(directory, {
    recursive: true,
    force: true,
  });
  await execution.sandbox._stop();
  clearTimeout(deadline);
}
