import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { useMemo } from 'react';

const messageMarkdown = new Marked({
  renderer: {
    list(token) {
      if (!token.ordered) return false;
      const start = typeof token.start === 'number' ? token.start : 1;
      const items = token.items
        .map(
          (item, index) => `<li class="message-ordered-list-item">
<span class="message-list-marker">${start + index}.</span>
<div class="message-list-content">${this.parser.parse(item.tokens)}</div>
</li>`,
        )
        .join('\n');
      const startAttribute = start === 1 ? '' : ` start="${start}"`;
      return `<ol class="message-ordered-list"${startAttribute}>
${items}
</ol>`;
    },
  },
});

const allowedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'span',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];

const allowedAttributes = [
  'align',
  'checked',
  'class',
  'disabled',
  'href',
  'start',
  'title',
  'type',
];

export function MessageMarkdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(messageMarkdown.parse(text, { async: false }), {
        ALLOWED_ATTR: allowedAttributes,
        ALLOWED_TAGS: allowedTags,
      }),
    [text],
  );

  return (
    <div
      className="message-body"
      dangerouslySetInnerHTML={{ __html: html }}
      ref={(body) => {
        for (const link of body?.querySelectorAll<HTMLAnchorElement>(
          'a[href]',
        ) ?? []) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        for (const list of body?.querySelectorAll<HTMLOListElement>(
          'ol.message-ordered-list',
        ) ?? [])
          list.setAttribute('role', 'list');
        for (const marker of body?.querySelectorAll<HTMLSpanElement>(
          '.message-list-marker',
        ) ?? [])
          marker.setAttribute('aria-hidden', 'true');
      }}
    />
  );
}
