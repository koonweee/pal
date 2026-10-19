import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import { ApplicationError } from '../application/contracts/errors.js';

export const MAX_FILE_BYTES = 25_000_000;

@Injectable()
export class ApplicationFileStorage {
  private readonly directory: string;
  private readonly active = new Set<string>();

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.directory = resolve(config.getOrThrow<string>('PAL_UPLOAD_DIR'));
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
  }

  /** Internal agent/file-service path; never expose it in adapter views. */
  path(name: string) {
    return resolve(this.directory, name);
  }

  async open(name: string) {
    return open(this.path(name), 'r');
  }

  async remove(name: string) {
    await rm(this.path(name), { force: true });
  }

  release(name: string) {
    this.active.delete(name);
  }

  private validateFilename(value: string) {
    const filename = basename(value.replaceAll('\\', '/'));
    if (
      !filename ||
      filename === '.' ||
      filename === '..' ||
      filename.length > 1024 ||
      filename
        .split('')
        .some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
    )
      throw new ApplicationError('invalid_input', 'Invalid filename');
    return filename;
  }

  private validateContentType(value?: string) {
    const contentType = value || 'application/octet-stream';
    if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(contentType))
      throw new ApplicationError('invalid_input', 'Invalid content type');
    return contentType;
  }

  private limitStream(counter: { bytes: number }) {
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        counter.bytes += chunk.length;
        callback(
          counter.bytes > MAX_FILE_BYTES
            ? new ApplicationError('too_large', 'File exceeds 25 MB')
            : null,
          chunk,
        );
      },
    });
  }

  /** Stores a transport-neutral byte stream; multipart parsing belongs to adapters. */
  async storeStream(input: {
    stream: Readable;
    filename: string;
    contentType?: string;
  }) {
    const id = randomUUID();
    const temporary = id + '.part';
    const filename = this.validateFilename(input.filename);
    const contentType = this.validateContentType(input.contentType);
    const counter = { bytes: 0 };
    this.active.add(temporary);
    this.active.add(id);
    try {
      await pipeline(
        input.stream,
        this.limitStream(counter),
        createWriteStream(this.path(temporary), { flags: 'wx' }),
      );
      return await this.finish(
        id,
        temporary,
        filename,
        contentType,
        counter.bytes,
      );
    } catch (error) {
      await this.remove(temporary);
      await this.remove(id);
      this.release(id);
      throw error;
    } finally {
      this.release(temporary);
    }
  }

  private async finish(
    id: string,
    temporary: string,
    filename: string,
    contentType: string,
    sizeBytes: number,
  ) {
    const detected = await fileTypeFromFile(this.path(temporary)).catch(
      () => undefined,
    );
    const originalExtension = extname(filename).toLowerCase();
    const extension = detected
      ? '.' + detected.ext
      : /^\.[a-z0-9]{1,16}$/.test(originalExtension)
        ? originalExtension
        : '';
    contentType =
      detected?.mime ??
      (contentType.startsWith('image/')
        ? 'application/octet-stream'
        : contentType);
    const storageFilename = id + extension;
    this.active.add(storageFilename);
    try {
      await rename(this.path(temporary), this.path(storageFilename));
      return { id, filename, contentType, sizeBytes, storageFilename };
    } catch (error) {
      this.release(storageFilename);
      throw error;
    } finally {
      if (storageFilename !== id) this.release(id);
    }
  }

  async importFile(input: {
    path: string;
    filename?: string;
    contentType?: string;
  }) {
    const filename = this.validateFilename(
      input.filename ?? basename(input.path),
    );
    const contentType = this.validateContentType(input.contentType);
    const handle = await open(
      input.path,
      constants.O_RDONLY | constants.O_NONBLOCK,
    ).catch(() => {
      throw new ApplicationError('invalid_input', 'File is not readable');
    });
    try {
      const info = await handle.stat();
      if (!info.isFile())
        throw new ApplicationError('invalid_input', 'Expected a regular file');
      if (info.size > MAX_FILE_BYTES)
        throw new ApplicationError('too_large', 'File exceeds 25 MB');
      return await this.storeStream({
        stream: handle.createReadStream({ autoClose: false }),
        filename,
        contentType,
      });
    } finally {
      await handle.close();
    }
  }

  async cleanupOrphans(known: Set<string>, cutoff: Date) {
    for (const name of await readdir(this.directory)) {
      if (
        this.active.has(name) ||
        known.has(name) ||
        !/^[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$/.test(name)
      )
        continue;
      try {
        if ((await stat(this.path(name))).mtime < cutoff)
          await this.remove(name);
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
    }
  }
}
