import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ChatService } from '../chat/chat.service.js';
import { AGENT_RUNTIME, type AgentRuntime } from '../agent/agent-runtime.js';
import type {
  MessageSubmissionPort,
  SubmitMessageInput,
} from './contracts/chat.js';
import { AgentHandoffError } from '../agent/agent-runtime.js';
import { ApplicationError } from './contracts/errors.js';

@Injectable()
export class ChatCoordinatorService
  implements MessageSubmissionPort, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ChatCoordinatorService.name);
  private closing = false;
  private acceptance: Promise<void> = Promise.resolve();
  private readonly retryableHandoffs = new Set<string>();
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(AGENT_RUNTIME) private readonly runtime: AgentRuntime,
  ) {}
  send(input: SubmitMessageInput) {
    // Native idle submissions can finish preparation out of order. Serialize
    // persistence and handoff only; accepted generation remains independent.
    const submission = this.acceptance.then(() => this.acceptAndSubmit(input));
    this.acceptance = submission.then(
      () => {},
      () => {},
    );
    return submission;
  }
  private async acceptAndSubmit(input: SubmitMessageInput) {
    if (this.closing)
      throw new ApplicationError('unavailable', 'Backend is shutting down');
    const result = await this.chat.accept(input);
    const shouldSubmit =
      result.created || this.retryableHandoffs.delete(result.messageId);
    if (shouldSubmit) {
      try {
        await this.runtime.submit(await this.chat.get(result.messageId));
      } catch (error) {
        const uncertain =
          !(error instanceof AgentHandoffError) || error.uncertain;
        if (!uncertain) this.retryableHandoffs.add(result.messageId);
        this.logger.error('Agent message submission failed');
        throw new ApplicationError(
          'unavailable',
          uncertain
            ? 'Agent acceptance could not be confirmed.'
            : 'Agent could not accept the message. Retry with the same idempotency key.',
        );
      }
    }
    return { messageId: result.messageId };
  }
  beforeApplicationShutdown() {
    this.closing = true;
  }
}
