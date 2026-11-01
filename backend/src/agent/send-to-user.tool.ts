import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import type { UserVisibleMessage } from '../chat/chat.types.js';
import type { MastraDBMessage } from '@mastra/core/agent';
import {
  parsePublicResponse,
  publicOutputSchema,
  type PublicOutput,
  type PublicResponse,
} from './public-output.js';

type Routing = { destinationIds: string[]; notify: boolean };
type RoutingInput = { explicitDestinationIds?: string[]; notify: boolean };
type SendInput = RoutingInput & {
  content:
    | { kind: 'message'; message: PublicResponse }
    | { kind: 'reaction'; messageRef: number; emoji: string };
};

export function sendToUserTool(
  resolveRouting: (
    input: RoutingInput,
    messages: readonly MastraDBMessage[],
  ) => Promise<Routing>,
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
    explicitDestinationIds: {
      type: 'array' as const,
      description:
        "Additional enabled channels explicitly requested by the current user instruction. Example: if the user says 'send this to Telegram', use ['telegram']. Omit for ordinary replies. Automatic routing follows origin channels only and does not fulfill a request for another channel.",
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string' as const },
    },
    notify: { type: 'boolean' as const },
  };
  return createTool({
    id: 'sendToUser',
    description:
      "Send a message or set/replace the single emoji reaction on a Main message. Pal is always included, and secondary routing is determined automatically from the current execution origins. To fulfill a current instruction such as 'send this to Telegram', explicitly set explicitDestinationIds to that enabled channel. Otherwise omit it. notify requests alerts on every included channel where supported. Returns persisted acceptance, not provider receipt.",
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
      required: ['content', 'notify'],
      additionalProperties: false,
    }),
    execute: async (input, context) => {
      const key = context?.agent?.toolCallId;
      if (!key) throw new Error('Native tool call identity is required');
      const resolvedRouting = await resolveRouting(
        input,
        context.agent?.getMessages?.() ?? [],
      );
      if (input.content.kind === 'reaction') {
        const message = await react(
          {
            messageRef: input.content.messageRef,
            emoji: input.content.emoji,
            ...resolvedRouting,
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
          const message = await send(
            output,
            resolvedRouting,
            key + ':' + index,
            {
              ...input,
              resolvedDestinationIds: resolvedRouting.destinationIds,
              part: index,
            },
          );
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
