import { fileURLToPath } from 'node:url';
const bootstrap = JSON.stringify(
  fileURLToPath(new URL('./bootstrap.cjs', import.meta.url)),
);
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
};
async function call(method, params) {
  const key = ++id;
  const value = await new Promise((resolve) => {
    pending.set(key, resolve);
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  if (value.error || value.result?.exceptionDetails)
    throw Error(
      value.result?.exceptionDetails?.exception?.description ??
        value.error?.message ??
        'Inspector operation failed',
    );
  return value.result;
}
try {
  if (process.argv[2] === 'attach') {
    const result = await call('Runtime.evaluate', {
      expression: `(async()=>{if(globalThis.__palBrowserBenchmark||globalThis.__palTurnProbe||globalThis.__palLoginLatency)throw Error('Another probe is installed');const r=process.getBuiltinModule('module').createRequire('/opt/pal/package.json');delete r.cache[r.resolve(${bootstrap})];return (await r(${bootstrap})).prototype})()`,
      awaitPromise: true,
    });
    const objects = await call('Runtime.queryObjects', {
      prototypeObjectId: result.result.objectId,
    });
    const found = await call('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      functionDeclaration:
        'function(){const s=globalThis.__palBrowserBenchmark;s.runtime=this.find(x=>x.main?.taskAgent);if(!s.runtime)throw Error("Dev runtime not found");return {attached:true};}',
      returnByValue: true,
    });
    console.log(JSON.stringify(found.result.value));
  } else {
    if (!['preflight', 'run', 'stop'].includes(process.argv[2]))
      throw Error('Unknown command');
    const command = process.argv[2];
    const result = await call('Runtime.evaluate', {
      expression: `(async()=>{const result=await globalThis.__palBrowserBenchmark?.${command}();${command === 'stop' ? "if(result?.restored)setTimeout(()=>process.getBuiltinModule('inspector').close(),100);" : ''}return result})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(JSON.stringify(result.result.value));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
