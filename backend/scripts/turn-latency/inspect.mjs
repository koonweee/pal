// All values returned by the probe are metadata only; remote objects stay in-process.
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
async function call(method, params = {}) {
  const key = ++id;
  const value = await new Promise((resolve) => {
    pending.set(key, resolve);
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  if (value.error || value.result?.exceptionDetails)
    throw Error('Diagnostic operation failed');
  return value.result;
}
try {
  if (process.argv[2] === 'attach') {
    const result = await call('Runtime.evaluate', {
      expression:
        "(async()=>{const r=process.getBuiltinModule('module').createRequire('/opt/pal/package.json');await r('/tmp/pal-turn-latency-probe.cjs');return globalThis.__palTurnProbe.Runtime.prototype})()",
      awaitPromise: true,
    });
    const objects = await call('Runtime.queryObjects', {
      prototypeObjectId: result.result.objectId,
    });
    const found = await call('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      functionDeclaration:
        'function(){const s=globalThis.__palTurnProbe;s.runtime=this.find(x=>x.main?.taskAgent);return {attached:!!s.runtime};}',
      returnByValue: true,
    });
    console.log(JSON.stringify(found.result.value));
  } else {
    const expression =
      process.argv[2] === 'stop'
        ? "await globalThis.__palTurnProbe?.stop();delete globalThis.__palTurnProbe;setTimeout(()=>process.getBuiltinModule('inspector').close(),100);return {restored:true}"
        : 'return await globalThis.__palTurnProbe.run()';
    const result = await call('Runtime.evaluate', {
      expression: '(async()=>{' + expression + '})()',
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(JSON.stringify(result.result.value));
  }
} catch {
  console.error('Turn benchmark diagnostic failed');
  process.exitCode = 1;
} finally {
  ws.close();
}
