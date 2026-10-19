import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { isUUID } from 'class-validator';
import { ApplicationError } from '../application/contracts/errors.js';
import type { AgentFile } from './files.types.js';
import type { AttachmentRecord } from './files.repository.js';
import { FilesRepository, attachmentView } from './files.repository.js';
import { ApplicationFileStorage } from './application-file-storage.js';
@Injectable()
export class FilesService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FilesService.name);
  private timer?: NodeJS.Timeout;
  private cleanupRun?: Promise<void>;
  constructor(
    @Inject(FilesRepository) private readonly repository: FilesRepository,
    @Inject(ApplicationFileStorage)
    private readonly storage: ApplicationFileStorage,
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
    return this.save(await this.storage.importFile(input));
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
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row)
        throw new ApplicationError(
          'invalid_input',
          'One or more attachments do not exist',
        );
      return {
        ...attachmentView(row),
        path: this.storage.path(row.storageFilename),
      };
    });
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
