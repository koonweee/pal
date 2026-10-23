import { chromium } from '/opt/pal/node_modules/playwright-core/index.mjs';
import { createInterface } from 'node:readline';
const tag = process.argv[2];
const hosts = Object.fromEntries(
  ['apple', 'amazon', 'futbin'].map((name) => [
    name,
    `pal-latency-${name}-${tag}.example.test`,
  ]),
);
const password = 'Latency-only-dummy-password!';
const marker = 'pal-latency-fixture:' + tag;
function emit(event, data = {}) {
  console.log(JSON.stringify({ at: Date.now(), event, ...data }));
}
const endpoint = process.env.PAL_BROWSER_ENDPOINT;
const version = await (await fetch(endpoint + '/json/version')).json();
const path = new URL(version.webSocketDebuggerUrl).pathname;
const browser = await chromium.connectOverCDP(
  endpoint.replace(/^http/, 'ws') + path,
  { noDefaults: true },
);
const context = browser.contexts()[0];
const states = Object.fromEntries(
  Object.keys(hosts).map((name) => [name, { signedIn: false, rejections: 0 }]),
);
const escape = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const input = (id, label, type, auto) =>
  `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" autocomplete="${auto}" required>`;
function html(name, stage) {
  const brand = {
    apple: 'Orchard Store',
    amazon: 'River Market',
    futbin: 'Football Hub',
  }[name];
  let content = '';
  if (stage === 'account')
    content =
      '<h1>Your account</h1><p>You are signed in.</p><a href="/signout">Sign out</a>';
  else if (stage === 'trust')
    content =
      '<h1>Trust this browser?</h1><p>You will not need a verification code as often.</p><button data-next="trust">Trust</button><button data-next="skip">Not now</button>';
  else if (stage === 'verify')
    content =
      '<h1>Two-factor authentication</h1><p>Enter the six-digit verification code.</p><form>' +
      Array.from(
        { length: 6 },
        (_, i) =>
          `<label class="digit">Digit ${i + 1}<input name="digit${i}" type="tel" inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" required></label>`,
      ).join('') +
      '<button>Continue</button></form>';
  else if (stage === 'password')
    content =
      '<h1>Enter your password</h1><form>' +
      input('password', 'Password', 'password', 'current-password') +
      (name === 'amazon'
        ? '<label><input type="checkbox" name="remember">Keep me signed in</label>'
        : '') +
      '<p role="alert" id="error"></p><button>Sign in</button></form>';
  else if (name === 'futbin')
    content =
      '<h1>Sign in</h1><form>' +
      input('username', 'Email address', 'email', 'username') +
      input('password', 'Password', 'password', 'current-password') +
      '<label><input type="checkbox" name="remember">Remember me</label><p role="alert" id="error"></p><button>Log in</button></form>';
  else
    content =
      '<h1>Sign in</h1><form>' +
      input(
        'username',
        name === 'apple' ? 'Apple Account' : 'Email or mobile phone number',
        'text',
        'username',
      ) +
      '<button>Continue</button></form>';
  return `<!doctype html><html><head><title>${brand} — ${stage}</title><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;margin:0;background:#f5f5f7;color:#202124}header{padding:20px 40px;border-bottom:1px solid #ddd;background:white}main{max-width:420px;margin:70px auto;padding:32px;background:white;border-radius:12px}h1{font-size:26px}label{display:block;margin:16px 0 6px}input:not([type=checkbox]){font:18px system-ui;box-sizing:border-box;padding:12px;width:100%;border:1px solid #aaa;border-radius:6px}button{font:16px system-ui;padding:12px 18px;margin:20px 8px 0 0;cursor:pointer}.digit{display:inline-block;width:48px;margin-right:8px}.digit input{width:48px!important;padding:8px!important}#error{color:#b91c1c}</style></head><body><header>${brand}</header><main>${content}</main><script>
 const trace=(milestone)=>fetch('/trace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({milestone,stage:${JSON.stringify(stage)},browserAt:Date.now()}),keepalive:true});
 document.addEventListener('DOMContentLoaded',()=>trace('dom_content_loaded'));
 window.addEventListener('load',()=>trace('load'));
 const send=async values=>{trace('submit_handler');const r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stage:${JSON.stringify(stage)},...values})});const v=await r.json();trace('submit_response');if(v.error){document.getElementById('error').textContent=v.error}else location.href=v.next;};
 document.querySelector('form')?.addEventListener('submit',e=>{e.preventDefault();send(Object.fromEntries(new FormData(e.target)))});
 document.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>send({choice:b.dataset.next}));
 document.querySelectorAll('.digit input').forEach((el,i,all)=>el.addEventListener('input',()=>{if(el.value&&all[i+1])all[i+1].focus()}));
 </script></body></html>`;
}
const handler = async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  const name = Object.keys(hosts).find((k) => hosts[k] === url.hostname);
  const s = states[name];
  if (url.pathname === '/trace') {
    const body = request.postDataJSON();
    if (
      [
        'dom_content_loaded',
        'load',
        'submit_handler',
        'submit_response',
      ].includes(body.milestone)
    )
      emit('fixture.browser', {
        name,
        stage: body.stage,
        milestone: body.milestone,
        browserAt: body.browserAt,
      });
    return route.fulfill({ status: 204 });
  }
  if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
  if (url.pathname === '/submit') {
    const body = request.postDataJSON();
    let next = '/account',
      error;
    if (body.stage === 'username') next = '/password';
    else if (body.stage === 'password' || body.stage === 'combined') {
      const valid = body.password === password;
      emit('fixture.password_submitted', {
        name,
        valid,
        remember: body.remember === 'on',
      });
      if (!valid) {
        s.rejections++;
        error = 'The password you entered is incorrect. Please try again.';
      } else if (name === 'apple') next = '/verify';
      else s.signedIn = true;
    } else if (body.stage === 'verify') {
      const valid =
        Array.from({ length: 6 }, (_, i) => body['digit' + i] ?? '').join(
          '',
        ) === '731946';
      emit('fixture.code_submitted', { name, valid });
      if (valid) next = '/trust';
      else error = 'The verification code is incorrect.';
    } else if (body.stage === 'trust') {
      s.signedIn = true;
      emit('fixture.trust_selected', { name, choice: body.choice });
    }
    return route.fulfill({ json: { ...(error ? { error } : { next }) } });
  }
  if (url.pathname === '/signout') {
    s.signedIn = false;
    emit('fixture.signed_out', { name });
    return route.fulfill({
      status: 302,
      headers: { location: '/login' },
      body: '',
    });
  }
  let stage = url.pathname.slice(1);
  if (!['password', 'verify', 'trust', 'account'].includes(stage))
    stage = s.signedIn
      ? 'account'
      : name === 'futbin'
        ? 'combined'
        : 'username';
  if (stage === 'account' && !s.signedIn)
    return route.fulfill({
      status: 302,
      headers: { location: '/login' },
      body: '',
    });
  if (stage === 'account') emit('fixture.signed_in', { name });
  emit('fixture.page', { name, stage });
  return route.fulfill({ contentType: 'text/html', body: html(name, stage) });
};
const predicate = (url) => Object.values(hosts).includes(url.hostname);
await context.route(predicate, handler);
async function bw(path, method = 'GET', body) {
  const r = await fetch('http://127.0.0.1:8087' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok || !v.success) throw new Error('Synthetic vault operation failed');
  return v.data;
}
emit('fixtures.ready', { hosts });
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const cmd = JSON.parse(line);
    if (cmd.action === 'seed') {
      for (const label of ['Personal', 'Work']) {
        await bw(
          '/list/object/items?url=' +
            encodeURIComponent('https://' + hosts.futbin),
        );
        const item = await bw('/object/item', 'POST', {
          type: 1,
          name: 'Latency ' + label,
          notes: marker,
          login: {
            username: label.toLowerCase() + '@example.invalid',
            password,
            uris: [{ uri: 'https://' + hosts.futbin, match: 1 }],
          },
        });
        emit('fixture.seeded', { accountId: item.id, label });
      }
      let count = 0;
      for (let i = 0; i < 20; i++) {
        count = (
          await bw(
            '/list/object/items?url=' +
              encodeURIComponent('https://' + hosts.futbin + '/login'),
          )
        ).data.length;
        if (count === 2) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      emit('fixture.seed_complete', { matchingAccounts: count });
    } else if (cmd.action === 'cleanup') {
      const items = (await bw('/list/object/items')).data;
      for (const item of items) {
        if (
          !item.login?.uris?.some((u) => {
            try {
              return Object.values(hosts).includes(new URL(u.uri).hostname);
            } catch {
              return false;
            }
          })
        )
          continue;
        await bw('/object/item/' + encodeURIComponent(item.id), 'DELETE');
        emit('fixture.vault_deleted', { accountId: item.id });
      }
      await context.unroute(predicate, handler);
      await browser.close();
      emit('fixtures.closed');
      process.exit(0);
    }
  } catch (e) {
    emit('fixture.control_error', { error: e.message });
  }
}
