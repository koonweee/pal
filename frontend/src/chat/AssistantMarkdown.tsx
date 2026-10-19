import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

const allowedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
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

export function AssistantMarkdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false }), {
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
      }}
    />
  );
}
