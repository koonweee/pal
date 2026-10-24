import { delegationVariants } from './delegation.mjs';
export const variants = [
  { id: 'control', model: 'gpt-6.1-sol', effort: 'medium', delegated: false },
  ...['low', 'medium', 'high'].map((effort) => ({
    id: `sol-${effort}`,
    model: 'gpt-6.1-sol',
    effort,
    delegated: true,
  })),
  ...['low', 'high', 'xhigh'].map((effort) => ({
    id: `luna-${effort}`,
    model: 'gpt-6-luna',
    effort,
    delegated: true,
  })),
  ...['low', 'medium'].map((effort) => ({
    id: `astra-${effort}`,
    model: 'gpt-6-astra',
    effort,
    delegated: true,
  })),
];
export const allVariants = [...variants, ...delegationVariants];
export const cases = [
  {
    id: 'billing',
    kind: 'synthetic',
    inspiration: 'Stripe billing portal / Amazon staged login',
    path: '/login',
    constraints:
      'Use the Acme Studio business account, September 2026 invoice, USD. Do not change billing settings.',
    prompt:
      'Sign in using the saved benchmark account, find our September 2026 invoice, and report the invoice number, total, due date and payment status with a link. Use the account and period we agreed on.',
    expected: ['INV-2609-104', '248.40', 'October 15, 2026', 'Paid'],
    requiredPages: ['/invoices/INV-2609-104'],
  },
  {
    id: 'stays',
    kind: 'synthetic',
    inspiration: 'Booking.com / Airbnb search and room details',
    path: '/stays',
    constraints:
      'Two adults, November 12–14, 2026, two nights in Portland. Total including fees must be at most $450. Require free cancellation through November 10 and breakfast included. Do not book.',
    prompt:
      'Find the cheapest stay meeting all the trip constraints we agreed on. Check its room details and explain the total and cancellation deadline. Stop before booking.',
    expected: ['Cedar House', '428', 'November 10'],
    requiredPages: ['/stays/cedar'],
  },
  {
    id: 'support',
    kind: 'synthetic',
    inspiration: 'Zendesk / Linear support forms',
    path: '/support',
    constraints:
      'Acme Studio workspace. CSV exports fail with E42 in Chrome and Firefox since October 21. Affects all 12 teammates, blocks month-end reporting. Cache clearing and retry did not help. Save a high-priority draft only; do not submit.',
    prompt:
      'Prepare the support ticket using the troubleshooting details and urgency we agreed on. Save it as a draft and tell me its title and priority.',
    expected: ['high'],
    requiredPages: ['/support'],
    draft: true,
  },
  {
    id: 'desktop',
    kind: 'synthetic',
    inspiration: 'Expensify / SAP Concur expense entry',
    path: '/expenses',
    computer: true,
    constraints:
      'Expense: Northstar Cafe, October 20, 2026, USD 38.60, Meals, project Acme Launch. Save a draft; do not submit for reimbursement.',
    prompt:
      'Use screenshots and computer mouse/keyboard tools to enter the expense we discussed in the page already open. Save the draft and report the merchant and amount. Do not use DOM/browser automation, JavaScript or shell to operate this page.',
    expected: ['Northstar Cafe', '38.60'],
    requiredPages: ['/expenses'],
    expense: true,
  },
  {
    id: 'live-mdn',
    kind: 'live',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control',
    constraints:
      'Explain no-cache versus no-store and give the directive for a response that must not be stored. Use official MDN documentation and cite the exact page. Read-only browsing.',
    prompt:
      'Use the browser to check the documentation and answer the caching question we discussed. Include the distinction and recommendation.',
    expected: ['no-cache', 'no-store'],
    review:
      'Verify that no-cache allows storage but requires validation before reuse; no-store forbids storage. Check source support, clarity and recommendation.',
  },
  {
    id: 'live-wikipedia',
    kind: 'live',
    url: 'https://en.wikipedia.org/wiki/Golden_Gate_Bridge',
    constraints:
      'Find the opening date, total length in metres, and main span in metres for the Golden Gate Bridge. Cite the page. Distinguish total length from main span. Read-only browsing.',
    prompt:
      'Use the browser to find the three bridge facts we discussed and return them with a source link.',
    expected: ['1937', '2,737', '1,280'],
    review:
      'Check opening date May 27, 1937, total length 2,737 m and main span 1,280 m against the captured source. Alternative numeric formatting is acceptable.',
  },
];

// The same support objective with essential facts available only in a file.
export const supportBrief =
  'Acme Studio workspace. CSV exports fail with E42 in Chrome and Firefox since October 21, 2026. All 12 teammates are affected. Month-end reporting is blocked. Clearing cache and retrying did not help.';
cases.push({
  ...cases.find((c) => c.id === 'support'),
  id: 'support-file',
  attachment: true,
  constraints:
    'Prepare a high-priority support draft from the supplied local troubleshooting brief. Preserve all facts. Save only; do not submit.',
  prompt:
    'Read the supplied troubleshooting brief, prepare and save a high-priority support draft in the website, and report its title and priority. Preserve all facts from the brief. Do not submit.',
});

// Explicit synthetic history: the same bytes are supplied to both arms. It is
// meaningful project conversation, not a copy of a private user thread.
export function history(context, scenario) {
  const messages = [
    { role: 'user', content: `For this work: ${scenario.constraints}` },
    {
      role: 'assistant',
      content:
        'Understood. I will retain those requirements for the next operation.',
    },
  ];
  if (context === 'fresh') return messages;
  const topics = [
    'launch schedule',
    'venue shortlist',
    'supplier quotes',
    'accessibility review',
    'team onboarding',
    'support escalation',
    'release checklist',
    'budget reconciliation',
    'travel arrangements',
    'content approvals',
    'analytics review',
    'handover notes',
  ];
  for (let cycle = 0; cycle < 5; cycle++)
    for (const [index, topic] of topics.entries()) {
      messages.push({
        role: 'user',
        content: `Planning discussion ${cycle + 1}, ${topic}: We need to reconcile the current working notes before the next review. Track the owner, dependencies, unresolved questions and evidence separately. The ${topic} workstream has ${index + 2} open items. The design review is Wednesday and the operations review is Friday. Keep the earlier browser-task requirements unchanged. We are comparing several alternatives, but no external commitment has been authorized. The working budget for this separate workstream is ${1200 + cycle * 240 + index * 35} dollars. Retain the distinction between proposed changes and approved decisions. Summarize what the team needs to provide before we can close this discussion.`,
      });
      messages.push({
        role: 'assistant',
        content: `For ${topic}, the next step is to collect the outstanding evidence from its owner and resolve dependencies before Friday's operations review. The current ${index + 2} items remain open. The working budget is ${1200 + cycle * 240 + index * 35} dollars, subject to reconciliation; it is not a spending authorization. I would ask for the current document, the latest comparison, and confirmation of who owns each unresolved item. Wednesday's design review can settle presentation questions, while operational decisions remain with Friday's review. I have kept the earlier browser-task requirements intact. No booking, submission, purchase, or external message has been made.`,
      });
    }
  messages.push(
    {
      role: 'user',
      content:
        'Return to the browser task now. The original requirements still apply.',
    },
    {
      role: 'assistant',
      content: 'Ready to continue with those requirements.',
    },
  );
  return messages;
}
export function schedule(
  selectedVariants,
  selectedCases,
  contexts,
  repetitions,
  roundOffset = 0,
) {
  const rows = [];
  for (let round = roundOffset; round < roundOffset + repetitions; round++)
    for (const [index, scenario] of selectedCases.entries())
      for (const context of contexts) {
        const shift =
          (round + index + (context === 'established' ? 1 : 0)) %
          selectedVariants.length;
        const order = [
          ...selectedVariants.slice(shift),
          ...selectedVariants.slice(0, shift),
        ];
        if (round % 2) order.reverse();
        for (const variant of order)
          rows.push({
            key: `${scenario.id}/${context}/${variant.id}/${round}`,
            scenario,
            context,
            variant,
            round,
          });
      }
  return rows;
}
const normalize = (text) =>
  text.toLowerCase().replaceAll(',', '').replace(/\s+/g, ' ');
function containsFact(answer, value) {
  const text = normalize(answer);
  if (/^\d[\d,.]*$/.test(value)) {
    const target = Number(value.replaceAll(',', ''));
    return (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).some(
      (token) => Number(token) === target,
    );
  }
  if (value === 'October 15, 2026')
    return /(?:oct(?:ober)?\.? 15(?:th)?(?: )?2026|15(?:th)? oct(?:ober)?\.? 2026|2026-10-15)/.test(
      text,
    );
  if (value === 'November 10')
    return /(?:nov(?:ember)?\.? 10(?:th)?\b|10(?:th)? nov(?:ember)?\b|2026-11-10)/.test(
      text,
    );
  if (value === 'Paid')
    return /\bpaid\b/.test(text) && !/\bunpaid\b|\bnot paid\b/.test(text);
  if (value === 'high') return /\bhigh\b/.test(text);
  return text.includes(normalize(value));
}
export function score(scenario, state, answer, tools = []) {
  const checks = {};
  for (const value of scenario.expected)
    checks[`answer:${value}`] = containsFact(answer, value);
  if (scenario.kind === 'live') {
    checks.source = answer.includes(new URL(scenario.url).hostname);
    checks.visited = state.pages.some((url) => url.startsWith(scenario.url));
    return {
      checks,
      success: null,
      automatedPass: Object.values(checks).every(Boolean),
      review: scenario.review,
    };
  }
  checks.pages = scenario.requiredPages.every((path) =>
    state.pages.includes(path),
  );
  checks.noSubmission = state.submissions === 0;
  if (scenario.id === 'billing') checks.authenticated = state.signedIn === true;
  if (scenario.draft) {
    const draft = state.draft;
    checks.saved = !!draft;
    checks.priority = draft?.priority === 'High';
    checks.workspace = draft?.workspace === 'Acme Studio';
    const description = normalize(draft?.description ?? '');
    const facts = {
      errorCode: /\be42\b/,
      chrome: /\bchrome\b/,
      firefox: /\bfirefox\b/,
      teamSize: /\b(?:12|twelve)\b/,
      startDate: /(?:oct(?:ober)?\.? 21|21(?:st)? oct(?:ober)?|2026-10-21)/,
      cache: /\bcache\b/,
      retry: /\bretr(?:y|ied|ies|ying)\b/,
      reportingImpact: /month[ -]?end reporting/,
    };
    for (const [name, pattern] of Object.entries(facts))
      checks['draft:' + name] = pattern.test(description);
    checks.title = /export/i.test(draft?.title ?? '');
  }
  if (scenario.expense) {
    checks.saved = !!state.expense;
    for (const [field, value] of Object.entries({
      merchant: 'Northstar Cafe',
      date: '2026-10-20',
      amount: '38.60',
      category: 'Meals',
      project: 'Acme Launch',
    }))
      checks[field] =
        field === 'amount'
          ? Number(state.expense?.[field]) === Number(value)
          : state.expense?.[field] === value;
    checks.computerUsed = tools.some((name) =>
      /computer.*(click|type|key)/i.test(name),
    );
    checks.noAutomation = !tools.some((name) =>
      /^(browser|login_|secure_)|execute_command|execute_typescript/.test(name),
    );
  }
  return {
    checks,
    automatedPass: Object.values(checks).every(Boolean),
    success: Object.values(checks).every(Boolean),
  };
}
