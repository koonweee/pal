import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { DockerSandbox } from '@mastra/docker';
import { ComposeSandbox } from '../dist/execution/compose-sandbox.js';

it('reconnects the same running adapter after execution replacement and refuses missing execution', async () => {
  const containers = vi
    .spyOn(Docker.prototype, 'listContainers')
    .mockResolvedValue([{ Id: 'original' } as Docker.ContainerInfo]);
  const sandbox = new ComposeSandbox('pal-reconnect-test', '/home/pal');
  try {
    await sandbox._start();
    expect(sandbox.container.id).toBe('original');

    containers.mockResolvedValue([
      { Id: 'replacement' } as Docker.ContainerInfo,
    ]);
    await sandbox.processes.list();
    expect(sandbox.container.id).toBe('replacement');

    containers.mockResolvedValue([]);
    await expect(sandbox.processes.list()).rejects.toThrow(
      'Expected one running Compose execution container',
    );

    containers.mockResolvedValue([{ Id: 'recovered' } as Docker.ContainerInfo]);
    await sandbox.processes.list();
    expect(sandbox.container.id).toBe('recovered');
  } finally {
    await sandbox._stop();
    containers.mockRestore();
  }
});

it('preserves UTF-8 characters split across interleaved Docker output frames', async () => {
  const sandbox = new DockerSandbox();
  const started = vi.spyOn(sandbox, 'ensureRunning').mockResolvedValue();
  const stream = new PassThrough();
  sandbox.processes.setContainer({
    exec: async () => ({
      id: 'unicode-output',
      start: async () => stream,
      inspect: async () => ({ ExitCode: 0 }),
    }),
  } as unknown as Docker.Container);
  try {
    const handle = await sandbox.processes.spawn('fixture');
    const stdout = Buffer.from('é');
    const stderr = Buffer.from('€');
    for (let index = 0; index < stderr.length; index++) {
      for (const [type, bytes] of [
        [1, stdout],
        [2, stderr],
      ] as const) {
        if (index >= bytes.length) continue;
        const frame = Buffer.alloc(9);
        frame[0] = type;
        frame.writeUInt32BE(1, 4);
        frame[8] = bytes[index];
        stream.write(frame);
      }
    }
    stream.end();
    const result = await handle.wait();
    expect(result.stdout).toBe('é');
    expect(result.stderr).toBe('€');
  } finally {
    stream.destroy();
    sandbox.processes.reset();
    started.mockRestore();
  }
});
