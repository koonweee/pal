import { ApplicationError } from '../application/contracts/errors.js';

export const cardRoles = [
  'cardholderName',
  'number',
  'expiry',
  'expMonth',
  'expYear',
  'securityCode',
] as const;
export type CardRole = (typeof cardRoles)[number];
export type SecureRole = 'username' | 'password' | 'code' | CardRole;
export type SecureFields = Partial<
  Record<Exclude<SecureRole, 'code'>, string>
> & { code?: string[] };
export type SecureValues = Partial<Record<SecureRole, string>>;
export const isCardRole = (role: string): role is CardRole =>
  (cardRoles as readonly string[]).includes(role);
export const fieldKind = (fields: SecureFields) =>
  Object.keys(fields).some(isCardRole)
    ? ('card' as const)
    : fields.code
      ? ('code' as const)
      : ('credentials' as const);
export class StaleSecureFieldsError extends ApplicationError {
  constructor() {
    super(
      'conflict',
      'Secure field selection expired or changed; inspect again',
    );
  }
}

export interface LoginInput {
  ref: string;
  origin: string;
  type: string;
  autocomplete: string;
  label: string;
  group: string;
  maxLength?: number;
}

// Serialized by Playwright into the page. These checks validate destinations;
// the model assigns semantic roles from the metadata and masked screenshot.
export function isEligibleInput(
  el: HTMLInputElement | HTMLSelectElement,
  role: 'any' | SecureRole,
) {
  if (
    !el.isConnected ||
    el.disabled ||
    ('readOnly' in el && el.readOnly) ||
    !(
      el instanceof HTMLSelectElement ||
      ['text', 'email', 'tel', 'number', 'password', 'url', 'search'].includes(
        el.type,
      )
    ) ||
    !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  )
    return false;
  const purposes = el.autocomplete.toLowerCase().split(/\s+/);
  const card = [
    'cardholderName',
    'number',
    'expiry',
    'expMonth',
    'expYear',
    'securityCode',
  ].includes(role);
  if (
    el instanceof HTMLSelectElement &&
    !['any', 'expMonth', 'expYear'].includes(role)
  )
    return false;
  if (role !== 'any' && !card && purposes.some((p) => p.startsWith('cc-')))
    return false;
  if (
    card &&
    purposes.some((p) =>
      [
        'username',
        'current-password',
        'new-password',
        'one-time-code',
      ].includes(p),
    )
  )
    return false;
  if (
    role === 'password' &&
    (el.type !== 'password' ||
      purposes.some((p) => ['new-password', 'one-time-code'].includes(p)))
  )
    return false;
  if (
    role === 'username' &&
    (el.type === 'password' ||
      purposes.some((p) =>
        ['new-password', 'current-password', 'one-time-code'].includes(p),
      ))
  )
    return false;
  const rect = el.getBoundingClientRect();
  let left = rect.left,
    right = rect.right,
    top = rect.top,
    bottom = rect.bottom;
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

export function inputMetadata(el: HTMLInputElement | HTMLSelectElement) {
  const root = el.getRootNode() as Document | ShadowRoot;
  const label = [
    el.getAttribute('aria-label') ?? '',
    ...[...(el.labels ?? [])].map((label) => label.textContent ?? ''),
    ...(el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => root.getElementById(id)?.textContent ?? ''),
    el.getAttribute('placeholder') ?? '',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return {
    type: el.type,
    autocomplete: el.autocomplete,
    label,
    form: el.form
      ? Array.from(root.querySelectorAll('form')).indexOf(el.form)
      : -1,
    ...('maxLength' in el && el.maxLength > 0
      ? { maxLength: el.maxLength }
      : {}),
  };
}

/** Tool providers may emit null for an unused optional role. */
export function selectedFields(fields: unknown): [SecureRole, string][] {
  const invalid = () =>
    new ApplicationError('invalid_input', 'Invalid secure field selection');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields))
    throw invalid();
  const entries = Object.entries(fields);
  if (
    entries.some(
      ([key]) => !['username', 'password', 'code', ...cardRoles].includes(key),
    )
  )
    throw invalid();
  const active = entries.filter(
    ([, value]) => value !== null && value !== undefined,
  );
  if (!active.length) throw invalid();
  if (
    active.some(([role]) => isCardRole(role)) &&
    active.some(([role]) => !isCardRole(role))
  )
    throw invalid();
  if (
    active.some(([role]) => role === 'expiry') &&
    active.some(([role]) => role === 'expMonth' || role === 'expYear')
  )
    throw invalid();
  const code = active.find(([key]) => key === 'code');
  let result: [SecureRole, string][];
  if (code) {
    const refs = code[1];
    if (
      active.length !== 1 ||
      !Array.isArray(refs) ||
      !refs.length ||
      refs.length > 64 ||
      refs.some((ref) => typeof ref !== 'string' || !ref)
    )
      throw invalid();
    result = refs.map((ref) => ['code', ref]);
  } else {
    if (active.some(([, ref]) => typeof ref !== 'string' || !ref))
      throw invalid();
    result = active.map(([role, ref]) => [role as SecureRole, ref as string]);
  }
  if (new Set(result.map(([, ref]) => ref)).size !== result.length)
    throw invalid();
  return result;
}

export function normalizeFields(fields: unknown): SecureFields {
  const selected = selectedFields(fields);
  return selected[0][0] === 'code'
    ? { code: selected.map(([, ref]) => ref) }
    : (Object.fromEntries(selected) as SecureFields);
}
