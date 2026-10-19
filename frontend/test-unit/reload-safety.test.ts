import { expect, test } from 'vitest';
import { canActivateUpdate } from '../src/pwa/reload-safety.ts';

const idle = {
  draft: '',
  pendingFiles: 0,
  submitting: false,
  desktopOpen: false,
  dirtyForms: false,
};

test('permits an update only when reload cannot discard active work', () => {
  expect(canActivateUpdate(idle)).toBe(true);
  expect(canActivateUpdate({ ...idle, draft: 'hello' })).toBe(false);
  expect(canActivateUpdate({ ...idle, draft: ' ' })).toBe(false);
  expect(canActivateUpdate({ ...idle, pendingFiles: 1 })).toBe(false);
  expect(canActivateUpdate({ ...idle, submitting: true })).toBe(false);
  expect(canActivateUpdate({ ...idle, desktopOpen: true })).toBe(false);
  expect(canActivateUpdate({ ...idle, dirtyForms: true })).toBe(false);
});
