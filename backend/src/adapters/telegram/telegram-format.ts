// Markdown rendering policy stays local to the Telegram adapter.
import { Lexer, type Token, type Tokens } from 'marked';
type MessageEntity = Annotation & { offset: number; length: number };
export interface Rendered {
  text: string;
  entities: MessageEntity[];
}
type Annotation =
  | {
      type:
        | 'bold'
        | 'italic'
        | 'strikethrough'
        | 'blockquote'
        | 'expandable_blockquote'
        | 'code';
    }
  | { type: 'pre'; language?: string }
  | { type: 'text_link'; url: string };
const literal = (text: string): Rendered => ({ text, entities: [] });
function join(parts: (Rendered | string)[], separator = ''): Rendered {
  const result: Rendered = { text: '', entities: [] };
  for (const [index, part] of parts.entries()) {
    if (index) result.text += separator;
    const value = typeof part === 'string' ? literal(part) : part,
      offset = result.text.length;
    result.entities.push(
      ...value.entities.map((e) => ({ ...e, offset: e.offset + offset })),
    );
    result.text += value.text;
  }
  return result;
}
function annotate(value: Rendered, annotation: Annotation): Rendered {
  return {
    text: value.text,
    entities: value.text.length
      ? [
          ...value.entities,
          { ...annotation, offset: 0, length: value.text.length },
        ]
      : value.entities,
  };
}
function prefixLines(value: Rendered, first: string, rest: string): Rendered {
  if (!value.text) return literal(first.trimEnd());
  const starts = [0];
  for (let index = 0; index < value.text.length - 1; index++)
    if (value.text[index] === '\n') starts.push(index + 1);
  const extra = (position: number, inclusive: boolean) =>
    starts.reduce(
      (total, start, index) =>
        total +
        (start < position || (inclusive && start === position)
          ? index === 0
            ? first.length
            : rest.length
          : 0),
      0,
    );
  return {
    text: value.text
      .split('\n')
      .map((line, index) => (index === 0 ? first : rest) + line)
      .join('\n'),
    entities: value.entities.map((e) => {
      const offset = e.offset + extra(e.offset, true),
        end = e.offset + e.length;
      return { ...e, offset, length: end + extra(end, false) - offset };
    }),
  };
}
function safeLink(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (
      ['http:', 'https:', 'mailto:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {}
  return undefined;
}
function inline(tokens: Token[]): Rendered {
  return join(
    tokens.map((token) => {
      switch (token.type) {
        case 'strong':
          return annotate(inline(token.tokens ?? []), { type: 'bold' });
        case 'em':
          return annotate(inline(token.tokens ?? []), { type: 'italic' });
        case 'del':
          return annotate(inline(token.tokens ?? []), {
            type: 'strikethrough',
          });
        case 'codespan':
          return annotate(literal(token.text), { type: 'code' });
        case 'link': {
          const label = inline(token.tokens ?? []),
            url = safeLink(token.href);
          return url
            ? annotate(label, { type: 'text_link', url })
            : join([label, ` (${token.href})`]);
        }
        case 'image':
          return join([
            'Image: ',
            inline(token.tokens ?? []),
            token.href ? ` (${token.href})` : '',
          ]);
        case 'br':
          return literal('\n');
        case 'text':
          return token.tokens
            ? inline(token.tokens ?? [])
            : literal(token.text);
        case 'escape':
        case 'html':
          return literal(token.text);
        default:
          return literal(token.raw);
      }
    }),
  );
}
function list(token: Tokens.List, inQuote: boolean): Rendered {
  return join(
    token.items.map((item, index) => {
      const marker = item.task
        ? item.checked
          ? '☑ '
          : '☐ '
        : token.ordered
          ? `${Number(token.start) + index}. `
          : '• ';
      return prefixLines(
        blocks(item.tokens, inQuote, '\n'),
        marker,
        ' '.repeat(marker.length),
      );
    }),
    '\n',
  );
}
function blocks(
  tokens: Token[],
  inQuote = false,
  separator = '\n\n',
): Rendered {
  return join(
    tokens
      .filter(
        (t) => t.type !== 'space' && t.type !== 'def' && t.type !== 'checkbox',
      )
      .map((token) => {
        switch (token.type) {
          case 'heading':
            return annotate(inline(token.tokens ?? []), { type: 'bold' });
          case 'paragraph':
          case 'text':
            return token.tokens
              ? inline(token.tokens ?? [])
              : literal(token.text);
          case 'code':
            return annotate(literal(token.text), {
              type: 'pre',
              ...(token.lang
                ? { language: token.lang.trim().split(/\s+/)[0] }
                : {}),
            });
          case 'list':
            return list(token as Tokens.List, inQuote);
          case 'blockquote': {
            const expandable =
              !inQuote && /^\[!details\](?:\n|$)/.test(token.text);
            const content = expandable
              ? blocks(
                  Lexer.lex(token.text.replace(/^\[!details\](?:\n|$)/, ''), {
                    gfm: true,
                  }),
                  true,
                )
              : blocks(token.tokens ?? [], true);
            // Telegram cannot nest quotes. Keep inner depth visible inside one quote.
            return inQuote
              ? prefixLines(content, '› ', '› ')
              : annotate(content, {
                  type: expandable ? 'expandable_blockquote' : 'blockquote',
                });
          }
          case 'table': {
            const table = token as Tokens.Table;
            return join(
              [
                annotate(
                  join(
                    table.header.map((cell) => inline(cell.tokens)),
                    ' | ',
                  ),
                  { type: 'bold' },
                ),
                ...table.rows.map((row) =>
                  join(
                    row.map((cell) => inline(cell.tokens)),
                    ' | ',
                  ),
                ),
              ],
              '\n',
            );
          }
          case 'hr':
            return literal('────────');
          // Raw HTML is visible text, never an alternate parser or executable media.
          case 'html':
            return literal(token.text);
          default:
            return literal(token.raw);
        }
      }),
    separator,
  );
}
const end = (entity: MessageEntity) => entity.offset + entity.length;
function subtract(
  entity: MessageEntity,
  excluded: MessageEntity[],
): MessageEntity[] {
  let parts = [entity];
  for (const cut of excluded)
    parts = parts.flatMap((part) => {
      if (cut.offset >= end(part) || end(cut) <= part.offset) return [part];
      const result: MessageEntity[] = [];
      if (cut.offset > part.offset)
        result.push({ ...part, length: cut.offset - part.offset });
      if (end(cut) < end(part))
        result.push({
          ...part,
          offset: end(cut),
          length: end(part) - end(cut),
        });
      return result;
    });
  return parts;
}
/** Apply classic Bot API nesting rules without changing the visible content. */
function compatibleEntities(entities: MessageEntity[]): MessageEntity[] {
  const expandable = entities.filter((e) => e.type === 'expandable_blockquote');
  entities = entities.filter(
    (e) =>
      !['code', 'pre', 'text_link'].includes(e.type) ||
      !expandable.some((q) => q.offset <= e.offset && end(q) >= end(e)),
  );
  const code = entities.filter((e) => e.type === 'code' || e.type === 'pre'),
    links = entities.filter((e) => e.type === 'text_link');
  let result = entities.flatMap((e) =>
    e.type === 'code' || e.type === 'pre'
      ? [e]
      : subtract(
          e,
          e.type === 'blockquote'
            ? [...code, ...links]
            : e.type === 'expandable_blockquote'
              ? []
              : code,
        ),
  );
  // Cutting a quote around a link/code span can make an outer style cross its
  // boundary. Split crossing ranges (never text) until all overlaps are nested.
  let crossing = true;
  while (crossing) {
    crossing = false;
    outer: for (let a = 0; a < result.length; a++)
      for (let b = a + 1; b < result.length; b++) {
        const first = result[a],
          second = result[b];
        let index: number, boundary: number;
        if (
          first.offset < second.offset &&
          second.offset < end(first) &&
          end(first) < end(second)
        ) {
          index = b;
          boundary = end(first);
        } else if (
          second.offset < first.offset &&
          first.offset < end(second) &&
          end(second) < end(first)
        ) {
          index = a;
          boundary = end(second);
        } else continue;
        const split = result[index];
        result.splice(
          index,
          1,
          { ...split, length: boundary - split.offset },
          { ...split, offset: boundary, length: end(split) - boundary },
        );
        crossing = true;
        break outer;
      }
  }
  const seen = new Set<string>();
  result = result.filter((e) => {
    const key = JSON.stringify(e);
    if (!e.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return result.sort(
    (a, b) =>
      a.offset - b.offset ||
      b.length - a.length ||
      a.type.localeCompare(b.type),
  );
}
/** Parse CommonMark/GFM once; JS string lengths are Telegram's UTF-16 offsets. */
export function renderMarkdown(text: string): Rendered {
  try {
    const rendered = blocks(Lexer.lex(text, { gfm: true, breaks: false }));
    if (!rendered.text.trim()) return literal(text);
    return { ...rendered, entities: compatibleEntities(rendered.entities) };
  } catch {
    return literal(text);
  }
}

/** Split rendered text and clip/rebase entities without cutting surrogate pairs. */
export function splitTelegramText(value: Rendered): Rendered[] {
  const result: Rendered[] = [];
  for (let offset = 0; offset < value.text.length;) {
    let boundary = Math.min(offset + 4000, value.text.length);
    const last = value.text.charCodeAt(boundary - 1);
    if (boundary < value.text.length && last >= 0xd800 && last <= 0xdbff)
      boundary--;
    result.push({
      text: value.text.slice(offset, boundary),
      entities: value.entities.flatMap((entity) => {
        const start = Math.max(offset, entity.offset);
        const stop = Math.min(boundary, entity.offset + entity.length);
        return stop > start
          ? [{ ...entity, offset: start - offset, length: stop - start }]
          : [];
      }),
    });
    offset = boundary;
  }
  return result;
}
