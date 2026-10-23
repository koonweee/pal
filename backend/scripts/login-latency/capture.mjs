import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { AsyncLocalStorage } = await import('node:async_hooks');
const scope = new AsyncLocalStorage();
const tracePath = '/tmp/pal-login-latency.jsonl';
const state = { restore: [], enabled: true };
if (globalThis.__palLoginLatency)
  throw new Error('Latency capture already installed');
globalThis.__palLoginLatency = state;
const { writeFileSync } = await import('node:fs');
writeFileSync(tracePath, '', { mode: 0o600 });
function emit(event, data = {}) {
  if (state.enabled)
    appendFileSync(
      tracePath,
      JSON.stringify({ at: Date.now(), event, ...data }) + '\n',
      { mode: 0o600 },
    );
}
state.emit = emit;
const root = 'file:///opt/pal/dist/';
function wrap(cls, name, meta = () => ({}), after = () => ({})) {
  const original = cls.prototype[name];
  if (typeof original !== 'function') return;
  cls.prototype[name] = async function (...args) {
    const id = randomUUID(),
      start = Date.now();
    const details = { ...scope.getStore(), ...meta(args) };
    emit('operation.start', {
      id,
      operation: cls.name + '.' + name,
      ...details,
    });
    try {
      const result = await original.apply(this, args);
      emit('operation.end', {
        id,
        operation: cls.name + '.' + name,
        ms: Date.now() - start,
        ...details,
        ...after(result),
      });
      return result;
    } catch (error) {
      emit('operation.error', {
        id,
        operation: cls.name + '.' + name,
        ms: Date.now() - start,
        ...details,
        errorType: error?.name,
        code: error?.code,
      });
      throw error;
    }
  };
  state.restore.push(() => {
    cls.prototype[name] = original;
  });
}
for (const [path, exportName, methods] of [
  [
    'login/login.service.js',
    'LoginService',
    [
      'inspect',
      'request',
      'fill',
      'fillRequest',
      'finish',
      'selectAccount',
      'submitCode',
      'flushNotifications',
    ],
  ],
  ['login/login-browser.js', 'LoginBrowser', ['inspect', 'select', 'fill']],
  [
    'login/login.repository.js',
    'LoginRepository',
    ['request', 'finish', 'select', 'notifications', 'notified'],
  ],
  [
    'login/bitwarden.service.js',
    'BitwardenService',
    ['ensureReady', 'matching', 'save', 'request'],
  ],
  ['browser/browser.service.js', 'BrowserService', ['command', 'selectedPage']],
  ['execution/execution.service.js', 'ExecutionService', ['run']],
  [
    'agent/mastra-agent-runtime.js',
    'MastraAgentRuntime',
    ['sendTask', 'delegate', 'consumeTask', 'publishTask'],
  ],
  ['chat/chat.service.js', 'ChatService', ['publish']],
]) {
  const mod = await import(root + path);
  const cls = mod[exportName];
  if (!cls) {
    emit('capture.missing', { exportName });
    continue;
  }
  for (const method of methods)
    wrap(
      cls,
      method,
      (args) => {
        if (exportName === 'LoginService' && method === 'inspect')
          return {
            taskId: args[0],
            hasAction: !!args[2]?.length,
            actionKind: args[2]?.[0],
          };
        if (exportName === 'LoginService' && method === 'request')
          return {
            taskId: args[0],
            entryKind: args[1]?.code ? 'code' : 'credentials',
            codeFields: args[1]?.code?.length,
          };
        if (exportName === 'LoginService' && method === 'fillRequest')
          return { taskId: args[0]?.taskId, requestId: args[0]?.id };
        if (exportName === 'LoginService')
          return ['inspect', 'request', 'fill'].includes(method)
            ? { taskId: args[0] }
            : ['finish', 'selectAccount', 'submitCode'].includes(method)
              ? { requestId: args[0] }
              : {};
        if (exportName === 'BrowserService')
          return {
            taskId: args[0],
            ...(method === 'command' ? { command: args[1]?.[0] } : {}),
          };
        if (exportName === 'BitwardenService')
          return method === 'request'
            ? {
                route: String(args[0])
                  .split('?')[0]
                  .replace(/\/object\/item\/[^/]+/, '/object/item/:id'),
                method: args[1] ?? 'GET',
              }
            : {};
        if (exportName === 'ExecutionService') return { executable: args[0] };
        if (exportName === 'LoginRepository')
          return ['finish', 'notified'].includes(method)
            ? { requestId: args[0] }
            : ['request', 'select'].includes(method)
              ? { taskId: args[0] }
              : {};
        if (exportName === 'MastraAgentRuntime')
          return method === 'sendTask'
            ? {
                taskId: args[0],
                reason: args[2]
                  ? 'user'
                  : String(args[1]).includes('is selected.')
                    ? 'selected'
                    : String(args[1]).includes('is saved.')
                      ? 'saved'
                      : String(args[1]).includes('is filled.')
                        ? 'filled'
                        : 'delegation',
              }
            : method === 'consumeTask'
              ? { taskId: args[1] }
              : {};
        if (exportName === 'ChatService')
          return {
            taskId: args[0]?.taskId,
            role: args[0]?.role,
            phase: args[0]?.phase,
            cardId: args[0]?.metadata?.secureEntryRequestId,
          };
        return {};
      },
      (result) => ({
        ...(result?.requestId ? { requestId: result.requestId } : {}),
        ...(typeof result?.status === 'string'
          ? { status: result.status }
          : {}),
        ...(result?.inspectionId ? { inspectionId: result.inspectionId } : {}),
        ...(Array.isArray(result?.inputs)
          ? {
              inputCount: result.inputs.length,
              refLengths: result.inputs.map((input) => input.ref.length),
            }
          : {}),
      }),
    );
}
// Tap actual tool execute functions after Mastra resolves this step's tools.
// The original tool objects and processor result are preserved; no args/results are recorded.
const { TaskToolDiscoveryProcessor } = await import(
  root + 'agent/task-tool-discovery.processor.js'
);
const { MASTRA_THREAD_ID_KEY } =
  await import('file:///opt/pal/node_modules/@mastra/core/dist/request-context/index.js');
const originalProcess = TaskToolDiscoveryProcessor.prototype.processInputStep;
const wrappedTools = new WeakSet();
TaskToolDiscoveryProcessor.prototype.processInputStep = async function (args) {
  const stepId = randomUUID(),
    start = Date.now(),
    threadId = args.requestContext?.get(MASTRA_THREAD_ID_KEY);
  emit('processor.start', { stepId, threadId, stepNumber: args.stepNumber });
  const result = await originalProcess.call(this, args);
  for (const [name, tool] of Object.entries(result.tools ?? {})) {
    if (!tool || typeof tool.execute !== 'function' || wrappedTools.has(tool))
      continue;
    wrappedTools.add(tool);
    const execute = tool.execute;
    tool.execute = function (input, context) {
      const parent = scope.getStore(),
        callId =
          context?.agent?.toolCallId ?? context?.toolCallId ?? parent?.callId;
      const details = {
        tool: name,
        callId,
        threadId: context?.agent?.threadId ?? context?.threadId ?? threadId,
        executionId: randomUUID(),
        parentExecutionId: parent?.executionId,
      };
      return scope.run(details, async () => {
        const begin = Date.now();
        emit('tool.execute.start', details);
        try {
          const result = await execute.call(this, input, context);
          emit('tool.execute.end', { ...details, ms: Date.now() - begin });
          return result;
        } catch (error) {
          emit('tool.execute.error', {
            ...details,
            ms: Date.now() - begin,
            errorType: error?.name,
          });
          throw error;
        }
      });
    };
    state.restore.push(() => {
      tool.execute = execute;
    });
  }
  emit('processor.end', {
    stepId,
    threadId,
    stepNumber: args.stepNumber,
    ms: Date.now() - start,
  });
  return result;
};
state.restore.push(() => {
  TaskToolDiscoveryProcessor.prototype.processInputStep = originalProcess;
});
const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url?.includes('chatgpt.com/backend-api/codex/responses'))
    return realFetch(input, init);
  const id = randomUUID(),
    start = Date.now(),
    headers = new Headers(init?.headers ?? input?.headers),
    threadId = headers.get('session-id');
  emit('model.start', { id, threadId });
  let response;
  try {
    response = await realFetch(input, init);
  } catch (e) {
    emit('model.error', {
      id,
      threadId,
      ms: Date.now() - start,
      errorType: e.name,
    });
    throw e;
  }
  emit('model.headers', {
    id,
    threadId,
    ms: Date.now() - start,
    status: response.status,
  });
  if (!response.body) return response;
  const decoder = new TextDecoder();
  let buffer = '',
    first = false;
  const seen = new Set(),
    calls = new Map();
  const stream = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!first) {
          first = true;
          emit('model.first_chunk', { id, threadId, ms: Date.now() - start });
        }
        buffer += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, cut).trimEnd();
          buffer = buffer.slice(cut + 1);
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (
              data.type === 'response.output_item.added' &&
              data.item?.type === 'function_call'
            ) {
              calls.set(data.item.id, {
                name: data.item.name,
                callId: data.item.call_id,
              });
              emit('model.tool', {
                id,
                threadId,
                name: data.item.name,
                callId: data.item.call_id,
                ms: Date.now() - start,
              });
            }
            if (data.type === 'response.function_call_arguments.delta') {
              const key = 'args:' + data.item_id;
              if (!seen.has(key)) {
                seen.add(key);
                emit('model.arguments.first', {
                  id,
                  threadId,
                  ...calls.get(data.item_id),
                  ms: Date.now() - start,
                });
              }
            }
            if (data.type === 'response.function_call_arguments.done')
              emit('model.arguments.done', {
                id,
                threadId,
                ...calls.get(data.item_id),
                characters: data.arguments?.length,
                ms: Date.now() - start,
              });
            if (
              data.type === 'response.output_item.done' &&
              data.item?.type === 'function_call'
            )
              emit('model.tool.done', {
                id,
                threadId,
                name: data.item.name,
                callId: data.item.call_id,
                ms: Date.now() - start,
              });
            const category = data.type?.includes('reasoning')
              ? 'reasoning'
              : data.type === 'response.output_text.delta'
                ? 'text'
                : null;
            if (category && !seen.has(category)) {
              seen.add(category);
              emit('model.first_' + category, {
                id,
                threadId,
                ms: Date.now() - start,
              });
            }
            if (data.type === 'response.completed') {
              const u = data.response?.usage;
              emit('model.completed', {
                id,
                threadId,
                ms: Date.now() - start,
                inputTokens: u?.input_tokens,
                cachedTokens: u?.input_tokens_details?.cached_tokens,
                outputTokens: u?.output_tokens,
                reasoningTokens: u?.output_tokens_details?.reasoning_tokens,
              });
            }
          } catch {}
        }
        controller.enqueue(chunk);
      },
      flush() {
        emit('model.end', { id, threadId, ms: Date.now() - start });
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
state.restore.push(() => {
  globalThis.fetch = realFetch;
});
state.stop = () => {
  state.restore.reverse().forEach((fn) => fn());
  emit('capture.stopped');
  state.enabled = false;
};
emit('capture.ready');
