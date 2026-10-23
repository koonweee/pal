const expression = process.argv[2];
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
const result = await new Promise((r, j) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) r(m);
  };
  ws.onerror = j;
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: '(async()=>{' + expression + '})()',
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
});
if (result.error || result.result?.exceptionDetails) {
  console.error('Latency inspector evaluation failed');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result?.result?.value ?? { ok: true }));
}
ws.close();
