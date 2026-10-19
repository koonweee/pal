import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { isUUID } from 'class-validator';
import {
  DatabaseService,
  type Transaction,
} from '../database/database.service.js';
import {
  PreferencesRepository,
  type PreferenceRecord,
} from './preferences.repository.js';
import {
  PREFERENCE_LIMITS,
  PREFERENCE_PAGE_DEFAULTS,
  type CreatePreference,
  type Preference,
  type PreferenceRevision,
  type PreferenceSearchCursor,
  type PreferenceSearchInput,
  type PreferenceSnapshot,
  type PreferenceSource,
  type PreferenceWriteActor,
  type UpdatePreference,
} from './preferences.types.js';

export class PreferenceConflictException extends ApplicationError {
  constructor(readonly current: Preference) {
    super('conflict', 'Preference was changed by another editor', { current });
  }
}

@Injectable()
export class PreferencesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PreferencesRepository)
    private readonly repository: PreferencesRepository,
  ) {}

  private snapshot(row: PreferenceRecord): PreferenceSnapshot {
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      topic: row.topic,
      statement: row.statement,
      appliesWhen: row.appliesWhen,
      basis: row.basis,
      sourceMessageIds: row.sourceMessageIds,
      status: row.status,
    };
  }

  private async view(
    row: PreferenceRecord,
    db: Transaction | typeof this.database.db = this.database.db,
  ): Promise<Preference> {
    const sourceRows = await this.repository.sources(row.sourceMessageIds, db);
    const byId = new Map(sourceRows.map((source) => [source.id, source]));
    const sources: PreferenceSource[] = row.sourceMessageIds.flatMap((id) => {
      const source = byId.get(id);
      return source
        ? [
            {
              id: source.id,
              sequence: source.sequence,
              taskId: source.taskId,
              createdAt: source.createdAt.toISOString(),
              textPreview: source.text.slice(
                0,
                PREFERENCE_LIMITS.sourcePreview,
              ),
            },
          ]
        : [];
    });
    return { ...this.snapshot(row), sources };
  }

  private normalizeText(value: string, name: string, max: number) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > max)
      throw new ApplicationError(
        'invalid_input',
        `${name} must be 1 to ${max} characters`,
      );
    return normalized;
  }

  private normalizeNullable(value: string | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null || !value.trim()) return null;
    return this.normalizeText(
      value,
      'Preference applicability',
      PREFERENCE_LIMITS.appliesWhen,
    );
  }

  private validateActor(actor: PreferenceWriteActor) {
    if (actor.actor === 'task') {
      if (!actor.taskId || !isUUID(actor.taskId))
        throw new ApplicationError(
          'invalid_input',
          'Task actor requires a valid task ID',
        );
    } else if (actor.taskId) {
      throw new ApplicationError(
        'invalid_input',
        'Only task edits can include a task ID',
      );
    }
  }

  private async validateSources(ids: string[], tx: Transaction) {
    if (
      ids.length > PREFERENCE_LIMITS.sources ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isUUID(id))
    )
      throw new ApplicationError(
        'invalid_input',
        `Preference sources must contain at most ${PREFERENCE_LIMITS.sources} unique message IDs`,
      );
    const rows = await this.repository.sources(ids, tx);
    if (rows.length !== ids.length || rows.some((row) => row.role !== 'user'))
      throw new ApplicationError(
        'invalid_input',
        'Preference sources must reference existing user messages',
      );
  }

  async resolveSourceSequences(sequences: number[]) {
    if (
      sequences.length > PREFERENCE_LIMITS.sources ||
      new Set(sequences).size !== sequences.length ||
      sequences.some((value) => !Number.isSafeInteger(value) || value < 1)
    )
      throw new ApplicationError(
        'invalid_input',
        `Preference sources must contain at most ${PREFERENCE_LIMITS.sources} unique positive message references`,
      );
    const rows = await this.repository.sourcesBySequence(sequences);
    const bySequence = new Map(rows.map((row) => [row.sequence, row]));
    if (
      rows.length !== sequences.length ||
      rows.some((row) => row.role !== 'user')
    )
      throw new ApplicationError(
        'invalid_input',
        'Preference sources must reference existing user messages',
      );
    return sequences.map((sequence) => bySequence.get(sequence)!.id);
  }

  private requireModelEvidence(actor: PreferenceWriteActor, ids: string[]) {
    if (actor.actor !== 'human' && !ids.length)
      throw new ApplicationError(
        'invalid_input',
        'Model-authored preference changes require a user message source',
      );
  }

  async create(input: CreatePreference, actor: PreferenceWriteActor) {
    this.validateActor(actor);
    const sourceMessageIds = input.sourceMessageIds ?? [];
    this.requireModelEvidence(actor, sourceMessageIds);
    const topic = this.normalizeText(
      input.topic,
      'Preference topic',
      PREFERENCE_LIMITS.topic,
    );
    const statement = this.normalizeText(
      input.statement,
      'Preference statement',
      PREFERENCE_LIMITS.statement,
    );
    const reason = this.normalizeText(
      input.reason,
      'Change reason',
      PREFERENCE_LIMITS.reason,
    );
    const appliesWhen = this.normalizeNullable(input.appliesWhen) ?? null;
    return this.database.transaction(async (tx) => {
      await this.validateSources(sourceMessageIds, tx);
      const row = await this.repository.create(
        {
          topic,
          statement,
          appliesWhen,
          basis: actor.actor === 'human' ? 'user-stated' : input.basis,
          sourceMessageIds,
          status: 'active',
        },
        tx,
      );
      await this.repository.addRevision(
        {
          preferenceId: row.id,
          version: row.version,
          snapshot: this.snapshot(row),
          actor: actor.actor,
          taskId: actor.taskId ?? null,
          reason,
        },
        tx,
      );
      return this.view(row, tx);
    });
  }

  async get(id: string) {
    const row = await this.repository.get(id);
    if (!row) throw new ApplicationError('not_found', 'Preference not found');
    return this.view(row);
  }

  async update(
    id: string,
    input: UpdatePreference,
    actor: PreferenceWriteActor,
  ) {
    this.validateActor(actor);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
      throw new ApplicationError(
        'invalid_input',
        'Expected version must be a positive integer',
      );
    const reason = this.normalizeText(
      input.reason,
      'Change reason',
      PREFERENCE_LIMITS.reason,
    );
    const patch = {
      ...(input.topic !== undefined
        ? {
            topic: this.normalizeText(
              input.topic,
              'Preference topic',
              PREFERENCE_LIMITS.topic,
            ),
          }
        : {}),
      ...(input.statement !== undefined
        ? {
            statement: this.normalizeText(
              input.statement,
              'Preference statement',
              PREFERENCE_LIMITS.statement,
            ),
          }
        : {}),
      ...(input.appliesWhen !== undefined
        ? { appliesWhen: this.normalizeNullable(input.appliesWhen)! }
        : {}),
      ...(input.basis !== undefined ? { basis: input.basis } : {}),
      ...(input.sourceMessageIds !== undefined
        ? { sourceMessageIds: input.sourceMessageIds }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    if (!Object.keys(patch).length)
      throw new ApplicationError(
        'invalid_input',
        'Preference update has no changes',
      );
    return this.database.transaction(async (tx) => {
      const current = await this.repository.lock(id, tx);
      if (!current)
        throw new ApplicationError('not_found', 'Preference not found');
      if (current.version !== input.expectedVersion)
        throw new PreferenceConflictException(await this.view(current, tx));
      const meaningChanged =
        input.topic !== undefined ||
        input.statement !== undefined ||
        input.appliesWhen !== undefined ||
        input.basis !== undefined ||
        input.sourceMessageIds !== undefined;
      const sourceMessageIds =
        input.sourceMessageIds ??
        (actor.actor === 'human' && meaningChanged
          ? []
          : current.sourceMessageIds);
      if (meaningChanged) this.requireModelEvidence(actor, sourceMessageIds);
      await this.validateSources(sourceMessageIds, tx);
      const row = await this.repository.update(
        id,
        {
          ...patch,
          ...(actor.actor === 'human' && meaningChanged
            ? { basis: 'user-stated' as const, sourceMessageIds }
            : {}),
        },
        tx,
      );
      await this.repository.addRevision(
        {
          preferenceId: row.id,
          version: row.version,
          snapshot: this.snapshot(row),
          actor: actor.actor,
          taskId: actor.taskId ?? null,
          reason,
        },
        tx,
      );
      return this.view(row, tx);
    });
  }

  async search(input: PreferenceSearchInput) {
    const queries = [
      ...new Set(
        (input.queries ?? [])
          .map((query) => query.trim().toLowerCase().replace(/\s+/g, ' '))
          .filter(Boolean),
      ),
    ].sort();
    if (
      queries.length > PREFERENCE_LIMITS.queries ||
      queries.some((query) => query.length > PREFERENCE_LIMITS.query)
    )
      throw new ApplicationError(
        'invalid_input',
        `Provide up to ${PREFERENCE_LIMITS.queries} queries of at most ${PREFERENCE_LIMITS.query} characters`,
      );
    const topic = input.topic?.trim() || null;
    if (topic && topic.length > PREFERENCE_LIMITS.topic)
      throw new ApplicationError(
        'invalid_input',
        'Preference topic filter is too long',
      );
    const status = input.status ?? 'active';
    const limit = input.limit ?? PREFERENCE_PAGE_DEFAULTS.search;
    if (!Number.isInteger(limit) || limit < 1 || limit > PREFERENCE_LIMITS.page)
      throw new ApplicationError(
        'invalid_input',
        `Search limit must be between 1 and ${PREFERENCE_LIMITS.page}`,
      );
    let cursor: PreferenceSearchCursor | undefined;
    if (input.after) {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(input.after, 'base64url').toString(),
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !('id' in value) ||
          typeof value.id !== 'string' ||
          !isUUID(value.id) ||
          !('createdAt' in value) ||
          typeof value.createdAt !== 'string' ||
          new Date(value.createdAt).toISOString() !== value.createdAt ||
          !('queries' in value) ||
          JSON.stringify(value.queries) !== JSON.stringify(queries) ||
          !('topic' in value) ||
          value.topic !== topic ||
          !('status' in value) ||
          value.status !== status
        )
          throw new Error();
        cursor = value as PreferenceSearchCursor;
      } catch {
        throw new ApplicationError(
          'invalid_input',
          'Invalid preference cursor',
        );
      }
    }
    const rows = await this.repository.search({
      queries,
      topic,
      status,
      limit,
      cursor,
    });
    const page = rows.slice(0, limit);
    const preferences = page.map((row) => this.snapshot(row));
    const last = page.at(-1);
    return {
      preferences,
      after:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                queries,
                topic,
                status,
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              } satisfies PreferenceSearchCursor),
            ).toString('base64url')
          : null,
    };
  }

  async history(id: string, input: { after?: string; limit?: number }) {
    if (!(await this.repository.get(id)))
      throw new ApplicationError('not_found', 'Preference not found');
    const limit = input.limit ?? PREFERENCE_PAGE_DEFAULTS.history;
    if (!Number.isInteger(limit) || limit < 1 || limit > PREFERENCE_LIMITS.page)
      throw new ApplicationError(
        'invalid_input',
        `History limit must be between 1 and ${PREFERENCE_LIMITS.page}`,
      );
    let beforeVersion: number | undefined;
    if (input.after) {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(input.after, 'base64url').toString(),
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !('preferenceId' in value) ||
          value.preferenceId !== id ||
          !('version' in value) ||
          !Number.isInteger(value.version) ||
          (value.version as number) < 1
        )
          throw new Error();
        beforeVersion = value.version as number;
      } catch {
        throw new ApplicationError(
          'invalid_input',
          'Invalid preference history cursor',
        );
      }
    }
    const rows = await this.repository.history(id, limit, beforeVersion);
    const page = rows.slice(0, limit);
    const revisions: PreferenceRevision[] = page.map((row) => ({
      preferenceId: row.preferenceId,
      version: row.version,
      snapshot: row.snapshot,
      actor: row.actor,
      taskId: row.taskId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
    const last = page.at(-1);
    return {
      revisions,
      after:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                preferenceId: id,
                version: last.version,
              }),
            ).toString('base64url')
          : null,
    };
  }
}
