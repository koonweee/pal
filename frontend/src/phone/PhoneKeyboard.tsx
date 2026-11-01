import { Textarea } from '@mantine/core';
import { Keyboard } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { IconAction } from '../ui/IconAction';

// Keep one character behind the caret so touch keyboards can emit Backspace.
const sentinel = '\u200b';

export function PhoneKeyboard({
  disabled,
  inputRef,
  typeText,
  pressKey,
}: {
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  typeText(text: string): void;
  pressKey(code: 66 | 67): void;
}) {
  const [active, setActive] = useState(false);
  const composing = useRef(false);
  const hideOnClick = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (disabled) {
      inputRef.current?.blur();
      setActive(false);
    }
  }, [disabled, inputRef]);
  function reset(input: HTMLTextAreaElement) {
    input.value = sentinel;
    input.setSelectionRange(1, 1);
  }
  function commit(input: HTMLTextAreaElement) {
    const value = input.value;
    if (!value) pressKey(67);
    else {
      const text = value.startsWith(sentinel) ? value.slice(1) : value;
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (index) pressKey(66);
        if (line) typeText(line);
      });
    }
    reset(input);
  }
  return (
    <>
      <IconAction
        label="Toggle phone keyboard"
        tooltipLabel={active ? 'Hide keyboard' : 'Show keyboard'}
        className="desktop-toggle"
        aria-pressed={active}
        disabled={disabled}
        onPointerDownCapture={() => {
          hideOnClick.current = active;
        }}
        onPointerCancel={() => {
          hideOnClick.current = undefined;
        }}
        onClick={() => {
          const hide = hideOnClick.current ?? active;
          hideOnClick.current = undefined;
          if (hide) inputRef.current?.blur();
          else {
            const input = inputRef.current;
            if (input) {
              reset(input);
              input.focus({ preventScroll: true });
            }
          }
        }}
      >
        <Keyboard aria-hidden="true" size={19} />
      </IconAction>
      <Textarea
        ref={inputRef}
        className="phone-keyboard-input"
        aria-label="Phone keyboard input"
        tabIndex={-1}
        disabled={disabled}
        defaultValue={sentinel}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setActive(true)}
        onBlur={(event) => {
          setActive(false);
          composing.current = false;
          reset(event.currentTarget);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commit(event.currentTarget);
        }}
        onInput={(event) => {
          if (
            !composing.current &&
            !(event.nativeEvent as InputEvent).isComposing
          )
            commit(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing) return;
          if (event.key === 'Backspace' || event.key === 'Enter') {
            event.preventDefault();
            pressKey(event.key === 'Backspace' ? 67 : 66);
          }
        }}
      />
    </>
  );
}
