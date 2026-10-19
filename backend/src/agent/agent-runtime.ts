import type { UserVisibleMessage } from '../chat/chat.types.js';
export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');
export class AgentHandoffError extends Error {
  constructor(
    readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'AgentHandoffError';
  }
}
export interface AgentRuntime {
  submit(message: UserVisibleMessage): Promise<void>;
}
