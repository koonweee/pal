import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { DatabaseService } from '../dist/database/database.service.js';

function createDatabase() {
  return new DatabaseService(
    new ConfigService({
      DATABASE_URL: 'postgresql://pal:pal@localhost/pal_test',
    }),
  );
}

it('observes unexpected idle pool failures without making the pool fatal', async () => {
  const errorLog = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const database = createDatabase();
  const error = Object.assign(new Error('connection lost'), {
    code: 'ECONNRESET',
  });
  try {
    expect(() => database.pool.emit('error', error)).not.toThrow();
    expect(errorLog).toHaveBeenCalledWith(
      'PostgreSQL pool connection failed; the discarded connection will be replaced on demand',
      error.stack,
    );
    expect(database.pool.listenerCount('error')).toBe(1);
  } finally {
    await database.onApplicationShutdown();
    errorLog.mockRestore();
  }
});

it('treats a pool failure after the planned-stop signal as shutdown noise', async () => {
  const existingSignalListeners = new Set(process.listeners('SIGTERM'));
  const errorLog = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const database = createDatabase();
  const stopListener = process
    .listeners('SIGTERM')
    .find((listener) => !existingSignalListeners.has(listener));
  try {
    expect(stopListener).toBeDefined();
    stopListener!();
    expect(() =>
      database.pool.emit(
        'error',
        new Error('terminating connection due to administrator command'),
      ),
    ).not.toThrow();
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    await database.onApplicationShutdown();
    errorLog.mockRestore();
  }
});
