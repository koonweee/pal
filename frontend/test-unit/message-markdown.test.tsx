import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageMarkdown } from '../src/chat/MessageMarkdown';

describe('MessageMarkdown', () => {
  test('renders supported markdown and safe external links', () => {
    const { container } = render(
      <MessageMarkdown
        text={
          '## Result\n\n[Open](https://example.com)\n\n```ts\nconst ok = true;\n```'
        }
      />,
    );

    expect(screen.getByRole('heading', { name: 'Result' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(container.querySelector('code')).toHaveClass('language-ts');
  });

  test('allows only the message markup policy', () => {
    const { container } = render(
      <MessageMarkdown
        text={
          '<script>alert(1)</script><img src="bad" alt="bad"><a href="javascript:alert(1)" onclick="alert(1)" style="color: red">Unsafe</a>'
        }
      />,
    );

    const link = container.querySelector('a');
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(link).toHaveTextContent('Unsafe');
    expect(link).not.toHaveAttribute('href');
    expect(link).not.toHaveAttribute('onclick');
    expect(link).not.toHaveAttribute('style');
  });
});
