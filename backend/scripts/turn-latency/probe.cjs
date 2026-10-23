module.exports = (async () => {
  const { writeFileSync, appendFileSync } = require('node:fs');
  const { MastraAgentRuntime: Runtime } =
    await import('file:///opt/pal/dist/agent/mastra-agent-runtime.js');
  const { RequestContext, MASTRA_THREAD_ID_KEY, MASTRA_RESOURCE_ID_KEY } =
    await import('file:///opt/pal/node_modules/@mastra/core/dist/request-context/index.js');
  const { MAIN_RESOURCE_ID } =
    await import('file:///opt/pal/dist/agent/main-session.js');
  const path = '/tmp/pal-turn-latency.jsonl';
  if (globalThis.__palTurnProbe) throw Error('Probe already installed');
  const originalFetch = globalThis.fetch;
  const state = {
    Runtime,
    runtime: null,
    capture: null,
    requests: new Map(),
    freshId: null,
  };
  globalThis.__palTurnProbe = state;
  writeFileSync(path, '', { mode: 0o600 });
  function emit(event, data = {}) {
    appendFileSync(
      path,
      JSON.stringify({ at: Date.now(), event, ...data }) + '\n',
      { mode: 0o600 },
    );
  }
  globalThis.fetch = async function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(init?.headers ?? input?.headers);
    if (
      state.capture &&
      url.includes('chatgpt.com/backend-api/codex/responses') &&
      headers.get('session-id') === state.capture.threadId
    ) {
      state.capture.request = new Request(
        input instanceof Request ? input.clone() : input,
        init,
      );
      state.capture.abort.abort();
      throw new DOMException('Benchmark preparation complete', 'AbortError');
    }
    return originalFetch(input, init);
  };
  state.stop = async () => {
    globalThis.fetch = originalFetch;
    state.capture?.abort.abort();
    state.capture = null;
    state.requests.clear();
    if (state.freshId)
      await state.runtime.tasks.update(state.freshId, { archived: true });
    emit('probe.stopped');
  };
  const prompt =
    "Let's log in to the test store https://pal-turn-latency.example.test/login";
  async function prepare(label, id) {
    const threadId = 'pal-task:' + id;
    const capture = { threadId, abort: new AbortController(), request: null };
    state.capture = capture;
    const requestContext = new RequestContext([
      [MASTRA_THREAD_ID_KEY, threadId],
      [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
    ]);
    try {
      const output = await state.runtime.main.taskAgent.stream(prompt, {
        memory: {
          thread: threadId,
          resource: MAIN_RESOURCE_ID,
          options: { readOnly: true },
        },
        requestContext,
        abortSignal: capture.abort.signal,
        maxSteps: 1,
        modelSettings: { maxRetries: 0, headers: { 'session-id': threadId } },
        onError: () => {},
        onAbort: () => {},
        onFinish: () => {},
        onChunk: () => {},
      });
      for await (const chunk of output.fullStream) {
        /* consume preparation only */
      }
    } catch {
      /* Expected abort after capturing the outbound request. */
    } finally {
      state.capture = null;
    }
    if (!capture.request) throw Error('No prepared request');
    const body = JSON.parse(await capture.request.clone().text());
    state.requests.set(label, { request: capture.request, body });
    emit('context.prepared', {
      context: label,
      inputItems: body.input?.length,
      inputCharacters: JSON.stringify(body.input).length,
      instructionCharacters: body.instructions?.length,
      tools: body.tools?.length,
      model: body.model,
      effort: body.reasoning?.effort,
    });
  }
  async function sample(context, model, effort, round, warmup = false) {
    const saved = state.requests.get(context);
    const body = {
      ...saved.body,
      model,
      reasoning: { ...saved.body.reasoning, effort },
    };
    const start = Date.now();
    const row = { context, model, effort, round, warmup };
    const headers = new Headers(saved.request.headers);
    // Preserve the actual Task routing/cache headers, but refresh the OAuth bearer
    // through the normal provider wrapper for every replay.
    headers.delete('authorization');
    headers.delete('chatgpt-account-id');
    const { AuthStorage } =
      await import('file:///opt/pal/node_modules/@mastra/code-sdk/dist/auth/storage.js');
    const { buildOpenAICodexOAuthFetch } =
      await import('file:///opt/pal/node_modules/@mastra/code-sdk/dist/providers/openai-codex.js');
    const send = buildOpenAICodexOAuthFetch({
      authStorage: new AuthStorage(
        state.runtime.config.getOrThrow('PAL_AGENT_AUTH_PATH'),
      ),
    });
    let timer;
    try {
      const abort = new AbortController();
      timer = setTimeout(() => abort.abort(), 60000);
      const response = await send(saved.request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      row.headersMs = Date.now() - start;
      row.status = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        emit('sample', row);
        return row;
      }
      let buffer = '';
      const decoder = new TextDecoder();
      const calls = [];
      for await (const chunk of response.body) {
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
          if (
            data.type === 'response.function_call_arguments.delta' &&
            row.firstArgumentsMs === undefined
          )
            row.firstArgumentsMs = Date.now() - start;
          if (data.type === 'response.function_call_arguments.done') {
            row.argumentsDoneMs = Date.now() - start;
            row.argumentCharacters =
              (row.argumentCharacters ?? 0) + (data.arguments?.length ?? 0);
          }
          if (
            data.type === 'response.output_item.done' &&
            data.item?.type === 'function_call'
          )
            calls.push(data.item);
          if (data.type === 'response.completed') {
            row.completedMs = Date.now() - start;
            const usage = data.response?.usage;
            row.inputTokens = usage?.input_tokens;
            row.cachedTokens = usage?.input_tokens_details?.cached_tokens;
            row.outputTokens = usage?.output_tokens;
            row.reasoningTokens =
              usage?.output_tokens_details?.reasoning_tokens;
          }
          if (data.type === 'response.failed' || data.type === 'error')
            row.providerFailure = true;
        }
      }
      row.totalMs = Date.now() - start;
      row.toolNames = calls.map((c) => c.name);
      row.validAction = calls.some((call) => {
        if (call.name !== 'login_inspect') return false;
        try {
          const a = JSON.parse(call.arguments).action;
          return (
            a?.length === 3 &&
            a[0] === 'tab' &&
            a[1] === 'new' &&
            a[2] === 'https://pal-turn-latency.example.test/login'
          );
        } catch {
          return false;
        }
      });
      row.completed = !!row.completedMs;
    } catch (error) {
      row.errorType = error.name;
      row.totalMs = Date.now() - start;
    } finally {
      clearTimeout(timer);
    }
    emit('sample', row);
    return row;
  }
  state.run = async () => {
    if (
      state.runtime.main.session.stream.isActive() ||
      state.runtime.main.taskAgent.listActiveThreadRuns().length
    )
      throw Error('Dev agent is busy');
    const fresh = await state.runtime.tasks.create({
      title: 'Turn latency benchmark',
      goal: 'Measure one browser-opening decision',
      description: prompt,
    });
    state.freshId = fresh.id;
    emit('probe.started', { freshTaskId: fresh.id });
    await prepare('reused', 'c2951b04-9c4a-4b6c-9960-fefe6179447d');
    await prepare('fresh', fresh.id);
    // Restore the fetch tap before timing, so replay requests have no capture overhead.
    globalThis.fetch = originalFetch;
    const current = state.requests.get('reused').body.model;
    const supported = [];
    for (const [model, effort] of [
      [current, 'medium'],
      [current, 'low'],
      ['gpt-6-luna', 'medium'],
    ]) {
      const test = await sample('fresh', model, effort, -1, true);
      if (test.status === 200 && test.completed)
        supported.push({ model, effort });
    }
    if (supported.length < 2)
      throw Error('Insufficient supported benchmark settings');
    const cases = supported.flatMap((v) =>
      ['fresh', 'reused'].map((context) => ({ context, ...v })),
    );
    // Rotate order each round to distribute cache warming/provider drift.
    for (let round = 0; round < 5; round++)
      for (let j = 0; j < cases.length; j++) {
        const c = cases[(j + round) % cases.length];
        await sample(c.context, c.model, c.effort, round);
      }
    emit('probe.complete', {
      variants: supported.length,
      samples: cases.length * 5,
    });
    return {
      complete: true,
      variants: supported.length,
      samples: cases.length * 5,
    };
  };
  return { ready: true };
})();
