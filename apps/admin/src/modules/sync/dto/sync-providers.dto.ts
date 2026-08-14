import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProviderFieldModifiedAtDto {
  @IsOptional() @IsString() @MaxLength(40) kind?: string;
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsString() @MaxLength(40) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(40) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(40) model?: string;
  @IsOptional() @IsString() @MaxLength(40) models?: string;
  @IsOptional() @IsString() @MaxLength(40) modelReasoningEfforts?: string;
  @IsOptional() @IsString() @MaxLength(40) modelContextWindows?: string;
  @IsOptional() @IsString() @MaxLength(40) imageInputModels?: string;
  @IsOptional() @IsString() @MaxLength(40) contextWindow?: string;
  @IsOptional() @IsString() @MaxLength(40) modelSelectionControlledByCodex?: string;
  @IsOptional() @IsString() @MaxLength(40) apiFormat?: string;
  @IsOptional() @IsString() @MaxLength(40) balancePlatform?: string;
  @IsOptional() @IsString() @MaxLength(40) balanceQueryUrl?: string;
  @IsOptional() @IsString() @MaxLength(40) balanceQueryToken?: string;
  @IsOptional() @IsString() @MaxLength(40) walletQueryUrl?: string;
  @IsOptional() @IsString() @MaxLength(40) walletQueryToken?: string;
  @IsOptional() @IsString() @MaxLength(40) walletUsername?: string;
  @IsOptional() @IsString() @MaxLength(40) walletPassword?: string;
}

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
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  models: string[] = [];

  @IsOptional()
  @IsObject()
  modelReasoningEfforts: Record<string, string[]> = {};

  @IsOptional()
  @IsObject()
  modelContextWindows: Record<string, number> = {};

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  imageInputModels: string[] = [];

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
  @IsIn(['newApi', 'sub2Api', 'deepSeek'])
  balancePlatform?: 'newApi' | 'sub2Api' | 'deepSeek' | null;

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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProviderFieldModifiedAtDto)
  fieldModifiedAt?: ProviderFieldModifiedAtDto;
}

export class PutSyncProvidersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncProviderDto)
  providers: SyncProviderDto[];
}
