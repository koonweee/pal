import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export function trace(path) {
  const rows = [];
  const emit = (event, values = {}) => {
    const row = { at: Date.now(), event, ...values };
    rows.push(row);
    appendFileSync(path, JSON.stringify(row) + '\n', { mode: 0o600 });
    return row;
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? input?.headers);
    const session = headers.get('session-id') ?? '';
    if (!session.startsWith('pal-browser-bench:')) return original(input, init);
    const [, sample, role] = session.split(':');
    const id = randomUUID(),
      start = Date.now();
    let body = {};
    try {
      body = JSON.parse(init?.body ?? (await input.clone().text()));
    } catch {}
    emit('model.start', {
      id,
      sample,
      role,
      model: body.model,
      effort: body.reasoning?.effort,
      inputCharacters: JSON.stringify(body.input ?? []).length,
      instructionCharacters: body.instructions?.length ?? 0,
      tools: (body.tools ?? []).map((tool) => tool.name ?? tool.type),
    });
    let response;
    try {
      response = await original(input, init);
    } catch (error) {
      emit('model.error', {
        id,
        sample,
        role,
        ms: Date.now() - start,
        error: error.name,
      });
      throw error;
    }
    emit('model.headers', {
      id,
      sample,
      role,
      ms: Date.now() - start,
      status: response.status,
    });
    if (!response.body) return response;
    let buffer = '',
      first = false;
    const decoder = new TextDecoder();
    return new Response(
      response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            let cut;
            while ((cut = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, cut).trimEnd();
              buffer = buffer.slice(cut + 1);
              if (!line.startsWith('data: ')) continue;
              let data;
              try {
                data = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              if (!first && (data.type ?? '').endsWith('delta')) {
                first = true;
                emit('model.first', {
                  id,
                  sample,
                  role,
                  ms: Date.now() - start,
                });
              }
              if (
                data.type === 'response.output_item.done' &&
                data.item?.type === 'function_call'
              )
                emit('model.tool', {
                  id,
                  sample,
                  role,
                  tool: data.item.name,
                  callId: data.item.call_id,
                });
              if (
                [
                  'response.completed',
                  'response.incomplete',
                  'response.failed',
                ].includes(data.type)
              ) {
                const u = data.response?.usage;
                emit('model.finish', {
                  id,
                  sample,
                  role,
                  ms: Date.now() - start,
                  status: data.type,
                  inputTokens: u?.input_tokens,
                  cachedTokens: u?.input_tokens_details?.cached_tokens,
                  outputTokens: u?.output_tokens,
                  reasoningTokens: u?.output_tokens_details?.reasoning_tokens,
                });
              }
            }
            controller.enqueue(chunk);
          },
          flush() {
            emit('model.end', { id, sample, role, ms: Date.now() - start });
          },
        }),
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
  return {
    rows,
    emit,
    close() {
      globalThis.fetch = original;
    },
  };
}
export function toolTiming(emit, sample, role) {
  const wrapped = new WeakMap();
  return {
    id: `benchmark-tools-${role}`,
    processInputStep({ tools }) {
      return {
        tools: Object.fromEntries(
          Object.entries(tools).map(([name, tool]) => {
            if (typeof tool.execute !== 'function') return [name, tool];
            if (!wrapped.has(tool))
              wrapped.set(tool, {
                ...tool,
                execute: async (...args) => {
                  const id = randomUUID(),
                    start = Date.now();
                  emit('tool.start', { id, sample, role, tool: name });
                  try {
                    const result = await tool.execute(...args);
                    emit('tool.end', {
                      id,
                      sample,
                      role,
                      tool: name,
                      ms: Date.now() - start,
                      resultError:
                        result?.success === false || result?.status === 'error',
                    });
                    return result;
                  } catch (error) {
                    emit('tool.error', {
                      id,
                      sample,
                      role,
                      tool: name,
                      ms: Date.now() - start,
                      error: error.name,
                    });
                    throw error;
                  }
                },
              });
            return [name, wrapped.get(tool)];
          }),
        ),
      };
    },
  };
}
