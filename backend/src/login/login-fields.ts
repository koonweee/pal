// These self-contained functions are serialized by Playwright into the page.
export function isEligibleInput(
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
export function hasUsernameHint(el: HTMLInputElement) {
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
// Verification semantics are required; a generic numeric/comment field is insufficient.
export function codeInput(el: HTMLInputElement) {
  if (!['text', 'tel', 'number', 'password'].includes(el.type)) return false;
  const purposes = el.autocomplete.toLowerCase().split(/\s+/);
  if (
    purposes.some((p) => p.startsWith('cc-')) ||
    /cvv|cvc/i.test(el.name + ' ' + el.id)
  )
    return false;
  const root = el.getRootNode() as Document | ShadowRoot;
  const label = [
    el.getAttribute('aria-label') ?? '',
    ...[...(el.labels ?? [])].map((l) => l.textContent ?? ''),
    ...(el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => root.getElementById(id)?.textContent ?? ''),
  ].join(' ');
  return (
    purposes.includes('one-time-code') ||
    /verification\s*code|authentication\s*code|one[- ]time\s*(code|password)|security\s*code\s*digit/i.test(
      label,
    )
  );
}
export function codeDigit(el: HTMLInputElement) {
  if (
    !['text', 'tel', 'number', 'password'].includes(el.type) ||
    el.autocomplete
      .toLowerCase()
      .split(/\s+/)
      .some((p) => p.startsWith('cc-')) ||
    /cvv|cvc/i.test(el.name + ' ' + el.id)
  )
    return false;
  return (
    el.maxLength === 1 ||
    /(?:code\s*)?digit\s*\d/i.test(el.getAttribute('aria-label') ?? '')
  );
}
