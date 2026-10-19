import type { Entity } from '../common/entity.types.js';
export interface Attachment extends Entity {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** Private agent context; paths never appear in public API models. */
export interface AgentFile extends Attachment {
  path: string;
}
