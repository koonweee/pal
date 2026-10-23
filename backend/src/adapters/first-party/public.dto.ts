import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttachmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty({ minimum: 0 }) sizeBytes!: number;
}

export class MessageReplySummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({ enum: ['user', 'assistant'] }) role!: 'user' | 'assistant';
  @ApiProperty() textPreview!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty({ enum: ['commentary', 'final_answer'], nullable: true })
  phase!: 'commentary' | 'final_answer' | null;
  @ApiProperty() mainVisible!: boolean;
}

export class MessageActionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
}

export class MessageActionsResponseDto {
  @ApiProperty({ type: [MessageActionResponseDto] })
  actions!: MessageActionResponseDto[];
  @ApiProperty({ enum: ['available', 'selected', 'disabled'] })
  state!: 'available' | 'selected' | 'disabled';
  @ApiProperty({ nullable: true }) selectedActionId!: string | null;
}

export class MessageMetadataResponseDto {
  @ApiPropertyOptional() secureEntryRequestId?: string;
  @ApiPropertyOptional() timezone?: string;
}

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({ nullable: true }) source!: string | null;
  @ApiProperty({ nullable: true }) originDestinationId!: string | null;
  @ApiProperty() mainVisible!: boolean;
  @ApiProperty({ nullable: true }) reaction!: string | null;
  @ApiProperty({ type: [String] }) deliveryDestinationIds!: string[];
  @ApiProperty({ type: [String] }) notificationDestinationIds!: string[];
  @ApiProperty() notify!: boolean;
  @ApiProperty({ nullable: true }) idempotencyKey!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) replyToMessageId!:
    string | null;
  @ApiProperty({ type: MessageReplySummaryResponseDto, nullable: true })
  replyTo!: MessageReplySummaryResponseDto | null;
  @ApiProperty({ enum: ['user', 'assistant'] }) role!: 'user' | 'assistant';
  @ApiProperty() text!: string;
  @ApiProperty({ type: MessageMetadataResponseDto })
  metadata!: MessageMetadataResponseDto;
  @ApiProperty({ type: [AttachmentResponseDto] })
  attachments!: AttachmentResponseDto[];
  @ApiProperty({ type: MessageActionsResponseDto, nullable: true })
  actions!: MessageActionsResponseDto | null;
  @ApiProperty({ format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty({ enum: ['commentary', 'final_answer'], nullable: true })
  phase!: 'commentary' | 'final_answer' | null;
}

export class HistoryPageResponseDto {
  @ApiProperty({ type: [MessageResponseDto] }) messages!: MessageResponseDto[];
  @ApiProperty({ minimum: 1, nullable: true }) before!: number | null;
}

export class MessageAcceptedResponseDto {
  @ApiProperty({ format: 'uuid' }) messageId!: string;
}

export class TaskResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ format: 'date-time' }) lastActivityAt!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() title!: string;
  @ApiProperty() goal!: string;
  @ApiProperty({ enum: ['in-progress', 'needs-input', 'completed'] })
  status!: 'in-progress' | 'needs-input' | 'completed';
  @ApiProperty() archived!: boolean;
}

export class TaskDetailsResponseDto extends TaskResponseDto {
  @ApiProperty() description!: string;
}

export class TaskPageResponseDto {
  @ApiProperty({ type: [TaskResponseDto] }) tasks!: TaskResponseDto[];
  @ApiProperty({ nullable: true }) after!: string | null;
}

export class TaskDetailsEnvelopeResponseDto {
  @ApiProperty({ type: TaskDetailsResponseDto }) task!: TaskDetailsResponseDto;
}

export class PreferenceSnapshotResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty() topic!: string;
  @ApiProperty() statement!: string;
  @ApiProperty({ nullable: true }) appliesWhen!: string | null;
  @ApiProperty({ enum: ['user-stated', 'model-inferred'] })
  basis!: 'user-stated' | 'model-inferred';
  @ApiProperty({ type: [String], format: 'uuid' }) sourceMessageIds!: string[];
  @ApiProperty({ enum: ['active', 'retired'] })
  status!: 'active' | 'retired';
}

export class PreferenceSourceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty({ format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty() textPreview!: string;
}

export class PreferenceResponseDto extends PreferenceSnapshotResponseDto {
  @ApiProperty({ type: [PreferenceSourceResponseDto] })
  sources!: PreferenceSourceResponseDto[];
}

export class PreferencePageResponseDto {
  @ApiProperty({ type: [PreferenceSnapshotResponseDto] })
  preferences!: PreferenceSnapshotResponseDto[];
  @ApiProperty({ nullable: true }) after!: string | null;
}

export class PreferenceRevisionResponseDto {
  @ApiProperty({ format: 'uuid' }) preferenceId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: PreferenceSnapshotResponseDto })
  snapshot!: PreferenceSnapshotResponseDto;
  @ApiProperty({ enum: ['human', 'main', 'task'] })
  actor!: 'human' | 'main' | 'task';
  @ApiProperty({ format: 'uuid', nullable: true }) taskId!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PreferenceRevisionPageResponseDto {
  @ApiProperty({ type: [PreferenceRevisionResponseDto] })
  revisions!: PreferenceRevisionResponseDto[];
  @ApiProperty({ nullable: true }) after!: string | null;
}

export class McpAuthResponseDto {
  @ApiProperty({ enum: ['none', 'oauth', 'headers'] })
  type!: 'none' | 'oauth' | 'headers';
  @ApiPropertyOptional() clientId?: string;
  @ApiPropertyOptional() clientMetadataUrl?: string;
  @ApiPropertyOptional() scope?: string;
  @ApiPropertyOptional() hasClientSecret?: boolean;
  @ApiPropertyOptional({ type: [String] }) headerNames?: string[];
}

export class McpStatusResponseDto {
  @ApiProperty({
    enum: ['disabled', 'not-applied', 'connected', 'needs-auth', 'error'],
  })
  state!: 'disabled' | 'not-applied' | 'connected' | 'needs-auth' | 'error';
  @ApiProperty({ minimum: 0 }) toolCount!: number;
  @ApiPropertyOptional() error?: string;
}

export class McpServerResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'uri' }) url!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: McpAuthResponseDto }) auth!: McpAuthResponseDto;
  @ApiProperty() hasLogin!: boolean;
  @ApiProperty() loginPending!: boolean;
  @ApiPropertyOptional() loginError?: string;
  @ApiProperty() applyNeeded!: boolean;
  @ApiProperty({ type: McpStatusResponseDto }) status!: McpStatusResponseDto;
}

export class McpSnapshotResponseDto {
  @ApiProperty() applyNeeded!: boolean;
  @ApiProperty({ type: [McpServerResponseDto] })
  servers!: McpServerResponseDto[];
}

export class IdResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

export class AuthorizationUrlResponseDto {
  @ApiProperty({ format: 'uri' }) authorizationUrl!: string;
}

export class ApplicationErrorResponseDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
  @ApiPropertyOptional({ type: PreferenceResponseDto })
  current?: PreferenceResponseDto;
}

export class MessageEventResponseDto {
  @ApiProperty({ enum: ['message.added', 'message.updated'] })
  event!: 'message.added' | 'message.updated';
  @ApiProperty({ type: MessageResponseDto }) message!: MessageResponseDto;
}

export class TaskEventResponseDto {
  @ApiProperty({ enum: ['task.added', 'task.updated'] })
  event!: 'task.added' | 'task.updated';
  @ApiProperty({ type: TaskResponseDto }) task!: TaskResponseDto;
}

export class ActivityTaskResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
}

export class ActivityCommentaryResponseDto {
  @ApiProperty() messageId!: string;
  @ApiProperty({ minimum: 1 }) sequence!: number;
  @ApiProperty() text!: string;
}

export class RunningTaskResponseDto extends ActivityTaskResponseDto {
  @ApiProperty({ type: ActivityCommentaryResponseDto, nullable: true })
  commentary!: ActivityCommentaryResponseDto | null;
}

export class ActivityCompletionResponseDto extends ActivityTaskResponseDto {
  @ApiProperty() cueId!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}

export class AgentActivityResponseDto {
  @ApiProperty({ minimum: 0 }) revision!: number;
  @ApiProperty() mainWorking!: boolean;
  @ApiProperty({ type: [RunningTaskResponseDto] })
  runningTasks!: RunningTaskResponseDto[];
  @ApiProperty({ type: [ActivityTaskResponseDto] })
  needsInputTasks!: ActivityTaskResponseDto[];
  @ApiProperty({ type: ActivityCompletionResponseDto, nullable: true })
  latestCompletion!: ActivityCompletionResponseDto | null;
  @ApiProperty({ enum: ['idle', 'working'] }) status!: 'idle' | 'working';
}

export class AgentActivityEventResponseDto {
  @ApiProperty({ enum: ['agent.activity'] }) event!: 'agent.activity';
  @ApiProperty({ type: AgentActivityResponseDto })
  state!: AgentActivityResponseDto;
}

export class FrontendUpdatedEventResponseDto {
  @ApiProperty({ enum: ['frontend.updated'] }) event!: 'frontend.updated';
  @ApiProperty() releaseId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) contractVersion!: number;
}

export class HeartbeatEventResponseDto {
  @ApiProperty({ enum: ['heartbeat'] }) event!: 'heartbeat';
}
