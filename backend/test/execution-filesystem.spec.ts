import {
  createWorkspaceTools,
  FileNotFoundError,
  PermissionError,
  StaleFileError,
  Workspace,
  WORKSPACE_TOOLS,
} from '@mastra/core/workspace';
import { ExecutionFilesystem } from '../dist/execution/execution-filesystem.js';
import type { ExecutionService } from '../dist/execution/execution.service.js';

const filesystemFor = (error: Record<string, unknown>) =>
  new ExecutionFilesystem({
    output: async () => Buffer.from(JSON.stringify({ error })),
  } as unknown as ExecutionService);

it('rehydrates typed filesystem errors returned by execution', async () => {
  const filesystem = filesystemFor({
    version: 1,
    domain: 'filesystem',
    kind: 'file_not_found',
    name: 'FileNotFoundError',
    message: 'File not found: workspace/new.json',
    code: 'ENOENT',
    path: 'workspace/new.json',
  });

  const error = await filesystem
    .exists('workspace/new.json')
    .catch((value) => Promise.resolve(value));
  expect(error).toBeInstanceOf(FileNotFoundError);
  expect(error).toMatchObject({
    code: 'ENOENT',
    path: 'workspace/new.json',
  });
});

it('lets the workspace write tool create a file after a missing stat', async () => {
  const methods: string[] = [];
  const filesystem = new ExecutionFilesystem({
    output: async (_command, _args, options) => {
      const request = JSON.parse(String(options.input)) as { method: string };
      methods.push(request.method);
      if (request.method === 'stat')
        return Buffer.from(
          JSON.stringify({
            error: {
              version: 1,
              domain: 'filesystem',
              kind: 'file_not_found',
              message: 'File not found: workspace/new.json',
              name: 'FileNotFoundError',
              code: 'ENOENT',
              path: 'workspace/new.json',
            },
          }),
        );
      return Buffer.from(JSON.stringify({ value: null }));
    },
  } as unknown as ExecutionService);
  const workspace = new Workspace({ filesystem });
  const tools = await createWorkspaceTools(workspace);

  await expect(
    tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE].execute!(
      { path: 'workspace/new.json', content: '{}' },
      {},
    ),
  ).resolves.toBe('Wrote 2 bytes to workspace/new.json');
  expect(methods).toEqual(['stat', 'writeFile']);
});

it('preserves fields used by permission and stale-write handling', async () => {
  const permission = await filesystemFor({
    version: 1,
    domain: 'filesystem',
    kind: 'permission',
    name: 'PermissionError',
    message: 'Permission denied: write on workspace/file.txt',
    code: 'EACCES',
    path: 'workspace/file.txt',
    operation: 'write',
  })
    .exists('workspace/file.txt')
    .catch((error) => error);
  expect(permission).toBeInstanceOf(PermissionError);
  expect(permission).toMatchObject({
    path: 'workspace/file.txt',
    operation: 'write',
  });

  const expectedMtime = '2026-11-01T00:00:00.000Z';
  const actualMtime = '2026-11-01T00:00:01.000Z';
  const stale = await filesystemFor({
    version: 1,
    domain: 'filesystem',
    kind: 'stale_file',
    name: 'StaleFileError',
    message: 'File was modified externally: workspace/file.txt',
    code: 'ESTALE',
    path: 'workspace/file.txt',
    expectedMtime,
    actualMtime,
  })
    .exists('workspace/file.txt')
    .catch((error) => error);
  expect(stale).toBeInstanceOf(StaleFileError);
  expect(stale).toMatchObject({
    path: 'workspace/file.txt',
    expectedMtime: new Date(expectedMtime),
    actualMtime: new Date(actualMtime),
  });
});

it('rehydrates legacy errors during a backend-first rollout', async () => {
  const filesystem = filesystemFor({
    name: 'FileNotFoundError',
    message: 'File not found: workspace/legacy.json',
    code: 'ENOENT',
  });

  const error = await filesystem
    .exists('workspace/legacy.json')
    .catch((value) => value);
  expect(error).toBeInstanceOf(FileNotFoundError);
  expect(error).toMatchObject({
    code: 'ENOENT',
    path: 'workspace/legacy.json',
  });
});
