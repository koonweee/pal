import type { MutableEntity } from '../common/entity.types.js';
export type TaskStatus = 'in-progress' | 'needs-input' | 'completed';
export interface Task extends MutableEntity {
  lastActivityAt: string;
  title: string;
  goal: string;
  status: TaskStatus;
  archived: boolean;
}
export interface DetailedTask extends Task {
  description: string;
}
export interface CreateTask {
  title: string;
  goal: string;
  description?: string;
}

export interface TaskSearchInput {
  queries: string[];
  after?: string;
  limit?: number;
}
export interface TaskSearchCursor {
  queries: string[];
  createdAt: string;
  id: string;
}
