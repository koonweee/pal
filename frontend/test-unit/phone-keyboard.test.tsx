import { MantineProvider } from '@mantine/core';
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PhoneKeyboard } from '../src/phone/PhoneKeyboard';

beforeAll(() => {
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
});
afterEach(cleanup);

test('toggle focuses client input; text, mobile deletion and Enter forward once', () => {
  const inputRef = createRef<HTMLTextAreaElement>();
  const typeText = vi.fn(),
    pressKey = vi.fn();
  render(
    <MantineProvider>
      <PhoneKeyboard
        disabled={false}
        inputRef={inputRef}
        typeText={typeText}
        pressKey={pressKey}
      />
    </MantineProvider>,
  );
  const toggle = screen.getByRole('button', { name: 'Toggle phone keyboard' });
  fireEvent.click(toggle);
  expect(inputRef.current).toHaveFocus();
  fireEvent.input(inputRef.current!, { target: { value: '\u200bhello' } });
  expect(typeText).toHaveBeenCalledExactlyOnceWith('hello');
  expect(inputRef.current!.value).toBe('\u200b');
  fireEvent.input(inputRef.current!, {
    target: { value: '' },
    inputType: 'deleteContentBackward',
  });
  fireEvent.keyDown(inputRef.current!, { key: 'Enter' });
  expect(pressKey.mock.calls).toEqual([[67], [66]]);
  fireEvent.pointerDown(toggle);
  fireEvent.click(toggle);
  expect(inputRef.current).not.toHaveFocus();
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('composition waits for committed text and does not duplicate the final input event', () => {
  const inputRef = createRef<HTMLTextAreaElement>();
  const typeText = vi.fn();
  render(
    <MantineProvider>
      <PhoneKeyboard
        disabled={false}
        inputRef={inputRef}
        typeText={typeText}
        pressKey={vi.fn()}
      />
    </MantineProvider>,
  );
  fireEvent.compositionStart(inputRef.current!);
  fireEvent.input(inputRef.current!, {
    target: { value: '\u200b漢' },
    isComposing: true,
  });
  expect(typeText).not.toHaveBeenCalled();
  fireEvent.compositionEnd(inputRef.current!);
  fireEvent.input(inputRef.current!);
  expect(typeText).toHaveBeenCalledExactlyOnceWith('漢');
});
