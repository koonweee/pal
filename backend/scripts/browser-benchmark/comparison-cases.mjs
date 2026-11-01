// Protocol, fixture state and scoring contain no model or Docker dependencies.
export const arms = ['browser', 'computer', 'android'];
export const comparisonSecrets = {
  username: 'pal-user-É漢字',
  password: 'pal-password-É漢字!72',
  code: '936721',
};
export const draftReference = 'PAL-DRAFT-42';
export const comparisonCases = [
  {
    id: 'staged-login',
    kind: 'synthetic',
    path: '/login',
    comparison: true,
    prompt:
      'Sign in through the username, password and verification-code stages using Pal private entry for each missing stage. After authentication, save exactly one draft with reference PAL-DRAFT-42. Verify the saved draft and authenticated destination.',
  },
  {
    id: 'amazon-order',
    kind: 'live',
    url: 'https://www.amazon.com/gp/your-account/order-history',
    packageName: 'com.amazon.mShop.android.shopping',
    login: true,
    prompt:
      'Sign in with the matching saved Amazon account using Pal secure filling. Find the most recent order and report only its order date, first item name and delivery/status. Do not show addresses, payment information or full order IDs. Do not place, cancel or change orders.',
  },
  {
    id: 'amazon-products',
    kind: 'live',
    url: 'https://www.amazon.com/',
    packageName: 'com.amazon.mShop.android.shopping',
    prompt:
      'Compare the Sony WH-1000XM5 headphones in Black and Bose QuietComfort Headphones in Black on Amazon. Report the exact model/variant, current one-time purchase price, availability and product link for each. Use the current session and marketplace, ignore used/refurbished offers, and do not add anything to cart or check out.',
  },
  {
    id: 'facebook-event',
    kind: 'live',
    url: 'https://www.facebook.com/events/going',
    packageName: 'com.facebook.katana',
    login: true,
    prompt:
      'Sign in with the matching saved Facebook account using Pal secure filling. In Your Events, find the next upcoming event and report its name, date/time with timezone and location. If there are no upcoming events, verify and report that. Do not post, message, RSVP or change account settings.',
  },
  {
    id: 'apple-store',
    kind: 'live',
    url: 'https://www.apple.com/shop/account/home',
    login: true,
    assisted: true,
    prompt:
      'Sign in to the agreed Apple Store website using Pal secure entry. Yield for private input or account challenges. Verify account access by reaching the account destination and report only whether account access is available. Make no purchases or account changes.',
  },
];
export function comparisonSchedule({
  phase = 'main',
  cases,
  repetitions = 3,
  assistedJobs,
  variants = arms,
}) {
  if (
    !['smoke', 'main', 'assisted', 'diagnostic'].includes(phase) ||
    !Number.isInteger(repetitions) ||
    repetitions < 1
  )
    throw Error('Invalid comparison schedule');
  if (assistedJobs) {
    if (
      phase !== 'assisted' ||
      new Set(assistedJobs.map((j) => j.key)).size !== assistedJobs.length
    )
      throw Error('Invalid assisted manifest');
    return assistedJobs.map((job) => {
      const scenario = comparisonCases.find((c) => c.id === job.case);
      if (
        !scenario ||
        scenario.kind !== 'live' ||
        !arms.includes(job.arm) ||
        (scenario.assisted && job.arm === 'android')
      )
        throw Error('Invalid assisted case');
      return { ...job, scenario };
    });
  }
  const selected =
    cases ??
    comparisonCases
      .filter((c) => Boolean(c.assisted) === (phase === 'assisted'))
      .map((c) => c.id);
  if (!selected.length || new Set(selected).size !== selected.length)
    throw Error('Choose distinct cases');
  const jobs = [];
  for (let round = 0; round < repetitions; round++)
    for (const id of selected) {
      let scenario = comparisonCases.find((c) => c.id === id);
      if (phase === 'diagnostic') {
        if (
          !['amazon-products', 'amazon-order'].includes(id) ||
          !variants.length ||
          variants.some((arm) => !arms.includes(arm))
        )
          throw Error('Invalid diagnostic retrieval');
        scenario = {
          ...scenario,
          login: false,
          prompt: scenario.prompt.replace(
            'Sign in with the matching saved Amazon account using Pal secure filling. ',
            'Use the existing signed-in session. If sign-in is required, report that blocker and stop. ',
          ),
        };
      }
      if (
        !scenario ||
        (phase !== 'assisted' && scenario.assisted) ||
        (phase === 'assisted' && scenario.kind !== 'live')
      )
        throw Error('Human-assisted cases require a separate assisted run');
      const methods =
        phase === 'diagnostic'
          ? variants
          : scenario.assisted
            ? arms.slice(0, 2)
            : arms;
      for (let index = 0; index < methods.length; index++) {
        const arm = methods[(index + round) % methods.length];
        jobs.push({
          key: `${phase}:${round}:${id}:${arm}`,
          arm,
          round,
          scenario,
        });
      }
    }
  return jobs;
}
export function comparisonState() {
  return {
    pages: [],
    stage: 0,
    roles: [],
    authenticated: false,
    saves: 0,
    draft: null,
  };
}
export function comparisonTransition(state, action, values) {
  if (action === 'next' && state.stage < 3) {
    const role = ['username', 'password', 'code'][state.stage];
    if (values[role] !== comparisonSecrets[role])
      return { error: 'Check private entry' };
    state.roles.push(role);
    state.stage++;
    state.authenticated = state.stage === 3;
    return { next: ['/login', '/password', '/code', '/account'][state.stage] };
  }
  if (action === 'draft' && state.authenticated) {
    state.saves++;
    state.draft = values.reference;
    state.completedAt = Date.now();
    return {
      message: 'Draft saved: ' + state.draft + '; saves: ' + state.saves,
    };
  }
  return { error: 'Unsupported action' };
}
export function comparisonPage(path, state) {
  const stage = ['/login', '/password', '/code'].indexOf(path),
    role = ['username', 'password', 'code'][stage];
  const body =
    stage >= 0
      ? `<h1>${['Username', 'Password', 'Verification code'][stage]}</h1><form data-action="next"><label>${['Email or username', 'Password', 'Verification code'][stage]}<input name="${role}" type="${stage === 1 ? 'password' : 'text'}" autocomplete="${['username', 'current-password', 'one-time-code'][stage]}" required></label><button>${stage === 2 ? 'Verify' : 'Continue'}</button></form>`
      : state.authenticated
        ? '<h1>Authenticated — Pal secure fixture</h1><p>Verified stages: username, password, transient code</p><form data-action="draft"><label>Draft reference<input name="reference" required></label><button>Save draft</button></form>'
        : '<h1>Sign in required</h1>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pal secure fixture</title><style>body{font:22px system-ui;padding:48px;max-width:760px}label,input{display:block}input,button{font:inherit;padding:14px;margin:16px 0}</style></head><body>${body}<p id="status" role="status">${state.authenticated && state.draft === draftReference ? 'Draft saved: PAL-DRAFT-42; saves: ' + state.saves : ''}</p><script>document.querySelector('form')?.addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:e.target.dataset.action,values:Object.fromEntries(new FormData(e.target))})});const v=await r.json();if(v.next)location.href=v.next;else document.querySelector('#status').textContent=v.message||v.error;});</script></body></html>`;
}
export function exposesComparisonSecret(value) {
  const text =
    JSON.stringify(value, (key, item) =>
      ['image', 'data'].includes(key) &&
      typeof item === 'string' &&
      item.length > 1024
        ? '[media]'
        : item,
    ) ?? '';
  return [
    ...Object.values(comparisonSecrets),
    'PRIVATE_READONLY_CHILD_CANARY',
  ].some((s) => text.includes(s));
}
export function comparisonScore({
  scenario,
  state,
  fillRoles = [],
  boundaryValid,
  privacyValid,
  answer,
  status,
}) {
  const checks = { boundary: boundaryValid, privacy: privacyValid };
  if (scenario.id === 'staged-login')
    Object.assign(checks, {
      authenticated: state?.authenticated === true,
      draft: state?.draft === draftReference,
      savedOnce: state?.saves === 1,
      actualFill: ['username', 'password', 'code'].every((role) =>
        fillRoles.includes(role),
      ),
      noDuplicateFill: fillRoles.join(',') === 'username,password,code',
    });
  else if (scenario.login)
    checks.actualFill = fillRoles.some((role) =>
      ['username', 'password'].includes(role),
    );
  const failed =
    status !== 'completed' ||
    Object.values(checks).some((value) => value !== true);
  return {
    checks,
    success: failed ? false : scenario.kind === 'live' ? null : true,
    reviewRequired: scenario.kind === 'live' && !failed && Boolean(answer),
  };
}
