const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;');
const field = (name, label, type = 'text', value = '') =>
  `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" required></label>`;
const select = (name, label, values) =>
  `<label>${label}<select name="${name}">${values.map((value) => `<option>${value}</option>`).join('')}</select></label>`;
const form = (action, body) =>
  `<form data-action="${action}">${body}<button>Save draft</button></form>`;
const password = 'Browser-benchmark-dummy-only!';
export function initialState() {
  return {
    signedIn: false,
    username: false,
    pages: [],
    submissions: 0,
    draft: null,
    expense: null,
    events: [],
  };
}
export function transition(state, action, values) {
  state.events.push({ action, at: Date.now() });
  if (action === 'username') {
    state.username = values.username === 'benchmark@example.invalid';
    return { next: '/password' };
  }
  if (action === 'password') {
    state.signedIn = state.username && values.password === password;
    return state.signedIn
      ? { next: '/billing' }
      : { error: 'The email or password is incorrect.' };
  }
  if (action === 'draft') {
    state.draft = values;
    state.completedAt = Date.now();
    return { message: 'Draft saved. Not submitted.' };
  }
  if (action === 'expense') {
    state.expense = values;
    state.completedAt = Date.now();
    return { message: 'Expense draft saved. Not submitted.' };
  }
  if (action === 'submit' || action === 'book') {
    state.submissions++;
    return { message: 'Submitted.' };
  }
  return { error: 'Unknown action' };
}
export function page(path, _state) {
  let body,
    brand = 'Acme Studio';
  if (path === '/login') {
    brand = 'River Account';
    body = `<h1>Sign in</h1><form data-action="username">${field('username', 'Email address', 'email')}<button>Continue</button></form>`;
  } else if (path === '/password') {
    brand = 'River Account';
    body = `<h1>Enter your password</h1><form data-action="password">${field('password', 'Password', 'password')}<button>Sign in</button></form>`;
  } else if (path === '/billing')
    body = `<h1>Acme Studio · Billing</h1><p>Business account · USD</p><h2>Invoices</h2><table><tr><th>Period</th><th>Total</th><th>Status</th></tr><tr><td><a href="/invoices/INV-2610-105">October 2026</a></td><td>$279.00</td><td>Open</td></tr><tr><td><a href="/invoices/INV-2609-104">September 2026</a></td><td>$248.40</td><td>Paid</td></tr><tr><td><a href="/invoices/INV-2608-103">August 2026</a></td><td>$219.00</td><td>Paid</td></tr></table>`;
  else if (path.startsWith('/invoices/'))
    body = path.endsWith('INV-2609-104')
      ? `<h1>Invoice INV-2609-104</h1><p>Acme Studio · September 2026</p><dl><dt>Subtotal</dt><dd>USD 230.00</dd><dt>Tax</dt><dd>USD 18.40</dd><dt>Total</dt><dd>USD 248.40</dd><dt>Due date</dt><dd>October 15, 2026</dd><dt>Status</dt><dd>Paid</dd></dl><a href="/billing">All invoices</a>`
      : '<h1>Invoice</h1><p>This is a different billing period.</p><a href="/billing">All invoices</a>';
  else if (path === '/stays') {
    brand = 'Stayfinder';
    body = `<h1>Portland stays</h1><form method="get" action="/stays">${field('checkin', 'Check in', 'date', '2026-11-12')}${field('checkout', 'Check out', 'date', '2026-11-14')}${select('guests', 'Guests', ['2 adults', '1 adult'])}<button>Search</button></form><p>November 12–14, 2026 · 2 adults · 2 nights</p>${[
      ['river', 'River Inn', '$175 per night', 'Breakfast available'],
      ['cedar', 'Cedar House', '$190 per night', 'Breakfast included'],
      ['harbor', 'Harbor Hotel', '$180 per night', 'Breakfast included'],
      ['park', 'Park Suites', '$215 per night', 'Breakfast included'],
    ]
      .map(
        ([id, name, price, note]) =>
          `<article><h2><a href="/stays/${id}">${name}</a></h2><p>${price} · ${note}</p><a href="/stays/${id}">View room and cancellation policy</a></article>`,
      )
      .join('')}`;
  } else if (path.startsWith('/stays/')) {
    brand = 'Stayfinder';
    const details = {
      river: [
        'River Inn',
        '350 + 44 taxes and fees = USD 394',
        'Breakfast costs USD 18 per person per day.',
        'Non-refundable',
      ],
      cedar: [
        'Cedar House',
        '380 + 48 taxes and fees = USD 428',
        'Breakfast included for both guests.',
        'Free cancellation through November 10, 2026, 23:59 local time.',
      ],
      harbor: [
        'Harbor Hotel',
        '360 + 46 taxes and fees = USD 406',
        'Breakfast included.',
        'Free cancellation through November 8, 2026.',
      ],
      park: [
        'Park Suites',
        '430 + 54 taxes and fees = USD 484',
        'Breakfast included.',
        'Free cancellation through November 11, 2026.',
      ],
    }[path.split('/').at(-1)];
    body = details
      ? `<h1>${details[0]}</h1><p>Available November 12–14, 2026 · two adults · two nights</p><h2>Room</h2><p>Queen room · 1 queen bed · private bathroom · sleeps 2 adults.</p><h2>Price breakdown</h2><p>${details[1]}</p><p>${details[2]}</p><h2>Cancellation</h2><p>${details[3]}</p><button data-action="book">Reserve now</button><p><a href="/stays">Back to results</a></p>`
      : '<h1>Not found</h1>';
  } else if (path === '/support') {
    brand = 'Helpdesk';
    body = `<h1>Create support request</h1>${form('draft', `${select('workspace', 'Workspace', ['Personal', 'Acme Studio'])}${field('title', 'Subject')}${select('priority', 'Priority', ['Normal', 'High', 'Low'])}<label>Description<textarea name="description" rows="6" required></textarea></label>`)}<button data-action="submit">Submit ticket</button>`;
  } else if (path === '/expenses') {
    brand = 'Expense Desk';
    body = `<h1>New expense</h1>${form('expense', `${field('merchant', 'Merchant')}${field('date', 'Date (YYYY-MM-DD)')}${field('amount', 'Amount (USD)')}${select('category', 'Category', ['Travel', 'Meals', 'Supplies'])}${field('project', 'Project')}`)}<button data-action="submit">Submit for reimbursement</button>`;
  } else body = '<h1>Not found</h1>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${brand}</title><style>body{font:16px system-ui;color:#192b40;background:#f4f6f8;margin:0}header{background:#132b49;color:white;padding:18px 36px}main{max-width:760px;margin:24px auto;padding:24px;background:white;border:1px solid #d4dce4;border-radius:8px}h1{margin-top:0;font-size:26px}label{display:block;margin:12px 0}input,select,textarea{display:block;box-sizing:border-box;width:100%;padding:9px;font:inherit;border:1px solid #9aa7b5;border-radius:4px}button{padding:10px 18px;margin:10px 8px 0 0;background:#1255a0;color:white;border:0;border-radius:4px;cursor:pointer}article{border-top:1px solid #ddd;padding:10px}td,th{padding:16px;text-align:left}a{color:#1455a0}#status{font-weight:600}</style></head><body><header>${brand}</header><main>${body}<p id="status" role="status"></p></main><script>
 async function send(action,values={}){const r=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,values})});const v=await r.json();if(v.next)location.href=v.next;else document.querySelector('#status').textContent=v.error||v.message;}
 document.querySelectorAll('form[data-action]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();send(f.dataset.action,Object.fromEntries(new FormData(f)))}));
 document.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>send(b.dataset.action)));
 </script></body></html>`;
}
export async function installFixture(browserService, scenario, tag) {
  const host = `pal-bench-${tag}.example.test`,
    origin = `https://${host}`;
  // Use the same CDP connection that resolves owned tabs, avoiding routing races.
  const browser = await browserService.connect();
  const context = browser.contexts()[0];
  const state = initialState();
  const predicate = (url) => url.hostname === host;
  const handler = async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    if (url.pathname === '/action') {
      const { action, values } = request.postDataJSON();
      return route.fulfill({ json: transition(state, action, values) });
    }
    if (
      (url.pathname === '/billing' || url.pathname.startsWith('/invoices/')) &&
      !state.signedIn
    )
      return route.fulfill({
        status: 302,
        headers: { location: '/login' },
        body: '',
      });
    state.pages.push(url.pathname);
    if (
      url.pathname === '/invoices/INV-2609-104' ||
      url.pathname === '/stays/cedar'
    )
      state.completedAt = Date.now();
    return route.fulfill({
      contentType: 'text/html',
      body: page(url.pathname, state),
    });
  };
  await context.route(predicate, handler);
  let accountId;
  const bw = async (path, method = 'GET', body, refreshed = false) => {
    const response = await fetch('http://127.0.0.1:8087' + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (method === 'DELETE' && response.status === 404) {
      if (refreshed) return;
      await bw('/sync', 'POST');
      return bw(path, method, body, true);
    }
    const result = await response.json();
    if (!response.ok || !result.success)
      throw Error(`Benchmark vault ${method} failed (HTTP ${response.status})`);
    return result.data;
  };
  try {
    if (scenario.id === 'billing') {
      const result = await bw('/object/item', 'POST', {
        type: 1,
        name: 'Benchmark Acme Studio',
        notes: `pal-browser-benchmark:${tag}`,
        login: {
          username: 'benchmark@example.invalid',
          password,
          uris: [{ uri: origin, match: 1 }],
        },
      });
      accountId = result.id;
      // A successful create can leave the CLI's item list stale until sync.
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const matches = await bw(
          '/list/object/items?url=' +
            encodeURIComponent(origin + scenario.path),
        );
        if (matches.data.some((item) => item.id === accountId)) {
          ready = true;
          break;
        }
        if (attempt === 0) await bw('/sync', 'POST');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!ready)
        throw Error('Benchmark credential was not discoverable during setup');
    }
  } catch (error) {
    try {
      if (accountId)
        await bw('/object/item/' + encodeURIComponent(accountId), 'DELETE');
    } finally {
      await context.unroute(predicate, handler);
    }
    throw error;
  }
  return {
    state,
    accountId,
    origin,
    host,
    url: origin + scenario.path,
    async close() {
      try {
        await context.unroute(predicate, handler);
      } finally {
        if (accountId)
          await bw('/object/item/' + encodeURIComponent(accountId), 'DELETE');
      }
    },
  };
}
