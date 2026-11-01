import { createTool } from '@mastra/core/tools';
import type { ToolsInput } from '@mastra/core/agent';
import { jsonSchema, type JSONSchema7 } from 'ai';
import { PARENT_TASK_ID, WORKER_ID } from '../agent/task-workers.js';
import {
  androidActions,
  type AndroidAction,
  type AndroidService,
} from './android.service.js';

const string = { type: 'string' } as const;
const number = { type: 'number', minimum: 0 } as const;
const definitions = {
  android_apps: {
    description: 'List installed apps on the configured Android phone.',
    properties: {},
  },
  android_foreground_app: {
    description: 'Read the foreground Android app.',
    properties: {},
  },
  android_launch_app: {
    description: 'Launch an installed Android app by package name.',
    properties: { packageName: string },
    required: ['packageName'],
  },
  android_inspect: {
    description:
      'Read Android screen elements and current @refs. Refresh after navigation or layout changes.',
    properties: {},
  },
  android_screenshot: {
    description:
      'View the Android screen as an image. Use screen elements for targets when available; honor screenshot-to-device coordinate scaling.',
    properties: {},
  },
  android_tap: {
    description:
      'Tap a current Android element ref, or x/y device coordinates. Supply ref or both x and y.',
    properties: { ref: string, x: number, y: number },
  },
  android_long_press: {
    description: 'Long-press an Android element ref or x/y device coordinates.',
    properties: { ref: string, x: number, y: number },
  },
  android_swipe: {
    description: 'Swipe the Android screen in a direction.',
    properties: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    },
    required: ['direction'],
  },
  android_type: {
    description:
      'Type ordinary text into the focused Android field. Never enter credentials, card details, or verification codes.',
    properties: { text: string, submit: { type: 'boolean' } },
    required: ['text'],
  },
  android_press_button: {
    description: 'Press an Android navigation or editing button.',
    properties: {
      button: {
        type: 'string',
        enum: ['HOME', 'BACK', 'ENTER', 'BACKSPACE', 'APP_SWITCH'],
      },
    },
    required: ['button'],
  },
  android_open_url: {
    description: 'Open an HTTP(S) URL in the Android browser.',
    properties: { url: string },
    required: ['url'],
  },
} satisfies Record<
  AndroidAction,
  {
    description: string;
    properties: NonNullable<JSONSchema7['properties']>;
    required?: string[];
  }
>;

export function androidTools(android: AndroidService): ToolsInput {
  if (!android.enabled) return {};
  return Object.fromEntries(
    (Object.keys(androidActions) as AndroidAction[]).map((action) => {
      const definition = definitions[action];
      return [
        action,
        createTool({
          id: action,
          description: definition.description,
          inputSchema: jsonSchema<Record<string, unknown>>({
            type: 'object',
            properties: definition.properties,
            required: 'required' in definition ? [...definition.required] : [],
            additionalProperties: false,
          }),
          execute: async (args, context) => {
            const taskId = context?.requestContext?.get(PARENT_TASK_ID);
            const workerId = context?.requestContext?.get(WORKER_ID);
            if (typeof taskId !== 'string' || typeof workerId !== 'string')
              throw new Error('Android tools require an interaction worker.');
            return android.call(
              { taskId, workerId },
              action,
              args,
              context?.abortSignal,
            );
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
