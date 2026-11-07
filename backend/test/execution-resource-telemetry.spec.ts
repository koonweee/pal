import { ExecutionResourceTelemetry } from '../dist/execution/execution-resource-telemetry.js';
import type { ExecutionService } from '../dist/execution/execution.service.js';

it('records bounded execution resource samples and sanitized failures', async () => {
  const output = vi
    .fn()
    .mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({
          available: true,
          memoryCurrentBytes: 1024,
          memoryEventsOomKill: 2,
          chromiumRendererCount: 4,
          pageTargetCount: 5,
        }),
      ),
    )
    .mockRejectedValueOnce(new Error('private failure'));
  const records: { data: Record<string, unknown>; failed?: boolean }[] = [];
  const telemetry = new ExecutionResourceTelemetry(
    { output } as unknown as ExecutionService,
    (data, failed) => records.push({ data, failed }),
  );

  await telemetry.sample();
  await telemetry.sample();
  telemetry.close();

  expect(records).toEqual([
    {
      data: {
        available: true,
        memoryCurrentBytes: 1024,
        memoryEventsOomKill: 2,
        chromiumRendererCount: 4,
        pageTargetCount: 5,
      },
      failed: undefined,
    },
    { data: { available: false }, failed: true },
  ]);
  expect(output).toHaveBeenCalledWith(
    'node',
    expect.arrayContaining(['--input-type=module', '-e']),
    { timeout: 5_000, maxBytes: 8_192 },
  );
});
