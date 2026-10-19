import type { MastraDBMessage } from '@mastra/core/agent';
import type { Processor } from '@mastra/core/processors';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { Logger } from '@nestjs/common';
import {
  AttachmentDeliveryError,
  parsePublicResponse,
  type PublicOutput,
} from './public-output.js';

const logger = new Logger('PublishTextProcessor');
const invalidOutputMessage =
  'I could not complete that response. Please send your message again.';

function isPlainText(value: string) {
  const first = value.trimStart()[0];
  return first !== '{' && first !== '[' && first !== '"' && first !== '`';
}

export interface TextContext {
  runId?: string;
  phase?: 'commentary' | 'final_answer';
  threadId?: string;
  // Live input can precede native storage at text-end.
  messages?: MastraDBMessage[];
}

interface FailedPublication {
  output: PublicOutput;
  context: TextContext;
  reason: string;
}

export function publishTextProcessor(
  publish: (output: PublicOutput, context: TextContext) => Promise<void>,
): Processor & Required<Pick<Processor, 'processOutputStream'>> {
  return {
    id: 'pal-publish-text',
    async processOutputStream({
      part,
      streamParts,
      requestContext,
      state,
      messageList,
    }) {
      if (part.type === 'text-end') {
        const id = part.payload.id;
        let text = '';
        let phase = part.payload.providerMetadata?.openai?.phase;
        for (const chunk of streamParts) {
          if (chunk.type === 'text-start' && chunk.payload.id === id) {
            text = '';
            phase =
              part.payload.providerMetadata?.openai?.phase ??
              chunk.payload.providerMetadata?.openai?.phase;
          }
          if (chunk.type === 'text-delta' && chunk.payload.id === id)
            text += chunk.payload.text;
        }
        const threadId: unknown = requestContext?.get(MASTRA_THREAD_ID_KEY);
        if (text.trim()) {
          const phaseName =
            phase === 'commentary' || phase === 'final_answer'
              ? phase
              : 'unknown';
          const context: TextContext = {
            runId: part.runId,
            phase: phaseName === 'unknown' ? undefined : phaseName,
            threadId: typeof threadId === 'string' ? threadId : undefined,
            messages: messageList?.get.all.db(),
          };
          let outputs: PublicOutput[];
          try {
            outputs = parsePublicResponse(text);
          } catch (error) {
            if (error instanceof AttachmentDeliveryError) {
              const failed = (state.failedPublications ??=
                []) as FailedPublication[];
              failed.push({
                output: { ...error.output, attachmentIds: [], files: [] },
                context,
                reason: error.message,
              });
              return part;
            }
            const location = `thread: ${typeof threadId === 'string' ? threadId : 'unknown'}, phase: ${phaseName}`;
            if (error instanceof SyntaxError && isPlainText(text)) {
              outputs = [{ text, replyTo: null, attachmentIds: [], files: [] }];
              logger.warn(
                `Plain-text agent output outside structured format (${location})`,
              );
            } else {
              outputs = [
                {
                  text: invalidOutputMessage,
                  replyTo: null,
                  attachmentIds: [],
                  files: [],
                },
              ];
              logger.error(`Invalid structured agent output (${location})`);
            }
          }
          for (const output of outputs) {
            if (
              !output.text.trim() &&
              !output.attachmentIds.length &&
              !output.files.length
            )
              continue;
            try {
              await publish(output, context);
            } catch (error) {
              if (!(error instanceof AttachmentDeliveryError)) throw error;
              const failed = (state.failedPublications ??=
                []) as FailedPublication[];
              failed.push({ output, context, reason: error.message });
            }
          }
        }
      }
      return part;
    },
    async processOutputStep({ state, abort, retryCount, messageList }) {
      const failed = state.failedPublications as
        FailedPublication[] | undefined;
      delete state.failedPublications;
      if (!failed?.length) return messageList;
      if (!state.attachmentRetryUsed && retryCount === 0) {
        state.attachmentRetryUsed = true;
        abort(
          'Attachment delivery failed: ' +
            failed.map((item) => item.reason).join('; ') +
            '. Correct the attachmentIds using incoming metadata or inspect_message, or correct the files paths after creating the output files. Do not invent IDs. Resubmit only the failed structured answer; earlier delivered messages are already visible.',
          { retry: true },
        );
      }
      logger.error('Agent attachment publication failed after retry');
      for (const { output, context } of failed)
        await publish(
          {
            ...output,
            text: [
              output.text,
              'I could not attach those files. Please ask me to send them again.',
            ]
              .filter(Boolean)
              .join('\n\n'),
            attachmentIds: [],
            files: [],
          },
          context,
        );
      return messageList;
    },
  };
}
