import { createTool } from '@mastra/core/tools';
import { jsonSchema } from 'ai';
import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { ApplicationError } from '../application/contracts/errors.js';
import type { FilesService } from '../files/files.service.js';
import type { ChatService } from '../chat/chat.service.js';
import { messageVisibleInChat } from '../chat/chat.types.js';
import { taskIdFromThread, TASK_THREAD_PREFIX } from './task-tools.js';
import { PARENT_TASK_ID } from './task-workers.js';

export function inspectMessageTool(files: FilesService, chat: ChatService) {
  return createTool({
    id: 'inspect_message',
    description:
      'Retrieve an earlier public message by numeric reference, including attachment IDs and absolute local paths. Use to reopen files after a later request or memory compression.',
    inputSchema: jsonSchema<{ messageRef: number }>({
      type: 'object',
      properties: { messageRef: { type: 'integer', minimum: 1 } },
      required: ['messageRef'],
      additionalProperties: false,
    }),
    execute: async ({ messageRef }, context) => {
      const message = await chat.getBySequence(messageRef);
      const thread = context?.requestContext?.get(MASTRA_THREAD_ID_KEY);
      const parent = context?.requestContext?.get(PARENT_TASK_ID);
      const taskId =
        typeof parent === 'string'
          ? parent
          : typeof thread === 'string' && thread.startsWith(TASK_THREAD_PREFIX)
            ? taskIdFromThread(thread)
            : null;
      if (
        !message ||
        !(
          messageVisibleInChat(message, taskId) ||
          (taskId && messageVisibleInChat(message, null))
        )
      )
        throw new ApplicationError(
          'invalid_input',
          'Message is not available in this chat',
        );
      return {
        ...message,
        attachments: await files.manifest(
          message.attachments.map((file) => file.id),
        ),
      };
    },
  });
}
