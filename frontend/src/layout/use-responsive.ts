import { useEffect, useState } from 'react';

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function classifyInputCapabilities(input: {
  fineHover: boolean;
  coarsePointer: boolean;
  maxTouchPoints: number;
}) {
  return {
    coarsePointer: input.coarsePointer,
    fineHover: input.fineHover,
    touch: input.maxTouchPoints > 0,
  };
}

export function useInputCapabilities() {
  const fineHover = useMedia('(hover: hover) and (pointer: fine)');
  const coarsePointer = useMedia('(any-pointer: coarse)');
  return classifyInputCapabilities({
    coarsePointer,
    fineHover,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}
