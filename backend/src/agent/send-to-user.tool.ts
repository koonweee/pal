import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import type { UserVisibleMessage } from '../chat/chat.types.js';
import {
  parsePublicResponse,
  publicOutputSchema,
  type PublicOutput,
  type PublicResponse,
} from './public-output.js';

type Routing = { destinationIds: string[]; notify: boolean };
type SendInput = Routing & {
  content:
    | { kind: 'message'; message: PublicResponse }
    | { kind: 'reaction'; messageRef: number; emoji: string };
};

export function sendToUserTool(
  send: (
    output: PublicOutput,
    routing: Routing,
    key: string,
    request: Record<string, unknown>,
  ) => Promise<UserVisibleMessage>,
  react: (
    input: Routing & { messageRef: number; emoji: string },
    key: string,
  ) => Promise<UserVisibleMessage>,
) {
  const routing = {
    destinationIds: {
      type: 'array' as const,
      description:
        'Additional enabled channels beyond Pal; [] sends only in Pal.',
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string' as const },
    },
    notify: { type: 'boolean' as const },
  };
  return createTool({
    id: 'sendToUser',
    description:
      'Send a message or set/replace the single emoji reaction on a Main message. Pal is always included. Select additional enabled channels; notify requests alerts on Pal and every selected channel where supported. Returns persisted acceptance, not provider receipt.',
    inputSchema: jsonSchema<SendInput>({
      type: 'object',
      properties: {
        ...routing,
        content: {
          anyOf: [
            {
              type: 'object',
              properties: {
                kind: { const: 'message' },
                message: publicOutputSchema,
              },
              required: ['kind', 'message'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'reaction' },
                messageRef: { type: 'integer', minimum: 1 },
                emoji: { type: 'string', minLength: 1, maxLength: 64 },
              },
              required: ['kind', 'messageRef', 'emoji'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['content', 'destinationIds', 'notify'],
      additionalProperties: false,
    }),
    execute: async (input, context) => {
      const key = context?.agent?.toolCallId;
      if (!key) throw new Error('Native tool call identity is required');
      if (input.content.kind === 'reaction') {
        const message = await react(
          {
            messageRef: input.content.messageRef,
            emoji: input.content.emoji,
            destinationIds: input.destinationIds,
            notify: input.notify,
          },
          key,
        );
        return { messageRef: message.sequence, reaction: message.reaction };
      }
      const outputs = parsePublicResponse(
        JSON.stringify(input.content.message),
      );
      const refs: number[] = [];
      for (const [index, output] of outputs.entries()) {
        try {
          const message = await send(output, input, key + ':' + index, {
            ...input,
            part: index,
          });
          refs.push(message.sequence);
        } catch (error) {
          if (!refs.length) throw error;
          return {
            messageRefs: refs,
            error:
              error instanceof Error ? error.message : 'Publication failed',
            correction:
              'Earlier parts are already visible. Resend only the failed part.',
          };
        }
      }
      return { messageRefs: refs };
    },
  });
}
