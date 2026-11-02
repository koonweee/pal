import assert from 'node:assert/strict';

// Preflight only: scripts/dev-local stops the backend before any device access.
const response = await fetch('http://127.0.0.1:3000/stream', {
  signal: AbortSignal.timeout(5000),
});
assert.ok(response.ok);
const reader = response.body.getReader();
let data = '';
try {
  for (;;) {
    const chunk = await reader.read();
    assert.ok(!chunk.done, 'Missing dev activity snapshot');
    data += new TextDecoder().decode(chunk.value);
    const line = data
      .split('\n')
      .find(
        (line) => line.startsWith('data:') && line.includes('agent.activity'),
      );
    if (!line) continue;
    const { state } = JSON.parse(line.slice(5));
    assert.equal(
      state.status,
      'idle',
      'Wait for existing dev agent work to settle',
    );
    assert.ok(
      !state.resources?.some(
        (resource) => resource.ownerTaskId || resource.waitingTaskIds.length,
      ),
      'Wait for existing dev device operations',
    );
    break;
  }
} finally {
  await reader.cancel();
}
