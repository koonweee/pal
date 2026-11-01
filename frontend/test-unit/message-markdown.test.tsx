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
          '<script>alert(1)</script><img src="bad" alt="bad"><a href="javascript:alert(1)" onclick="alert(1)" style="color: red">Unsafe</a><p role="button">Visible</p>'
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
    expect(screen.getByText('Visible')).not.toHaveAttribute('role');
  });

  test('renders semantic ordered lists with measured visible markers', () => {
    const { container } = render(
      <MessageMarkdown
        text={
          '3499. **Parent** item\n      1. Nested item\n      2. Nested item two\n3500. Second item\n\n- Unordered item'
        }
      />,
    );

    const lists = container.querySelectorAll('ol.message-ordered-list');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toHaveAttribute('start', '3499');
    expect(lists[0]).toHaveAttribute('role', 'list');
    expect(lists[1]).not.toHaveAttribute('start');
    expect(lists[0]!.querySelector('strong')).toHaveTextContent('Parent');
    expect(
      Array.from(container.querySelectorAll('.message-list-marker')).map(
        (marker) => marker.textContent,
      ),
    ).toEqual(['3499.', '1.', '2.', '3500.']);
    for (const marker of container.querySelectorAll('.message-list-marker'))
      expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('ul .message-list-marker')).toBeNull();
    expect(screen.getByText('Unordered item')).toBeVisible();
  });
});
