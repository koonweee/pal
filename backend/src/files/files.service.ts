import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  ExecutionService,
  ExecutionFileError,
} from '../execution/execution.service.js';
import { isUUID } from 'class-validator';
import { ApplicationError } from '../application/contracts/errors.js';
import type { AgentFile } from './files.types.js';
import type { AttachmentRecord } from './files.repository.js';
import { FilesRepository, attachmentView } from './files.repository.js';
import {
  ApplicationFileStorage,
  MAX_FILE_BYTES,
} from './application-file-storage.js';
@Injectable()
export class FilesService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FilesService.name);
  private timer?: NodeJS.Timeout;
  private cleanupRun?: Promise<void>;
  constructor(
    @Inject(FilesRepository) private readonly repository: FilesRepository,
    @Inject(ApplicationFileStorage)
    private readonly storage: ApplicationFileStorage,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
  ) {}
  async onModuleInit() {
    await this.storage.initialize();
    await this.cleanup();
    this.timer = setInterval(
      () => {
        if (!this.cleanupRun)
          this.cleanupRun = this.cleanup()
            .catch((error: unknown) => this.logger.error(error))
            .finally(() => {
              this.cleanupRun = undefined;
            });
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }
  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.cleanupRun;
  }
  /** Saves a client/provider stream without depending on its framing protocol. */
  async upload(input: {
    stream: Readable;
    filename: string;
    contentType?: string;
  }) {
    return (await this.prepareUpload(input)).commit();
  }

  /**
   * Stages bytes until an adapter validates its complete envelope. Call exactly
   * one of `commit` or `discard`; neither operation exposes the storage path.
   */
  async prepareUpload(input: {
    stream: Readable;
    filename: string;
    contentType?: string;
  }) {
    const stored = await this.storage.storeStream(input);
    let settled = false;
    return {
      commit: async () => {
        if (settled)
          throw new ApplicationError('conflict', 'Upload is already settled');
        settled = true;
        return this.save(stored);
      },
      discard: async () => {
        if (settled) return;
        settled = true;
        await this.storage.remove(stored.storageFilename);
        this.storage.release(stored.storageFilename);
      },
    };
  }
  async importFile(input: {
    path: string;
    filename?: string;
    contentType?: string;
  }) {
    let bytes: Buffer;
    try {
      bytes = await this.execution.readFile(input.path, MAX_FILE_BYTES);
    } catch (error) {
      if (error instanceof ExecutionFileError) {
        if (error.kind === 'too_large')
          throw new ApplicationError('too_large', 'File exceeds 25 MB');
        if (error.kind === 'not_file')
          throw new ApplicationError(
            'invalid_input',
            'Expected a regular file',
          );
      }
      throw new ApplicationError('invalid_input', 'File is not readable');
    }
    return this.save(
      await this.storage.storeStream({
        stream: Readable.from(bytes),
        filename: input.filename ?? input.path.split('/').pop() ?? 'file',
        contentType: input.contentType,
      }),
    );
  }
  private async save(file: Omit<AttachmentRecord, 'createdAt'>) {
    try {
      return attachmentView(await this.repository.create(file));
    } catch (error) {
      await this.storage.remove(file.storageFilename);
      throw error;
    } finally {
      this.storage.release(file.storageFilename);
    }
  }
  async manifest(ids: string[]): Promise<AgentFile[]> {
    if (ids.some((id) => !isUUID(id)))
      throw new ApplicationError('invalid_input', 'Invalid attachment ID');
    const rows = await this.repository.getMany(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return Promise.all(
      ids.map(async (id) => {
        const row = byId.get(id);
        if (!row)
          throw new ApplicationError(
            'invalid_input',
            'One or more attachments do not exist',
          );
        const path = this.execution.home + '/incoming/' + row.storageFilename;
        const handle = await this.storage.open(row.storageFilename);
        try {
          await this.execution.sandbox._start();
          await this.execution.sandbox.writeFiles([
            { path, content: await handle.readFile() },
          ]);
        } finally {
          await handle.close();
        }
        return { ...attachmentView(row), path };
      }),
    );
  }
  async get(id: string) {
    const file = await this.repository.get(id);
    if (!file) throw new ApplicationError('not_found', 'File not found');
    return file;
  }

  async content(id: string) {
    const file = await this.get(id);
    try {
      return { file, handle: await this.storage.open(file.storageFilename) };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        throw new ApplicationError('not_found', 'File not found');
      throw error;
    }
  }
  async cleanup() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await this.repository.removeExpired(cutoff);
    for (const file of expired) await this.storage.remove(file.storageFilename);
    await this.storage.cleanupOrphans(
      await this.repository.storageNames(),
      cutoff,
    );
  }
}
