import { useReducedMotion } from '@mantine/hooks';
import { useState } from 'react';

export function AnimatedNumber({ value }: { value: number | string }) {
  const reducedMotion = useReducedMotion();
  const [frame, setFrame] = useState<{
    value: number | string;
    previous: number | string | null;
  }>({ value, previous: null });
  if (frame.value !== value || (reducedMotion && frame.previous !== null))
    setFrame({ value, previous: reducedMotion ? null : frame.value });
  return (
    <span className="pal-animated-number">
      <span
        key={value}
        className={
          frame.previous === null ? undefined : 'pal-animated-number-new'
        }
        onAnimationEnd={() =>
          setFrame((current) =>
            current.value === value ? { value, previous: null } : current,
          )
        }
      >
        {value}
      </span>
      {frame.previous !== null ? (
        <span
          key={`old-${value}`}
          className="pal-animated-number-old"
          aria-hidden="true"
        >
          {frame.previous}
        </span>
      ) : null}
    </span>
  );
}
