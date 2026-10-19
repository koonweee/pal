import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PREFERENCE_LIMITS,
  PREFERENCE_PAGE_DEFAULTS,
  PREFERENCE_STATUS_VALUES,
} from '../../preferences/preferences.types.js';
import { ApiPropertyOptional } from '@nestjs/swagger';

const queryArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class PreferenceListQuery {
  @IsOptional()
  @Transform(queryArray)
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.queries)
  @IsString({ each: true })
  @MaxLength(PREFERENCE_LIMITS.query, { each: true })
  queries?: string[];
  @IsOptional() @IsString() @MaxLength(PREFERENCE_LIMITS.topic) topic?: string;
  @IsOptional() @IsIn(PREFERENCE_STATUS_VALUES) status?: 'active' | 'retired';
  @IsOptional() @IsString() @MaxLength(PREFERENCE_LIMITS.cursor) after?: string;
  @IsOptional()
  @ApiPropertyOptional({
    type: Number,
    default: PREFERENCE_PAGE_DEFAULTS.search,
    minimum: 1,
    maximum: PREFERENCE_LIMITS.page,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PREFERENCE_LIMITS.page)
  limit: number = PREFERENCE_PAGE_DEFAULTS.search;
}

export class PreferenceHistoryQuery {
  @IsOptional() @IsString() @MaxLength(PREFERENCE_LIMITS.cursor) after?: string;
  @IsOptional()
  @ApiPropertyOptional({
    type: Number,
    default: PREFERENCE_PAGE_DEFAULTS.history,
    minimum: 1,
    maximum: PREFERENCE_LIMITS.page,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PREFERENCE_LIMITS.page)
  limit: number = PREFERENCE_PAGE_DEFAULTS.history;
}

export class CreatePreferenceDto {
  @IsString() @MaxLength(PREFERENCE_LIMITS.topic) topic!: string;
  @IsString() @MaxLength(PREFERENCE_LIMITS.statement) statement!: string;
  @IsOptional()
  @IsString()
  @MaxLength(PREFERENCE_LIMITS.appliesWhen)
  appliesWhen?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.sources)
  @IsUUID('4', { each: true })
  sourceMessageIds?: string[];
  @IsString() @MaxLength(PREFERENCE_LIMITS.reason) reason!: string;
}

export class UpdatePreferenceDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(PREFERENCE_LIMITS.topic) topic?: string;
  @IsOptional()
  @IsString()
  @MaxLength(PREFERENCE_LIMITS.statement)
  statement?: string;
  @IsOptional()
  @IsString()
  @MaxLength(PREFERENCE_LIMITS.appliesWhen)
  appliesWhen?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.sources)
  @IsUUID('4', { each: true })
  sourceMessageIds?: string[];
  @IsOptional() @IsIn(PREFERENCE_STATUS_VALUES) status?: 'active' | 'retired';
  @IsString() @MaxLength(PREFERENCE_LIMITS.reason) reason!: string;
}
