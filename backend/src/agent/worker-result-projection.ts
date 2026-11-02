import type {
  SubAgent,
  SubAgentGenerateResult,
  SubAgentStreamResult,
} from '@mastra/core/agent';
import type { ChunkType, FullOutput } from '@mastra/core/stream';

type ProjectableToolResult = Awaited<
  NonNullable<SubAgentStreamResult['toolResults']>
>[number];

function projectToolResults(
  results: ProjectableToolResult[],
): ProjectableToolResult[] {
  return results.map(({ payload }) => ({
    payload: {
      toolName: payload.toolName,
      toolCallId: payload.toolCallId,
      ...(payload.isError === undefined ? {} : { isError: payload.isError }),
    },
  }));
}

function projectChunk(chunk: ChunkType): ChunkType | undefined {
  const type = (chunk as { type: string }).type;
  if (
    type.startsWith('data-') &&
    type !== 'data-tool-call-approval' &&
    type !== 'data-tool-call-suspended'
  )
    return undefined;
  switch (chunk.type) {
    case 'tool-call': {
      const { toolCallId, toolName, providerExecuted, dynamic, title } =
        chunk.payload;
      return {
        ...chunk,
        payload: {
          toolCallId,
          toolName,
          ...(providerExecuted === undefined ? {} : { providerExecuted }),
          ...(dynamic === undefined ? {} : { dynamic }),
          ...(title === undefined ? {} : { title }),
        },
      };
    }
    case 'tool-result': {
      const { toolCallId, toolName, isError, providerExecuted, dynamic } =
        chunk.payload;
      return {
        ...chunk,
        payload: {
          toolCallId,
          toolName,
          result: undefined,
          ...(isError === undefined ? {} : { isError }),
          ...(providerExecuted === undefined ? {} : { providerExecuted }),
          ...(dynamic === undefined ? {} : { dynamic }),
        },
      };
    }
    case 'tool-error': {
      const { toolCallId, toolName, error, providerExecuted } = chunk.payload;
      return {
        ...chunk,
        payload: {
          toolCallId,
          toolName,
          error,
          ...(providerExecuted === undefined ? {} : { providerExecuted }),
        },
      };
    }
    case 'step-start':
      return {
        ...chunk,
        payload: {
          ...chunk.payload,
          request: {},
          inputMessages: undefined,
        },
      };
    case 'step-finish':
      return {
        ...chunk,
        payload: {
          ...chunk.payload,
          output: {
            ...chunk.payload.output,
            toolCalls: undefined,
            steps: undefined,
            object: undefined,
          },
          messages: undefined,
        },
      };
    case 'finish':
      return {
        ...chunk,
        payload: {
          ...chunk.payload,
          output: { ...chunk.payload.output, steps: undefined },
          messages: { all: [], user: [], nonUser: [] },
          response: undefined,
        },
      };
    case 'source':
    case 'file':
    case 'reasoning-file':
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'reasoning-signature':
    case 'redacted-reasoning':
    case 'custom':
    case 'raw':
    case 'tool-call-input-streaming-start':
    case 'tool-call-delta':
    case 'tool-call-input-streaming-end':
    case 'object':
    case 'object-result':
      return undefined;
    default:
      return chunk;
  }
}

function projectStream(stream: ReadableStream<ChunkType>) {
  return stream.pipeThrough(
    new TransformStream<ChunkType, ChunkType>({
      transform(chunk, controller) {
        const projected = projectChunk(chunk);
        if (projected) controller.enqueue(projected);
      },
    }),
  );
}

function observeRejection<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function projectGenerateResult(
  result: FullOutput | SubAgentGenerateResult,
): SubAgentGenerateResult {
  return {
    text: result.text,
    finishReason: result.finishReason,
    runId: result.runId,
    response: { dbMessages: result.response.dbMessages },
    toolCalls: result.toolCalls,
    toolResults: result.toolResults
      ? projectToolResults(result.toolResults)
      : undefined,
    suspendPayload: result.suspendPayload,
    resumeSchema: result.resumeSchema,
    usage: result.usage,
  };
}

async function projectStreamResult(
  result: Awaited<ReturnType<SubAgent['stream']>>,
): Promise<SubAgentStreamResult> {
  const finishReason = result.finishReason
    ? observeRejection(result.finishReason)
    : undefined;
  const usage = result.usage ? observeRejection(result.usage) : undefined;
  const toolCalls =
    result.toolCalls === undefined
      ? undefined
      : observeRejection(Promise.resolve(result.toolCalls));
  const toolResults =
    result.toolResults === undefined
      ? undefined
      : observeRejection(
          Promise.resolve(result.toolResults).then(projectToolResults),
        );
  const projected: SubAgentStreamResult = {
    fullStream: projectStream(
      result.fullStream as unknown as ReadableStream<ChunkType>,
    ),
    text: observeRejection(result.text),
    finishReason,
    usage,
    messageList: result.messageList,
    toolCalls,
    toolResults,
    runId: result.runId,
  };
  Object.defineProperty(projected, 'error', {
    enumerable: true,
    get: () => result.error,
  });
  return projected;
}

export function projectWorkerResults(worker: SubAgent): SubAgent {
  return {
    id: worker.id,
    name: worker.name,
    getDescription: () => worker.getDescription(),
    getModel: (options) => worker.getModel(options),
    hasOwnMemory: () => worker.hasOwnMemory(),
    __setMemory: (memory) => worker.__setMemory(memory),
    getMemory: (options) => worker.getMemory(options),
    getInstructions: (options) => worker.getInstructions(options),
    generate: async (messages, options) =>
      projectGenerateResult(await worker.generate(messages, options)),
    stream: async (messages, options) =>
      projectStreamResult(await worker.stream(messages, options)),
    resumeGenerate: async (resumeData, options) =>
      projectGenerateResult(await worker.resumeGenerate(resumeData, options)),
    resumeStream: async (resumeData, options) =>
      projectStreamResult(await worker.resumeStream(resumeData, options)),
    __registerMastra: (mastra) => worker.__registerMastra?.(mastra),
    getBackgroundTasksConfig: () => worker.getBackgroundTasksConfig?.(),
  };
}
