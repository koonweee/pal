import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { QuotePreview } from '../src/chat/QuotePreview';

describe('QuotePreview', () => {
  test('renders inline assistant formatting and link labels', () => {
    const { container } = render(
      <QuotePreview
        role="assistant"
        text="**Bold** *italic* ~~removed~~ `code` [Link](https://example.com)"
      />,
    );
    expect(container).toHaveTextContent('Bold italic removed code Link');
    expect(container.querySelector('strong')).toHaveTextContent('Bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('del')).toHaveTextContent('removed');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelector('a')).not.toBeInTheDocument();
  });

  test('allows only safe inline markup inside the quote control', () => {
    const { container } = render(
      <QuotePreview
        role="assistant"
        text={
          '<script>alert(1)</script><img src=x onerror="alert(1)"><button>Button</button><br><strong style="color:red" onclick="alert(1)">Safe</strong>'
        }
      />,
    );
    expect(
      container.querySelector('script, img, button, br'),
    ).not.toBeInTheDocument();
    const strong = container.querySelector('strong');
    expect(strong).toHaveTextContent('Safe');
    expect(strong).not.toHaveAttribute('style');
    expect(strong).not.toHaveAttribute('onclick');
  });

  test('preserves literal user text and the empty-message fallback', () => {
    const { container, rerender } = render(
      <QuotePreview role="user" text="**literal** <em>text</em>" />,
    );
    expect(container).toHaveTextContent('**literal** <em>text</em>');
    expect(container.querySelector('strong, em')).not.toBeInTheDocument();
    for (const role of ['user', 'assistant'] as const) {
      rerender(<QuotePreview role={role} text="" />);
      expect(container).toHaveTextContent('Message');
    }
  });
});
