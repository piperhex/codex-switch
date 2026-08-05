import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SyncProviderDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsOptional()
  @IsIn(['custom', 'openai'])
  kind?: 'custom' | 'openai' = 'custom';

  @IsString()
  @MaxLength(160)
  name: string;

  @IsString()
  @MaxLength(500)
  baseUrl: string;

  @IsString()
  apiKey: string;

  @IsString()
  @MaxLength(160)
  model: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  models: string[] = [];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contextWindow?: number | null;

  @IsBoolean()
  modelSelectionControlledByCodex: boolean = false;

  @IsIn(['openaiResponses', 'openaiChat'])
  apiFormat: 'openaiResponses' | 'openaiChat';

  @IsOptional()
  @IsIn(['newApi', 'sub2Api'])
  balancePlatform?: 'newApi' | 'sub2Api' | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  balanceQueryUrl?: string | null;

  @IsOptional()
  @IsString()
  balanceQueryToken?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  walletQueryUrl?: string | null;

  @IsOptional()
  @IsString()
  walletQueryToken?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  walletUsername?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  walletPassword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastModifiedAt?: string;
}

export class PutSyncProvidersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncProviderDto)
  providers: SyncProviderDto[];
}
