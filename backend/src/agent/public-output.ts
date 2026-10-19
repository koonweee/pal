import { isUUID } from 'class-validator';
import { toStandardSchema } from '@mastra/core/schema';
import type { JSONSchema7 } from 'json-schema';

export interface GeneratedFile {
  path: string;
  filename: string;
  contentType: string;
}

export interface PublicOutput {
  text: string;
  replyTo: number | null;
  attachmentIds: string[];
  files: GeneratedFile[];
}

export interface PublicResponse extends Omit<PublicOutput, 'text'> {
  text: string | string[];
}

export class AttachmentDeliveryError extends Error {
  constructor(
    message: string,
    readonly output: Pick<PublicOutput, 'text' | 'replyTo'>,
  ) {
    super(message);
  }
}

export const publicOutputSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    text: {
      anyOf: [
        { type: 'string' },
        { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      ],
    },
    replyTo: { type: ['integer', 'null'] },
    attachmentIds: {
      type: 'array',
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    files: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1 },
          filename: { type: 'string', minLength: 1, maxLength: 1024 },
          contentType: { type: 'string', minLength: 1 },
        },
        required: ['path', 'filename', 'contentType'],
        additionalProperties: false,
      },
    },
  },
  required: ['text', 'replyTo', 'attachmentIds', 'files'],
  additionalProperties: false,
};

export const publicOutputOptions = {
  schema: toStandardSchema<PublicResponse>(publicOutputSchema),
  jsonPromptInjection: false,
  errorStrategy: 'warn',
} as const;

export function parsePublicOutput(value: string): PublicOutput {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('text' in parsed) ||
    typeof parsed.text !== 'string'
  )
    throw new Error('Invalid public agent output');
  // Intermediate commentary can omit unused structured-output fields.
  const replyTo = 'replyTo' in parsed ? parsed.replyTo : null;
  if (!(
    replyTo === null ||
    (typeof replyTo === 'number' &&
      Number.isSafeInteger(replyTo) &&
      replyTo > 0)
  ))
    throw new Error('Invalid public agent output');
  const attachmentIds = 'attachmentIds' in parsed ? parsed.attachmentIds : [];
  if (
    !Array.isArray(attachmentIds) ||
    attachmentIds.length > 100 ||
    attachmentIds.some((id) => typeof id !== 'string' || !isUUID(id)) ||
    new Set(attachmentIds).size !== attachmentIds.length
  )
    throw new AttachmentDeliveryError(
      'Invalid attachmentIds. Use IDs from incoming metadata or inspect_message.',
      {
        text: parsed.text,
        replyTo,
      },
    );
  const files = 'files' in parsed ? parsed.files : [];
  if (
    !Array.isArray(files) ||
    attachmentIds.length + files.length > 100 ||
    files.some(
      (file) =>
        !file ||
        typeof file !== 'object' ||
        typeof file.path !== 'string' ||
        !file.path.trim() ||
        typeof file.filename !== 'string' ||
        !file.filename.trim() ||
        file.filename.length > 1024 ||
        typeof file.contentType !== 'string' ||
        !file.contentType.trim(),
    )
  )
    throw new AttachmentDeliveryError(
      'Invalid files. Each generated file needs a readable local path, filename, and contentType; send at most 100 attachments.',
      {
        text: parsed.text,
        replyTo,
      },
    );
  return {
    text: parsed.text,
    replyTo,
    attachmentIds,
    files,
  };
}

/** One response may intentionally contain several messages; clients still receive ordinary messages. */
export function parsePublicResponse(value: string): PublicOutput[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('text' in parsed) ||
    !Array.isArray(parsed.text)
  )
    return [parsePublicOutput(value)];
  const texts: unknown[] = parsed.text;
  if (
    !texts.length ||
    !texts.every(
      (text): text is string => typeof text === 'string' && !!text.trim(),
    )
  )
    throw new Error('Expected nonempty message texts');
  // Validate the whole response before publishing any part. File correction can
  // therefore retain the complete answer if a declared attachment is invalid.
  const output = parsePublicOutput(
    JSON.stringify({ ...parsed, text: texts.join('\n\n') }),
  );
  return texts.map((text, index) => ({
    text,
    replyTo: index === 0 ? output.replyTo : null,
    attachmentIds: index === texts.length - 1 ? output.attachmentIds : [],
    files: index === texts.length - 1 ? output.files : [],
  }));
}
