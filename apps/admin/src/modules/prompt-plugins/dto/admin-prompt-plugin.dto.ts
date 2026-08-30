import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { PromptPluginType } from '../entities/prompt-plugin-item.entity';

export class ListAdminPromptPluginsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;
}

export class UpdateAdminPromptPluginDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  version?: string;

  @IsOptional()
  @IsIn(['injection', 'filter'])
  type?: PromptPluginType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text?: string;
}
