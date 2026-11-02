import { createTool } from '@mastra/core/tools';
import type { ToolsInput } from '@mastra/core/agent';
import { jsonSchema, type JSONSchema7 } from 'ai';
import { PARENT_TASK_ID, WORKER_ID } from '../agent/task-workers.js';
import {
  androidActions,
  type AndroidAction,
  type AndroidService,
} from './android.service.js';

// Keep Pal aliases while using the dependency's schemas, semantics and results.
export async function androidTools(
  android: AndroidService,
  actions = Object.keys(androidActions) as AndroidAction[],
  activateSurface?: (taskId: string, workerId: string) => void,
): Promise<ToolsInput> {
  if (!android.enabled) return {};
  const upstream = await android.toolDefinitions();
  if (!upstream) return {};
  const names = Object.entries(androidActions);
  const describe = (text: string) =>
    names.reduce(
      (result, [alias, name]) => result.replaceAll(name, alias),
      text,
    );
  return Object.fromEntries(
    actions.map((action) => {
      const definition = upstream.find(
        (tool) => tool.name === androidActions[action],
      );
      if (!definition)
        throw new Error(`Android MCP is missing ${androidActions[action]}`);
      const schema = structuredClone(definition.inputSchema) as JSONSchema7;
      delete schema.properties?.device;
      schema.required = schema.required?.filter((name) => name !== 'device');
      let description = describe(definition.description ?? definition.name);
      if (action === 'android_inspect') {
        delete schema.properties?.format; // Upstream compact text is the host default.
        description +=
          ' This is ordinary navigation inspection; it does not inspect private fields or test private entry. Use inspect_private_fields on the active surface for credentials, codes, or payment fields.';
      }
      if (action === 'android_batch') {
        const steps = schema.properties!.steps as JSONSchema7;
        const item = steps.items as JSONSchema7;
        item.properties!.name = {
          type: 'string',
          enum: actions.filter(
            (name) => name !== 'android_batch' && name !== 'android_screenshot',
          ),
        };
        delete schema.properties?.stopOnError; // Use upstream's stop-on-error default.
        description =
          'Run known ordinary Android actions sequentially, optionally inspecting at the end. Step names and arguments match the Android tools. Stops on the first error. Use private fill tools for credentials.';
      }
      return [
        action,
        createTool({
          id: action,
          description,
          inputSchema: jsonSchema<Record<string, unknown>>(schema),
          execute: async (args, context) => {
            const taskId = context?.requestContext?.get(PARENT_TASK_ID);
            const workerId = context?.requestContext?.get(WORKER_ID);
            if (typeof taskId !== 'string' || typeof workerId !== 'string')
              throw new Error('Android tools require an interaction worker.');
            if (action === 'android_batch') {
              const steps = args.steps as { name: AndroidAction }[];
              if (steps.some((step) => !actions.includes(step.name)))
                throw new Error(
                  'Android batch step is unavailable in this workflow.',
                );
            }
            const output = await android.call(
              { taskId, workerId },
              action,
              args,
              context?.abortSignal,
            );
            activateSurface?.(taskId, workerId);
            if (action === 'android_inspect')
              output.content.push({
                type: 'text',
                text: 'Private fields were not inspected. Use inspect_private_fields for credentials, codes, or payment fields.',
              });
            return output;
          },
          outputSchema: jsonSchema<Awaited<ReturnType<AndroidService['call']>>>(
            {
              type: 'object',
              properties: {
                content: { type: 'array', items: { type: 'object' } },
              },
              required: ['content'],
              additionalProperties: true,
            },
          ),
          toModelOutput: (output) => ({
            type: 'content',
            value: output.content.flatMap<
              | { type: 'text'; text: string }
              | { type: 'media'; data: string; mediaType: string }
            >((part) => {
              if (part.type === 'text')
                return [{ type: 'text' as const, text: part.text }];
              if (part.type === 'image')
                return [
                  {
                    type: 'media' as const,
                    data: part.data,
                    mediaType: part.mimeType,
                  },
                ];
              return [];
            }),
          }),
        }),
      ];
    }),
  );
}
