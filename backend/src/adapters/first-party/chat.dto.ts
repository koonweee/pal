import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsObject,
  IsTimeZone,
  ValidateNested,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from './pagination.dto.js';

export class HistoryQuery extends PaginationQuery {
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before?: number;
}

export class MessageMetadataDto {
  @IsOptional() @IsString() @IsTimeZone() timezone?: string;
}

export class SuggestedReplySelectionDto {
  @IsUUID() messageId!: string;
  @IsInt() @Min(0) index!: number;
}

export class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(100) destinationId?: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MessageMetadataDto)
  metadata?: MessageMetadataDto;
  @IsString() @MinLength(1) @MaxLength(200) idempotencyKey!: string;
  @IsString() @MaxLength(100000) text: string = '';
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SuggestedReplySelectionDto)
  suggestedReply?: SuggestedReplySelectionDto;
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @IsUUID() replyToMessageId?: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  attachmentIds: string[] = [];
}
