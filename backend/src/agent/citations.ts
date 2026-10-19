import { Logger } from '@nestjs/common';
import type { LanguageModelMiddleware } from 'ai';

const logger = new Logger('Citations');
const markerPattern = /\uE200cite\uE202[^\uE201]*\uE201/g;
const isMarker = (text: string) =>
  /^\uE200cite\uE202[^\uE201]*\uE201$/.test(text);

/** Offsets belong to the provider's raw text, including structured-output JSON. */
export function normalizeCitations(
  text: string,
  annotations: unknown,
): {
  text: string;
  unresolved: number;
} {
  let structured = false;
  try {
    structured = typeof JSON.parse(text) === 'object';
  } catch {
    /* Worker findings and unstructured replies are plain text. */
  }
  const replacements = new Map<
    string,
    { start: number; end: number; links: string[] }
  >();
  for (const value of Array.isArray(annotations) ? annotations : []) {
    if (!value || typeof value !== 'object') continue;
    const { type, start_index: start, end_index: end, url, title } = value;
    if (
      type !== 'url_citation' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      typeof url !== 'string'
    )
      continue;
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      continue;
    }
    if (!['https:', 'http:'].includes(target.protocol)) continue;
    // Providers may count Unicode code points rather than JavaScript UTF-16 units.
    let from = start;
    let to = end;
    if (!isMarker(text.slice(from, to))) {
      const points = Array.from(text);
      from = points.slice(0, start).join('').length;
      to = points.slice(0, end).join('').length;
      if (!isMarker(text.slice(from, to))) continue;
    }
    const label = (
      typeof title === 'string' && title.trim() ? title : target.hostname
    )
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\\[\]]/g, '\\$&');
    const link = `[${label}](<${target.href.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`;
    const key = `${from}:${to}`;
    const entry: { start: number; end: number; links: string[] } =
      replacements.get(key) ?? { start: from, end: to, links: [] };
    if (!entry.links.includes(link)) entry.links.push(link);
    replacements.set(key, entry);
  }
  for (const entry of [...replacements.values()].sort(
    (a, b) => b.start - a.start,
  )) {
    const link = entry.links.join(' ');
    text =
      text.slice(0, entry.start) +
      (structured ? JSON.stringify(link).slice(1, -1) : link) +
      text.slice(entry.end);
  }
  let unresolved = 0;
  text = text.replace(markerPattern, () => {
    unresolved++;
    return '';
  });
  // Escaped markers in JSON have no directly usable raw-text annotation span.
  if (structured)
    text = text.replace(/\\ue200cite\\ue202(?:(?!\\ue201).)*\\ue201/gi, () => {
      unresolved++;
      return '';
    });
  return { text, unresolved };
}

/** Buffer one provider text block so annotations are available before any consumer sees it. */
export const citationMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  async wrapStream({ doStream }) {
    const result = await doStream();
    const texts = new Map<string, string>();
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === 'text-delta') {
              texts.set(chunk.id, (texts.get(chunk.id) ?? '') + chunk.delta);
              return;
            }
            if (chunk.type === 'text-end') {
              const raw = texts.get(chunk.id) ?? '';
              texts.delete(chunk.id);
              const normalized = normalizeCitations(
                raw,
                chunk.providerMetadata?.openai?.annotations,
              );
              if (normalized.unresolved)
                logger.warn(
                  `Removed unresolved citations: block=${chunk.id} count=${normalized.unresolved}`,
                );
              controller.enqueue({
                type: 'text-delta',
                id: chunk.id,
                delta: normalized.text,
              });
            }
            controller.enqueue(chunk);
          },
        }),
      ),
    };
  },
};
