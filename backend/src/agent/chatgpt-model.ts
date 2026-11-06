import { citationMiddleware } from './citations.js';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';
import { buildOpenAICodexOAuthFetch } from '@mastra/code-sdk/providers/openai-codex';

type ModelRole = 'agent' | 'main' | 'task' | 'worker';
type ModelCallOptions = Parameters<
  NonNullable<LanguageModelMiddleware['transformParams']>
>[0]['params'];

export interface ModelRequestMeasurement {
  role: ModelRole;
  messageCount: number;
  contentPartCount: number;
  textPartCount: number;
  reasoningPartCount: number;
  imagePartCount: number;
  filePartCount: number;
  toolCallPartCount: number;
  toolResultPartCount: number;
  toolDefinitionCount: number;
  estimatedRequestBytes: number;
  promptBytes: number;
  instructionsBytes: number;
  textBytes: number;
  imageBytes: number;
  toolCallBytes: number;
  toolResultBytes: number;
  toolDefinitionBytes: number;
}

interface PromptMeasurement {
  bytes: number;
  contentPartCount: number;
  textPartCount: number;
  reasoningPartCount: number;
  imagePartCount: number;
  filePartCount: number;
  toolCallPartCount: number;
  toolResultPartCount: number;
  textBytes: number;
  imageBytes: number;
  toolCallBytes: number;
  toolResultBytes: number;
}

interface ModelTelemetryOptions {
  role?: ModelRole;
  onRequest?: (measurement: ModelRequestMeasurement) => void;
}

function jsonStringBytes(value: string) {
  let bytes = Buffer.byteLength(value) + 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || (code >= 8 && code <= 13)) bytes++;
    else if (code < 32) bytes += 5;
  }
  return bytes;
}

const contentPartTypes = new Set([
  'text',
  'reasoning',
  'file',
  'file-data',
  'file-url',
  'file-id',
  'image-data',
  'image-url',
  'image-file-id',
  'tool-call',
  'tool-result',
  'tool-approval-response',
  'custom',
]);

function estimateJsonBytes(
  value: unknown,
  prompt?: PromptMeasurement,
  seen = new WeakSet<object>(),
): number {
  if (value === null) return 4;
  if (typeof value === 'string') return jsonStringBytes(value);
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'bigint') return value.toString().length;
  if (typeof value !== 'object') return 0;
  if (value instanceof URL) return jsonStringBytes(value.toString());
  if (value instanceof Date) return jsonStringBytes(value.toISOString());
  if (ArrayBuffer.isView(value)) return 4 * Math.ceil(value.byteLength / 3) + 2;
  if (value instanceof ArrayBuffer)
    return 4 * Math.ceil(value.byteLength / 3) + 2;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) {
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
      if (index) bytes++;
      bytes += estimateJsonBytes(value[index], prompt, seen);
    }
    seen.delete(value);
    return bytes;
  }
  let bytes = 2;
  let count = 0;
  let inputBytes = 0;
  let outputBytes = 0;
  let imageBytes = 0;
  for (const [key, item] of Object.entries(value)) {
    if (
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol'
    )
      continue;
    if (count++) bytes++;
    const measured = estimateJsonBytes(item, prompt, seen);
    if (key === 'input') inputBytes = measured;
    else if (key === 'output') outputBytes = measured;
    else if (key === 'data' || key === 'url' || key === 'fileId')
      imageBytes ||= measured;
    bytes += jsonStringBytes(key) + 1 + measured;
  }
  if (prompt) {
    const part = value as Record<string, unknown>;
    const type = typeof part.type === 'string' ? part.type : '';
    if (contentPartTypes.has(type)) prompt.contentPartCount++;
    if (type === 'text' || type === 'reasoning') {
      if (type === 'text') prompt.textPartCount++;
      else prompt.reasoningPartCount++;
      if (typeof part.text === 'string')
        prompt.textBytes += Buffer.byteLength(part.text);
    } else if (type === 'tool-call') {
      prompt.toolCallPartCount++;
      prompt.toolCallBytes += inputBytes;
    } else if (type === 'tool-result') {
      prompt.toolResultPartCount++;
      prompt.toolResultBytes += outputBytes;
    }
    const image =
      type.startsWith('image-') ||
      ((type === 'file' || type === 'file-data') &&
        typeof part.mediaType === 'string' &&
        part.mediaType.startsWith('image/'));
    if (type === 'file') prompt.filePartCount++;
    if (image) {
      prompt.imagePartCount++;
      prompt.imageBytes += imageBytes;
    }
  }
  seen.delete(value);
  return bytes;
}

function measurePrompt(prompt: ModelCallOptions['prompt']) {
  const measurement: PromptMeasurement = {
    bytes: 0,
    contentPartCount: 0,
    textPartCount: 0,
    reasoningPartCount: 0,
    imagePartCount: 0,
    filePartCount: 0,
    toolCallPartCount: 0,
    toolResultPartCount: 0,
    textBytes: 0,
    imageBytes: 0,
    toolCallBytes: 0,
    toolResultBytes: 0,
  };
  measurement.bytes = estimateJsonBytes(prompt, measurement);
  return measurement;
}

function requestBytes(
  params: ModelCallOptions,
  promptBytes: number,
  toolDefinitionBytes: number,
) {
  let bytes = 2;
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'abortSignal' ||
      value === undefined ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    )
      continue;
    if (count++) bytes++;
    bytes += jsonStringBytes(key) + 1;
    bytes +=
      key === 'prompt'
        ? promptBytes
        : key === 'tools'
          ? toolDefinitionBytes
          : estimateJsonBytes(value);
  }
  return bytes;
}

function requestRole(params: ModelCallOptions, fallback: ModelRole) {
  const sessionId = params.headers?.['session-id'];
  if (sessionId === 'pal-main') return 'main';
  if (sessionId?.startsWith('pal-task:')) return 'task';
  if (sessionId?.startsWith('pal-worker:')) return 'worker';
  return fallback;
}

export function measureModelRequest(
  params: ModelCallOptions,
  fallbackRole: ModelRole = 'agent',
): ModelRequestMeasurement {
  const prompt = measurePrompt(params.prompt);
  const toolDefinitionBytes = estimateJsonBytes(params.tools);
  const instructions = params.providerOptions?.openai?.instructions;
  return {
    role: requestRole(params, fallbackRole),
    messageCount: params.prompt.length,
    contentPartCount: prompt.contentPartCount,
    textPartCount: prompt.textPartCount,
    reasoningPartCount: prompt.reasoningPartCount,
    imagePartCount: prompt.imagePartCount,
    filePartCount: prompt.filePartCount,
    toolCallPartCount: prompt.toolCallPartCount,
    toolResultPartCount: prompt.toolResultPartCount,
    toolDefinitionCount: params.tools?.length ?? 0,
    estimatedRequestBytes: requestBytes(
      params,
      prompt.bytes,
      toolDefinitionBytes,
    ),
    promptBytes: prompt.bytes,
    instructionsBytes:
      typeof instructions === 'string' ? Buffer.byteLength(instructions) : 0,
    textBytes: prompt.textBytes,
    imageBytes: prompt.imageBytes,
    toolCallBytes: prompt.toolCallBytes,
    toolResultBytes: prompt.toolResultBytes,
    toolDefinitionBytes,
  };
}

export function chatgptModel(
  modelId: string,
  authPath: string,
  thinkingEffort = 'medium',
  telemetry: ModelTelemetryOptions = {},
): ReturnType<typeof wrapLanguageModel> {
  const auth = new AuthStorage(authPath);
  const provider = createOpenAI({
    apiKey: 'chatgpt-oauth',
    fetch: buildOpenAICodexOAuthFetch({ authStorage: auth }),
  });
  return wrapLanguageModel({
    model: provider.responses(modelId),
    middleware: [
      citationMiddleware,
      {
        specificationVersion: 'v3',
        async transformParams({ params }) {
          // The subscription endpoint requires instructions and store:false.
          // Preserve each caller's instructions, including the observer/reflector.
          const instructions = params.prompt
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n\n');
          const transformed = {
            ...params,
            prompt: params.prompt.filter(
              (message) => message.role !== 'system',
            ),
            providerOptions: {
              ...params.providerOptions,
              openai: {
                ...params.providerOptions?.openai,
                instructions,
                store: false,
                reasoningEffort: thinkingEffort,
              },
            },
          };
          try {
            telemetry.onRequest?.(
              measureModelRequest(transformed, telemetry.role ?? 'agent'),
            );
          } catch {
            // Request telemetry must never affect the model call.
          }
          return transformed;
        },
      },
    ],
  });
}
