import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionFilesystem } from './execution-filesystem.js';
import { ComposeSandbox } from './compose-sandbox.js';

import { AGENT_HOME } from './paths.js';

export class ExecutionFileError extends Error {
  constructor(readonly kind: 'not_file' | 'too_large' | 'unreadable') {
    super(kind);
  }
}

@Injectable()
export class ExecutionService {
  readonly sandbox: ComposeSandbox;
  readonly home = AGENT_HOME;
  readonly filesystem = new ExecutionFilesystem(this);

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.sandbox = new ComposeSandbox(
      config.get<string>('PAL_EXECUTION_ID') ?? 'pal-execution',
      config.get<string>('PAL_AGENT_WORKING_DIR') ?? AGENT_HOME + '/workspace',
    );
  }

  async run(
    command: string,
    args: string[] = [],
    options: {
      input?: string;
      signal?: AbortSignal;
      timeout?: number;
      maxBytes?: number;
    } = {},
  ) {
    options.signal?.throwIfAborted();
    await this.sandbox._start();
    const handle = await this.sandbox.processes.spawn(
      [command, ...args]
        .map((value) => "'" + value.replaceAll("'", "'\\''") + "'")
        .join(' '),
      {
        abortSignal: options.signal,
        timeout: options.timeout ?? 30_000,
        maxRetainedBytes: options.maxBytes ?? 8 * 1024 * 1024,
        stdinMode: options.input === undefined ? 'ignore' : 'pipe',
      },
    );
    try {
      if (options.input !== undefined) {
        await handle.sendStdin(options.input);
        await handle.closeStdin();
      }
      const result = await handle.wait();
      options.signal?.throwIfAborted();
      if (result.stdoutTruncated || result.stderrTruncated)
        throw new Error('Execution output exceeds the operation limit');
      return result;
    } finally {
      this.sandbox.processes.release(handle.pid);
    }
  }

  async output(
    command: string,
    args: string[] = [],
    options: Parameters<ExecutionService['run']>[2] = {},
  ) {
    const result = await this.run(command, args, options);
    if (!result.success)
      throw new Error(`Execution command failed: ${command}`);
    return Buffer.from(result.stdout);
  }

  /** Resolve and read agent-supplied paths in execution's filesystem namespace. */
  async readFile(path: string, maxBytes: number) {
    const result = await this.output(
      'node',
      [
        '--input-type=module',
        '-e',
        `
      import {open, constants} from 'node:fs/promises';
      let handle;
      try {
        handle = await open(process.argv[1], constants.O_RDONLY | constants.O_NONBLOCK);
        const info = await handle.stat({bigint: true});
        if (!info.isFile()) throw Object.assign(new Error(), {code: 'not_file'});
        if (info.size > BigInt(process.argv[2])) throw Object.assign(new Error(), {code: 'too_large'});
        const bytes = Buffer.alloc(Number(process.argv[2]) + 1);
        let length = 0;
        while (length < bytes.length) {
          const read = await handle.read(bytes, length, bytes.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > Number(process.argv[2])) throw Object.assign(new Error(), {code: 'too_large'});
        const after = await handle.stat({bigint: true});
        if (after.size !== info.size || after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs)
          throw Object.assign(new Error(), {code: 'unreadable'});
        process.stdout.write(JSON.stringify({base64: bytes.subarray(0, length).toString('base64')}));
      } catch (error) {
        process.stdout.write(JSON.stringify({error: ['not_file', 'too_large'].includes(error.code) ? error.code : 'unreadable'}));
      } finally { await handle?.close(); }
    `,
        path,
        String(maxBytes),
      ],
      { maxBytes: Math.ceil((maxBytes * 4) / 3) + 1024 },
    );
    const value = JSON.parse(result.toString()) as {
      base64: string;
      error?: ExecutionFileError['kind'];
    };
    if (value.error) throw new ExecutionFileError(value.error);
    return Buffer.from(value.base64, 'base64');
  }
}
