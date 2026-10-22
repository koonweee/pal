import {
  MastraFilesystem,
  type ProviderStatus,
  type FileContent,
  type ReadOptions,
  type WriteOptions,
  type RemoveOptions,
  type CopyOptions,
  type ListOptions,
  type FileEntry,
  type FileStat,
} from '@mastra/core/workspace';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import type { ExecutionService } from './execution.service.js';
import { AGENT_HOME, executionPath } from './paths.js';

/** Native LocalFilesystem operations execute inside the agent's filesystem namespace. */
export class ExecutionFilesystem extends MastraFilesystem {
  status: ProviderStatus = 'pending';
  readonly id = 'pal-execution-files';
  readonly name = 'Agent home';
  readonly provider = 'pal-docker';
  readonly basePath = AGENT_HOME;

  constructor(private readonly execution: ExecutionService) {
    super({ name: 'Agent home' });
  }

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    // Only path arguments are rewritten; file contents and option values are untouched.
    args[0] = executionPath(args[0] as string);
    if (method === 'copyFile' || method === 'moveFile')
      args[1] = executionPath(args[1] as string);
    while (args.length && args.at(-1) === undefined) args.pop();
    const output = await this.execution.output(
      'node',
      ['/opt/pal/execution/filesystem.mjs'],
      {
        input: JSON.stringify({ method, args }),
        maxBytes: 40_000_000,
      },
    );
    const result = JSON.parse(output.toString()) as {
      value: T;
      error?: { message: string; code?: string; name?: string };
    };
    if (result.error)
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
        name: result.error.name ?? 'Error',
      });
    return result.value;
  }

  resolveAbsolutePath(path: string) {
    const absolute = resolve(AGENT_HOME, executionPath(path));
    const suffix = relative(AGENT_HOME, absolute);
    return suffix === '..' ||
      suffix.startsWith('..' + sep) ||
      isAbsolute(suffix)
      ? undefined
      : absolute;
  }

  realpath(path: string) {
    return this.call<string>('realpath', [path]);
  }
  async readFile(
    path: string,
    options?: ReadOptions,
  ): Promise<string | Buffer> {
    const result = await this.call<{ base64: string }>('readFile', [path]);
    const buffer = Buffer.from(result.base64, 'base64');
    return options?.encoding ? buffer.toString(options.encoding) : buffer;
  }
  private content(value: FileContent) {
    return { base64: Buffer.from(value).toString('base64') };
  }
  writeFile(path: string, content: FileContent, options?: WriteOptions) {
    return this.call<void>('writeFile', [path, this.content(content), options]);
  }
  appendFile(path: string, content: FileContent) {
    return this.call<void>('appendFile', [path, this.content(content)]);
  }
  deleteFile(path: string, options?: RemoveOptions) {
    return this.call<void>('deleteFile', [path, options]);
  }
  copyFile(src: string, dest: string, options?: CopyOptions) {
    return this.call<void>('copyFile', [src, dest, options]);
  }
  moveFile(src: string, dest: string, options?: CopyOptions) {
    return this.call<void>('moveFile', [src, dest, options]);
  }
  mkdir(path: string, options?: { recursive?: boolean }) {
    return this.call<void>('mkdir', [path, options]);
  }
  rmdir(path: string, options?: RemoveOptions) {
    return this.call<void>('rmdir', [path, options]);
  }
  readdir(path: string, options?: ListOptions) {
    return this.call<FileEntry[]>('readdir', [path, options]);
  }
  exists(path: string) {
    return this.call<boolean>('exists', [path]);
  }
  async stat(path: string): Promise<FileStat> {
    const result = await this.call<FileStat>('stat', [path]);
    return {
      ...result,
      createdAt: new Date(result.createdAt),
      modifiedAt: new Date(result.modifiedAt),
    };
  }
}
