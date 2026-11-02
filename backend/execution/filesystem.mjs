import {
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  FileReadRequiredError,
  FilesystemError,
  FilesystemNotReadyError,
  IsDirectoryError,
  LocalFilesystem,
  NotDirectoryError,
  PermissionError,
  StaleFileError,
  UnsupportedGrepPatternError,
} from '@mastra/core/workspace';

const filesystemErrorKinds = [
  [FileNotFoundError, 'file_not_found'],
  [DirectoryNotFoundError, 'directory_not_found'],
  [FileExistsError, 'file_exists'],
  [IsDirectoryError, 'is_directory'],
  [NotDirectoryError, 'not_directory'],
  [UnsupportedGrepPatternError, 'unsupported_grep_pattern'],
  [DirectoryNotEmptyError, 'directory_not_empty'],
  [PermissionError, 'permission'],
  [FileReadRequiredError, 'file_read_required'],
  [StaleFileError, 'stale_file'],
  [FilesystemNotReadyError, 'filesystem_not_ready'],
  [FilesystemError, 'filesystem_error'],
];

function serializeError(error) {
  const object = error && typeof error === 'object' ? error : {};
  const kind = filesystemErrorKinds.find(
    ([type]) => error instanceof type,
  )?.[1];
  return {
    version: 1,
    domain: 'filesystem',
    kind: kind ?? 'unknown',
    message:
      typeof object.message === 'string' ? object.message : String(error),
    name: typeof object.name === 'string' ? object.name : 'Error',
    ...(typeof object.code === 'string' ? { code: object.code } : {}),
    ...(typeof object.path === 'string' ? { path: object.path } : {}),
    ...(typeof object.operation === 'string'
      ? { operation: object.operation }
      : {}),
    ...(object.expectedMtime instanceof Date
      ? { expectedMtime: object.expectedMtime.toISOString() }
      : {}),
    ...(object.actualMtime instanceof Date
      ? { actualMtime: object.actualMtime.toISOString() }
      : {}),
    ...(typeof object.dest === 'string' ? { dest: object.dest } : {}),
    ...(typeof object.syscall === 'string' ? { syscall: object.syscall } : {}),
    ...(['string', 'number'].includes(typeof object.errno)
      ? { errno: object.errno }
      : {}),
  };
}

const filesystem = new LocalFilesystem({
  basePath: '/home/pal',
  contained: true,
});
const methods = new Set([
  'readFile',
  'writeFile',
  'appendFile',
  'deleteFile',
  'copyFile',
  'moveFile',
  'mkdir',
  'rmdir',
  'readdir',
  'exists',
  'stat',
  'realpath',
]);
process.stdin.setEncoding('utf8');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 40_000_000)
    throw new Error('File operation exceeds limit');
}
try {
  const { method, args } = JSON.parse(input);
  if (!methods.has(method) || !Array.isArray(args))
    throw new Error('Invalid file operation');
  if (method === 'writeFile' || method === 'appendFile')
    args[1] = Buffer.from(args[1].base64, 'base64');
  if (method === 'writeFile' && args[2]?.expectedMtime)
    args[2].expectedMtime = new Date(args[2].expectedMtime);
  let value = await filesystem[method](...args);
  if (Buffer.isBuffer(value)) value = { base64: value.toString('base64') };
  process.stdout.write(JSON.stringify({ value }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: serializeError(error),
    }),
  );
}
