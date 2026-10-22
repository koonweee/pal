import { ConfigService } from '@nestjs/config';
import { ExecutionService } from '../dist/execution/execution.service.js';

export async function smokeExecution() {
  if (!process.env.PAL_EXECUTION_ID?.startsWith('pal-split-stack-'))
    throw new Error('Run through the isolated split-stack smoke harness');
  const config = new ConfigService({
    ...process.env,
    PAL_DESKTOP_ENABLED: true,
  });
  const execution = new ExecutionService(config);
  await execution.sandbox._start();
  const exec = async (command, args, options = {}) => {
    const data = await execution.output(command, args, options);
    return options.encoding ? data.toString(options.encoding) : data;
  };
  const read = (path, encoding) =>
    exec('cat', [path], encoding ? { encoding } : {});
  const start = async (command, args, options = {}) => {
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    return execution.sandbox.processes.spawn(
      [command, ...args].map(quote).join(' '),
      options,
    );
  };
  return { config, execution, exec, read, start };
}

/** Test HTTP servers live beside Chromium; fixture event payloads return over stdout. */
export async function fixtureServer(
  remote,
  handler,
  bindings,
  onEvent = () => {},
) {
  const source = `
    import {createServer} from 'node:http';
    const ${Object.entries(bindings)
      .map(([key, value]) => key + '=' + JSON.stringify(value))
      .join(',')};
    const emit=(kind,value)=>process.stdout.write(JSON.stringify({kind,value})+'\\n');
    const events={push:value=>emit('event',value)}, submitted={push:value=>emit('submitted',value)};
    let ready=false;
    const server=createServer(${handler.toString()});
    server.listen(0, '127.0.0.1',()=>emit('listen',{port:server.address().port,pid:process.pid}));
    process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
  `;
  let buffer = '';
  const listening = Promise.withResolvers();
  const child = await remote.start(
    'node',
    ['--input-type=module', '-e', source],
    {
      onStdout(chunk) {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const message = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (message.kind === 'listen') listening.resolve(message.value);
          else onEvent(message.kind, message.value);
        }
      },
    },
  );
  void child
    .wait()
    .then((result) =>
      listening.reject(new Error('Fixture exited: ' + result.exitCode)),
    );
  const { port, pid } = await Promise.race([
    listening.promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Fixture startup timed out')),
        15000,
      ).unref(),
    ),
  ]);
  return {
    origin: 'http://127.0.0.1:' + port,
    async close() {
      await remote.execution.output('kill', [String(pid)]).catch(() => {});
      await child.wait();
    },
  };
}
