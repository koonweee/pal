import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class McpAuthDto {
  @IsIn(['none', 'headers', 'oauth']) type!: 'none' | 'headers' | 'oauth';
  @IsOptional() @IsObject() headers?: Record<string, string> | null;
  @IsOptional() @IsString() @MaxLength(1000) clientId?: string;
  @IsOptional() @IsString() @MaxLength(10000) clientSecret?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) clientMetadataUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) scope?: string;
}

export class SaveMcpServerDto {
  @IsOptional() @Matches(/^[a-z][a-z0-9_]{0,47}$/) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateNested() @Type(() => McpAuthDto) auth?: McpAuthDto;
}
