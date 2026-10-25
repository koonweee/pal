import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import type { Message } from '../api/client';

export function QuotePreview({
  text,
  role,
  id,
}: Pick<Message, 'text' | 'role'> & { id?: string }) {
  const html = useMemo(
    () =>
      role === 'assistant'
        ? DOMPurify.sanitize(marked.parseInline(text, { async: false }), {
            ALLOWED_TAGS: ['strong', 'em', 'del', 'code'],
            ALLOWED_ATTR: [],
          })
        : null,
    [text, role],
  );

  return html === null ? (
    <span id={id}>{text || 'Message'}</span>
  ) : (
    <span id={id} dangerouslySetInnerHTML={{ __html: html || 'Message' }} />
  );
}
