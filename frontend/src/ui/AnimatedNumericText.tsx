import { VisuallyHidden } from '@mantine/core';
import { AnimatedNumber } from './AnimatedNumber';

export function AnimatedNumericText({ text }: { text: string }) {
  const parts = text.split(/(\d+(?:[.,]\d+)*)/g);
  if (parts.length === 1) return <>{text}</>;
  if (parts.length === 3 && !parts[0] && !parts[2])
    return <AnimatedNumber value={parts[1]!} />;
  return (
    <>
      <VisuallyHidden>{text}</VisuallyHidden>
      <span aria-hidden="true">
        {parts.map((part, index) =>
          index % 2 ? (
            <AnimatedNumber key={parts.length - index} value={part} />
          ) : (
            part
          ),
        )}
      </span>
    </>
  );
}
