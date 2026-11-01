// Stdio bridge to the existing execution container; no listener or new container.
import Docker from '/opt/pal/node_modules/dockerode/lib/docker.js';
const docker = new Docker();
const container = docker.getContainer(process.argv[2]);
const execution = await container.exec({
  Cmd: [
    '/tmp/pal-cua-comparison/cua-driver',
    'mcp',
    '--socket',
    '/tmp/pal-cua-comparison/driver.sock',
  ],
  Env: ['CUA_DRIVER_RS_HOME=/tmp/pal-cua-comparison/state', 'DO_NOT_TRACK=1'],
  AttachStdin: true,
  AttachStdout: true,
  AttachStderr: true,
});
const stream = await execution.start({ hijack: true, stdin: true });
docker.modem.demuxStream(stream, process.stdout, process.stderr);
process.stdin.pipe(stream);
process.stdin.on('end', () => stream.end());
stream.on('end', () => process.exit(0));
process.on('SIGTERM', () => {
  stream.destroy();
  process.exit(0);
});
