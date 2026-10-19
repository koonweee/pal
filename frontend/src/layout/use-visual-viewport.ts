import { useEffect } from 'react';

function hasFocusedEditable(owner: Document): boolean {
  const active = owner.activeElement;
  if (!active) return false;
  if (
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    (active as HTMLElement).isContentEditable
  )
    return true;
  if (active.tagName !== 'IFRAME') return false;
  try {
    const nested = (active as HTMLIFrameElement).contentDocument;
    return nested ? hasFocusedEditable(nested) : false;
  } catch {
    return false;
  }
}

export function useVisualViewportCssVars() {
  useEffect(() => {
    const root = document.documentElement;
    const initialViewport = window.visualViewport;
    let restingHeight = initialViewport?.height ?? window.innerHeight;
    let restingWidth = initialViewport?.width ?? window.innerWidth;

    const update = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const top = viewport?.offsetTop ?? 0;
      const editableFocused = hasFocusedEditable(document);

      if (!editableFocused || Math.abs(width - restingWidth) > 50) {
        restingHeight = height;
        restingWidth = width;
      }

      root.toggleAttribute(
        'data-keyboard-open',
        editableFocused && restingHeight - height > 100,
      );
      root.style.setProperty('--pal-viewport-height', `${height}px`);
      root.style.setProperty('--pal-viewport-top', `${top}px`);
      root.style.setProperty(
        '--pal-viewport-bottom',
        `${Math.max(0, window.innerHeight - height - top)}px`,
      );
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.removeAttribute('data-keyboard-open');
      root.style.removeProperty('--pal-viewport-height');
      root.style.removeProperty('--pal-viewport-top');
      root.style.removeProperty('--pal-viewport-bottom');
    };
  }, []);
}
