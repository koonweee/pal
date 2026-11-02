import {
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  FileReadRequiredError,
  FilesystemError,
  FilesystemNotReadyError,
  IsDirectoryError,
  MastraFilesystem,
  NotDirectoryError,
  PermissionError,
  StaleFileError,
  UnsupportedGrepPatternError,
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
import { AGENT_HOME } from './paths.js';

type RemoteFilesystemError = {
  version?: number;
  domain?: string;
  kind?: string;
  message: string;
  code?: string;
  name?: string;
  path?: string;
  operation?: string;
  expectedMtime?: string;
  actualMtime?: string;
  dest?: string;
  syscall?: string;
  errno?: string | number;
};

const legacyPath = (error: RemoteFilesystemError, prefix: string) =>
  error.path ??
  (error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message);

const validDate = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

function genericError(error: RemoteFilesystemError) {
  return Object.assign(new Error(error.message), {
    name: error.name ?? 'Error',
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.path === undefined ? {} : { path: error.path }),
    ...(error.dest === undefined ? {} : { dest: error.dest }),
    ...(error.syscall === undefined ? {} : { syscall: error.syscall }),
    ...(error.errno === undefined ? {} : { errno: error.errno }),
  });
}

function decodeFilesystemError(error: RemoteFilesystemError) {
  const kind =
    error.version === 1 && error.domain === 'filesystem'
      ? error.kind
      : error.name;
  const path = error.path ?? error.message;
  switch (kind) {
    case 'file_not_found':
    case 'FileNotFoundError':
      return new FileNotFoundError(legacyPath(error, 'File not found: '));
    case 'directory_not_found':
    case 'DirectoryNotFoundError':
      return new DirectoryNotFoundError(
        legacyPath(error, 'Directory not found: '),
      );
    case 'file_exists':
    case 'FileExistsError':
      return new FileExistsError(legacyPath(error, 'File already exists: '));
    case 'is_directory':
    case 'IsDirectoryError':
      return new IsDirectoryError(legacyPath(error, 'Path is a directory: '));
    case 'not_directory':
    case 'NotDirectoryError':
      return new NotDirectoryError(
        legacyPath(error, 'Path is not a directory: '),
      );
    case 'unsupported_grep_pattern': {
      const decoded = new UnsupportedGrepPatternError(path);
      decoded.message = error.message;
      return decoded;
    }
    case 'directory_not_empty':
    case 'DirectoryNotEmptyError':
      return new DirectoryNotEmptyError(
        legacyPath(error, 'Directory not empty: '),
      );
    case 'permission':
      if (error.path && error.operation)
        return new PermissionError(error.path, error.operation);
      return genericError(error);
    case 'file_read_required':
      if (error.path)
        return new FileReadRequiredError(error.path, error.message);
      return genericError(error);
    case 'stale_file': {
      const expected = validDate(error.expectedMtime);
      const actual = validDate(error.actualMtime);
      if (error.path && expected && actual)
        return new StaleFileError(error.path, expected, actual);
      return genericError(error);
    }
    case 'filesystem_not_ready':
      if (error.path) return new FilesystemNotReadyError(error.path);
      return genericError(error);
    case 'filesystem_error':
      if (error.code && error.path)
        return new FilesystemError(error.message, error.code, error.path);
      return genericError(error);
    default:
      return genericError(error);
  }
}

/**
 * Native LocalFilesystem operations execute inside the agent's filesystem namespace.
 * Code SDK 1.16 SandboxFilesystem ignores expectedMtime and puts writes in argv,
 * which fails for large files. This stdin bridge preserves native write checks.
 * This adapter is intentionally not ideal: remove it when Mastra's Docker
 * sandbox offers a filesystem that preserves streamed writes, typed errors,
 * containment and optimistic concurrency.
 */
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
      error?: RemoteFilesystemError;
    };
    if (result.error) throw decodeFilesystemError(result.error);
    return result.value;
  }

  resolveAbsolutePath(path: string) {
    const absolute = resolve(AGENT_HOME, path);
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
